/**
 * todo-bridge.js —— 待办提醒桥（桌宠侧）
 *
 * 职责边界：
 *   · 待办进程负责存数据、算 deadline、判断「到期」——它是唯一权威。
 *   · 桌宠只负责「演」：收到事件 → 选台词 → 播动画。不重复算时间，
 *     否则两端时钟/时区/边界条件必然不一致。
 *
 * 传输：Windows 命名管道 \\.\pipe\whalechan-todo，单行 JSON。
 *   为什么不用 HTTP：端口会触发防火墙弹窗，管道不会；管道有 ACL，天然限制在当前用户。
 *
 * 容错：
 *   · 待办没装 / 没启动 / 崩溃 → 静默降级，菜单里那一项消失，**不弹任何错误**
 *   · 断线自动重连（指数退避，上限 30s）
 *   · 同一事项每天最多提醒 2 次（去重表落盘）
 */

'use strict';

const net = require('net');
const path = require('path');
const fs = require('fs');

const PIPE_PATH = '\\\\.\\pipe\\whalechan-todo';
const PROTOCOL_VERSION = 1;

/** 台词：按优先级分档。搁置的不提醒。 */
const LINES = {
  urgent: (c) => `那个「${c}」，现在就得弄了！`,
  important: (c) => `「${c}」快到点了，别忘了。`,
  normal: (c) => `有空的话，「${c}」该动一动了。`,
  minor: (c) => `「${c}」…不急，但记着点。`,
  shelved: () => null,
};

const LINES_OVERDUE = {
  urgent: (c, t) => `「${c}」已经超期${t}了！`,
  important: (c, t) => `「${c}」超期${t}了，还来得及。`,
  normal: (c, t) => `「${c}」超期${t}了…`,
  minor: (c, t) => `「${c}」超期${t}了，别忘了。`,
  shelved: () => null,
};

let opts = null;            // { userDataDir, petWindow, getMood }
let sock = null;
let connected = false;
let retry = 1000;
let retryTimer = null;
let items = [];
let statePath = null;
let remindState = {};

/* ------------------------------------------------------------------ 去重 */

function todayKey() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

function loadRemindState() {
  try {
    remindState = JSON.parse(fs.readFileSync(statePath, 'utf8')) || {};
  } catch (_) {
    remindState = {};
  }
  const k = todayKey();
  if (!remindState[k]) remindState[k] = {};
  // 只保留今天和昨天，别让它无限长
  for (const key of Object.keys(remindState)) {
    if (key !== k) delete remindState[key];
  }
}

function saveRemindState() {
  try {
    const tmp = statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(remindState, null, 2), 'utf8');
    fs.renameSync(tmp, statePath);
  } catch (_) {}
}

/** 同一事项每天最多 2 次 */
function canRemind(id) {
  const k = todayKey();
  const n = (remindState[k] && remindState[k][id]) || 0;
  return n < 2;
}

function markReminded(id) {
  const k = todayKey();
  if (!remindState[k]) remindState[k] = {};
  remindState[k][id] = (remindState[k][id] || 0) + 1;
  saveRemindState();
}

/* ------------------------------------------------------------------ 演出 */

function fmtOverdue(ms) {
  const m = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  if (m < 60) return ` ${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return ` ${h} 小时`;
  return ` ${Math.floor(h / 24)} 天`;
}

/**
 * 提醒的表现：
 *   心情高（≥70）→ 桌宠做个动作 + 说话（更主动）
 *   心情低        → 只冒气泡（不打扰）
 * 搁置档直接不提醒。
 */
function performRemind(payload) {
  const { id, content, priority, overdueBy } = payload || {};
  if (!id || !content) return;
  const key = String(priority || 'normal');
  const fn = (Number(overdueBy) > 0 ? LINES_OVERDUE : LINES)[key];
  if (!fn) return;                       // shelved 或未知档位
  if (!canRemind(id)) return;

  const text = fn(String(content).slice(0, 24), fmtOverdue(overdueBy));
  if (!text) return;

  markReminded(id);

  const win = opts.petWindow;
  if (!win || win.isDestroyed()) return;

  const mood = typeof opts.getMood === 'function' ? opts.getMood() : 60;
  const active = mood >= 70 && key !== 'minor';

  const script = active
    ? `window.petReact && window.petReact('excited'); window.speak && window.speak(${JSON.stringify(text)}, 6000);`
    : `window.speak && window.speak(${JSON.stringify(text)}, 6000);`;
  win.webContents.executeJavaScript(script).catch(() => {});
}

/* ------------------------------------------------------------------ 连接 */

function connect() {
  if (sock) { try { sock.destroy(); } catch (_) {} sock = null; }

  const s = net.connect(PIPE_PATH);
  let buf = '';

  s.on('connect', () => {
    connected = true;
    retry = 1000;
    s.write(JSON.stringify({ type: 'hello', from: 'whalechan-pet', version: PROTOCOL_VERSION }) + '\n');
    if (opts.onStatusChange) opts.onStatusChange(true);
  });

  s.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { continue; }
      handleMessage(msg);
    }
  });

  const down = () => {
    if (connected && opts.onStatusChange) opts.onStatusChange(false);
    connected = false;
    sock = null;
    scheduleReconnect();
  };

  s.on('error', down);
  s.on('close', down);
  sock = s;
}

function scheduleReconnect() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retry = Math.min(retry * 2, 30000);
    connect();
  }, retry);
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'state') {
    items = Array.isArray(msg.items) ? msg.items : [];
  } else if (msg.type === 'due') {
    performRemind(msg);
  }
}

/** 请求待办把窗口弹出来（点菜单「看看待办」时用） */
function requestOpen() {
  if (!sock || !connected) return false;
  try {
    sock.write(JSON.stringify({ type: 'open' }) + '\n');
    return true;
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------------ 对外 */

function init(options) {
  opts = options;
  statePath = path.join(options.userDataDir, 'remind-state.json');
  loadRemindState();
  connect();
}

function isConnected() { return connected; }
function getItems() { return items.slice(); }
function stop() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (sock) { try { sock.destroy(); } catch (_) {} sock = null; }
  connected = false;
}

module.exports = { init, isConnected, getItems, requestOpen, stop, PIPE_PATH };
