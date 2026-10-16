# 鲸鱼娘桌宠 · 跨平台版（macOS / Windows）

基于工作区「视觉作品画廊」官方立绘的桌面宠物：透明置顶窗 + 官方 chibi 精灵 + 状态机
（拖拽奔跑 / 单击说话 / 双击喂饭 / 闲置睡觉）。一份代码同时出 **macOS（M 系列芯片）** 和 **Windows** 包。

> 形象与精灵来自工作区 `assets/character-samples/*reference-sheet.webp`，已用 `extract_sprites.py`
> 裁切成 12 个透明 PNG 姿势精灵（站立 / 鞠躬 / 跳跃 / 奔跑 / 思考 / 指挥 + 恢复 / 开机 / 专注 / 休息 / 倦怠 / 补给）。

## 文件结构
```
whalechan-electron/
├── main.js              # Electron 主进程：透明置顶窗 + 托盘🐳菜单 + 拖拽 IPC
├── preload.js           # 安全桥接（contextIsolation）：只暴露拖拽三个原语
├── package.json         # 依赖 + 构建脚本 + electron-builder 配置
├── make_icon.py         # 从官方 logo 生成托盘/应用图标（png/ico/icns）
├── build/               # 图标资源（icon.png / icon.ico / icon.icns + 官方 logo 母版）
└── src/
    ├── whalechan.html   # 桌宠本体：SVG 容器 + 12 精灵 + 状态机 + 交互
    ├── tray.png / tray@2x.png  # 托盘小图标（官方 master logo 16pt/@2x）
    └── sprites/         # 12 个姿势精灵（透明 PNG）+ 一张拼图（不打包）
```

> 图标来源：社区资源库 [TreapGoGo/deepseek-whale-girl](https://github.com/TreapGoGo/deepseek-whale-girl)
> `characters/brand/` 的两张官方 logo——应用图标用 `whale-girl-logo-dynamic-master.png`（发型飘动更生动），
> 托盘小图标用 `whale-girl-logo-master.png`（正脸居中，小尺寸更清晰）。重新生成：`python3 make_icon.py`（需先按脚本头注释 curl 下载母版）。

## 运行环境
- **Node.js ≥ 18**（含 npm）。Windows 朋友机子装个 Node 即可自己构建，或直接收你打好的包。

## 开发预览（可选）
```bash
npm install
npm start          # 直接以 Electron 打开桌宠，调试用
```

## 构建发布包

### 1）macOS（M 系列芯片）
```bash
npm install
npm run dist:mac    # 产出 dist-electron/鲸鱼娘桌宠-*.dmg
```
双击 `.dmg` 拖入「应用程序」即可。首次打开若报「无法验证开发者」：右键 → 打开。

### 2）Windows（给朋友）
**方式 A — 在你的 Mac 上交叉打包**（自动下载 Windows 运行时）：
```bash
npm install
npm run dist:win    # 产出 dist-electron/鲸鱼娘桌宠 Setup *.exe 安装包
```
**方式 B — 朋友在自己的 Windows 上打包**：把整个 `whalechan-electron` 文件夹发过去，装好 Node 后跑上面同样的两条命令。

把 `*.exe` 发给朋友双击安装即可（未签名会被 SmartScreen 拦一下，点「更多信息 → 仍要运行」即可）。

### 一条命令同时出两个平台
```bash
npm run dist        # = dist:mac + dist:win
```
> 跨平台构建需联网下载对应运行时（Mac 包约 80MB、Win 包另需下载），请保持网络畅通。

## 操作方式
| 操作 | 效果 |
|------|------|
| 拖动 | 鲸鱼娘被拎起来撒腿奔跑（原生拖拽，零抖动） |
| 单击 | 随机切换姿势 + 说一句台词（3 秒后恢复站立） |
| 双击 | 喂白米饭🍚（补给姿势，3 秒内点击无效，自动恢复） |
| 闲置 50 秒 | 自动进入「休息」睡觉💤，点击唤醒 |
| 托盘🐳菜单 | 说点什么 / 喂饭 / 切换姿势 / 鼠标穿透开关 / 退出 |
| 点击托盘图标 | 快速切换鼠标穿透（穿透时点击会穿过桌宠落到下层窗口） |

## 与 Swift 原生版的关系
`../whalechan-desktop-pet/` 是早期纯 Swift 原生 Mac 版（更小、更跟手），适合你自己玩；
本目录是**跨平台**版本，用 Electron 统一封装，便于分发给 Windows 朋友。两者形象与交互一致。
