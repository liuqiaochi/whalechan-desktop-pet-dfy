/**
 * preload-game.js —— 小游戏的沙箱桥（只暴露 window.PetGame）
 *
 * 这是游戏与桌宠之间**唯一**的通道。除此之外游戏什么都没有：
 * 没有 require、没有 fs、没有 Node、没有主进程对象。
 *
 * 之所以由 preload 直接 exposeInMainWorld 而不是让游戏引一个 SDK 文件：
 * 创作者零工具链 —— 不需要 npm、不需要打包、不需要 <script>，打开就有 PetGame。
 * 这跟本项目「没有构建步骤」的风格一致，也少一个「忘了引 SDK」的坑。
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function detectGameId() {
  try {
    const arg = (process.argv || []).find((a) => a.startsWith('--petgame-id='));
    if (arg) return arg.slice('--petgame-id='.length);
  } catch (_) {}
  try {
    return (location.pathname || '').split('/').filter(Boolean)[0] || '';
  } catch (_) {
    return '';
  }
}

const GAME_ID = detectGameId();

contextBridge.exposeInMainWorld('PetGame', {
  /** 协议版本 */
  version: 1,
  /** 本游戏 id（由清单声明） */
  id: GAME_ID,

  /** 握手：确认宿主可用 */
  ready: () => ipcRenderer.invoke('petgame:ready'),

  /** 开一局。开始时间由主进程记录，游戏说的时间不作数。 */
  startSession: () => ipcRenderer.invoke('petgame:start'),

  /**
   * 结算。只能传分数，**不能传「要加多少白饭」**。
   * 返回 { awarded, balance, capped }
   *   awarded —— 主进程算出来的实际白饭，不是游戏说了算
   *   capped  —— 'too-fast' | 'session' | 'daily' | 'diminish' | null
   */
  submit: (score) => ipcRenderer.invoke('petgame:submit', { score: Number(score) || 0 }),

  /** 让桌宠做个反应：'happy' | 'full' | 'sleepy' | 'excited' */
  react: (mood) => ipcRenderer.send('petgame:react', { mood: String(mood || 'happy') }),

  /** 请求关闭游戏窗口 */
  close: () => ipcRenderer.send('petgame:close'),
});
