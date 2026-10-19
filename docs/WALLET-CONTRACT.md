# 白饭经济层 · 接口约定（草案 v0.3）

> v0.3 变更：**胖度改为随时间回落**（最大体型 → 最小体型 30 分钟），并新增「吃胖造型」阈值。
> v0.2 变更：取消饱腹度；白饭同时是货币与食物；新增心情值；心情只影响表现活跃度，不产生减益。
> 目的：让 `wallet` 模块和「游戏宿主」能直接对接，不用返工。这是**约定**不是实现。

---

## 零、落地状态

`src/main/wallet.js` 已按本约定实现，可直接使用。`ledger.jsonl` **保留**（排查「白饭怎么没了」很方便，成本只有几十行）。

---

## 一、设计原则（这一版的三条硬规矩）

1. **不制造焦虑。** 没有饱腹度、没有饥饿、没有死亡、没有"不喂就变差"。唯一会随时间下降的只有心情，而且**有下限 30**——永远不会变成"不开心的宠物"，只是从"兴奋"回到"平静"。
2. **白饭是唯一数字。** 它既是货币也是食物。菜单里没有"兑换"，只有"喂饭"。
3. **心情是奖励，不是压力。** 心情高 → 更爱乱爬、更多好心情台词。心情低 → 什么都不发生。

---

## 二、磁盘结构

```
userData/
├── wallet.json        # 白饭、心情、胖度、首启标记
├── ledger.jsonl       # 只追加，永不修改
└── games/<id>/        # 第三方游戏（asar 只读，必须放这儿）
```

**`wallet.json` 不要塞进 M1 的 `state.json`。** 两者写盘频率差一个数量级（钱包每次喂饭都写，state 只在拖完窗口写），而且钱包丢了是"玩家攒的白饭没了"，state 丢了只是"宠物回到右下角"。共用文件迟早互相覆盖。

### `wallet.json`

```json
{
  "schemaVersion": 1,
  "rice": 20,
  "mood": 60,
  "chubby": 0,
  "lastMoodTickAt": 1792300000000,
  "lastChubbyTickAt": 1792300000000,
  "firstRunDone": true,
  "daily": {
    "date": "2026-10-17",
    "byGame": { "whalechan.fishing": { "earned": 24, "plays": 2 } }
  }
}
```

| 字段 | 范围 | 说明 |
|---|---|---|
| `rice` | `>= 0` 整数 | 唯一货币 |
| `mood` | `[30, 100]` 整数 | 心情。**下限 30 由衰减逻辑保证**，不是靠 clamp |
| `chubby` | `[0, 20]` **浮点** | 胖度。浮点是为了连续回落，看不出「一格一格掉」 |
| `lastMoodTickAt` | 毫秒时间戳 | 心情衰减基准 |
| `lastChubbyTickAt` | 毫秒时间戳 | 胖度衰减基准 |

---

## 三、模块导出（`src/main/wallet.js`）

```js
module.exports = {
  init(userDataDir),      // 启动：读盘、补算心情衰减、首启赠礼
  getState(),             // → { rice, mood, chubby, daily }
  getFeedCost(),          // → { rice: 3, mood: 8, chubby: 1 }（见第五节）

  feed(),                 // 喂饭：校验 → 扣白饭 → 加心情/胖度 → 落盘
                          //   → { ok:true, balance, mood, chubby }
                          //   → { ok:false, reason:'no-rice', balance }

  settleGame(opts),       // 结算：游戏宿主唯一入口，见第六节
  getDaily(gameId),       // → { earned, plays, remaining }
};
```

**关键约束：不导出 `earn()`。** 只有 `settleGame()` 能加白饭，而它只接受「游戏 id + 分数 + 开始时间 + 清单」，**不接受"要加多少"**。这是防作弊的第一道也是最重要的一道闸。

---

## 四、喂饭（`feed`）—— 唯一的支出

```
一次喂饭 = 3 白饭 → +8 心情 → +4 胖度
```

