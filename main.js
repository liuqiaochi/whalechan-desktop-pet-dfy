const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog } = require('electron');
const path = require('path');

const wallet = require('./src/main/wallet');
const gameHost = require('./src/main/game-host');
const todoBridge = require('./src/main/todo-bridge');

// 必须在 app ready 之前注册特权协议（小游戏用 app:// 加载自己的 json/图集）
gameHost.registerScheme();

let win = null;
let tray = null;
let clickThrough = false;   // 菜单「别挡着我」：强制整窗穿透（用户显式开启）
let alphaIgnore = false;    // 逐像素穿透：光标位于角色透明处时的临时穿透
let pinned = false;         // 菜单「钉在最顶层」：默认关闭 → 与普通窗口同级，可被其他窗口盖住

function createWindow() {
  win = new BrowserWindow({
    width: 300,
    height: 380,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: false,     // 默认不置顶；置顶由「钉在最顶层」开关控制（见 setPinned）
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

  // 置顶相关一律走 pinned 状态：默认 false 时既不是最顶层，也不跨工作区/全屏显示。
  applyPinned();

  win.on('closed', () => { stopDrag(); win = null; });
}

// 按当前 pinned 状态应用窗口层级（创建时与切换开关时共用，避免两处逻辑分叉）
function applyPinned() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(pinned, 'screen-saver');
  win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: pinned });
}

// 菜单「钉在最顶层」：勾上才升到 screen-saver 级（可盖住全屏/其他置顶窗口）
function setPinned(on) {
  pinned = !!on;
  applyPinned();
  refreshMenus();
}

// ---- 拖拽：主进程按「光标位移增量」移动窗口（delta 定位，无累积偏差）----
// drag-begin 时一次性采样「窗口位置 + 光标位置」，之后每帧只加增量；
// 不假设窗口尺寸、不做绝对坐标换算，因此不会出现「越拖越偏」或跨次累积。
let dragTimer = null;
let dragStartWin = { x: 0, y: 0 };
let dragStartCursor = { x: 0, y: 0 };

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
    win.setPosition(
      Math.round(dragStartWin.x + (p.x - dragStartCursor.x)),
      Math.round(dragStartWin.y + (p.y - dragStartCursor.y))
    );
  };
  dragTimer = setInterval(move, 8);              // ~120Hz 平滑跟随
});

ipcMain.on('wc:drag-end', () => { stopDrag(); });

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
  tray.setToolTip(`鲸鱼娘 · 白饭 ${s.rice} · ${s.moodText}`);
}

function buildPetMenu() {
  const invoke = (code) => { if (win) win.webContents.executeJavaScript(code); };
  const s = wallet.getState();
  const cost = wallet.getFeedCost().rice;

  return Menu.buildFromTemplate([
    // 状态行：一眼看到余额和心情。原生菜单只能靠 disabled item 做，灰一点但够用。
    { label: `鲸鱼娘 · 白饭 ${s.rice} · ${s.moodText}`, enabled: false },
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
    { label: '钉在最顶层', type: 'checkbox', checked: pinned, click: (item) => setPinned(item.checked) },
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
    title: '鲸鱼娘的小卖部',
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
  tray.setToolTip('鲸鱼娘桌宠');
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
