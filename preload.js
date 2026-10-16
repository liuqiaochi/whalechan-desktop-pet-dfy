const { contextBridge, ipcRenderer } = require('electron');

// 桌宠的窗口拖拽已改用 Electron 原生（-webkit-app-region: drag），由系统接管位移，
// 不再需要渲染层与主进程通信来驱动拖拽，故此处不暴露任何拖拽桥接。
contextBridge.exposeInMainWorld('wc', {});
