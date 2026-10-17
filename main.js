const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');

let win = null;
let tray = null;
let clickThrough = false;

function createWindow() {
  win = new BrowserWindow({
    width: 260,
    height: 330,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'whalechan.html'));

  // 右下角定位
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win.setPosition(width - 290, height - 360);

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true);

  win.on('closed', () => { stopDrag(); win = null; });
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

// ---- 宠物菜单：托盘右键与宠物本体右键共用同一份模板，保证完全一致 ----
function buildPetMenu() {
  const invoke = (code) => { if (win) win.webContents.executeJavaScript(code); };
  return Menu.buildFromTemplate([
    { label: '说点什么', click: () => invoke('window.speakRandom && window.speakRandom()') },
    { label: '喂白米饭 🍚', click: () => invoke('window.feed && window.feed()') },
    { label: '切换姿势', click: () => invoke('window.toggleMode && window.toggleMode()') },
    { type: 'separator' },
    { label: clickThrough ? '鼠标穿透：开' : '鼠标穿透：关', click: () => toggleThrough() },
    { type: 'separator' },
    { label: '退出鲸鱼娘', click: () => app.quit() },
  ]);
}

// 渲染层在宠物上右键 → 主进程弹出与托盘完全一致的菜单（原生菜单可超出 260×330 窗口边界）
ipcMain.on('wc:context-menu', () => {
  if (!win) return;
  buildPetMenu().popup({ window: win });
});

// ---- 托盘菜单（🐳）----
function buildTray() {
  // 托盘用官方 master logo 的 16pt/@2x 小图（位于 src/，会随应用打包）
  const icon = nativeImage.createFromPath(path.join(__dirname, 'src', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('鲸鱼娘桌宠');
  tray.setContextMenu(buildPetMenu());
  tray.on('click', () => toggleThrough());
}

function toggleThrough() {
  clickThrough = !clickThrough;
  if (win) win.setIgnoreMouseEvents(clickThrough, { forward: true });
  if (tray) tray.setContextMenu(buildPetMenu());   // 重建菜单以刷新「鼠标穿透」文案
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();
  createWindow();
  buildTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 关窗不退出，保留托盘
app.on('window-all-closed', () => {});
