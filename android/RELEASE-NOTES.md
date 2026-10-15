# WordPop v1.9.2 正式版

Windows 1.9.2 与 Android 0.1.6：新增三星外屏背词组件，并统一两端图标。

- **独立外屏组件**：新增“WordPop 外屏背词”，按三星公开 Flex Window 接口声明，和普通桌面组件分别注册。可直接显示释义、发音、选择不认识 / 模糊 / 认识，或点击右上角星号表示轻松，并支持撤销上次评分。两种组件与 App 共用本地记录及云同步。
- **外屏布局**：调整小屏文字、按钮和触摸区域；先回忆时英文居中，显示释义后上移。背景透明度与自动发音设置可应用到外屏组件，设置页可滚动。
- **统一图标**：采用蓝色词卡、白色 W 与青色星光，覆盖 Android 启动图标、自适应图标，以及 Windows 程序、窗口、安装器和托盘。
- **覆盖升级**：Android 使用非调试 release 构建，沿用固定签名，versionCode 升为 8；从 0.1.2 起的固定签名包可覆盖安装，保留账号、学习记录和已有桌面组件。无需修改 Supabase 表。

## 三星 Z Flip7 外屏添加

安装新版后先打开 App，再进入三星 **设置 → 外屏 → 小组件**，查找 WordPop / WordPop 外屏背词并启用。入口随 One UI 和地区变化。

采用的是三星公开开发接口；组件声明、布局和评分 / 撤销交互已通过 Android 模拟器测试，**三星 Flip7 的外屏列表能否显示并添加仍需实机确认**。普通 Android 模拟器不能验证三星外屏宿主。如果系统没有提供该条目，可参阅手机说明中的 CoverWidgets 备用方案；它是第三方工具，可能要求无障碍权限和付费。原有 Good Lock / MultiStar 打开 App 的方式也保留。

## 安装与升级

- **Android**：下载 `WordPop.Android.0.1.6.apk` 覆盖安装。0.1.5 可从 App 右上角菜单 →“检查更新”进入；更早版本请手动下载。固定签名版本请直接覆盖，无需卸载。
- **Windows**：从托盘退出现有版本，再运行 `WordPop.Setup.1.9.2.exe`。也可通过托盘“检查更新”进入发布页，保留本地数据。
- 旧临时签名 0.1.0 / 0.1.1 需先完成云同步并在电脑备份，再重装恢复；卸载会清除手机本地数据。

沿用现有 FSRS 和增量同步规则，评分立即保存到本地；手机后台同步受系统节电、待机和网络影响，可能延迟。

两端安装包及 `SHA256SUMS.txt` 位于同一发布页。

[手机使用说明](https://github.com/linianchen666/wordpop/blob/main/android/README.md) · [三星官方 Flex Window 文档](https://developer.samsung.com/galaxy-z/flex_window.html) · [云同步规则](https://github.com/linianchen666/wordpop/blob/main/cloud/README.md) · [签名说明](https://github.com/linianchen666/wordpop/blob/main/android/SIGNING.md)
