#!/usr/bin/env python3
"""生成逐像素点击穿透遮罩 src/alpha-masks.js

桌宠窗口是 260x330 的矩形，但角色只占其中一部分；透明区域依然参与系统鼠标命中，
会挡住下层窗口的点击。解决方式是「逐像素点击穿透」：只有角色不透明的像素才接收鼠标。

做法：对 src/sprites/*.png 的 alpha 通道按 COLS 列等比降采样（BOX 均值），
alpha > ALPHA_T 的格子标记为不透明(1)，按位打包后 base64 写入 src/alpha-masks.js。
运行时按光标在图片矩形内的相对位置查表即可。

用法：
    python make_alpha.py
新增或修改精灵后需重新运行一次。
"""
import base64
import glob
import json
import os

from PIL import Image

COLS = 64          # 掩码横向格数（纵向按图片宽高比等比推导）
ALPHA_T = 16       # alpha 阈值：>16 视为不透明（剔除极淡的半透明雾状边）

SRC_GLOB = 'src/sprites/*.png'
OUT_FILE = 'src/alpha-masks.js'


def pack_bits(bits):
    """把 0/1 序列按 MSB-first 打包成字节，再 base64 编码。"""
    out = bytearray()
    cur = 0
    n = 0
    for b in bits:
        cur = (cur << 1) | (1 if b else 0)
        n += 1
        if n == 8:
            out.append(cur)
            cur = 0
            n = 0
    if n:
        out.append(cur << (8 - n))
    return base64.b64encode(bytes(out)).decode('ascii')


def build():
    entries = []
    for p in sorted(glob.glob(SRC_GLOB)):
        name = os.path.splitext(os.path.basename(p))[0]
        if name.startswith('_'):
            continue                      # 跳过 _contact_sheet.png 之类的参考图
        im = Image.open(p).convert('RGBA')
        w, h = im.size
        if w <= 0 or h <= 0:
            continue
        rows = max(1, round(COLS * h / w))
        alpha = im.getchannel('A').resize((COLS, rows), Image.BOX)
        px = alpha.load()
        bits = [1 if px[x, y] > ALPHA_T else 0 for y in range(rows) for x in range(COLS)]
        entries.append((name, rows, pack_bits(bits)))

    lines = [
        '// 自动生成：由 make_alpha.py 根据 src/sprites/*.png 的 alpha 通道生成，请勿手改。',
        '// 用途：逐像素点击穿透——掩码为 1 的格子（角色不透明处）才接收鼠标，透明处放行给下层窗口。',
        '(function(){',
        '  window.ALPHA_MASKS = {',
        '    masks: {',
    ]
    for name, rows, b64 in entries:
        lines.append('      %s: { cols: %d, rows: %d, b64: "%s" },' % (json.dumps(name), COLS, rows, b64))
    lines += [
        '    }',
        '  };',
        '})();',
        '',
    ]
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('generated %s (%d masks)' % (OUT_FILE, len(entries)))


if __name__ == '__main__':
    build()
