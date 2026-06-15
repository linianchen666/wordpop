const { Tray, Menu, nativeImage, app } = require('electron');

let tray = null;
let isPaused = false;

/**
 * 生成托盘图标 Buffer（纯内存，不读文件）
 * - 32×32 像素
 * - 蓝色背景 (#4A90E2) + 白色 "W" 字形
 * - 永远成功，不依赖任何外部文件
 */
function createTrayIconBuffer(size = 32) {
  const b = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const margin = Math.round(size * 0.125);   // 4px @32px
  const thick = Math.round(size * 0.1875); // 6px @32px

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const inBounds =
        x >= margin && x < size - margin &&
        y >= margin && y < size - margin;

      // "W" 字形像素
      const inW =
        inBounds && (
          // 左竖线
          (x >= margin && x < margin + thick &&
           y >= margin + thick && y < size - margin - Math.round(size * 0.125)) ||
          // 右竖线
          (x >= size - margin - thick && x < size - margin &&
           y >= margin + thick && y < size - margin - Math.round(size * 0.125)) ||
          // 左下斜线
          (x >= margin && x < cx &&
           y >= size - margin - Math.round(size * 0.125) &&
           y < size - margin &&
           Math.abs((y - (size - margin - Math.round(size * 0.125))) <=
             (x - margin) * ((size - margin - (size - margin - Math.round(size * 0.125))) / (cx - margin | 1)) ||
          // 右下斜线
          (x >= cx && x < size - margin &&
           y >= size - margin - Math.round(size * 0.125) &&
           y < size - margin &&
           Math.abs((y - (size - margin - Math.round(size * 0.125))) <=
             ((size - margin) - x) * ((size - margin - (size - margin - Math.round(size * 0.125))) / ((size - margin) - cx | 1))
        );

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

    tray = new Tray(icon);

    function buildMenu() {
      const items = [
        { label: 'WordPop v1.0 (预览)', enabled: false },
        { type: 'separator' },
        {
          label: isPaused ? '▶ 恢复学习' : '⏸ 暂停学习',
          click: () => {
            try {
              isPaused = !isPaused;
              if (options.onPauseToggle) options.onPauseToggle(isPaused);
              tray.setContextMenu(buildMenu());
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
    // 完全失败：返回 null，让 index.js 显示错误窗口
    return null;
  }
}

function setPaused(p) { isPaused = p; }
function destroyTray() { if (tray) { try { tray.destroy(); } catch (e) {} tray = null; } }

module.exports = { createTray, setPaused, destroyTray };
