const status = document.getElementById("status");
async function auth(signup) {
  const button = document.getElementById(signup ? "signup" : "login");
  button.disabled = true;
  status.textContent = "正在连接…";
  try {
    const result = await window.wordpopAPI.cloudLogin({
      signup,
      url: document.getElementById("url").value,
      key: document.getElementById("key").value,
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
    });
    status.textContent = result.message;
  } catch (_) {
    status.textContent = "连接失败，请检查网络及项目配置";
  } finally {
    document.getElementById("password").value = "";
    button.disabled = false;
  }
}
document.getElementById("login").onclick = () => auth(false);
document.getElementById("signup").onclick = () => auth(true);
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
  document.getElementById("url").value = result.url || "";
  document.getElementById("email").value = result.email || "";
});