- 心情封顶 100，超出丢弃（不要溢出成 120 存着）。
- 胖度封顶 20（喂 5 次到最大体型），超出丢弃。
- **白饭不足时不要"点了没反应"**。仍播吃动画，台词换成"钱包空空…要不要去玩个小游戏？"，同时把游戏入口亮出来。把核心互动变成一堵墙是最容易犯的错。

### 数值体感参考

| 场景 | 数值 |
|---|---|
| 一局小游戏（3 分钟） | 约 15 白饭 |
| 喂一次 | 3 白饭 / +8 心情 / +4 胖度（约 6 分钟后回落） |
| 心情从 30 喂到 100 | 约 9 次 ≈ 27 白饭 ≈ 2 局游戏 |
| 心情自然回落 100 → 30 | 约 70 小时（近 3 天） |
| 胖度从满（20）回落到 0 | **30 分钟** |
| 连喂 5 次 | 到最大体型，之后 30 分钟内慢慢瘦回去 |

也就是：**一周玩两三次就能让宠物一直保持好心情**，不玩也不会变差。胖是"刚吃饱"的状态，不是永久身材——这样既有即时反馈，又不会让宠物永远圆着。

---

## 五、心情衰减（`tickMood`）

```js
const elapsed = clamp(now - lastMoodTickAt, 0, 24*3600*1000);  // 上限 24h
const lost = Math.floor(elapsed / (60 * 60 * 1000));            // 每小时 -1
mood = Math.max(MOOD_FLOOR, mood - lost);                       // 下限 30
lastMoodTickAt = now;
```

三个要点：

1. **`MOOD_FLOOR = 30`** 写在常量里，衰减到 30 就停。这不是"心情不好"，是"心情平静"。
2. **必须 clamp 上限 24 小时**。不然用户把系统时间改到 2099 年再改回来，心情会瞬间归零。
3. **`lastMoodTickAt` 每次都更新**，哪怕 `lost === 0`，否则连续启动会重复扣。

---

## 六、结算（`settleGame`）—— 唯一的收入口

```js
settleGame({ gameId, score, startedAt, manifest })
```

内部顺序**不能变**：

```
1. 时长校验    elapsed = now - startedAt
               elapsed < manifest.economy.minSeconds  → awarded=0, capped='too-fast'
2. 分数折算    raw = floor(score / manifest.economy.scorePerRice)
               raw = clamp(raw, 0, manifest.economy.maxPerSession)
3. 每日上限    remaining = maxPerDay - daily.byGame[gameId].earned
               awarded = min(raw, remaining)           → capped='daily' 若被截
4. 收益递减    if (daily.byGame[gameId].plays >= 3) awarded = floor(awarded * 0.5)
                                                       → capped='diminish' 若被截
5. 落盘        rice += awarded；写 ledger；更新 daily
6. 返回        { awarded, balance, capped }
```

游戏只拿到 `{ awarded, balance, capped }`，永远不能指定金额。

---

## 七、形体变化（`chubby`）

### 7.1 衰减

```
满值 20 → 0 需要 30 分钟  ⇒  每分钟回落 0.667（浮点，连续）
```

和心情一样：clamp 上限 24h、负值按 0、每次都推进 `lastChubbyTickAt`。

**必须有心跳**：主进程每分钟调一次 `wallet.heartbeat()` 并推 `wc:wallet` 给渲染层。
否则数据在回落、画面却停在原来的体型，直到下一次喂饭才「跳」一下。

### 7.2 两段式体型

| 胖度 | 横向 | 纵向 | 观感 |
|---|---|---|---|
| 0 → 12 | 1.00 → 1.10 | 1.00 → 1.10 | 等比放大 |
| 12 → 20 | 1.10 → **1.20** | 1.10 → **1.04** | 横向加宽 + 纵向回压 = **吃胖** |

超过 12 视为「吃胖造型」，渲染层给 `.pet` 加 `.fat` 类（影子加重一点）。

**为什么不是等比放大**：等比放大到 1.2 只是「变大了」，看起来像镜头拉近；横向加宽 + 纵向压扁才是「胖」。

### 7.3 技术约束（改数值前必读）

窗口是 `300 × 380`，`.pet img` 基础 `max-width: 245px / max-height: 232px`。

