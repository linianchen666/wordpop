# WordPop 图标

`wordpop-source.png` 是通过图像生成工具创作的透明原稿：蓝色词卡、白色 W 和青色星光。Windows 与 Android 由同一原稿生成，不分别绘制。

安装 ImageMagick 后在仓库根目录运行：

```sh
node tools/build-icons.cjs
```

生成 Windows 多尺寸 ICO、窗口及托盘 PNG、Android 各密度启动图标、自适应图标前景和页面品牌图。自适应图标保留安全边距，背景色在 Android `values/colors.xml` 中。生成资源已提交，正常构建不需要 ImageMagick。

Windows 正式构建在 Windows CI 中写入 EXE 图标和版本信息，安装器及卸载器使用同一 ICO。
