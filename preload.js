const { contextBridge, ipcRenderer } = require('electron');

// 渲染层通知「拖拽开始/结束」：主进程按光标位移增量移动窗口（delta 定位，无累积偏差）。
// 右键菜单：渲染层只发信号，实际菜单由主进程用与托盘一致的模板弹出。
// 逐像素穿透：渲染层依据精灵 alpha 遮罩判断光标是否落在角色身上，动态请求忽略鼠标。
// 经济层：喂饭走主进程（扣白饭、加心情/胖度），余额由主进程主动推回。
contextBridge.exposeInMainWorld('wc', {
  dragBegin:       () => ipcRenderer.send('wc:drag-begin'),
  dragEnd:         () => ipcRenderer.send('wc:drag-end'),
  showContextMenu: () => ipcRenderer.send('wc:context-menu'),
  setIgnoreMouse:  (ignore) => ipcRenderer.send('wc:set-ignore-mouse', !!ignore),

  // 喂饭：{ ok:true, balance, mood, chubby, chubbyScale } | { ok:false, reason:'no-rice', ... }
  feed:      () => ipcRenderer.invoke('wc:feed'),
  getWallet: () => ipcRenderer.invoke('wc:wallet'),

  // 主进程在余额变化后主动推一次
  onWallet: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('wc:wallet', (_e, state) => cb(state));
  },
});
