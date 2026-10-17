const { contextBridge, ipcRenderer } = require('electron');

// 渲染层通知「拖拽开始/结束」：主进程按光标位移增量移动窗口（delta 定位，无累积偏差）。
// 右键菜单：渲染层只发信号，实际菜单由主进程用与托盘一致的模板弹出。
// 逐像素穿透：渲染层依据精灵 alpha 遮罩判断光标是否落在角色身上，动态请求忽略鼠标。
contextBridge.exposeInMainWorld('wc', {
  dragBegin:       () => ipcRenderer.send('wc:drag-begin'),
  dragEnd:         () => ipcRenderer.send('wc:drag-end'),
  showContextMenu: () => ipcRenderer.send('wc:context-menu'),
  setIgnoreMouse:  (ignore) => ipcRenderer.send('wc:set-ignore-mouse', !!ignore),
});
