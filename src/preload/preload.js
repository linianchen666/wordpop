const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wordpopAPI', {
  // === 弹窗操作 ===
  /** 接收单词数据推送 */
  onWordData: (callback) => {
    ipcRenderer.on('popup:word', (_event, data) => callback(data));
  },
  /** 接收隐藏信号 */
  onHide: (callback) => {
    ipcRenderer.on('popup:hide', () => callback());
  },
  /** 标记「认识」 */
  markKnown: () => ipcRenderer.send('word:known'),
  /** 标记「不认识」 */
  markUnknown: () => ipcRenderer.send('word:unknown'),
  /** 发音请求 */
  pronounce: (word) => ipcRenderer.send('word:pronounce', word),
  /** 手动隐藏弹窗（最小化到托盘） */
  minimizePopup: () => ipcRenderer.send('popup:minimize'),

  // === 设置操作 ===
  /** 获取完整配置 */
  getConfig: () => ipcRenderer.invoke('config:get'),
  /** 保存配置 */
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  /** 获取可用词库列表 */
  getWordlists: () => ipcRenderer.invoke('wordlists:get'),
  /** 导入词库到数据库 */
  importWordlist: (wordlistId) => ipcRenderer.invoke('wordlist:import', wordlistId),
  /** 导入自定义词表（打开文件选择对话框） */
  importCustomWordlist: () => ipcRenderer.invoke('wordlist:import-custom'),

  // === 统计操作 ===
  /** 获取统计概览 */
  getStats: () => ipcRenderer.invoke('stats:get'),
  /** 获取每日统计趋势 */
  getDailyStats: (days) => ipcRenderer.invoke('stats:daily', days),
  /** 获取各阶段单词分布 */
  getStageDistribution: () => ipcRenderer.invoke('stats:stage-distribution'),

  // === 调度器操作 ===
  /** 获取调度器状态 */
  getSchedulerStatus: () => ipcRenderer.invoke('scheduler:status'),
  /** 暂停/恢复 */
  togglePause: () => ipcRenderer.invoke('scheduler:toggle-pause'),

  // === 系统操作 ===
  /** 退出应用 */
  quitApp: () => ipcRenderer.send('app:quit'),

  // === 监听事件 ===
  /** 监听配置变更 */
  onConfigChanged: (callback) => {
    ipcRenderer.on('config:changed', (_event, config) => callback(config));
  },
  /** 监听统计更新 */
  onStatsUpdated: (callback) => {
    ipcRenderer.on('stats:updated', (_event, stats) => callback(stats));
  },

  // === 清理监听器 ===
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
