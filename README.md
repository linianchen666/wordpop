# 📖 WordPop

**基于艾宾浩斯遗忘曲线的 Windows 桌面弹窗背单词工具**

[![Latest Release](https://img.shields.io/github/v/release/linianchen666/wordpop?label=latest)](https://github.com/linianchen666/wordpop/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/linianchen666/wordpop/releases/latest)

---

## ✨ 特性

- **艾宾浩斯遗忘曲线** — 9 阶段间隔复习（5min → 30min → 12h → 1d → 2d → 4d → 7d → 15d → 已掌握），科学抗遗忘
- **非侵入式弹窗** — 小窗口始终置顶，不影响正常工作，点击即反馈
- **连续刷词模式** — 点完一个单词立即弹出下一个，无需等待间隔
- **完整词库内置** — CET-4（2000 词）、CET-6（1532 词）、考研词汇（250 词）
- **随机排序** — 单词出现顺序完全随机，避免机械记忆
- **每日词量自定义** — 支持 5/10/20/30/50 个新词/天
- **系统托盘常驻** — 最小化到托盘，随时暂停/恢复
- **键盘快捷键** — ← / A 不认识，→ / D / Enter 认识，Space 发音，Esc 最小化
- **点击发音** — 基于 Web Speech API，点击单词即可朗读
- **学习统计** — 今日/累计数据、连续打卡、7 天趋势图、阶段分布

## 📸 截图

### 弹窗
小窗口显示单词、音标、释义、例句，两个按钮快速反馈：

```
┌─────────────────────────┐
│ 📖 WordPop    新词  ─   │
│                         │
│        abandon          │
│       /əˈbændən/       │
│    vt. 放弃；抛弃       │
│                         │
│  He abandoned his plan. │
│                         │
│  [✗ 不认识] [✓ 认识]    │
│ ▓▓▓▓▓░░░░░░░           │
└─────────────────────────┘
```

### 设置面板
配置每日词量、弹窗位置、词库选择、显示选项等。

### 统计面板
今日学习数据、累计进度、7 天趋势、阶段分布图。

## 🚀 下载安装

1. 前往 [Releases](https://github.com/linianchen666/wordpop/releases/latest) 下载最新版本的 `WordPop-vX.X.X-win-x64.zip`
2. 解压到任意目录
3. 运行 `win-unpacked/WordPop.exe`
4. 首次启动会弹出设置向导，选择词库和每日词量
5. 设置完成后弹窗立即开始显示单词

## 🎮 使用方法

| 操作 | 方式 |
|------|------|
| 标记「认识」 | 点击按钮 或 按 → / D / Enter |
| 标记「不认识」 | 点击按钮 或 按 ← / A |
| 单词发音 | 点击单词 或 按 Space |
| 最小化弹窗 | 点击 ─ 按钮 或 按 Esc |
| 暂停/恢复 | 右键托盘图标 → 暂停学习/恢复学习 |
| 打开设置 | 右键托盘图标 → 设置 |
| 查看统计 | 右键托盘图标 → 今日统计 |

## 🧠 复习间隔

基于艾宾浩斯遗忘曲线，每个单词有 9 个阶段：

| 阶段 | 间隔 | 说明 |
|------|------|------|
| 0 | 立即 | 新词首次出现 |
| 1 | 5 分钟 | 短期记忆巩固 |
| 2 | 30 分钟 | |
| 3 | 12 小时 | |
| 4 | 1 天 | |
| 5 | 2 天 | |
| 6 | 4 天 | |
| 7 | 7 天 | |
| 8 | 15 天 | |
| 9 | — | 🎉 已掌握，不再推送 |

- 点击「认识」→ 阶段 +1
- 点击「不认识」→ 阶段重置为 0

## 📚 词库

| 词库 | 词数 | 说明 |
|------|------|------|
| CET-4 四级 | 2000 | 大学英语四级高频词汇 |
| CET-6 六级 | 1532 | 大学英语六级词汇 |
| 考研词汇 | 250 | 考研英语核心词汇 |

支持导入自定义词表（CSV/TXT 格式）。

## 🛠 技术栈

- **Electron 28** — 桌面应用框架
- **better-sqlite3** — 本地 SQLite 数据库（WAL 模式）
- **原生 HTML/CSS/JS** — 轻量渲染，无框架依赖
- **electron-builder** — 打包与分发

### 项目结构

```
wordpop/
├── src/
│   ├── main/               # 主进程
│   │   ├── index.js        # 入口：应用生命周期
│   │   ├── popup-manager.js# 弹窗管理器
│   │   ├── scheduler.js    # 艾宾浩斯调度引擎
│   │   ├── db.js           # 数据库操作
│   │   ├── config.js       # 配置管理
│   │   ├── tray.js         # 系统托盘
│   │   └── ipc-handlers.js # IPC 通信处理
│   ├── preload/
│   │   └── preload.js      # 预加载脚本
│   ├── renderer/
│   │   ├── popup/          # 弹窗页面
│   │   ├── settings/      # 设置页面
│   │   ├── stats/         # 统计页面
│   │   └── shared/         # 共享样式与工具
│   └── data/wordlists/     # 内置词库 JSON
├── assets/                  # 图标资源
├── electron-builder.yml     # 构建配置
└── package.json
```

## 📝 开发

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建 Windows 版本
npm run build
```

## 📜 License

MIT
