const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('wordpopAPI', {
  // === 弹窗操作 ===
  onWordData:      (cb) => ipcRenderer.on('popup:word',  (_e,d) => cb(d)),
  onHide:          (cb) => ipcRenderer.on('popup:hide',         () => cb()),
  markKnown:       ()  => ipcRenderer.send('word:known'),
  markUnknown:     ()  => ipcRenderer.send('word:unknown'),
  markFuzzy:       ()  => ipcRenderer.send('word:fuzzy'),
  markMastered:    ()  => ipcRenderer.send('word:mastered'),
  undo:            ()  => ipcRenderer.send('word:undo'),
  minimizePopup:  ()  => ipcRenderer.send('popup:minimize'),

  // === 胶囊操作 ===
  onPillData:         (cb) => ipcRenderer.on('pill-data', (_e, d) => cb(d)),
  closePill:          ()   => ipcRenderer.send('pill:close'),

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
  getStubbornWords:    (m)  => ipcRenderer.invoke('stats:stubborn-words', m),
  getProgressSummary:  (ids) => ipcRenderer.invoke('stats:progress-summary', ids),

  // === 数据库诊断与修复 ===
  diagnoseDatabase:   ()  => ipcRenderer.invoke('db:diagnose'),
  repairDatabase:     ()  => ipcRenderer.invoke('db:repair'),

  // === 数据备份与恢复 ===
  exportBackup:       ()  => ipcRenderer.invoke('backup:export'),
  importBackup:       ()  => ipcRenderer.invoke('backup:import'),

  // === 调度器操作、批次与积压平摊 ===
  getSchedulerStatus:  ()  => ipcRenderer.invoke('scheduler:status'),
  getDynamicQuotaInfo: ()  => ipcRenderer.invoke('scheduler:quota-info'),
  smoothOverdueReviews:(d) => ipcRenderer.invoke('reviews:smooth-overdue', d),
  triggerNextBatch:    ()  => ipcRenderer.invoke('scheduler:trigger-next-batch'),
  togglePause:        ()  => ipcRenderer.invoke('scheduler:toggle-pause'),

  // === 沉浸专注刷词模式 ===
  openFocusSession:   ()   => ipcRenderer.invoke('focus:open'),
  closeFocusSession:  ()   => ipcRenderer.invoke('focus:close'),
  getFocusWords:      (c)  => ipcRenderer.invoke('focus:get-words', c),
  submitFocusWord:    (id, a) => ipcRenderer.invoke('focus:submit-word', id, a),

  // === 系统操作 ===
  quitApp:            ()  => ipcRenderer.send('app:quit'),

  // === 事件监听 ===
  onConfigChanged:    (cb) => ipcRenderer.on('config:changed',   (_e,c) => cb(c)),
  onStatsUpdated:    (cb) => ipcRenderer.on('stats:updated',   () => cb()),
  onScrollToStubborn: (cb) => ipcRenderer.on('stats:scroll-to-stubborn', () => cb()),
  onBatchCompleted:   (cb) => ipcRenderer.on('popup:batch-completed', (_e,d) => cb(d)),
});
