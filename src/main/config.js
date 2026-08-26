const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILENAME = 'config.json';

const DEFAULT_CONFIG = {
  dailyNewWords: 20,
  dailyNewWordsMode: 'fixed',      // fixed (固定词量) | target (智能目标模式)
  autoBalanceLoad: true,           // 智能负荷动态平衡：复习过多时自动削减/暂停新词
  maxDynamicNewWords: 50,          // 智能模式每日新词上限
  batchSize: 3,                    // 单次弹窗批次词数：1, 3, 5, 0 (0为连续不间断)
  cooldownMinutes: 10,             // 批次完成后的静默冷却时间（分钟）：1, 3, 5, 10, 15, 30
  displayMode: 'card',             // card (标准卡片 380x440) | pill (灵动胶囊 300x54)
  smartDisturbance: true,          // 智能打扰感知：高强度打字时暂缓弹出
  popupPosition: 'bottom-right',   // top-left | top-right | bottom-left | bottom-right
  selectedWordlists: ['cet4'],     // 启用的词库列表
  autoPronounce: true,             // 自动发音
  pronounceVoice: 'dict-us',       // 发音音色：dict-us (标准美音) | dict-uk (标准英音) | loli (萝莉音) | mature (御姐音) | deep-male (大叔音) | fast (速记音)
  autoStart: false,                // 开机自启
  showExample: true,               // 显示例句
  fontSize: 'medium',              // small | medium | large
  theme: 'light',                  // light | dark
  setupComplete: false,            // 是否已完成初始化设置
  targetDate: null,                 // 目标完成日期，格式 'YYYY-MM-DD'，null表示未设置
  autoCheckUpdate: true            // 自动检查更新（每天一次）
};

let configPath = null;
let cachedConfig = null;

/**
 * 获取配置文件路径
 */
function getConfigPath() {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), CONFIG_FILENAME);
  }
  return configPath;
}

/**
 * 加载配置
 * @returns {object} 合并默认值后的配置对象
 */
function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const filePath = getConfigPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const userConfig = JSON.parse(raw);
      // 迁移旧版配置中的 pronounceAccent -> pronounceVoice
      if (userConfig.pronounceAccent && !userConfig.pronounceVoice) {
        userConfig.pronounceVoice = (userConfig.pronounceAccent === 'en-GB' || userConfig.pronounceAccent === 'uk') ? 'dict-uk' : 'dict-us';
        delete userConfig.pronounceAccent;
      }
      cachedConfig = { ...DEFAULT_CONFIG, ...userConfig };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
  } catch (err) {
    console.error('[Config] Failed to load config:', err.message);
    cachedConfig = { ...DEFAULT_CONFIG };
  }

  return cachedConfig;
}

/**
 * 保存配置
 * @param {object} config - 要保存的配置对象
 */
function saveConfig(config) {
  const filePath = getConfigPath();
  try {
    const merged = { ...loadConfig(), ...config };
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    cachedConfig = merged;
    if ('autoStart' in config) {
      app.setLoginItemSettings({
        openAtLogin: config.autoStart,
        path: app.getPath('exe')
      });
    }

    return { success: true, config: merged };
  } catch (err) {
    console.error('[Config] Failed to save config:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 获取单个配置项
 */
function getConfig(key) {
  const config = loadConfig();
  return config[key] !== undefined ? config[key] : DEFAULT_CONFIG[key];
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfig,
  DEFAULT_CONFIG,
  /**
   * 清除配置缓存，下次 loadConfig() 将重新从磁盘读取
   * 在设置窗口关闭等场景中调用
   */
  clearCache() { cachedConfig = null; }
};
