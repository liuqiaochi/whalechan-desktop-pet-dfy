/**
 * game-host.js —— 小游戏宿主
 *
 * 职责边界（见 docs/GAME-PROTOCOL.md）：
 *   · 开窗口、配沙箱、加载 app:// 资源、管生命周期
 *   · 收游戏的结算请求 → 做合理性校验 → 请求 wallet 入账（自己不碰余额）
 *   · 不实现任何游戏逻辑，不信任游戏传来的任何数字
 *
 * 安全基线（不可降级）：
 *   contextIsolation:true + nodeIntegration:false + sandbox:true
 *   每个游戏独立 partition，A 游戏读不到 B 游戏的 localStorage
 *   导航与弹窗全部锁死，游戏不能把自己变成浏览器
 *   app:// 协议做路径穿越防护（第三方包里可能有 ../../）
 */

'use strict';

const { BrowserWindow, ipcMain, protocol, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const API_VERSION = 1;
const SCHEME = 'app';

let userGamesDir = null;   // <userData>/games
let builtinGamesDir = null; // <app>/src/games
let petWindow = null;
let gamePreload = null;
let onSettled = null;      // 结算后回调（刷新菜单等）

/** 当前打开的游戏 */
let current = null; // { win, id, manifest, dir, startedAt, settled }

/* ------------------------------------------------------------------ 注册协议 */

/**
 * 必须在 app.whenReady() 之前调用。
 * supportFetchAPI 是关键：游戏用 fetch() 加载自己的 json/图集时，
 * file:// 会被 CORS 拦掉，注册成特权 scheme 才放行。
 */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
    },
  ]);
}

/* ------------------------------------------------------------------ 初始化 */

function init(opts) {
  userGamesDir = path.join(opts.userDataDir, 'games');
  builtinGamesDir = path.join(opts.assetsRoot, 'games');
  petWindow = opts.petWindow;
  gamePreload = opts.gamePreload;
  onSettled = opts.onSettled || null;

  ensureDir(userGamesDir);
  protocol.handle(SCHEME, handleRequest);
  registerIpc();
}

function ensureDir(d) {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (_) {}
}

/* ------------------------------------------------------------------ 资源解析 */

function gameDirOf(id) {
  // 用户安装的优先（可覆盖内置同名游戏）
  const u = path.join(userGamesDir, id);
  if (fs.existsSync(path.join(u, 'petgame.json'))) return u;
  const b = path.join(builtinGamesDir, id);
  if (fs.existsSync(path.join(b, 'petgame.json'))) return b;
  return null;
}

/**
 * app://game/<id>/<rel>
 * 路径穿越防护：解析后的绝对路径必须仍在游戏目录内，否则 403。
 * 第三方游戏包是不可信输入，`../../` 是最经典的越权读文件手法。
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function handleRequest(req) {
  let u;
  try { u = new URL(req.url); } catch (_) { return new Response('bad url', { status: 400 }); }

  const parts = u.pathname.split('/').filter(Boolean); // ["<id>", ...rest]
  const id = parts.shift();
  let rel = parts.join('/');
  try { rel = decodeURIComponent(rel); } catch (_) {}
  if (!rel) rel = 'index.html';

  if (!id) return new Response('missing game id', { status: 400 });
  const base = gameDirOf(id);
  if (!base) return new Response('game not found', { status: 404 });

  const baseAbs = path.resolve(base);
  const target = path.resolve(baseAbs, rel);
  if (target !== baseAbs && !target.startsWith(baseAbs + path.sep)) {
    return new Response('forbidden', { status: 403 });
  }

  // 用 fs 直接读而不是 net.fetch(file://)：两个不确定点一起规避 ——
  //   ① 打包后游戏在 app.asar 里，file:// 能否穿透 asar 依 Electron 版本而异；
  //   ② MIME 靠扩展名推断，推断错会让 <script type="module"> 直接被拒。
  // fs 在 asar 内是官方支持的，MIME 自己给，最稳。
  let buf;
  try {
    buf = fs.readFileSync(target);
  } catch (e) {
    return new Response('not found', { status: 404 });
  }

  const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
  return new Response(buf, { status: 200, headers: { 'content-type': type } });
}

/**
 * 自定义协议按 session 注册：全局 protocol 只作用于 defaultSession，
 * 而游戏窗口用的是独立 partition。不在游戏自己的 session 上再注册一次，
 * app:// 在游戏窗口里会直接 ERR_UNKNOWN_URL_SCHEME。
 */
function ensureProtocolForSession(ses) {
  if (!ses || ses.__petgameProtocolReady) return ses;
  ses.protocol.handle(SCHEME, handleRequest);
  ses.__petgameProtocolReady = true;
  return ses;
}

/* ------------------------------------------------------------------ 清单 */

function readManifest(id) {
  const dir = gameDirOf(id);
  if (!dir) return null;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'petgame.json'), 'utf8'));
    if (!m || typeof m !== 'object') return null;
    if (!m.entry) m.entry = 'index.html';
    if (!m.name) m.name = id;
    if (!m.window) m.window = {};
    if (!m.economy) m.economy = {};
    return Object.assign({ id, dir }, m);
  } catch (e) {
    console.error('[game-host] 清单解析失败', id, e.message);
    return null;
  }
}

