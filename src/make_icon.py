#!/usr/bin/env python3
"""生成宠物伴侣欧鲸鲸的应用图标与托盘图标。

应用图标素材：build/icon-source.png（用户提供的新立绘，白底）
  流程：去白底(四角 flood fill) → 裁切居中补方 → 生成 icon.png / icon.ico / icon.icns
托盘图标素材：build/whale-girl-logo-master.png（官方正脸 logo，16pt/@2x；缺失则跳过）

运行：python src/make_icon.py   （可在项目任意目录运行；脚本按自身位置解析路径）
"""
import os
import struct
from io import BytesIO
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))   # 本脚本所在目录（src/）
ROOT = os.path.dirname(HERE)                        # 项目根目录
BUILD = os.path.join(ROOT, "build")


def load(name):
    p = os.path.join(BUILD, name)
    if not os.path.exists(p):
        raise SystemExit(f"缺少 {p}")
    return Image.open(p).convert("RGBA")


def remove_white_bg(im, thresh=20):
    """从四角 flood fill，把连通的白色背景变透明（保留角色内部的白 ）。"""
    w, h = im.size
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(im, seed, (0, 0, 0, 0), thresh=thresh)
    return im


def square_pad(im, pad_ratio=0.06):
    """裁到不透明包围盒，再四周留边补成正方形。"""
    bbox = im.getbbox()
    im2 = im.crop(bbox) if bbox else im
    bw, bh = im2.size
    s = max(bw, bh)
    pad = int(s * pad_ratio)
    S = s + pad * 2
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.paste(im2, ((S - bw) // 2, (S - bh) // 2), im2)
    return canvas


def fit_square(im):
    w, h = im.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    return im.crop((left, top, left + s, top + s))


def _png_bytes(img, sz):
    b = BytesIO()
    img.resize((sz, sz), Image.LANCZOS).save(b, format="PNG")
    return b.getvalue()


def write_icns(img, out):
    """手写 ICNS（PNG 内嵌条目，现代 macOS 支持），无需 macOS 的 sips。"""
    entries = [
        (b"icp4", 16), (b"icp5", 32), (b"icp6", 64),
        (b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024),
        (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 512),
    ]
    body = b""
    for t, sz in entries:
        data = _png_bytes(img, sz)
        body += t + struct.pack(">I", len(data) + 8) + data
    with open(out, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


# ---- 应用图标（新立绘）----
app_src = square_pad(remove_white_bg(load("icon-source.png")))
app_src.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD, "icon.png"))
app_src.resize((512, 512), Image.LANCZOS).save(
    os.path.join(BUILD, "icon.ico"),
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
)
write_icns(app_src, os.path.join(BUILD, "icon.icns"))
print("build/icon.png / build/icon.ico / build/icon.icns 已生成（新立绘）")

# ---- 托盘图标（官方正脸版，16pt + @2x；素材缺失则跳过）----
if os.path.exists(os.path.join(BUILD, "whale-girl-logo-master.png")):
    tray_src = fit_square(load("whale-girl-logo-master.png"))
    tray_src.resize((16, 16), Image.LANCZOS).save(os.path.join(HERE, "tray.png"))
    tray_src.resize((32, 32), Image.LANCZOS).save(os.path.join(HERE, "tray@2x.png"))
    print("src/tray.png / src/tray@2x.png 已生成（官方 master logo）")
else:
    print("跳过托盘图标（缺 build/whale-girl-logo-master.png）")
