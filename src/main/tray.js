const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let isPaused = false;

/**
 * 创建托盘图标
 * 在打包环境中，assets 在 asar 内部，Windows 托盘需要从 asar 中正确读取 PNG
 * 使用 process.resourcesPath + app.asar 路径确保在打包后也能找到图标
 */
function createTrayIcon(size = 16) {
  // 尝试多个路径查找图标
  const iconPaths = [
    // 打包后：asar 内部路径
    path.join(__dirname, '..', '..', 'assets', 'tray-icon.png'),
    // 打包后：process.resourcesPath 外部路径（如果 assets 被 extraResources 复制出来）
    path.join(process.resourcesPath, 'assets', 'tray-icon.png'),
    // 开发环境路径
    path.join(__dirname, '..', '..', 'assets', 'tray-icon.png'),
  ];

  for (const iconPath of iconPaths) {
    try {
      // Electron 支持 asar 路径读取，但需要验证图片是否有效
      if (fs.existsSync(iconPath) || iconPath.includes('.asar')) {
        const img = nativeImage.createFromPath(iconPath);
        if (!img.isEmpty()) {
          return img.resize({ width: size, height: size });
        }
      }
    } catch (e) {
      // 继续尝试下一个路径
    }
  }

  // 所有路径都失败，创建可靠的默认图标
  return createDefaultTrayIcon(size);
}

/**
 * 创建默认托盘图标
 * 使用 32x32 尺寸（Windows 推荐的托盘图标大小）
 * 使用更鲜明的颜色确保在 Windows 任务栏中可见
 */
function createDefaultTrayIcon(size = 32) {
  const canvas = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // 绘制一个 "W" 形状的蓝色图标
      const center = size / 2;
      const margin = 4;

      // 背景圆角矩形
      const inBounds = x >= margin && x < size - margin &&
                       y >= margin && y < size - margin;

      // W 字形区域
      const inW = inBounds && (
        // 左竖线
        (x >= margin + 4 && x <= margin + 6 && y >= margin + 6 && y <= size - margin - 4) ||
        // 右竖线
        (x >= size - margin - 6 && x <= size - margin - 4 && y >= margin + 6 && y <= size - margin - 4) ||
        // V 字底部连接
        (y >= size - margin - 6 && y <= size - margin - 4 &&
         x >= margin + 4 + (y - (size - margin - 6)) &&
         x <= size - margin - 4 - (y - (size - margin - 6)))
      );

      if (inW) {
        // W 字：白色
        canvas[idx] = 255;
        canvas[idx + 1] = 255;
        canvas[idx + 2] = 255;
        canvas[idx + 3] = 255;
      } else if (inBounds) {
        // 背景：蓝色圆角矩形
        canvas[idx] = 74;      // R
        canvas[idx + 1] = 144; // G
        canvas[idx + 2] = 226; // B
        canvas[idx + 3] = 255; // A
      } else {
        // 透明区域
        canvas[idx] = 0;
        canvas[idx + 1] = 0;
        canvas[idx + 2] = 0;
        canvas[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size,
    dpiAware: false  // Windows DPI 适配
  });
}

/**
 * 创建系统托盘
 * @param {object} options - { onPauseToggle, onOpenSettings, onOpenStats, onQuit }
 */
function createTray(options = {}) {
  if (tray) return tray;

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