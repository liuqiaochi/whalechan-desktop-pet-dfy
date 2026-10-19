# 鲸鱼娘桌宠 · 跨平台版（macOS / Windows）

基于「视觉作品画廊」官方 chibi 立绘的桌面宠物：透明置顶窗 + 官方精灵 + 状态机
（拖拽奔跑 / 单击说话 / 双击喂饭 / 闲置睡觉）。一份代码同时出 **macOS（Apple 芯片）** 与 **Windows** 包，
也支持 Linux 打包。

> 形象与精灵来自工作区 `assets/character-samples/*reference-sheet.webp`，已用 `extract_sprites.py`
> 裁切成 13 个透明 PNG 姿势精灵（站立 / 鞠躬 / 跳跃 / 奔跑 / 思考 / 指挥 + 恢复 / 开机 / 专注 / 休息 / 倦怠 / 补给 / 拎起）。

---

## 一、文件结构

```
whalechan-desktop-pet-dfy/
├── main.js              # Electron 主进程：透明置顶窗 + 托盘🐳菜单（拖拽：按光标增量移动窗口）
├── preload.js           # 安全桥接（contextIsolation）：dragBegin / dragEnd / showContextMenu / setIgnoreMouse
├── package.json         # 依赖 + 构建脚本 + electron-builder 配置
├── package.js           # 一键打包：自动识别系统，输出到 release/（带锁自动兜底）
├── start.bat            # Windows 免安装快速运行（直接用本地 Electron 跑源码，不打包）
├── build/               # 图标资源（icon.png / icon.ico / icon.icns + 母版 + 来源 logo）
├── src/
│   ├── whalechan.html   # 桌宠本体：SVG 容器 + 13 精灵 + 状态机 + 交互
│   ├── alpha-masks.js   # 逐像素点击穿透遮罩（make_alpha.py 生成，勿手改）
│   ├── tray.png / tray@2x.png  # 托盘小图标
│   ├── make_icon.py     # 生成托盘/应用图标（png/ico/icns）
│   ├── make_alpha.py    # 生成逐像素点击穿透遮罩 src/alpha-masks.js（精灵变更后需重跑）
│   └── sprites/         # 13 个姿势精灵（透明 PNG）+ 一张拼图（不打包）
└── LICENSE              # 代码许可证（MIT）
```

