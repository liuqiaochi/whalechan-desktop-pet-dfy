# 菜单改版 + 待办项目接入评估

日期：2026-10-17
对象：`whalechan-desktop-pet-dfy`（Electron 桌宠）、`待办事项优先级提示窗`（Go + WebView2）

---

# 第一部分：菜单改版

## 1.1 现在的问题

`main.js:85-96` 的 `buildPetMenu()` 是**工具菜单**，不是**宠物在跟你说话**：

```js
{ label: '说点什么', ... },
{ label: '喂白米饭 🍚', ... },
{ label: '切换姿势', ... },
{ label: clickThrough ? '鼠标穿透：开' : '鼠标穿透：关', ... },   // ← 状态不是动作
{ label: '退出鲸鱼娘', ... },
```

四个具体问题：

| 问题 | 说明 |
|---|---|
| 没有信息量 | 玩家最想知道的"我还有多少白饭"，菜单里没有 |
| 技术词出戏 | "鼠标穿透"是开发者的词，宠物不会这么说话 |
| 状态写成动作 | "鼠标穿透：开"点一下是关，但文案像在陈述，用户不敢点 |
| 缺一个"安静"的出口 | 只有"退出"，没有"先别闹" |

## 1.2 改版方案

```
鲸鱼娘 · 白饭 12 · 心情不错        ← 不可点，纯状态行
────────────────────
陪我聊两句
喂口白饭 🍚  （3 白饭）
一起玩 ▸
────────────────────
换个姿势 ▸
先睡会儿
────────────────────
☑ 别挡着我
☐ 钉在最上层
☐ 桌面乱爬
────────────────────
关掉我
```

设计说明：

- **状态行放最上面**，一眼看到余额和心情。原生菜单只能用 disabled item 做，灰一点但可接受。
- **"喂口白饭（3 白饭）"** 把价格写在标签里，玩家不用点就知道能不能喂。**余额不足时不要禁用**——让他点，宠物会说话。
- **"别挡着我"** = 鼠标穿透，改成 checkbox（勾选态由系统画 ✓），语义从"状态"变成"动作"。
- **"先睡会儿"** 是新增的：手动进入 `sleep`，给用户一个"我要安静"的出口，比直接关掉温和。
- **"关掉我"** 用第一人称，比"退出鲸鱼娘"有角色感。

## 1.3 代码模板

```js
// main.js —— 替换 buildPetMenu
function buildPetMenu() {
  const invoke = (code) => { if (win) win.webContents.executeJavaScript(code); };
  const s = wallet.getState();
  const moodText = s.mood >= 80 ? '心情很好' : s.mood >= 55 ? '心情不错' : '心情平静';

  return Menu.buildFromTemplate([
    { label: `鲸鱼娘 · 白饭 ${s.rice} · ${moodText}`, enabled: false },
    { type: 'separator' },

    { label: '陪我聊两句', click: () => invoke('window.speakRandom && window.speakRandom()') },
    { label: `喂口白饭 🍚  （${wallet.getFeedCost().rice} 白饭）`,
      click: () => invoke('window.feed && window.feed()') },
    { label: '一起玩', submenu: buildGameSubmenu() },        // M2.5 接入，先留空数组

    { type: 'separator' },
    { label: '换个姿势', submenu: buildPoseSubmenu() },
    { label: '先睡会儿', click: () => invoke('window.sleepNow && window.sleepNow()') },

    { type: 'separator' },
    { label: '别挡着我', type: 'checkbox', checked: clickThrough, click: (i) => setClickThrough(i.checked) },
    { label: '钉在最上层', type: 'checkbox', checked: pinned,   click: (i) => setPinned(i.checked) },
    { label: '桌面乱爬', type: 'checkbox', checked: roamEnabled, click: (i) => setRoamEnabled(i.checked) },

    { type: 'separator' },
    { label: '关掉我', click: () => app.quit() },
  ]);
}

// 状态变化后必须刷新托盘菜单，否则余额停在旧值
function refreshMenus() {
  if (tray) tray.setContextMenu(buildPetMenu());
  if (tray) tray.setToolTip(`鲸鱼娘 · 白饭 ${wallet.getState().rice}`);
}
```

**别忘了**：`feed()` 成功后要调 `refreshMenus()`，否则菜单里还是喂之前的余额。

