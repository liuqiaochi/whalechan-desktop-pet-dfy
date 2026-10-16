const { contextBridge, ipcRenderer } = require('electron');

// 渲染进程只暴露三个拖拽原语，由主进程移动窗口（绝对锚点法，无抖动）
contextBridge.exposeInMainWorld('wc', {
  dragBegin: (x, y) => ipcRenderer.send('wc:drag-begin', x, y),
  dragMove:  (x, y) => ipcRenderer.send('wc:drag-move', x, y),
  dragEnd:   () => ipcRenderer.send('wc:drag-end'),
});
