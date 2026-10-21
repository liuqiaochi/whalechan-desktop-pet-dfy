#!/usr/bin/env python3
"""从视频生成走路动画帧：src/sprites/walk_animation.mp4 → src/sprites/walk/*.png

视频是白底、无透明通道（720x960 / 24fps / 约 4.4s），右下角带「豆包AI生成」水印。
本脚本做四件事：

1. 用 ffmpeg 抽全部帧到临时目录；
2. **从边界泛洪**抠掉白底——只清除与画面边缘连通的近白像素，围裙/白袜/荷叶边
   这些被深色轮廓包住的白色会被保留（不能用全局去白）；
3. 单独擦掉右下角水印（仅该区域内"浅色"像素，角色深色部分不受影响）；
4. 自动找循环窗口：以帧差最小确定一个步态周期，再选首尾最接近的起点，
   取一个周期导出；32 帧统一按并集包围盒裁剪并缩放到统一高度
   （帧尺寸/相对位置一致，播放不抖），额外输出 walk.png 并集剪影供点击遮罩用。

用法：
    python src/make_walk_from_video.py     （需 ffmpeg + numpy/scipy/pillow）
    python src/make_alpha.py               （之后重建点击穿透遮罩）

输出帧数会打印出来，需与 src/whalechan.html 的 WALK_FRAMES 保持一致。
"""
import glob
import os
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'sprites', 'walk_animation.mp4')
OUT_DIR = os.path.join(HERE, 'sprites', 'walk')
SILHOUETTE = os.path.join(HERE, 'sprites', 'walk.png')

OUT_H = 300          # 输出帧高度（显示时按 232px 等比缩放，留出高清余量）
ALPHA_T = 40         # 有内容判定阈值（与并集包围盒/剪影一致）
WHITE_MIN = 232      # 近白：三通道最小值高于此
WHITE_RANGE = 14     # 近白：通道最大差小于此（排除偏色）
FEATHER = 0.7        # 边缘羽化半径


def extract_frames(tmp):
    """用 ffmpeg 抽帧，返回按序号排序的文件列表。"""
    cmd = ['ffmpeg', '-v', 'error', '-i', SRC, '-vsync', '0', os.path.join(tmp, 'f_%03d.png')]
    subprocess.run(cmd, check=True)
    fs = sorted(glob.glob(os.path.join(tmp, 'f_*.png')))
    if not fs:
        raise SystemExit('错误：没抽到任何帧，请确认 ffmpeg 可用且视频存在')
    return fs


def key_frame(path):
    """白底泛洪抠图 + 擦水印，返回 RGBA Image。"""
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    near_white = (a.min(axis=2) > WHITE_MIN) & ((a.max(axis=2) - a.min(axis=2)) < WHITE_RANGE)
    seed = np.zeros_like(near_white)
    seed[0, :] = near_white[0, :]
    seed[-1, :] = near_white[-1, :]
    seed[:, 0] = near_white[:, 0]
    seed[:, -1] = near_white[:, -1]
    bg = ndimage.binary_propagation(seed, mask=near_white)
    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # 擦水印：仅右下角区域内的浅色像素（角色在该区域的深色部分保留）
    h, w = alpha.shape
    region = np.zeros_like(alpha, dtype=bool)
    region[int(h * 0.92):, int(w * 0.66):] = True
    light = a.min(axis=2) > 140
    alpha[region & light] = 0

    out = np.dstack([np.asarray(im).astype(np.uint8), alpha])
    img = Image.fromarray(out, 'RGBA')
    if FEATHER > 0:
        img.putalpha(img.getchannel('A').filter(ImageFilter.GaussianBlur(FEATHER)))
    return img


def mask_of(img, size=(180, 240)):
    """缩小的二值剪影，用于帧差比较。"""
    al = img.getchannel('A').point(lambda v: 255 if v > ALPHA_T else 0)
    return np.asarray(al.resize(size, Image.BOX), dtype=np.float32) / 255.0


def detect_cycle(masks):
    """以平均帧差最小求步态周期，再选首尾最接近的起点；返回 (start, period)。"""
    n = len(masks)
    best_period, best_err = None, 1e9
    for p in range(10, max(11, n // 2)):
        err = float(np.mean([np.abs(masks[i] - masks[i + p]).mean() for i in range(0, n - p, 2)]))
        if err < best_err:
            best_period, best_err = p, err
    p = best_period
    best_start, best_seam = 0, 1e9
    for s in range(0, n - p):
        seam = float(np.abs(masks[s] - masks[s + p]).mean())
        if seam < best_seam:
            best_start, best_seam = s, seam
    return best_start, p


def main():
    tmp = tempfile.mkdtemp(prefix='walkv_')
    try:
        fs = extract_frames(tmp)
        imgs = [key_frame(f) for f in fs]
        masks = [mask_of(i) for i in imgs]
        start, period = detect_cycle(masks)
        print('总帧 %d，周期 %d 帧，起始帧 %d' % (len(imgs), period, start + 1))
        cycle = imgs[start:start + period]

        # 并集包围盒（统一裁剪，保留原始动画的相对位置）
        union = None
        for img in cycle:
            bb = img.getchannel('A').point(lambda v: 255 if v > ALPHA_T else 0).getbbox()
            if not bb:
                continue
            union = bb if union is None else (min(union[0], bb[0]), min(union[1], bb[1]),
                                              max(union[2], bb[2]), max(union[3], bb[3]))
        if not union:
            raise SystemExit('错误：抠图后无内容')
        x0, y0, x1, y1 = union
        print('并集包围盒 %s → %dx%d' % (union, x1 - x0, y1 - y0))

        # 清掉旧帧（本脚本产物，命名固定 walk_NN.png）
        for old in glob.glob(os.path.join(OUT_DIR, 'walk_*.png')):
            os.remove(old)
        os.makedirs(OUT_DIR, exist_ok=True)

        sw = round((x1 - x0) * OUT_H / (y1 - y0))
        frames = []
        for i, img in enumerate(cycle, 1):
            f = img.crop(union).resize((sw, OUT_H), Image.LANCZOS)
            f.save(os.path.join(OUT_DIR, 'walk_%02d.png' % i), optimize=True)
            frames.append(f)

        # 并集剪影：逐像素取各帧 alpha 最大值，供 make_alpha.py 生成单张 'walk' 遮罩
        sil_a = np.zeros((OUT_H, sw), dtype=np.uint8)
        for f in frames:
            sil_a = np.maximum(sil_a, np.asarray(f.getchannel('A')))
        sil = frames[0].copy()
        sil.putalpha(Image.fromarray(sil_a))
        sil.save(SILHOUETTE, optimize=True)

        print('输出 %d 帧 → %s（%dx%d）' % (len(frames), OUT_DIR, sw, OUT_H))
        print('并集剪影 → %s' % SILHOUETTE)
        print('提醒：请确保 whalechan.html 的 WALK_FRAMES = %d，WALK_MS ≈ %d'
              % (len(frames), round(1000 / 24)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