## 1.4 托盘 tooltip

```js
tray.setToolTip(`鲸鱼娘 · 白饭 ${rice} · ${moodText}`);
```

这是**不打扰的状态显示**——鼠标悬停就能看到，不用点开。比任何弹窗都克制。

---

# 第二部分：待办项目接入评估

## 2.1 项目实测

| 项 | 实测 |
|---|---|
| 技术栈 | **Go + WebView2**（`github.com/jchv/go-webview2`），Windows only（`//go:build windows`） |
| 规模 | 约 5,500 行 Go + 2,400 行前端（`app.js` 1403 / `styles.css` 782 / `index.html` 227） |
| 数据 | `%APPDATA%\待办事项优先级提示窗-Go\{todos.json, window.json, media\}`；临时文件 + rename 原子写 |
| 数据结构 | `{ id, content, priority, deadline, createdAt, completed, completedAt, images? }` |
| 优先级 | 五档：`urgent` / `important` / `normal` / `minor` / `shelved` |
| 到期能力 | **已有**：`isOverdue` / `describeRemain` / 橙圈提醒 / 超期项置顶分组 |
| 吸附 | `snap.go` 纯几何、256 行、**有单测**（`snap_test.go` 148 行） |
| 自检 | `selftest.go` 1,501 行，**110 项检查**，含截图比对 |

**这是个完成度很高的项目**，不是玩具。这一点决定了接入方式的选择。

## 2.2 核心判断：不要移植，要对接

| 方案 | 做法 | 成本 | 结论 |
|---|---|---|---|
| A. 移植进桌宠 | 把 5,500 行 Go 用 JS 重写 | 极高，且丢掉 110 项自检 | ✖ |
| B. 待办独立进程 + 本地 IPC | 待办负责数据和调度，桌宠负责"演" | 低（约 300–500 行） | ✅ **推荐** |
| C. 桌宠直接读 `todos.json` | 零协议 | 低，但与待办进程抢写；待办关闭就断供 | ✖ |

**推荐 B**，职责切得很干净：

```
待办进程（Go）              桌宠进程（Electron）
  · 存 todos                · 不说话的时候什么都不做
  · 算 deadline / overdue   · 收到事件 → 选台词 → 播动画
  · 到期瞬间推事件    ──IPC──▶
```

**关键决策：谁判断"到期"？→ 待办。** 它已经有完整的 deadline 逻辑和提醒机制，桌宠再算一遍必然两端不一致（时钟、时区、边界条件）。桌宠只做表现。

## 2.3 传输层：用 named pipe，不用 HTTP

```go
// 待办侧（Go）
ln, _ := winio.ListenPipe(`\\.\pipe\whalechan-todo`, nil)
```

```js
// 桌宠侧（Node）
const net = require('net');
const sock = net.connect('\\\\.\\pipe\\whalechan-todo');
```

为什么不是 HTTP：

- **端口会触发 Windows 防火墙弹窗**，pipe 不会。
- pipe 有 ACL，天然限制在当前用户，不用自己发 token。
- 待办已经有单实例机制，加个 pipe server 是同一层的事。

协议：**单行 JSON**，简单到不用写 schema。

```jsonc
// 待办 → 桌宠（连接后立刻推一次全量，之后状态变化就推）
{"type":"state","items":[
  {"id":"a2","content":"交周报","priority":"urgent","deadline":1792300000000,"completed":false}
]}

// 待办 → 桌宠（到期瞬间）
{"type":"due","id":"a2","content":"交周报","priority":"urgent","overdueBy":0}

// 桌宠 → 待办
{"type":"open"}          // 让待办窗口弹出来（点气泡时用）
```

待办通常只有几十条，**全量推送**比增量同步简单得多，不用维护 diff。

## 2.4 「切掉屏幕边缘吸附」意味着什么

待办现在有：自己的窗口 + 吸附缩入 + 托盘 + 单实例。切掉吸附、做进桌宠，等于把它降级成**无窗口的后台服务**。

**建议保留两种运行模式**：

| 模式 | 启动方式 | 行为 |
|---|---|---|
| 独立模式 | 双击 exe | 现在的样子，有窗口有吸附，不依赖桌宠 |
| 桌宠模式 | `--headless` | 无窗口，只跑调度 + pipe 推送 |

