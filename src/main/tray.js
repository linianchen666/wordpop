const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let isPaused = false;

/**
 * 获取托盘图标
 * 优先使用 tray-icon.png 文件（与应用图标一致）
 * 如果文件不存在，fallback 到像素生成的 W 字母图标
 */
function getTrayIcon() {
  // 1. 尝试从文件加载
  let iconPath = null;
  if (app.isPackaged) {
    // 打包后：resources/tray-icon.png（通过 extraResources 复制）
    iconPath = path.join(process.resourcesPath, 'tray-icon.png');
  } else {
    // 开发模式：assets/tray-icon.png
    iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
  }

  if (fs.existsSync(iconPath)) {
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        console.log('[Tray] Using file icon:', iconPath);
        return icon;
      }
    } catch (e) {
      console.error('[Tray] Failed to load file icon:', e.message);
    }
  }

  // 2. Fallback: 像素生成 W 字母图标
  console.log('[Tray] File icon not found, generating pixel icon');
  return generatePixelIcon();
}

/**
 * 像素生成 W 字母图标（fallback）
 */
function generatePixelIcon(size = 32) {
  const b = Buffer.alloc(size * size * 4);
  const margin = Math.round(size * 0.125);
  const thick = Math.round(size * 0.1875);
  const cx = Math.round(size / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const inBounds =
        x >= margin && x < size - margin &&
        y >= margin && y < size - margin;

      const leftX = margin;
      const rightX = size - margin - 1;
      const topY = margin;
      const botY = size - margin - 1;
      const midY = Math.round(size * 0.45);

      let inW = false;

      // 左竖线
      if (x >= leftX && x < leftX + thick &&
          y >= topY && y <= botY - Math.round(size * 0.25)) {
        inW = true;
      }
      // 右竖线
      if (x >= rightX - thick + 1 && x <= rightX &&
          y >= topY && y <= botY - Math.round(size * 0.25)) {
        inW = true;
      }
      // 中间 V 形
      if (x >= leftX && x < cx && y > botY - Math.round(size * 0.3)) {
        const expectedY = botY - Math.round((x - leftX) * (botY - midY) / (cx - leftX - 1 || 1));
        if (Math.abs(y - expectedY) < thick) inW = true;
      }
      if (x >= cx && x <= rightX && y > botY - Math.round(size * 0.3)) {
        const expectedY = botY - Math.round((rightX - x) * (botY - midY) / (rightX - cx - 1 || 1));
        if (Math.abs(y - expectedY) < thick) inW = true;
      }
      // 顶部横线
      if (y >= topY && y < topY + Math.round(thick * 0.6) &&
          x >= leftX && x <= rightX) {
        inW = true;
      }

      if (inW) {
        b[idx] = 255; b[idx + 1] = 255; b[idx + 2] = 255; b[idx + 3] = 255;
      } else if (inBounds) {
        b[idx] = 74; b[idx + 1] = 144; b[idx + 2] = 226; b[idx + 3] = 255;
      } else {
        b[idx + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(b, { width: size, height: size });
}

/**
 * 生成纯色圆形图标（最终 fallback）
 */
function generateFallbackCircle(size = 32) {
  const b = Buffer.alloc(size * size * 4);
  const cx = Math.round(size / 2), cy = Math.round(size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < size / 2 - 1) {
        b[idx] = 74; b[idx + 1] = 144; b[idx + 2] = 226; b[idx + 3] = 255;
      } else {
        b[idx + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(b, { width: size, height: size });
}

/**
 * 创建系统托盘
 */
function createTray(options = {}) {
  if (tray) return tray;

  try {
    const icon = getTrayIcon();

    if (icon.isEmpty()) {
      console.error('[Tray] Icon is empty! Using fallback circle icon...');
      const fallbackIcon = generateFallbackCircle();
      if (!fallbackIcon.isEmpty()) {
        tray = new Tray(fallbackIcon);
      } else {
        const tinyBuf = Buffer.from([74, 144, 226, 255]);
        tray = new Tray(nativeImage.createFromBuffer(tinyBuf, { width: 1, height: 1 }));
      }
    } else {
      tray = new Tray(icon);
    }

    function buildMenu() {
      const items = [
        { label: 'WordPop v' + app.getVersion(), enabled: false },
        { type: 'separator' },
        {
          label: '📖 显示弹窗',
          click: () => { try { if (options.onShowPopup) options.onShowPopup(); } catch (e) {} }
        },
        {
          label: isPaused ? '▶ 恢复学习' : '⏸ 暂停学习',
          click: () => {
            try {
              isPaused = !isPaused;
              if (options.onPauseToggle) options.onPauseToggle(isPaused);
              if (tray) tray.setContextMenu(buildMenu());
            } catch (e) { console.error('[Tray] pause error:', e.message); }
          }
        },
        {
          label: '📊 今日统计',
          click: () => { try { if (options.onOpenStats) options.onOpenStats(); } catch (e) {} }
        },
        { type: 'separator' },
        {
          label: '⚙ 设置',
          click: () => { try { if (options.onOpenSettings) options.onOpenSettings(); } catch (e) {} }
        },
        { type: 'separator' },
        {
          label: '❌ 退出 WordPop',
          click: () => { try { if (options.onQuit) options.onQuit(); } catch (e) { app.quit(); } }
        }
      ];
      return Menu.buildFromTemplate(items);
    }

    tray.setToolTip('WordPop - 艾宾浩斯背单词');
    tray.setContextMenu(buildMenu());

    tray.on('double-click', () => {
      try { if (options.onShowPopup) options.onShowPopup(); } catch (e) {}
    });

    console.log('[Tray] Tray created successfully');
    return tray;
  } catch (err) {
    console.error('[Tray] FATAL: could not create tray:', err.message, err.stack);
    return null;
  }
}

function setPaused(p) { isPaused = p; }
function destroyTray() { if (tray) { try { tray.destroy(); } catch (e) {} tray = null; } }

module.exports = { createTray, setPaused, destroyTray };
