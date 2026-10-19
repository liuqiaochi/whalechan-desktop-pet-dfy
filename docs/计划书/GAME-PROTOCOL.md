# 小游戏接入计划书

| 项目 | 内容 |
|---|---|
| 发起人 | **LomiVeku**（项目所有者） |
| 起草 | WorkBuddy / DeepSeek |
| 日期 | 2026-10-18 |
| 性质 | **新增计划**（不属于 PLAN.md v1.1 原有内容） |
| 对象工程 | `whalechan-desktop-pet-dfy` |
| 对应阶段 | 建议插入 M2.5（宿主 MVP）与 M4.5（接 Live2D） |

> 本文件由 LomiVeku 提出需求、由 AI 起草，用于后续交接时区分"原计划"与"新增计划"。PLAN.md 中凡以「【批注 · 小游戏接入】」开头的段落，均属同一来源。

---

## 一、目标

让桌宠能够：

1. **导入**小游戏（内置 + 第三方包），
2. 向创作者提供**一套协议**，使其作品无需改动桌宠即可接入，
3. 小游戏产出**白饭**，白饭用于投喂，形成「玩 → 赚 → 喂 → 宠物更活泼」的闭环。

两者是同一个东西的两层：**协议是内核，导入器是外壳**。

---

## 二、现状基线（2026-10-18 实测）

| 能力 | 现状 | 位置 |
|---|---|---|
| 安全基线 | `contextIsolation:true` + `nodeIntegration:false` + preload 白名单桥接 | `main.js:20-24`、`preload.js` |
| 遥控通道 | 菜单通过 `executeJavaScript` 调用渲染层 `window.feed` / `speakRandom` | `main.js:86` |
| 逐像素穿透 | `setIgnoreMouseEvents(..., {forward:true})` | `main.js:76` |
| 经济层 | **本计划已落地**：`src/main/wallet.js` | 新增 |
| 游戏宿主 | **本计划已落地 MVP**：`src/main/game-host.js` | 新增 |
| 第一个小游戏 | 鲸歌（社区作品），已按协议改造 | `src/games/whalesong/` |

**两个天然优势（这个项目结构白送的）**：

1. `executeJavaScript` 已经是一条现成的"远程遥控"通道 —— 游戏让桌宠做反应，只需在渲染层加一个 `window.petReact`，**现有状态机一行不用改**。
2. `{forward:true}` 会把宠物窗口透明区的鼠标事件**转发给下层窗口** —— 只要游戏窗口排在宠物下面，玩家点宠物旁边的空白就能直接点到游戏，零代码。

---

## 三、架构

```
┌─ 桌宠外壳（可信，主进程）──────────────────┐
│  钱包与账本   游戏宿主   存档与安装包        │
└───────────────┬───────────────────────────┘
                │ PetGame SDK（IPC 白名单）
┌───────────────┴───────────────────────────┐
│  小游戏（不可信，独立沙箱）                 │
│  无 Node 权限，只能调白名单接口             │
└───────────────────────────────────────────┘
```

三个模块职责划死：

| 模块 | 职责 | 不做什么 |
|---|---|---|
| `wallet.js` | 唯一账本。白饭/心情/胖度、流水、结算定价 | 不管窗口、不管游戏 |
| `game-host.js` | 开窗口、配沙箱、加载资源、生命周期、结算校验 | **不碰余额**，只向 wallet 请求入账 |
| `preload-game.js` | 只暴露 `window.PetGame` | 不暴露任何 Node 能力 |

**关键原则：游戏窗口不设 `transparent`。** 游戏是实心面板，这一条直接把 PLAN.md 里 R3（透明窗 + WebGL 黑块）整条风险绕开。

---

## 四、协议

### 4.1 清单 `petgame.json`

放在游戏包根目录：

