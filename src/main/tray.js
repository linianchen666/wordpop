const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let isPaused = false;

/**
 * 创建托盘图标
 * 安全的多路径查找 + 可靠的兜底图标
 * 每一步都有 try-catch，确保不会抛出异常阻断应用启动
 */
function createTrayIcon(size = 32) {
  // 方法1：尝试读取 asar 内的 PNG 文件
  try {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      return img.resize({ width: size, height: size });
    }
  } catch (e) {
    // asar 内 PNG 读取失败
  }

  // 方法2：尝试读取 extraResources 外的 PNG
  try {
    const iconPath = path.join(process.resourcesPath, 'assets', 'tray-icon.png');
    if (fs.existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) {
        return img.resize({ width: size, height: size });
      }
    }
  } catch (e) {
    // 外部 PNG 读取失败
  }

  // 方法3：像素图标兜底（永远不会失败）
  return createPixelTrayIcon(size);
}

/**
 * 创建像素图标兜底
 * 32x32 蓝色方块 + 白色 W，确保在 Windows 任务栏中可见
 */
function createPixelTrayIcon(size = 32) {
  try {
    const canvas = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const margin = 4;

        const inBounds = x >= margin && x < size - margin &&
                         y >= margin && y < size - margin;

        if (inBounds) {
          // 蓝色方块背景
          canvas[idx] = 74;      // R
          canvas[idx + 1] = 144; // G
          canvas[idx + 2] = 226; // B
          canvas[idx + 3] = 255; // A
        } else {
          canvas[idx] = 0;
          canvas[idx + 1] = 0;
          canvas[idx + 2] = 0;
          canvas[idx + 3] = 0;
        }
      }
    }

    return nativeImage.createFromBuffer(canvas, {
      width: size,
      height: size
    });
  } catch (e) {
    // 哪怕像素图标也失败了（几乎不可能），创建 1x1 的纯色图标
    const fallback = Buffer.alloc(4);
    fallback[0] = 74;   // R
    fallback[1] = 144;  // G
    fallback[2] = 226;  // B
    fallback[3] = 255;  // A
    return nativeImage.createFromBuffer(fallback, { width: 1, height: 1 });
  }
}

/**
 * 创建系统托盘
 * 整个函数包裹在 try-catch 中，确保不会崩溃阻断应用
 */
function createTray(options = {}) {
  if (tray) return tray;

  try {
    const icon = createTrayIcon(32);

    tray = new Tray(icon);

    function buildContextMenu() {
      const menuItems = [
        {
          label: 'WordPop v1.0',
          enabled: false
        },
        { type: 'separator' },
        {
          label: isPaused ? '恢复学习' : '暂停学习',
          click: () => {
            try {
              isPaused = !isPaused;
              if (options.onPauseToggle) {
                options.onPauseToggle(isPaused);
              }
              tray.setContextMenu(buildContextMenu());
            } catch (e) {
              console.error('[Tray] Pause toggle error:', e.message);
            }
          }
        },
        {
          label: '今日统计',
          click: () => {
            try {
              if (options.onOpenStats) options.onOpenStats();
            } catch (e) {
              console.error('[Tray] Stats open error:', e.message);
            }
          }
        },
        { type: 'separator' },
        {
          label: '设置',
          click: () => {
            try {
              if (options.onOpenSettings) options.onOpenSettings();
            } catch (e) {
              console.error('[Tray] Settings open error:', e.message);
            }
          }
        },
        { type: 'separator' },
        {
          label: '退出 WordPop',
          click: () => {
            try {
              if (options.onQuit) options.onQuit();
            } catch (e) {
              // 退出时不在乎错误
              app.quit();
            }
          }
        }
      ];

      return Menu.buildFromTemplate(menuItems);
    }

    tray.setToolTip('WordPop - 艾宾浩斯背单词');
    tray.setContextMenu(buildContextMenu());

    tray.on('double-click', () => {
      try {
        if (options.onOpenStats) options.onOpenStats();
      } catch (e) {
        console.error('[Tray] Double-click error:', e.message);
      }
    });

    return tray;
  } catch (err) {
    console.error('[Tray] FAILED to create tray:', err.message);
    // 返回 null 表示托盘创建失败，index.js 会据此判断是否需要显示错误窗口
    return null;
  }
}

function setPaused(paused) {
  isPaused = paused;
}

function destroyTray() {
  try {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  } catch (e) {
    // 退出时不在乎
  }
}

module.exports = { createTray, setPaused, destroyTray };