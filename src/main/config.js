const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILENAME = 'config.json';

const DEFAULT_CONFIG = {
  dailyNewWords: 20,
  popupPosition: 'bottom-right',   // top-left | top-right | bottom-left | bottom-right
  selectedWordlists: ['cet4'],     // 启用的词库列表
  autoPronounce: false,            // 自动发音
  autoStart: false,                // 开机自启
  showExample: true,               // 显示例句
  fontSize: 'medium',              // small | medium | large
  theme: 'light',                  // light | dark
  setupComplete: false             // 是否已完成初始化设置
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

    // 处理开机自启
    if ('autoStart' in config) {
      app.setLoginItemSettings({
        openAtLogin: config.autoStart,
        path: app.getPath('exe')
      });
    }

    console.log('[Config] Config saved:', Object.keys(config).join(', '));
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
  DEFAULT_CONFIG
};
