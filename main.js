const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

const wallet = require('./src/main/wallet');
const gameHost = require('./src/main/game-host');
const todoBridge = require('./src/main/todo-bridge');

// 必须在 app ready 之前注册特权协议（小游戏用 app:// 加载自己的 json/图集）
gameHost.registerScheme();

let win = null;
let tray = null;
let clickThrough = false;   // 菜单「别挡着我」：强制整窗穿透（用户显式开启）
let alphaIgnore = false;    // 逐像素穿透：光标位于角色透明处时的临时穿透
// 置顶为默认行为（alwaysOnTop: true），无开关，因此不再保留 pinned 状态变量

function createWindow() {
  win = new BrowserWindow({
    width: 300,
    height: 380,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,      // 默认置顶（screen-saver 级），无手动开关
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'whalechan.html'));

  // 右下角定位（窗口 300×380，留 30px / 30px 边距）
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win.setPosition(width - 330, height - 410);

  // 默认永远置顶：screen-saver 级浮于普通窗口之上；跨工作区显示，但不覆盖全屏应用
  // （全屏时的自动隐藏由 startFullscreenWatch 接管，见下方）。
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  win.on('closed', () => { stopDrag(); stopFullscreenWatch(); win = null; });
}

// ---- 全屏自动隐藏 ----
// 检测到前台 App 处于全屏（看视频 / 演示 / 游戏）时隐藏桌宠，退出全屏后恢复。
// 仅 macOS 支持：依赖 System Events 的辅助功能(AX)查询，需在「系统设置 → 隐私与安全性 → 辅助功能」
// 中为本 App（或启动它的终端 / Electron）授予权限；未授权时查询失败会安全降级为「不隐藏」。
let hiddenByFullscreen = false;
let fsTimer = null;

function isFrontAppFullscreen() {
  return new Promise((resolve) => {
    const script = [
      'tell application "System Events"',
      '  set p to first process whose frontmost is true',
      '  tell p',
      '    set w to first window whose value of attribute "AXMain" is true',
      '    try',
      '      return value of attribute "AXFullScreen" of w',
      '    on error',
      '      return false',
      '    end try',
      '  end tell',
      'end tell',
    ].join('\n');
    execFile('osascript', ['-e', script], { timeout: 2000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(/^\s*true\s*$/i.test(stdout));
    });
  });
}

function startFullscreenWatch() {
  if (process.platform !== 'darwin') return;   // 其他平台暂未实现
  if (fsTimer) return;
  const check = () => {
    if (!win || win.isDestroyed()) return;
    isFrontAppFullscreen()
      .then((fs) => {
        if (fs === hiddenByFullscreen) return; // 状态未变，无需动作
        hiddenByFullscreen = fs;
        if (fs) win.hide();
        else win.showInactive();
      })
      .catch(() => {});
  };
  check();
  fsTimer = setInterval(check, 1000);
}

function stopFullscreenWatch() {
  if (fsTimer) { clearInterval(fsTimer); fsTimer = null; }
}

// ---- 拖拽：主进程按「光标位移增量」移动窗口（delta 定位，无累积偏差）----
// drag-begin 时一次性采样「窗口位置 + 光标位置」，之后每帧只加增量；
// 不假设窗口尺寸、不做绝对坐标换算，因此不会出现「越拖越偏」或跨次累积。
let dragTimer = null;
let dragStartWin = { x: 0, y: 0 };
let dragStartCursor = { x: 0, y: 0 };

// 贴边吸附：拖到距屏幕左/右边缘 EDGE_SNAP 像素内即吸附。
// 窗口尺寸恒定 300×380（固定透明容器，立绘在容器内等比缩放），松手只贴边定位，绝不放大窗口。
const EDGE_SNAP = 30;
let currentEdge = null;   // 拖拽过程中当前的吸附边：null | 'left' | 'right'

function stopDrag() {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
}

ipcMain.on('wc:drag-begin', () => {
  if (!win) return;
  stopDrag();
  const pos = win.getPosition();                 // [x, y]，DIP
  dragStartWin = { x: pos[0], y: pos[1] };
  const c = screen.getCursorScreenPoint();       // DIP
  dragStartCursor = { x: c.x, y: c.y };
  const move = () => {
    if (!win) { stopDrag(); return; }
    const p = screen.getCursorScreenPoint();
    const dx = p.x - dragStartCursor.x;
    const dy = p.y - dragStartCursor.y;
    let nx = Math.round(dragStartWin.x + dx);
    let ny = Math.round(dragStartWin.y + dy);
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const winW = win.getBounds().width;
    let edge = null;
    if (nx <= wa.x + EDGE_SNAP) { nx = wa.x; edge = 'left'; }
    else if (nx + winW >= wa.x + wa.width - EDGE_SNAP) { nx = wa.x + wa.width - winW; edge = 'right'; }
    win.setPosition(nx, ny);
    if (edge !== currentEdge) {
      currentEdge = edge;
      if (win && !win.isDestroyed()) win.webContents.send('wc:snap', edge);
    }
  };
  dragTimer = setInterval(move, 8);              // ~120Hz 平滑跟随
});

