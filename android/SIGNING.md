# 固定 Android 安装签名

Android 覆盖升级需要相同包名、更高 versionCode，以及相同签名（或由旧私钥授权的签名轮换链）。仅复制 APK 中的证书、修改别名或填写相同公司名，不能恢复旧签名。

已发布的 0.1.0-beta.1、0.1.1-beta.1 使用临时调试私钥，构建产物中没有保存私钥，当前无法用它们签署后续 APK。从 0.1.2-beta.1 开始改用固定 WordPop 私钥（GitHub Secrets 已验证）；首次迁移到固定签名包时需同步/备份并重新安装，此后保留该私钥且递增 versionCode 就能覆盖升级。

## 一次性配置 GitHub Actions

仓库 Settings → Secrets and variables → Actions → New repository secret，设置：

| 名称 | 内容 |
| --- | --- |
| `WORDPOP_ANDROID_KEYSTORE_BASE64` | 私有目录中 `keystore-base64.txt` 的完整内容 |
| `WORDPOP_ANDROID_KEYSTORE_PASSWORD` | 私有目录中 `keystore-password.txt` 的完整内容 |

私钥、密码只保存在私有目录及 GitHub Secrets，不能提交到仓库、上传公开构建产物或粘贴到聊天中。请将 `wordpop.p12` 和密码另存到自己的安全备份中，避免丢失后无法更新已安装应用。

签名证书的 SHA-256 已固定在 `android/signing-certificate.sha256`；该文件是公开指纹，不含私钥。Android 构建缺少 Secret 时会停止，验证发现证书变化时也会停止，避免再次发布随机调试签名。发布流程要求构建产物包含相同的已验证证书指纹。

GitHub Secrets 添加完成后再运行 Android 构建。现有公开 APK 不会被替换；下一次发布需更新 Android 的 versionCode 和版本号。

## 本地验证

私钥生成工具：`python3 android/tools/create-signing-key.py --output-dir <仓库外的安全目录>`。它拒绝覆盖已有密钥，使用 JDK keytool 创建 PKCS12、随机强密码及 Secret 输入文件。不要重新生成已投入使用的密钥。

使用已备份私钥，设置 `WORDPOP_ANDROID_KEYSTORE_PATH`（wordpop.p12 的绝对路径）和 `WORDPOP_ANDROID_KEYSTORE_PASSWORD`，再运行 Gradle。别名固定为 `wordpop`，库密码与私钥密码相同。不要把密码写在命令参数或仓库配置中。

`verify-signing.py` 使用 Android SDK 的 apksigner 验证 APK 的密码学签名和固定证书指纹。未配置固定密钥的本地调试构建仍可生成开发用 APK，但不能通过固定签名发布检查。