> 图标来源：社区资源库 [TreapGoGo/deepseek-whale-girl](https://github.com/TreapGoGo/deepseek-whale-girl)
> `characters/brand/` 的两张官方 logo——应用图标用 `whale-girl-logo-dynamic-master.png`（发型飘动更生动），
> 托盘小图标用 `whale-girl-logo-master.png`（正脸居中，小尺寸更清晰）。重新生成：`python3 src/make_icon.py`（需先按脚本头注释 curl 下载母版）。
>
> ⚠️ 以下目录为**构建产物 / 缓存**，已被 `.gitignore` 忽略，**不属于源码**，可随时删（部分在 Windows 上会被杀软持锁，重启后即可删除）：
> `node_modules/`、`.electron-dist/`、`_e30/`、`_e44/`、`dist-dev/`、`dist-electron/`、`dist-win/`、`dist-run/`、`release/`、`pkg-out*/`。

---

## 二、环境要求与依赖

本项目只有两类依赖，均在 `package.json` 的 `devDependencies` 中声明：

| 依赖 | 版本 | 用途 | 是否需要 |
|------|------|------|----------|
| **Node.js**（含 npm） | ≥ 18 | 运行脚本、安装依赖 | 必需 |
| `electron` | `^44.8.0` | 运行时 + `start.bat` 运行桌宠 | 运行 / 打包都需要 |
| `electron-builder` | `^26.15.3` | 打包安装包（NSIS / DMG / AppImage） | 仅打包需要 |

> 说明：Electron 的实际运行版本由 `npm install` 拉取的 `node_modules/electron/dist` 决定；
> 打包脚本会优先复用本机已安装的 `node_modules/electron/dist`，跳过下载，规避 Windows 下的文件锁。

### 安装依赖

```bash
# 在项目根目录执行一次（之后 start / 打包 都依赖它）
npm install
```

> 国内网络较慢时，可先设置镜像再安装：
> ```bash
> npm config set registry https://registry.npmmirror.com/
> npm install
> ```

---

## 三、快速开始（免安装运行）

开发预览 / 日常测试最推荐的方式 —— 直接拿本地 Electron 跑当前源码，**不打包、不产生 `dist-dev`、无文件锁问题**：

- **Windows**：双击 `start.bat`（内部执行 `node_modules\electron\dist\electron.exe .`）。
  需先 `npm install` 一次把 Electron 运行时装好。
- **macOS / Linux**：终端执行
  ```bash
  npm start          # 等价于 electron .
  ```

> 首次运行若提示找不到 Electron，请先执行上面的 `npm install`。

---

## 四、一键打包（自动识别系统）

```bash
node package.js      # 任意平台（Windows 直接运行即可，无需额外批处理）
```

脚本会检测当前系统并打出对应安装包，默认输出到 **`release/`**：
若 `release/` 被系统占用（如杀软持锁、待重启清理），**自动改用 `pkg-out-<时间戳>/`**，不会因此打包失败。

| 系统 | 产物 |
|------|------|
| Windows | `鲸鱼娘桌宠 Setup *.exe`（NSIS 安装包） |
| macOS | `鲸鱼娘桌宠-*.dmg` |
| Linux | `*.AppImage` / `*.deb` |

> - Mac 的 dmg **必须在 macOS 上打**（Windows 无法生成 dmg）；Windows 包在 Windows 上打。
> - 未签名安装包首次运行会被 SmartScreen / Gatekeeper 拦一下：Windows 点「更多信息 → 仍要运行」，
>   macOS 在「系统设置 → 隐私与安全性」里允许即可。

### 底层命令（等价，可选）

```bash
npm run dist:win    # Windows（输出 release/）
npm run dist:mac    # macOS（输出 release/）
npm run dist        # 双平台（mac + win）
```

---

## 五、操作方式

| 操作 | 效果 |
|------|------|
| 拖动 | 鲸鱼娘被拎起来撒腿奔跑（渲染层判定 + 主进程按光标增量移动窗口，跨次不累积偏移） |
| 单击 | 随机切换姿势 + 说一句台词（3 秒后恢复站立） |
| 双击 | 喂白米饭🍚（补给姿势，3 秒内点击无效，自动恢复） |
| 闲置 50 秒 | 自动进入「休息」睡觉💤，点击唤醒 |
| 透明区域 | 自动点击穿透：只有角色不透明像素接收鼠标，空白处点击直接落到下层窗口 |
| 托盘🐳菜单 | 说点什么 / 喂饭 / 切换姿势 / 鼠标穿透开关 / 退出 |
| 点击托盘图标 | 快速切换鼠标穿透（穿透时点击会穿过桌宠落到下层窗口） |

---

## 六、与 Swift 原生版的关系

`../whalechan-desktop-pet/` 是早期纯 Swift 原生 Mac 版（更小、更跟手），适合自己玩；
本目录是**跨平台**版本，用 Electron 统一封装，便于分发给 Windows 朋友。两者形象与交互一致。

---

## 七、⚠️ 免责声明（无责声明）

请在使用前阅读以下条款。**下载、复制、运行或分发本项目即视为已同意本声明。**

1. **「现状」提供，无担保**：本项目（含全部源码与脚本）按「现状（AS IS）」提供，**不作任何明示或暗示的担保**，
   包括但不限于对适用性、无侵权、无缺陷、特定用途适用性的担保。软件可能存在 bug，运行风险由使用者自行承担。
2. **不保证维护与支持**：作者不承诺持续更新、修复缺陷或提供技术支持；因软件故障、数据丢失、系统异常等
   造成的任何直接或间接损失，作者不承担责任。
3. **非官方关联**：本项目与任何第三方（包括但不限于 DeepSeek 及相关主体）**无官方隶属或授权关系**，
   名称、形象、文案若涉及第三方商标、著作权或其他知识产权，均归各自权利人所有。
4. **素材版权与授权**：项目内精灵图、图标等美术资源来自社区资源 / 官方样张，**其著作权归原作者或社区所有**，
   本项目仅以「学习、个人娱乐」目的引用，**不构成对任何素材的授权或转让**。使用者须自行确认所用素材的授权范围，
   并遵守所在国家/地区的法律法规。因使用素材引发的任何侵权争议或法律责任，**由使用者自行承担，与本项目作者无关**。
5. **使用范围**：本项目**仅供个人学习与非商业娱乐用途**。如需用于商业用途或对素材进行再分发，
   须另行取得相应素材权利人的书面授权。
6. **自行打包与分发**：使用者自行打包、修改、二次分发所产生的任何后果（含合规与法律风险）由使用者自行负责。
7. **侵权处理**：若任何权利人认为本项目内容侵犯其合法权益，可通过项目主页提交 issue 或联系作者，
   核实后我们将及时删除相关内容。

---

## 八、开源与许可证

- **源代码**：本项目源码以 **MIT License** 发布（详见 [`LICENSE`](./LICENSE)）。
  你可以自由使用、复制、修改、合并、再发布，但须**保留原始版权声明与许可声明**，且作者不对使用后果承担责任。
- **美术素材（sprites / icons）**：**不**随源码以 MIT 许可证发布。素材的权利归原作者 / 社区所有，
  其使用须遵循素材原始许可与当地法律（见第七节第 4、5 条）。将源码与素材一并用于商业或再分发前，
  请务必另行取得素材授权。
- **第三方依赖**：`electron`、`electron-builder` 等依赖遵循各自的许可证，与本项目的 MIT 许可无关。

> 简言之：代码你随便玩（保留署名即可），但里面的鲸鱼娘形象属于第三方素材，商用请先拿到授权。

---

## 九、常见问题 / 故障排查

**Q：`start.bat` 双击后闪退 / 提示找不到 electron.exe？**
A：先在本项目目录执行 `npm install` 安装依赖；`start.bat` 依赖 `node_modules/electron/dist/electron.exe`。

**Q：打包时报 `Cannot find module .../electron-builder/cli.js`？**
A：同样先 `npm install`；`package.js` 需要 `electron-builder` 在场。

**Q：Windows 下 `release/`、`dist-*` 等目录删不掉（提示被占用）？**
A：多为杀软（如 Windows Defender）对 `*.asar` 的实时扫描持锁所致。重启一次电脑通常即可解锁删除；
本项目也可直接改用 `pkg-out-<时间戳>/` 输出，不影响出包。这些目录均已被 `.gitignore` 忽略，不影响源码与提交。

**Q：Mac 上打出来的包打不开 / 被拦截？**
A：未签名 DMG 会被 Gatekeeper 拦。在「系统设置 → 隐私与安全性」里找到被拦截的记录，点击「仍要打开」即可。
如需彻底免拦，需自行申请 Apple Developer 证书签名。

**Q：桌宠周围的空白区域会挡住下层窗口的点击？**
A：已内置**逐像素点击穿透**——按每个精灵的 alpha 遮罩判定，只有角色不透明像素才接收鼠标，透明区域自动放行给下层窗口。
若更换 / 新增精灵后穿透区域与形象不符，请重新运行 `python src/make_alpha.py` 生成 `src/alpha-masks.js`。

**Q：想换掉鲸鱼娘形象？**
A：替换 `src/sprites/` 下对应姿势 PNG 即可（建议保持透明背景、尺寸一致），并运行 `python src/make_alpha.py` 重建点击遮罩；
托盘图标换 `src/tray.png`、`tray@2x.png`；应用图标换 `build/` 后运行 `python3 src/make_icon.py` 重新生成。

---

© 2026 laofei. 本项目仅供学习与非商业用途。
