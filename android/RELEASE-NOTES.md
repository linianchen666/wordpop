Android 开发测试版，含普通桌面背词小组件和 Windows 云同步预览安装包。Windows 正式 Latest 仍为 v1.8.6；该版本不作为软件内正式更新推送。

- 手机支持四级、六级、考研词库，离线背词、释义展开和四种反馈，使用与电脑相同的 FSRS 及 1 分钟 / 10 分钟确认规则。
- 小组件可调整大小，直接展开释义和评分；重复点击旧按钮不会误评下一词。
- 云同步采用 Supabase。先在自己的项目执行建表脚本，再在电脑预览版初始化，手机登录同一账户。项目尚未配置前仍可离线学习；没有内置他人的项目凭据。
- 使用期间约每 5 秒同步，操作小组件后也同步。Android 后台任务可能延迟，不能保证休眠时实时刷新。
- 三星 Z Flip7 外屏按用户确认的方式，通过 Good Lock / MultiStar 外屏启动器打开背词界面；原生外屏小组件未验证，不作支持承诺。

配置说明：https://github.com/linianchen666/wordpop/blob/main/cloud/README.md
手机使用：https://github.com/linianchen666/wordpop/blob/main/android/README.md

APK 是调试签名测试包，首次安装后打开应用并添加桌面小组件。Windows 预览版为 1.9.0-beta.1，先从托盘退出现有版本再安装，沿用现有学习数据。实际 Supabase 项目连接和 Z Flip7 外屏仍需设备/账户配置后的验证。