- 横向上限：`245 × 1.20 = 294 < 300` ✓ —— 再多就会被 `overflow:hidden` 裁掉
- 纵向上限：`232 × 1.10 = 255 < 380` ✓

**要调大横向系数，先把 `max-width` 降下来**，约束是 `245 × 新系数 ≤ 296`。

### 7.4 缩放不会破坏逐像素穿透

`isOpaqueAt` 用的是 `petImg.getBoundingClientRect()` 归一化坐标，
而 `getBoundingClientRect` 返回的是**包含 transform 的变换后边界框**。
所以缩放后遮罩查表依然对齐，**不需要重跑 `make_alpha.py`**。

前提：缩放挂在 `.pet` 容器上（`--chubby-x` / `--chubby-y`），不要挂在 `img` 上——
`img` 上有 `bob` / `happy` 两个 keyframes 会覆盖 inline transform。

### 7.5 关于「换成真的胖立绘」

社区资产库（`TreapGoGo/deepseek-whale-girl`）里**没有**现成的「吃胖」姿势：
`characters/dafeiyu/reference-sheets` 只有 chibi / mature 两张三视图（三视图 + 细节裁切），
画廊 137 条投稿里也没有吃胖主题。

所以当前用两段式缩放模拟。如果以后要真立绘，流程是：

```
新画一张「吃饱」姿势（同画布尺寸、同脚底基线）
  → 存 src/sprites/fat.png
  → python make_alpha.py        # 生成遮罩，否则逐像素穿透会退化成整矩形可点
  → chubbyVisual() 里把 12..20 段改成「换 src」
```

**注意**：换精灵时必须同步换遮罩（`setSprite` 里已经这么做了），漏了会让整个矩形都能点。


## 八、心情如何影响行为（接 M2 状态机）

心情只改**两个阈值**，不改任何判定逻辑：

| 行为 | 心情低（30） | 心情高（100） |
|---|---|---|
| 开始乱爬的闲置阈值 | 90 秒 | 40 秒 |
| 自发搭话间隔 | 120 秒 | 45 秒 |
| 台词池 | `linesCalm` | `linesHappy` |
| 到期提醒的表现 | 原位冒气泡 | 游到屏幕中间说话 |

```js
function roamThreshold(mood) { return 90000 - (mood - 30) / 70 * 50000; }  // 90s → 40s
function chatInterval(mood)  { return 120000 - (mood - 30) / 70 * 75000; } // 120s → 45s
```

**注意**：这些都只是"更容易发生"，不是"必然发生"。心情 100 也不该让宠物疯狂爬屏——PLAN 7.3 里的"用户活跃启发式"（`powerMonitor.getSystemIdleTime()`）优先级更高，用户在打字时一律不爬。

---

## 九、不变式（写完自查）

1. `rice >= 0`，任何路径都不许为负。
2. `mood ∈ [30, 100]`（下限由衰减逻辑保证，上限由喂饭保证）。
3. `chubby ∈ [0, 20]`，浮点，随时间单调不增（除非喂饭）。
4. 每一次 `rice` 变动，`ledger.jsonl` 必有一条对应记录，且 `balance` 与变动后的 `wallet.json` 一致。
5. 写盘一律 `write tmp → renameSync`，不许直接 `writeFileSync` 覆盖。
6. 除 `settleGame` 外，没有任何路径能让 `rice` 增加。
7. 首次启动赠送 20 白饭，且只赠一次（`firstRunDone`）。
8. `chubbyX × 245 <= 296`，`chubbyY × 232 <= 376` —— 越界会被窗口裁掉。

第 6 条最容易破——调试时随手加个 `rice += 100`，上线前忘了删。

---

## 十、已经定下来的

1. **`ledger.jsonl` 保留。** 排查「白饭怎么没了」很方便，成本只是几十行。
2. **胖度可逆（自然回落）。** 满值 30 分钟归零，不做「运动减肥」这种主动消耗口——那会引入压力。
3. **商店本期空货架。** `SHOP_ITEMS = []`，`buy()` 骨架就位，加商品时补 `applyItem()` 即可。