理由：你已经有 1.0beta 的安装包和用户，一刀切掉窗口等于废掉那个版本。加一个参数的成本几乎为零。

**还有个实际问题**：待办无窗口后，用户点气泡想看待办列表怎么办？

- 推荐：桌宠发 `{"type":"open"}`，让待办**临时弹出窗口**（用完可以再收起）。复用已有 UI，零移植。
- 不推荐：在桌宠里重做一个待办列表——那是把 A 方案的坑又走一遍。

也就是说，**桌宠只做"提醒"，不做"管理"**。这条边界要守住。

## 2.5 跨平台问题（必须提前想）

待办是 `//go:build windows`，**mac 上根本跑不了**。桌宠是 mac + win 双平台。

处理方式：桌宠侧把待办当作**可选能力**——

```js
// 连不上就静默降级，不报错、不显示空菜单
todoBridge.on('unavailable', () => {
  todoAvailable = false;
  refreshMenus();          // "待办提醒" 这一项从菜单里消失
});
```

mac 用户看到的是一个正常的桌宠，只是没有待办提醒。**不要弹"待办服务未连接"这种提示**——那是在暴露内部实现。

## 2.6 提醒怎么演（把心情接进来）

这是最有意思的部分。待办给的是冷数据，桌宠要把它演成"有人在惦记你"。

| 时机 | 心情高（≥70） | 心情低（<70） |
|---|---|---|
| 到期前 30 分钟 | 游到窗口边缘，冒小气泡"『交周报』快到了哦" | 原位冒气泡 |
| 到期瞬间 · `urgent` | **游到屏幕中间说话**，配 `conduct` 姿势 | 原位冒气泡 + 橙圈 |
| 到期瞬间 · 其他优先级 | 游到边缘说话 | 只冒气泡 |
| 已超期 · 再次唤醒 | "那个『交周报』…已经超期 2 小时了" | 同上 |

**防打扰三条**（不做会挨骂）：

1. 同一事项**每天最多提醒 2 次**，去重表存 `remind-state.json`。
2. 用户在打字/全屏时（`powerMonitor.getSystemIdleTime()` 短、或检测到全屏窗口）**一律只冒气泡，不游动**。
3. 桌面乱爬开关关掉时，提醒也不游动。

台词要按优先级分档，不要所有事项一个语气：

```js
const TODO_LINES = {
  urgent:    (c) => `那个「${c}」，现在就得弄了！`,
  important: (c) => `「${c}」快到点了，别忘了。`,
  normal:    (c) => `有空的话，「${c}」该动一动了。`,
  minor:     (c) => `「${c}」…不急，但记着点。`,
  shelved:   (c) => null,   // 搁置的不提醒
};
```

## 2.7 工作量

| 部分 | 内容 | 估 |
|---|---|---|
| 待办侧 | pipe server + 事件推送 + `--headless` 模式 | 150–200 行 Go |
| 桌宠侧 | pipe client + 重连 + 提醒调度 + 台词 | 200–300 行 JS |
| 台词库 | 五档 × 几种状态，约 30–50 条 | 文案 |
| 去重/限频 | `remind-state.json` | 50 行 |

## 2.8 顺序建议

**先做 M2.5（游戏宿主 + 钱包），再做待办接入。** 理由：

- 待办接入需要 `speakWithMood()` 这类"带心情的说话"能力，而那东西在 M2 的状态机重构里。
- 待办接入还需要菜单改版（"一起玩"和"待办提醒"都要进菜单），一次改完比改两次好。
- 游戏是"主动玩法"，待办是"被动提醒"。先有玩法，宠物才有存在感；否则它只是个会说话的闹钟。

---

## 附：两个项目的关系图

```
待办事项优先级提示窗（Go）              whalechan-desktop-pet（Electron）
  todos.json / 到期调度                   wallet.json / 白饭 / 心情
  snap.go（独立模式保留）                 游戏宿主（M2.5）
        │                                      │
        └──── named pipe（单行 JSON）──────▶ 提醒调度 → 台词 → 动画
                                               ▲
                                          小游戏 ── 白饭 ──┘
```

数据各自独立，只通过 pipe 单向传事件。**不要把两个应用的存档目录合并**——它们升级节奏完全不同。