/** 扫描已安装游戏（内置 + 用户目录） */
function listGames() {
  const out = [];
  const seen = new Set();
  const scan = (base) => {
    if (!base || !fs.existsSync(base)) return;
    for (const name of fs.readdirSync(base)) {
      if (seen.has(name)) continue;
      const m = readManifest(name);
      if (m) { seen.add(name); out.push(m); }
    }
  };
  scan(userGamesDir);
  scan(builtinGamesDir);
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
  return out;
}

function buildMenu() {
  const games = listGames();
  if (!games.length) return [{ label: '（还没有小游戏）', enabled: false }];
  return games.map((g) => ({
    label: g.name,
    click: () => open(g.id),
  }));
}

/* ------------------------------------------------------------------ 开关 */

function open(id) {
  if (current) close();
  const manifest = readManifest(id);
  if (!manifest) return { ok: false, reason: 'not-found' };

  const w = Math.max(320, Math.min(900, Number(manifest.window.width) || 520));
  const h = Math.max(240, Math.min(800, Number(manifest.window.height) || 400));

  // 每个游戏一个独立 session（存储隔离），并在这个 session 上注册 app://
  const ses = ensureProtocolForSession(session.fromPartition('persist:game-' + id));

  const win = new BrowserWindow({
    width: w,
    height: h,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#01060d',
    // 注意：不设 transparent —— 游戏是实心面板，
    // 这样整条「透明窗 + WebGL 黑块」的风险直接绕开
    webPreferences: {
      preload: gamePreload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      session: ses,                     // 独立存储，A 游戏读不到 B 游戏的 localStorage
      additionalArguments: ['--petgame-id=' + id, '--petgame-api=' + API_VERSION],
    },
  });

  // 低于宠物的 screen-saver 层级：宠物永远在上面，且透明区的点击会转发给游戏
  win.setAlwaysOnTop(true, 'floating');
  positionBesidePet(win, w, h);

  win.loadURL(`${SCHEME}://game/${id}/${manifest.entry}`);

  // 锁死导航与弹窗，防止游戏把自己变成浏览器
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  current = { win, id, manifest, dir: manifest.dir, startedAt: 0, settled: false };

  win.on('closed', () => {
    if (current && current.win === win) current = null;
    if (petWindow && !petWindow.isDestroyed()) {
      // 关掉游戏后重置闲置计时，否则宠物会立刻开始乱爬（它以为你 10 分钟没理它）
      petWindow.webContents.executeJavaScript('window.markInteraction && window.markInteraction()');
    }
  });

  return { ok: true, id };
}

/** 摆在宠物旁边，不遮挡：优先左侧，放不下就右侧 */
function positionBesidePet(win, w, h) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const p = petWindow.getBounds();
  const disp = screen.getDisplayMatching(p).workArea;
  const gap = 12;
  let x = p.x - w - gap;
  if (x < disp.x) x = p.x + p.width + gap;
  if (x + w > disp.x + disp.width) x = Math.max(disp.x, disp.x + disp.width - w - gap);
  let y = p.y + p.height - h;
  y = Math.max(disp.y, Math.min(y, disp.y + disp.height - h));
  win.setPosition(Math.round(x), Math.round(y));
}

function close() {
  if (!current) return;
  const { win } = current;
  current = null;
  if (win && !win.isDestroyed()) win.close();
}

/* ------------------------------------------------------------------ IPC */

function registerIpc() {
  const fromCurrentGame = (evt) => current && current.win && !current.win.isDestroyed() && evt.sender === current.win.webContents;

  ipcMain.handle('petgame:ready', (evt) => {
    if (!fromCurrentGame(evt)) return { ok: false };
    return { ok: true, apiVersion: API_VERSION, locale: 'zh-CN' };
  });

  // 开一局：开始时间由主进程记录，游戏说的时间不作数
  ipcMain.handle('petgame:start', (evt) => {
    if (!fromCurrentGame(evt)) return { ok: false };
    current.startedAt = Date.now();
    current.settled = false;
    return { ok: true };
  });

  // 结算：游戏只能传分数
  ipcMain.handle('petgame:submit', (evt, payload) => {
    if (!fromCurrentGame(evt)) return { ok: false, reason: 'forbidden' };
    if (current.settled) return { ok: false, reason: 'already-settled' };

    // 没开过会话就结算 → 视为无效。否则游戏可以跳过 startSession，
    // 让 startedAt=0 把「时长校验」直接绕过（elapsed 会变成一个巨大的数）。
    if (!current.startedAt) {
      current.settled = true;
      return { ok: true, awarded: 0, balance: require('./wallet').getState().rice, capped: 'no-session' };
    }

    current.settled = true;

    const score = Number(payload && payload.score);
    const res = require('./wallet').settleGame({
      gameId: current.id,
      score: Number.isFinite(score) ? score : 0,
      startedAt: current.startedAt,
      manifest: current.manifest,
    });

    if (onSettled) { try { onSettled(res); } catch (_) {} }
    return Object.assign({ ok: true }, res);
  });

  // 让桌宠做个反应
  ipcMain.on('petgame:react', (evt, payload) => {
    if (!fromCurrentGame(evt)) return;
    const mood = String((payload && payload.mood) || 'happy').replace(/[^a-z]/g, '');
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.executeJavaScript(
        `window.petReact && window.petReact(${JSON.stringify(mood)})`
      );
    }
  });

  ipcMain.on('petgame:close', (evt) => {
    if (!fromCurrentGame(evt)) return;
    close();
  });
}

module.exports = { registerScheme, init, open, close, listGames, buildMenu, API_VERSION };