// 松手后「吸附 + 落定」：窗口尺寸永远不变（固定透明容器），贴边时只把窗口
// 横向贴死屏幕边缘，纵坐标保持拖拽松手时的位置（不强制底对齐），让立绘停在
// 你把它拖到的高度；未贴边则不动。
function dockSettle(edge) {
  if (!win || win.isDestroyed() || !edge) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const b = win.getBounds();
  const x = edge === 'left' ? wa.x : wa.x + wa.width - b.width;
  win.setPosition(x, b.y);   // b.y 即松手时窗口的纵坐标，原样保留
}

ipcMain.on('wc:drag-end', () => {
  stopDrag();
  dockSettle(currentEdge);
});

// ---- 闲置自动巡逻：渲染层在闲置 2 分钟后请求启动，桌宠在屏幕内随机游走 ----
let patrolTimer = null;
// 随机分段游走：每段随机方向（以横向为主，偶尔斜走），持续 3~10 秒才换向。
// 选方向时先预判这一段的位移是否放得下（不会半路撞到工作区边缘），
// 因此换向节奏稳定落在 3~10 秒，不会出现「贴着边来回抖」。
const PATROL_SPEED = 100;        // 像素/秒（与走路动画步频匹配）
function startPatrol() {
  if (patrolTimer || !win || win.isDestroyed()) return;
  const TICK = 40;                              // 25fps 平滑移动
  const STEP = PATROL_SPEED * TICK / 1000;      // 每 tick 位移
  let dirX = 0, dirY = 0;                       // 当前段方向分量
  let px = 0, py = 0;                           // 浮点位置（避免整数累积误差）
  let segEnd = 0;                               // 当前段结束时间

  // 选一段新方向：先定「持续多久」，再验证这个方向放不放得下这段位移
  function pickSegment(now) {
    if (!win || win.isDestroyed()) return;
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const b = win.getBounds();
    const roomL = px - wa.x;                              // 向左可用距离
    const roomR = wa.x + wa.width - b.width - px;          // 向右可用距离
    const roomU = py - wa.y;                              // 向上可用距离
    const roomD = wa.y + wa.height - b.height - py;        // 向下可用距离
    for (let i = 0; i < 14; i++) {
      const dur = 3000 + Math.random() * 7000;            // 3~10 秒
      const dist = PATROL_SPEED * dur / 1000;
      const dx = Math.random() < 0.5 ? -1 : 1;            // 横向必有分量（形象只有左右朝向）
      // 竖向：多为一小段斜走，或纯横向（0.7 概率）
      const dy = Math.random() < 0.3 ? (Math.random() < 0.5 ? -0.6 : 0.6) : 0;
      const needX = dist * Math.abs(dx);
      const needY = dist * Math.abs(dy);
      if (needX <= (dx < 0 ? roomL : roomR) && needY <= (dy < 0 ? roomU : roomD)) {
        dirX = dx; dirY = dy;
        segEnd = now + dur;
        win.webContents.send('wc:patrol-dir', dx);        // 朝向：向右走（+1）渲染层会镜像
        return;
      }
    }
    // 极端窄屏兜底：朝空间较大的一侧走，时长按实际剩余空间折算（800ms~3s）
    const room = roomR >= roomL ? roomR : roomL;
    dirX = roomR >= roomL ? 1 : -1; dirY = 0;
    segEnd = now + Math.min(3000, Math.max(800, room / PATROL_SPEED * 1000));
    win.webContents.send('wc:patrol-dir', dirX);
  }

  const b0 = win.getBounds();
  px = b0.x;
  py = b0.y;
  pickSegment(Date.now());

  patrolTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { stopPatrol(); return; }
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const b = win.getBounds();
    const now = Date.now();
    if (now >= segEnd) pickSegment(now);

    let nx = px + dirX * STEP;
    let ny = py + dirY * STEP;
    // 兜底夹紧（正常情况下段内不会出界）
    nx = Math.min(Math.max(nx, wa.x), wa.x + wa.width - b.width);
    ny = Math.min(Math.max(ny, wa.y), wa.y + wa.height - b.height);
    px = nx;
    py = ny;
    win.setPosition(Math.round(nx), Math.round(ny));
  }, TICK);
}
function stopPatrol() {
  if (patrolTimer) { clearInterval(patrolTimer); patrolTimer = null; }
}
ipcMain.on('wc:patrol-start', () => startPatrol());
ipcMain.on('wc:patrol-stop', () => stopPatrol());

