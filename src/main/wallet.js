/**
 * wallet.js —— 白饭经济层（唯一货币：白饭）
 *
 * 设计原则（见 docs/WALLET-CONTRACT.md v0.2）：
 *   1) 不制造焦虑：没有饱腹度/饥饿/死亡。唯一随时间下降的是心情，且有下限 30，
 *      到 30 就停 —— 那是「心情平静」，不是「心情不好」。
 *   2) 白饭既是货币也是食物：菜单里没有「兑换」，只有「喂饭」。
 *   3) 心情是奖励不是压力：心情高 → 更爱乱爬、更多好心情台词；心情低 → 什么都不发生。
 *
 * 三条硬规矩：
 *   · 除 settleGame() 外，没有任何路径能让 rice 增加（防作弊的唯一闸口）。
 *   · 写盘一律「临时文件 + rename」原子替换，绝不直接覆盖。
 *   · 每次 rice 变动必写一条 ledger 流水，balance 与 wallet.json 一致。
 *
 * 数据文件与 state.json（窗口/开关）分离：两者写盘频率差一个数量级，
 * 且丢失后果不同（钱包丢了是玩家攒的白饭没了，state 丢了只是位置回到右下角）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ 常量 */

const SCHEMA_VERSION = 1;

/** 喂一次饭的代价与收益 */
const FEED_COST = 3;      // 白饭
const FEED_MOOD = 8;      // 心情
const FEED_CHUBBY = 4;    // 胖度（满值 20，即喂 5 次到最大体型）

/** 心情 */
const MOOD_MAX = 100;
const MOOD_FLOOR = 30;          // 衰减下限：到这里就停，不再往下掉
const MOOD_DECAY_PER_HOUR = 1;  // 每小时 -1
const MOOD_OFFLINE_CAP_MS = 24 * 3600 * 1000;  // 离线补算上限 24h（防改系统时间）

/** 胖度：0..20，**随时间自然回落**（最大体型 → 最小体型 30 分钟） */
const CHUBBY_MAX = 20;
const CHUBBY_DECAY_MS = 30 * 60 * 1000;   // 从最大体型回落到最小体型需要 30 分钟
const CHUBBY_PER_MS = CHUBBY_MAX / CHUBBY_DECAY_MS;
const CHUBBY_FAT_AT = 12;                 // 超过这个值换「吃胖」造型

/**
 * 体型换算：0..12 等比放大（1.00 → 1.10）；12..20 转为「吃胖」——
 * 横向继续加宽到 1.20、纵向回压到 1.04，视觉上就是"胖"而不是"放大"。
 *
 * 上限受窗口约束：图片基础宽 245px，245 × 1.20 = 294 < 300（窗口宽），
 * 再多就会被 overflow:hidden 裁掉。改这里前先算一遍 245 × 新系数。
 */
function chubbyVisual(chubby) {
  const c = Math.max(0, Math.min(CHUBBY_MAX, Number(chubby) || 0));
  let x, y, fat = false;
  if (c <= CHUBBY_FAT_AT) {
    const t = c / CHUBBY_FAT_AT;
    x = 1 + t * 0.10;
    y = 1 + t * 0.10;
  } else {
    fat = true;
    const f = (c - CHUBBY_FAT_AT) / (CHUBBY_MAX - CHUBBY_FAT_AT);
    x = 1.10 + f * 0.10;   // → 1.20
    y = 1.10 - f * 0.06;   // → 1.04
  }
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, fat };
}

/** 首次启动赠送 */
const START_RICE = 20;

/** 收益递减：当日第 N 局起打对折 */
const DIMINISH_AFTER_PLAYS = 3;
const DIMINISH_FACTOR = 0.5;

/** 商店：本期只留货架，不上商品 */
const SHOP_ITEMS = [];

/* ------------------------------------------------------------------ 状态 */

let dir = null;
let state = null;
let ledgerPath = null;
let walletPath = null;

