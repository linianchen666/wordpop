const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('wordpopAPI', {
  // === 弹窗操作 ===
  onWordData:      (cb) => ipcRenderer.on('popup:word',  (_e,d) => cb(d)),
  onHide:          (cb) => ipcRenderer.on('popup:hide',         () => cb()),
  markKnown:       ()  => ipcRenderer.send('word:known'),
  markUnknown:     ()  => ipcRenderer.send('word:unknown'),
  markMastered:    ()  => ipcRenderer.send('word:mastered'),
  pronounce:       (w) => ipcRenderer.send('word:pronounce', w),
  minimizePopup:  ()  => ipcRenderer.send('popup:minimize'),

  // === 设置操作 ===
  getConfig:           ()  => ipcRenderer.invoke('config:get'),
  saveConfig:          (c) => ipcRenderer.invoke('config:save', c),
  getWordlists:        ()  => ipcRenderer.invoke('wordlists:get'),
  importWordlist:      (id) => ipcRenderer.invoke('wordlist:import', id),
  importCustomWordlist: ()  => ipcRenderer.invoke('wordlist:import-custom'),

  // === 日志操作（新增）===
  getLogs:            ()  => ipcRenderer.invoke('app:get-logs'),
  openLogFolder:     ()  => ipcRenderer.invoke('app:open-log-folder'),

  // === 统计操作 ===
  getStats:            ()  => ipcRenderer.invoke('stats:get'),
  getDailyStats:       (d) => ipcRenderer.invoke('stats:daily', d),
  getStageDistribution: ()  => ipcRenderer.invoke('stats:stage-distribution'),

  // === 调度器操作 ===
  getSchedulerStatus:  ()  => ipcRenderer.invoke('scheduler:status'),
  togglePause:        ()  => ipcRenderer.invoke('scheduler:toggle-pause'),

  // === 系统操作 ===
  quitApp:            ()  => ipcRenderer.send('app:quit'),

  // === 事件监听 ===
  onConfigChanged:    (cb) => ipcRenderer.on('config:changed',   (_e,c) => cb(c)),
  onStatsUpdated:    (cb) => ipcRenderer.on('stats:updated',   () => cb()),
});