// ---- 逐像素点击穿透 ----
// 渲染层根据当前精灵的 alpha 遮罩判断光标是否落在角色不透明处：
// 落在透明处 → 请求忽略鼠标（点击穿透到下层窗口）；落在角色身上 → 恢复接收。
// 与菜单「别挡着我」（clickThrough）取「或」：任一为真则整窗穿透。
function applyIgnoreMouse() {
  if (!win) return;
  win.setIgnoreMouseEvents(clickThrough || alphaIgnore, { forward: true });
}

ipcMain.on('wc:set-ignore-mouse', (evt, ignore) => {
  alphaIgnore = !!ignore;
  applyIgnoreMouse();
});

// ---- 经济层 IPC ----
ipcMain.handle('wc:wallet', () => wallet.getState());

ipcMain.handle('wc:feed', () => {
  const r = wallet.feed();
  refreshMenus();
  if (win && !win.isDestroyed()) win.webContents.send('wc:wallet', wallet.getState());
  return r;
});

ipcMain.handle('wc:shop', () => wallet.getShop());

// ---- 菜单 ----
function refreshMenus() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildPetMenu());
  const s = wallet.getState();
  tray.setToolTip(`欧鲸鲸 · 白饭 ${s.rice} · ${s.moodText}`);
}

function buildPetMenu() {
  const invoke = (code) => { if (win) win.webContents.executeJavaScript(code); };
  const s = wallet.getState();
  const cost = wallet.getFeedCost().rice;

  return Menu.buildFromTemplate([
    // 状态行：一眼看到余额和心情。原生菜单只能靠 disabled item 做，灰一点但够用。
    { label: `欧鲸鲸 · 白饭 ${s.rice} · ${s.moodText}`, enabled: false },
    { type: 'separator' },

    { label: '陪我聊两句', click: () => invoke('window.speakRandom && window.speakRandom()') },
    { label: `喂口白饭 🍚  （${cost} 白饭）`, click: () => invoke('window.feed && window.feed()') },
    { label: '一起玩', submenu: gameHost.buildMenu() },
    { label: '去商店看看', click: () => showShop() },

    { type: 'separator' },
    { label: '换个姿势', click: () => invoke('window.toggleMode && window.toggleMode()') },
    { label: '先睡会儿', click: () => invoke('window.sleepNow && window.sleepNow()') },

    // 待办提醒：只有待办服务在线时才出现。连不上就整项消失，不弹任何错误。
    ...(todoBridge.isConnected()
      ? [{ type: 'separator' }, { label: '看看待办', click: () => todoBridge.requestOpen() }]
      : []),

    { type: 'separator' },
    { label: '别挡着我', type: 'checkbox', checked: clickThrough, click: () => toggleThrough() },

    { type: 'separator' },
    { label: '关掉我', click: () => app.quit() },
  ]);
}

function showShop() {
  const shop = wallet.getShop();
  const s = wallet.getState();
  const detail = shop.items.length
    ? shop.items.map((it) => `${it.emoji || '·'} ${it.name} —— ${it.price} 白饭`).join('\n')
    : '货架还空着。\n\n白饭已经能当钱用了，等第一批商品上架就能买。';
  dialog.showMessageBox({
    type: 'info',
    title: '欧鲸鲸的小卖部',
    message: `白饭 ${s.rice}`,
    detail,
    buttons: ['知道了'],
    noLink: true,
  });
}

// 渲染层在宠物上右键 → 主进程弹出与托盘完全一致的菜单（原生菜单可超出窗口边界）
ipcMain.on('wc:context-menu', () => {
  if (!win) return;
  buildPetMenu().popup({ window: win });
});

// ---- 托盘菜单（🐳）----
function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'src', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('宠物伴侣欧鲸鲸');
  refreshMenus();
  tray.on('click', () => toggleThrough());
}

function toggleThrough() {
  clickThrough = !clickThrough;
  applyIgnoreMouse();
  refreshMenus();
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();

  wallet.init(app.getPath('userData'));

  createWindow();
  startFullscreenWatch();   // 全屏自动隐藏（仅 macOS 生效，其他平台自动跳过）
  buildTray();

  gameHost.init({
    userDataDir: app.getPath('userData'),
    assetsRoot: path.join(__dirname, 'src'),
    petWindow: win,
    gamePreload: path.join(__dirname, 'src', 'game', 'preload-game.js'),
    onSettled: () => refreshMenus(),
  });

  // 待办提醒桥：连不上就静默降级（mac 上本来就没有待办服务）
  todoBridge.init({
    userDataDir: app.getPath('userData'),
    petWindow: win,
    getMood: () => wallet.getState().mood,
    onStatusChange: () => refreshMenus(),
  });

  // 每分钟推进一次时间相关状态（胖度回落、心情衰减）。
  // 没有这个心跳，胖度只在喂饭/结算时才更新 —— 数据在掉、画面却停在原来的体型。
  setInterval(() => {
    const s = wallet.heartbeat();
    if (win && !win.isDestroyed()) win.webContents.send('wc:wallet', s);
    refreshMenus();
  }, 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 关窗不退出，保留托盘
app.on('window-all-closed', () => {});
