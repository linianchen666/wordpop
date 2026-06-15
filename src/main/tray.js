const { Tray, Menu, nativeImage, app } = require('electron');

let tray = null;
let isPaused = false;

/**
 * 生成托盘图标 Buffer（纯内存，不读文件）
 * - 32×32 像素
 * - 蓝色背景 (#4A90E2) + 白色 "W" 字母
 * - 永远成功，不依赖任何外部文件
 */
function createTrayIconBuffer(size = 32) {
  const b = Buffer.alloc(size * size * 4);
  const margin = Math.round(size * 0.125);   // 4px @32px
  const thick = Math.round(size * 0.1875);   // 6px @32px
  const cx = Math.round(size / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const inBounds =
        x >= margin && x < size - margin &&
        y >= margin && y < size - margin;

      // 简化的 "W" 字形：用几条线段近似
      // 左竖线
      const leftX = margin;
      const rightX = size - margin - 1;
      const topY = margin;
      const botY = size - margin - 1;
      const midY = Math.round(size * 0.45);

      let inW = false;

      // 左竖线（从上到下，但底部留空给斜线）
      if (x >= leftX && x < leftX + thick &&
          y >= topY && y <= botY - Math.round(size * 0.25)) {
        inW = true;
      }
      // 右竖线
      if (x >= rightX - thick + 1 && x <= rightX &&
          y >= topY && y <= botY - Math.round(size * 0.25)) {
        inW = true;
      }
      // 中间 V 形（连接左竖线和右竖线的底部）
      // 左斜线：从左竖线底部到右竖线中部
      if (x >= leftX && x < cx && y > botY - Math.round(size * 0.3)) {
        const expectedY = botY - Math.round((x - leftX) * (botY - midY) / (cx - leftX - 1 || 1));
        if (Math.abs(y - expectedY) < thick) inW = true;
      }
      // 右斜线：从右竖线底部到左竖线中部
      if (x >= cx && x <= rightX && y > botY - Math.round(size * 0.3)) {
        const expectedY = botY - Math.round((rightX - x) * (botY - midY) / (rightX - cx - 1 || 1));
        if (Math.abs(y - expectedY) < thick) inW = true;
      }
      // 顶部横线连接左右竖线
      if (y >= topY && y < topY + Math.round(thick * 0.6) &&
          x >= leftX && x <= rightX) {
        inW = true;
      }

      if (inW) {
        b[idx] = 255; b[idx + 1] = 255; b[idx + 2] = 255; b[idx + 3] = 255;
      } else if (inBounds) {
        b[idx] = 74; b[idx + 1] = 144; b[idx + 2] = 226; b[idx + 3] = 255;
      } else {
        b[idx + 3] = 0; // 透明
      }
    }
  }
  return b;
}

/**
 * 创建系统托盘
 */
function createTray(options = {}) {
  if (tray) return tray;

  try {
    const size = 32;
    const buf = createTrayIconBuffer(size);
    const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });

    // 验证图标是否有效
    if (icon.isEmpty()) {
      console.error('[Tray] Generated icon is empty! Using fallback circle icon...');
      // 创建一个简单的纯色圆形作为 fallback
      const fallbackBuf = Buffer.alloc(size * size * 4);
      const cx2 = Math.round(size / 2), cy2 = Math.round(size / 2);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;
          const dx = x - cx2, dy = y - cy2;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < size / 2 - 1) {
            fallbackBuf[idx] = 74; fallbackBuf[idx + 1] = 144; fallbackBuf[idx + 2] = 226; fallbackBuf[idx + 3] = 255;
          } else {
            fallbackBuf[idx + 3] = 0;
          }
        }
      }
      const fallbackIcon = nativeImage.createFromBuffer(fallbackBuf, { width: size, height: size });
      if (!fallbackIcon.isEmpty()) {
        tray = new Tray(fallbackIcon);
      } else {
        // 最后兜底：用 1x1 像素图标
        const tinyBuf = Buffer.from([74, 144, 226, 255]);
        tray = new Tray(nativeImage.createFromBuffer(tinyBuf, { width: 1, height: 1 }));
      }
    } else {
      tray = new Tray(icon);
    }

    function buildMenu() {
      const items = [
        { label: 'WordPop v1.0.12 (预览)', enabled: false },
        { type: 'separator' },
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
      try { if (options.onOpenStats) options.onOpenStats(); } catch (e) {}
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