function defaults() {
  return {
    schemaVersion: SCHEMA_VERSION,
    rice: 0,
    mood: 60,
    chubby: 0,
    lastMoodTickAt: 0,
    lastChubbyTickAt: 0,
    firstRunDone: false,
    daily: { date: todayKey(), byGame: {} },
  };
}

function todayKey(d) {
  const t = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/* ------------------------------------------------------------------ 读写 */

function ensureDir() {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 原子写：先写 .tmp，再 rename 覆盖。断电最多丢这一次写入，不会写坏原文件。 */
function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function save() {
  ensureDir();
  state.savedAt = Date.now();
  atomicWrite(walletPath, JSON.stringify(state, null, 2));
}

/**
 * 读盘。损坏时把原文件备份成 wallet.broken-<时间戳>.json 再从默认值开始，
 * 而不是静默清空 —— 至少给用户留一个能手工抢救的文件。
 */
function load() {
  ensureDir();
  if (!fs.existsSync(walletPath)) {
    state = defaults();
    state.rice = START_RICE;
    state.firstRunDone = true;
    state.lastMoodTickAt = Date.now();
    save();
    ledger({ type: 'grant', amount: START_RICE, src: 'first-run' });
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    state = Object.assign(defaults(), raw);
    if (!state.daily || typeof state.daily !== 'object') state.daily = { date: todayKey(), byGame: {} };
    if (!state.daily.byGame) state.daily.byGame = {};
  } catch (e) {
    const bak = path.join(dir, `wallet.broken-${Date.now()}.json`);
    try { fs.renameSync(walletPath, bak); } catch (_) {}
    console.error('[wallet] 存档损坏，已备份到', bak, e.message);
    state = defaults();
    state.lastMoodTickAt = Date.now();
    save();
  }
  if (!state.firstRunDone) {
    state.rice += START_RICE;
    state.firstRunDone = true;
    save();
    ledger({ type: 'grant', amount: START_RICE, src: 'first-run' });
  }
  clampAll();
}

/** 流水：一行一条 JSON，只追加。排查「白饭怎么没了」时 tail 一下即可。 */
function ledger(entry) {
  if (!ledgerPath) return;
  const line = JSON.stringify(Object.assign({ ts: Date.now(), balance: state ? state.rice : 0 }, entry));
  try {
    ensureDir();
    fs.appendFileSync(ledgerPath, line + '\n', 'utf8');
  } catch (e) {
    console.error('[wallet] 流水写入失败', e.message);
  }
}

function clampAll() {
  state.rice = Math.max(0, Math.floor(state.rice || 0));
  state.mood = Math.min(MOOD_MAX, Math.max(MOOD_FLOOR, Math.round(state.mood || 0)));
  // 胖度是浮点：连续衰减才不会看出"一格一格掉"
  state.chubby = Math.min(CHUBBY_MAX, Math.max(0, Number(state.chubby) || 0));
}

/* ------------------------------------------------------------------ 心情 */

/**
 * 补算心情衰减。
 * 注意三个坑：
 *   1) 必须 clamp 上限 24h —— 否则用户把系统时间改到 2099 年再改回来，心情会瞬间归零；
 *   2) 负值（系统时间往回调）按 0 处理，不能反过来「涨」；
 *   3) 即使 lost === 0 也要更新 lastMoodTickAt，否则连续启动会重复扣。
 */
function tickMood() {
  const now = Date.now();
  if (!state.lastMoodTickAt) { state.lastMoodTickAt = now; return; }
  const elapsed = Math.min(Math.max(now - state.lastMoodTickAt, 0), MOOD_OFFLINE_CAP_MS);
  const lost = Math.floor(elapsed / (3600 * 1000)) * MOOD_DECAY_PER_HOUR;
  if (lost > 0) {
    state.mood = Math.max(MOOD_FLOOR, state.mood - lost);
  }
  state.lastMoodTickAt = now;
}

/**
 * 补算胖度衰减：最大体型 → 最小体型 30 分钟，连续（浮点）下降。
 * 与心情同样的三个坑：clamp 上限、负值按 0、每次都要推进时间戳。
 */
function tickChubby() {
  const now = Date.now();
  if (!state.lastChubbyTickAt) { state.lastChubbyTickAt = now; return; }
  const elapsed = Math.min(Math.max(now - state.lastChubbyTickAt, 0), MOOD_OFFLINE_CAP_MS);
  if (elapsed > 0 && state.chubby > 0) {
    state.chubby = Math.max(0, state.chubby - elapsed * CHUBBY_PER_MS);
  }
  state.lastChubbyTickAt = now;
}

/** 一次把时间相关的都补算掉 */
function tick() {
  tickMood();
  tickChubby();
}

/** 跨天清零当日额度 */
function rollDaily() {
  const k = todayKey();
  if (!state.daily || state.daily.date !== k) {
    state.daily = { date: k, byGame: {} };
  }
}

/* ------------------------------------------------------------------ 对外 */

function init(userDataDir) {
  dir = userDataDir;
  walletPath = path.join(dir, 'wallet.json');
  ledgerPath = path.join(dir, 'ledger.jsonl');
  load();
  tick();
  rollDaily();
  save();
  return getState();
}

function getState() {
  const v = chubbyVisual(state.chubby);
  return {
    rice: state.rice,
    mood: state.mood,
    chubby: Math.round(state.chubby * 10) / 10,
    chubbyX: v.x,
    chubbyY: v.y,
    isFat: v.fat,
    moodText: state.mood >= 80 ? '心情很好' : state.mood >= 55 ? '心情不错' : '心情平静',
    daily: state.daily,
  };
}

function getFeedCost() {
  return { rice: FEED_COST, mood: FEED_MOOD, chubby: FEED_CHUBBY };
}

/**
 * 喂饭：白饭 → 心情 + 胖度。
 * 白饭不足时返回 ok:false，但调用方仍应播吃动画（只是换台词）——
 * 把核心互动变成一堵墙是最容易犯的错。
 */
function feed() {
  tick();
  if (state.rice < FEED_COST) {
    return { ok: false, reason: 'no-rice', balance: state.rice, need: FEED_COST };
  }
  state.rice -= FEED_COST;
  state.mood = Math.min(MOOD_MAX, state.mood + FEED_MOOD);
  state.chubby = Math.min(CHUBBY_MAX, state.chubby + FEED_CHUBBY);
  save();
  ledger({ type: 'spend', amount: -FEED_COST, src: 'food:rice' });
  const v = chubbyVisual(state.chubby);
  return {
    ok: true,
    balance: state.rice,
    mood: state.mood,
    chubby: Math.round(state.chubby * 10) / 10,
    chubbyX: v.x,
    chubbyY: v.y,
    isFat: v.fat,
  };
}

function getDaily(gameId) {
  rollDaily();
  const rec = state.daily.byGame[gameId] || { earned: 0, plays: 0 };
  return { earned: rec.earned, plays: rec.plays };
}

/**
 * 心跳：把时间相关的补算推进一次并落盘。
 * 主进程每分钟调一次，否则胖度只在「喂饭/结算/重启」时才更新，
 * 数据在衰减、画面却停在原来的体型。
 */
function heartbeat() {
  const before = state.chubby;
  tick();
  rollDaily();
  if (Math.abs(state.chubby - before) > 0.001) save();
  return getState();
}

/**
 * 结算 —— 唯一的收入口。
 * 游戏只能传「分数」，不能传「要加多少」。顺序不可调整。
 */
function settleGame(opts) {
  const { gameId, score, startedAt, manifest } = opts || {};
  if (!gameId) return { awarded: 0, balance: state.rice, capped: 'bad-request' };

  tick();
  rollDaily();

  const eco = (manifest && manifest.economy) || {};
  const scorePerRice = Math.max(1, Number(eco.scorePerRice) || 50);
  const maxPerSession = Math.max(0, Number(eco.maxPerSession) || 20);
  const maxPerDay = Math.max(0, Number(eco.maxPerDay) || 60);
  const minSeconds = Math.max(0, Number(eco.minSeconds) || 10);

  const rec = state.daily.byGame[gameId] || { earned: 0, plays: 0 };

  // 1) 时长校验
  const elapsed = Math.max(0, (Date.now() - (Number(startedAt) || 0)) / 1000);
  if (elapsed < minSeconds) {
    rec.plays += 1;
    state.daily.byGame[gameId] = rec;
    save();
    return { awarded: 0, balance: state.rice, capped: 'too-fast' };
  }

  // 2) 分数折算 + 单局上限
  let awarded = Math.floor(Math.max(0, Number(score) || 0) / scorePerRice);
  let capped = null;
  if (awarded > maxPerSession) { awarded = maxPerSession; capped = 'session'; }

  // 3) 收益递减（先打折，再扣每日额度 —— 顺序反了会把额度白白浪费掉）
  if (rec.plays >= DIMINISH_AFTER_PLAYS) {
    const reduced = Math.floor(awarded * DIMINISH_FACTOR);
    if (reduced !== awarded) { awarded = reduced; capped = 'diminish'; }
  }

  // 4) 每日上限（最后扣，保证当日额度能被用满）
  const remaining = Math.max(0, maxPerDay - rec.earned);
  if (awarded > remaining) { awarded = remaining; capped = 'daily'; }

  // 5) 落盘
  rec.earned += awarded;
  rec.plays += 1;
  state.daily.byGame[gameId] = rec;
  state.rice += awarded;
  save();
  if (awarded > 0) ledger({ type: 'earn', amount: awarded, src: 'game:' + gameId });

  return { awarded, balance: state.rice, capped };
}

/* ------------------------------------------------------------------ 商店 */

/**
 * 商店货架。本期为空 —— 保留「白饭作为货币」的能力，后续加商品即可。
 * 商品结构（以后填）：
 *   { id, name, emoji, price, kind: 'food'|'deco'|'skin', effect: {...}, stock: -1 }
 */
function getShop() {
  return { items: SHOP_ITEMS.slice(), currency: 'rice' };
}

/**
 * 购买。本期货架为空，任何 id 都会返回 not-found，
 * 但扣款/发货的骨架已经在这里，加商品时只需补 applyItem()。
 */
function buy(itemId, qty) {
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const item = SHOP_ITEMS.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: 'not-found', balance: state.rice };
  const cost = item.price * n;
  if (state.rice < cost) return { ok: false, reason: 'no-rice', balance: state.rice, need: cost };

  state.rice -= cost;
  applyItem(item, n);
  save();
  ledger({ type: 'spend', amount: -cost, src: 'shop:' + item.id });
  return { ok: true, balance: state.rice, item: item.id, qty: n };
}

/** 发货：加商品时在这里实现具体效果 */
function applyItem(item, qty) {
  if (item.kind === 'food') {
    state.mood = Math.min(MOOD_MAX, state.mood + (item.effect.mood || 0) * qty);
    state.chubby = Math.min(CHUBBY_MAX, state.chubby + (item.effect.chubby || 0) * qty);
  }
}

module.exports = {
  init,
  getState,
  getFeedCost,
  feed,
  settleGame,
  getDaily,
  heartbeat,
  getShop,
  buy,
  // 供调试/自检用，正式逻辑不应调用
  _tickMood: tickMood,
  _rollDaily: rollDaily,
  _const: { FEED_COST, MOOD_FLOOR, MOOD_MAX, CHUBBY_MAX, START_RICE, DIMINISH_AFTER_PLAYS },
};
