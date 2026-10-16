#!/usr/bin/env python3
"""从官方鲸鱼娘 logo 生成桌宠图标。

素材来源（社区资源库 TreapGoGo/deepseek-whale-girl，characters/brand/）：
  - whale-girl-logo-dynamic-master.png  → 应用图标（icon.png / icon.ico，发型飘动更生动）
  - whale-girl-logo-master.png          → 托盘小图标（正脸居中，小尺寸更清晰）

如两个 master 图缺失，先下载：
  curl -sSL -o build/whale-girl-logo-master.png \
    https://raw.githubusercontent.com/TreapGoGo/deepseek-whale-girl/main/characters/brand/whale-girl-logo-master.png
  curl -sSL -o build/whale-girl-logo-dynamic-master.png \
    https://raw.githubusercontent.com/TreapGoGo/deepseek-whale-girl/main/characters/brand/whale-girl-logo-dynamic-master.png

macOS 的 ICNS 用 sips 转换（见 README 构建步骤）。
"""
import os
import sys
from PIL import Image

BUILD = "build"

def load(name):
    p = os.path.join(BUILD, name)
    if not os.path.exists(p):
        sys.exit(f"缺少 {p}，请先用脚本头部注释里的 curl 命令下载官方 logo")
    return Image.open(p).convert("RGBA")

def fit_square(im):
    """1254x1254 本就正方形；兼容未来非方形素材：取中心正方形。"""
    w, h = im.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    return im.crop((left, top, left + s, top + s))

# ---- 应用图标（dynamic 版）----
app_src = fit_square(load("whale-girl-logo-dynamic-master.png"))
icon512 = app_src.resize((512, 512), Image.LANCZOS)
icon512.save(os.path.join(BUILD, "icon.png"))
icon512.save(
    os.path.join(BUILD, "icon.ico"),
    sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)],
)
print("build/icon.png / build/icon.ico 已生成（官方 dynamic logo）")

# ---- 托盘图标（master 正脸版，16pt + @2x）----
tray_src = fit_square(load("whale-girl-logo-master.png"))
tray_src.resize((16, 16), Image.LANCZOS).save("src/tray.png")
tray_src.resize((32, 32), Image.LANCZOS).save("src/tray@2x.png")
print("src/tray.png / src/tray@2x.png 已生成（官方 master logo）")
