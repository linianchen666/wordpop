const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let isPaused = false;

// 托盘图标：使用简单的 16x16 像素 PNG 作为默认图标
// 在实际 Windows 构建中，assets/tray-icon.png 应该是一个 16x16 或 32x32 的 PNG

function createTrayIcon(size = 16) {
  // 创建一个简单的书本图标（纯色方块 + 文字模拟）
  // 在生产环境中应替换为实际的 .ico/.png 文件
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
  try {
    return nativeImage.createFromPath(iconPath).resize({ width: size, height: size });
  } catch (e) {
    // 如果图标文件不存在，创建一个简单的默认图标
    return createDefaultTrayIcon(size);
  }
}

function createDefaultTrayIcon(size = 16) {
  // 使用 nativeImage 创建一个简单的 16x16 图标
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // 简单渐变色作为默认图标
      const isEdge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const isCenter = x >= 4 && x <= 11 && y >= 4 && y <= 11;
      if (isCenter) {
        canvas[idx] = 74;      // R
        canvas[idx + 1] = 144; // G
        canvas[idx + 2] = 226; // B
        canvas[idx + 3] = 255; // A
      } else if (isEdge) {
        canvas[idx] = 40;
        canvas[idx + 1] = 80;
        canvas[idx + 2] = 120;
        canvas[idx + 3] = 255;
      } else {
        canvas[idx] = 60;
        canvas[idx + 1] = 100;
        canvas[idx + 2] = 160;
        canvas[idx + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

/**
 * 创建系统托盘
 * @param {object} options - { onPauseToggle, onOpenSettings, onOpenStats, onQuit }
 */
function createTray(options = {}) {
  if (tray) return tray;

  const icon = createTrayIcon(16);
  tray = new Tray(icon);

  function buildContextMenu() {
    const menuItems = [
      {
        label: 'WordPop v1.0',
        enabled: false
      },
      { type: 'separator' },
      {
        label: isPaused ? '▶ 恢复学习' : '⏸ 暂停学习',
        click: () => {
          isPaused = !isPaused;
          if (options.onPauseToggle) {
            options.onPauseToggle(isPaused);
          }
          tray.setContextMenu(buildContextMenu());
        }
      },
      {
        label: '📊 今日统计',
        click: () => {
          if (options.onOpenStats) options.onOpenStats();
        }
      },
      { type: 'separator' },
      {
        label: '⚙ 设置',
        click: () => {
          if (options.onOpenSettings) options.onOpenSettings();
        }
      },
      { type: 'separator' },
      {
        label: '❌ 退出 WordPop',
        click: () => {
          if (options.onQuit) options.onQuit();
        }
      }
    ];

    return Menu.buildFromTemplate(menuItems);
  }

  tray.setToolTip('WordPop - 艾宾浩斯背单词');
  tray.setContextMenu(buildContextMenu());

  // 双击托盘图标打开统计面板
  tray.on('double-click', () => {
    if (options.onOpenStats) options.onOpenStats();
  });

  return tray;
}

/**
 * 设置暂停状态
 */
function setPaused(paused) {
  isPaused = paused;
  if (tray) {
    // 更新托盘图标
    const iconPath = paused
      ? path.join(__dirname, '..', '..', 'assets', 'tray-icon-paused.png')
      : path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
    try {
      tray.setImage(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
    } catch (e) {
      // 使用默认图标
    }
  }
}

/**
 * 销毁托盘
 */
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, setPaused, destroyTray };
