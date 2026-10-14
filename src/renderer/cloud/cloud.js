const status = document.getElementById("status");
let authBusy = false;
document.getElementById("showPassword").onclick = () => {
  const input = document.getElementById("password");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  document.getElementById("showPassword").textContent = show
    ? "隐藏密码"
    : "显示密码";
};
async function auth(signup) {
  if (authBusy) return;
  authBusy = true;
  const button = document.getElementById(signup ? "signup" : "login");
  document.getElementById("login").disabled = document.getElementById(
    "signup",
  ).disabled = true;
  const label = button.textContent;
  button.textContent = signup ? "正在注册…" : "正在登录…";
  status.textContent = "正在验证账号和密码，请稍候…";
  const poll = setInterval(async () => {
    try {
      const result = await window.wordpopAPI.cloudStatus();
      if (authBusy) status.textContent = result.message;
    } catch (_) {}
  }, 500);
  try {
    const result = await window.wordpopAPI.cloudLogin({
      signup,
      url: document.getElementById("url").value,
      key: document.getElementById("key").value,
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
    });
    status.textContent = result.authenticated
      ? "登录成功 · " + result.message
      : result.message;
    if (result.authenticated) {
      document.getElementById("password").value = "";
      document.getElementById("password").type = "password";
      document.getElementById("showPassword").textContent = "显示密码";
    }
  } catch (_) {
    status.textContent = "连接失败，请检查网络及项目配置";
  } finally {
    clearInterval(poll);
    authBusy = false;
    button.textContent = label;
    document.getElementById("login").disabled = document.getElementById(
      "signup",
    ).disabled = false;
  }
}
document.getElementById("login").onclick = () => auth(false);
document.getElementById("signup").onclick = () => auth(true);
document.getElementById("resend").onclick = async () => {
  const button = document.getElementById("resend");
  button.disabled = true;
  status.textContent = "正在重新发送…";
  try {
    const result = await window.wordpopAPI.cloudResendConfirmation({
      url: document.getElementById("url").value,
      key: document.getElementById("key").value,
      email: document.getElementById("email").value,
    });
    status.textContent = result.message;
  } catch (_) {
    status.textContent = "连接失败，请检查网络及项目配置";
  } finally {
    button.disabled = false;
  }
};
document.getElementById("sync").onclick = async () => {
  status.textContent = "正在同步…";
  const result = await window.wordpopAPI.cloudSync();
  status.textContent = result.message;
};
document.getElementById("logout").onclick = async () => {
  await window.wordpopAPI.cloudLogout();
  status.textContent = "已退出云账户，本地学习记录保留";
};
window.wordpopAPI.cloudStatus().then((result) => {
  status.textContent = result.message;
  if (result.url) document.getElementById("url").value = result.url;
  if (result.key) document.getElementById("key").value = result.key;
  document.getElementById("email").value = result.email || "";
});