```json
{
  "id": "whalesong",
  "name": "鲸歌 · Whale Song",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.html",
  "author": { "name": "社区作者" },
  "window": { "width": 640, "height": 460 },
  "permissions": ["rice.earn", "pet.react"],
  "economy": {
    "scorePerRice": 30,
    "maxPerSession": 25,
    "maxPerDay": 70,
    "minSeconds": 15
  }
}
```

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一，同时是 `app://game/<id>/` 与存储分区名。改 id = 换一个游戏 |
| `apiVersion` | 协议版本，与宿主 `PetGame.version` 对应 |
| `entry` | 入口 HTML，相对包根目录 |
| `window` | 窗口尺寸（320–900 × 240–800 之间夹取） |
| `economy.scorePerRice` | 多少分换 1 白饭。**必须是数字，不能是表达式** |
| `maxPerSession` / `maxPerDay` | 单局 / 单日上限，由**宿主**强制执行 |
| `minSeconds` | 低于此时长不计分（拦"0.1 秒满分"） |

> **安全细节**：`economy` 里一律用数字。若允许 `"Math.floor(score/30)"` 这种字符串，宿主就得 `eval` 第三方 JSON 里的字段 —— 等于把沙箱白建了。

### 4.2 SDK（`window.PetGame`）

由 `preload-game.js` 直接 `contextBridge.exposeInMainWorld`，**创作者零工具链**：不需要 npm、不需要打包、不需要 `<script>`，打开就有。

| 接口 | 签名 | 说明 |
|---|---|---|
| `PetGame.version` | `1` | 协议版本 |
| `PetGame.id` | `"whalesong"` | 本游戏 id |
| `PetGame.ready()` | `→ Promise<{ok, apiVersion, locale}>` | 握手 |
| `PetGame.startSession()` | `→ Promise<{ok}>` | 开一局。**开始时间由主进程记录** |
| `PetGame.submit(score)` | `→ Promise<{awarded, balance, capped}>` | 结算。**`awarded` 是主进程算的** |
| `PetGame.react(mood)` | `'happy'\|'full'\|'sleepy'\|'excited'` | 让桌宠做反应 |
| `PetGame.close()` | `→ void` | 请求关闭 |

`submit` 的返回值设计是关键：游戏传分数，主进程按 `scorePerRice` + 当日累计 + 收益递减算出实际白饭。**即使游戏被改，损失也有上限。**

### 4.3 接入流程（目标：5 步、10 分钟）

1. 复制一个现成游戏包当模板（`src/games/whalesong/`）
2. 改 `index.html` 里的游戏逻辑
3. 改 `petgame.json` 的 id / name / 窗口尺寸 / 经济参数
4. 在"开局"和"结算"两处各加一行 `PetGame` 调用
5. 丢进 `%APPDATA%/whalechan-desktop-pet/games/<id>/`，重启桌宠，菜单「一起玩」里出现

**鲸歌的改造实测量**：两处挂钩 + 一行结算文案，共约 20 行。

---

## 五、安全模型

### 5.1 沙箱（不可降级）

```js
webPreferences: {
  preload: gamePreload,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  partition: 'persist:game-' + id,   // 每游戏独立存储
}
```

外加：

```js
win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
win.webContents.on('will-navigate', (e) => e.preventDefault());
win.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
```

**为什么第一天就要做**：等写了 5 个游戏、代码里到处 `require('fs')` 之后再补沙箱，等于重写。

### 5.2 `app://` 协议与路径穿越防护

游戏用 `fetch()` 加载自己的 json/图集，`file://` 下会被 CORS 拦掉，因此注册特权 scheme：

```js
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard:true, secure:true, supportFetchAPI:true, stream:true },
}]);
```

**必须有路径穿越防护** —— 第三方包里可能有 `../../` 试图读用户文件：

```js
const baseAbs = path.resolve(base);
const target  = path.resolve(baseAbs, rel);
if (target !== baseAbs && !target.startsWith(baseAbs + path.sep)) {
  return new Response('forbidden', { status: 403 });
}
```

### 5.3 防作弊：能做什么、做不到什么

**先说边界**：离线单机、存档在用户机器上，理论上防不住（改内存、改 `wallet.json`、直接调 IPC 都能绕）。目标不是"防住"，是"让投喂循环不被轻易破坏"。

