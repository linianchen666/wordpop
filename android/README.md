# WordPop Android

Android 8.0 及以上，推荐更新 Android System WebView。针对三星 Z Flip7 的普通桌面与小屏应用界面，使用系统 AppWidget 小组件、原生 SQLite 持久化和 JavaScriptSandbox 执行与电脑端相同的 FSRS 库。

## 构建

在仓库根目录运行 `npm ci --ignore-scripts`，然后 `node android/tools/build-assets.cjs`。Android 构建需要 JDK 17、Gradle 8.11.1、Android SDK 35 和 Build Tools 35.0.0，设置 `ANDROID_HOME` 后运行 `gradle -p android assembleDebug lintDebug`。

APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`。测试包使用调试签名，可安装体验；后续正式发行需要固定签名密钥，不能把不同签名的 APK 当成覆盖升级包。仓库的 Android APK 工作流构建并通过模拟器执行设备测试。

## 使用

安装后打开应用，选择词库和新词计划；点击“添加桌面小组件”，也可长按桌面空白处 → 小组件 → WordPop。小组件先显示单词，点释义区展开，再选择不认识、模糊、认识或轻松。可调整小组件大小。手机和小组件共用本地记录；离线也可评分。反馈规则与电脑版本一致：首次不认识/模糊后 1 分钟，答对再确认 10 分钟，确认后由 FSRS 安排跨日复习。

云配置见 [Supabase 说明](../cloud/README.md)。应用打开时同步约 5 秒，操作小组件后同步；后台受系统限制，不保证实时。

## 三星外屏

普通桌面支持标准 AppWidget。Z Flip7/One UI 是否允许把第三方 AppWidget 直接放到外屏，必须在实际手机上确认；目前未验证，不声称已支持原生外屏小组件。

应用界面支持缩放与小屏布局。若系统外屏不提供 WordPop 小组件，可通过三星 Good Lock → MultiStar 的外屏应用启动器允许并打开 WordPop（具体入口随 One UI 和地区变化）。这是外屏运行应用的替代方案，不能等同于直接添加外屏小组件。
