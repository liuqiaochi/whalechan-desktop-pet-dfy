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

  win.on('closed', () => { win = null; });
}

// ---- 拖拽 IPC：绝对锚点法，避免抖动 ----
let anchor = null;
ipcMain.on('wc:drag-begin', (e, cx, cy) => {
  if (!win) return;
  const [wx, wy] = win.getPosition();
  anchor = { wx, wy, cx, cy };
});
ipcMain.on('wc:drag-move', (e, cx, cy) => {
  if (!win || !anchor) return;
  const nx = anchor.wx + (cx - anchor.cx);
  const ny = anchor.wy + (cy - anchor.cy);
  win.setPosition(Math.round(nx), Math.round(ny));
});
ipcMain.on('wc:drag-end', () => { anchor = null; });

// ---- 托盘菜单（🐳）----
function buildTray() {
  // 托盘用官方 master logo 的 16pt/@2x 小图（位于 src/，会随应用打包）
  const icon = nativeImage.createFromPath(path.join(__dirname, 'src', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('鲸鱼娘桌宠');

  const invoke = (code) => { if (win) win.webContents.executeJavaScript(code); };
  const menu = Menu.buildFromTemplate([
    { label: '说点什么', click: () => invoke('window.speakRandom && window.speakRandom()') },
    { label: '喂白米饭 🍚', click: () => invoke('window.feed && window.feed()') },
    { label: '切换姿势', click: () => invoke('window.toggleMode && window.toggleMode()') },
    { type: 'separator' },
    { label: '鼠标穿透：关', click: () => toggleThrough() },
    { type: 'separator' },
    { label: '退出鲸鱼娘', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => toggleThrough());
}

function toggleThrough() {
  clickThrough = !clickThrough;
  if (win) win.setIgnoreMouseEvents(clickThrough, { forward: true });
  if (tray) {
    const m = tray.getContextMenu();
    m.items[4].label = clickThrough ? '鼠标穿透：开' : '鼠标穿透：关';
    tray.setContextMenu(m);
  }
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
