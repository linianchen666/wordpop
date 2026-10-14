Android 0.1.2-beta.1 与 Windows 云同步预览 1.9.0-beta.3。Windows 正式 Latest 仍为 v1.8.6，本次以测试版发布。

- App 点击“显示释义”立即展开已加载的释义、底部三个反馈按钮及右上角轻松星号，后台完成状态保存。减少页面数据传输，不再把完整学习历史传给页面；小组件更新不再阻塞 App 回调。
- 评分过程中防止快速连点重复提交；延迟的旧回调不会切回上一词，失败时恢复界面并显示提示。模拟后台延迟 500ms 的界面回归检查通过，实际手机响应速度需实机测试。
- 从本版开始采用固定 WordPop 安装签名，GitHub Secrets 和证书指纹已验证。后续保留同一密钥并递增版本可覆盖升级，构建和发布检查会拒绝其他证书。
- 保留小组件透明度调整、横纵缩放与紧凑布局、发音按钮及可关闭的交互自动发音；保留同一套 FSRS、云同步和注册确认处理。
- 三星外屏继续通过 Good Lock / MultiStar 打开专注背词 App，未接入三星原生外屏小组件。

**首次迁移固定签名仍需重新安装一次：**本包与 0.1.0-beta.1、0.1.1-beta.1 的临时签名不同。先在旧手机 App 点“立即同步”并确认成功，在电脑导出备份，再卸载旧 APK、安装新版并使用同一账户恢复已同步记录。卸载会清除手机本地数据，尚未上传的记录无法通过重新登录恢复。已发布的旧包未被替换。

Windows 从托盘退出现有版本后安装预览包，沿用本地学习记录。安卓发音需要手机的英语文字转语音数据和媒体音量；外屏、小组件和播放效果仍需 Z Flip7 实机验证。

手机说明：https://github.com/linianchen666/wordpop/blob/main/android/README.md
签名说明：https://github.com/linianchen666/wordpop/blob/main/android/SIGNING.md
云配置：https://github.com/linianchen666/wordpop/blob/main/cloud/README.md