| 能做 | 效果 |
|---|---|
| 主进程算奖励（游戏只传分数） | 拦住 90% 的"直接 submit(999999)" |
| 单局 / 单日上限 | 拦住无限刷 |
| `minSeconds` 会话时长校验 | 拦住"0.1 秒满分" |
| 收益递减（当日第 4 局起 50%） | 多玩有边际收益但不失控 |
| 每游戏独立 `partition` | A 游戏读不到 B 游戏存档 |
| 清单不 `eval` 任何字符串 | 不自己开洞 |

| 不做（别浪费时间） | 原因 |
|---|---|
| 防改 `wallet.json` | 本地文件，用户有完全控制权 |
| 输入重放校验 | 成本极高，除非做排行榜 |
| 服务端签名结算 | 需要账号体系，本期明确不做联网 |

**判断标准**：普通玩家正常玩，赚的白饭刚好够喂饱宠物、略有盈余；想作弊的人能刷，但刷出来的东西不值钱（食物就那几种，心情有上限）。

---

## 六、经济接入

白饭是**唯一货币**，也是食物本身。详见 `docs/WALLET-CONTRACT.md` v0.2。

结算顺序（`wallet.settleGame`，不可调整）：

```
1. 时长校验   elapsed < minSeconds        → awarded=0, capped='too-fast'
2. 分数折算   raw = floor(score / scorePerRice)，夹到 maxPerSession
3. 收益递减   plays >= 3 → awarded = floor(awarded * 0.5)
4. 每日上限   awarded = min(awarded, maxPerDay - 当日已赚)
5. 落盘       rice += awarded；写 ledger；更新 daily
6. 返回       { awarded, balance, capped }
```

> 第 3、4 步的顺序**不能反**：先打折再扣额度，当日额度才能被用满；反过来会白白浪费额度。

商店本期只留货架（`SHOP_ITEMS = []`），`buy()` 的扣款/发货骨架已就位，加商品时只需补 `applyItem()`。

---

## 七、里程碑

| 阶段 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| **M2.5-a** | 经济层（wallet + 心情 + 胖度 + 商店骨架） | 无 | ✅ 已完成 |
| **M2.5-b** | 游戏宿主 + `PetGame` SDK + `app://` 协议 | M2.5-a | ✅ 已完成 |
| **M2.5-c** | 鲸歌接入（第一个按协议跑的第三方游戏） | M2.5-b | ✅ 已完成 |
| **M2.5-d** | 导入器（拖 zip 安装 / 卸载 / 列表 UI） | M2.5-b | ⬜ 待做 |
| **M2.5-e** | 创作者调试环境（浏览器内 mock 宿主） | M2.5-b | ⬜ 待做 |
| **M4.5** | `petReact` 映射到 `Animator`，支持 Live2D 表情/动作 | M4 | ⬜ 待做 |

**验收标准**：让一个没看过桌宠代码的人，只读 `docs/GAME-PROTOCOL.md`，半天内做出一个能正常结算的小游戏。做不到就说明协议还不完整。

---

## 八、风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| G1 | Electron 版本错位（`package.json` 声明 `^44.8.0`，PLAN 1.1.1 记录实跑 `24.22.0`） | `sandbox` / `protocol.handle` 行为有差异 | **动宿主前先统一版本** |
| G2 | 第三方包路径穿越 | 读用户文件 | `app://` 里做 resolve + startsWith 校验 |
| G3 | 经济被刷崩 | 投喂失去意义 | 上限 + 递减 + 定价权在主进程 |
| G4 | 游戏窗口与宠物 z-order 打架 | 点了没反应 | 宠物 `screen-saver`，游戏 `floating` |
| G5 | 用户安装的游戏被 asar 覆盖 | 更新后游戏丢失 | 用户游戏放 `userData/games/`，不进 asar |
| G6 | 协议破坏性变更伤害创作者 | 作品白屏 | `apiVersion` + 弃用策略，旧版本至少保留两个大版本 |

---

## 九、明确不做

- 游戏市场 / 在线分发 / 审核签名（有 3 个以上第三方游戏之前，全是负资产）
- 排行榜（会引出重放校验，吃掉三个月）
- 联网账号与云端结算
- 在桌宠里实现游戏引擎（我们只做宿主，不做运行时）

---

*本文件随实施进展更新。*
