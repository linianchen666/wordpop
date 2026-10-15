package com.wordpop.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.ProgressBar;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Supplier;
import org.json.JSONObject;

final class AppUpdateChecker implements AutoCloseable {
  private static final ExecutorService NETWORK = Executors.newSingleThreadExecutor();
  private final Activity activity;
  private final Supplier<Source> sources;
  private Source activeSource;
  private Future<?> task;
  private int generation;
  private boolean checking, closed;
  AlertDialog dialog;

  interface Source extends AutoCloseable {
    JSONObject load() throws Exception;

    default void close() {}
  }

  AppUpdateChecker(Activity activity) {
    this(activity, () -> new GithubSource(installedVersion(activity)));
  }

  AppUpdateChecker(Activity activity, Supplier<Source> sources) {
    this.activity = activity;
    this.sources = sources;
  }

  static String installedVersion(Context context) {
    try {
      String version =
          context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
      return version == null || version.isEmpty() ? "未知" : version;
    } catch (Exception error) {
      return "未知";
    }
  }

  // Call on the activity's main thread, including the JavaScript bridge.
  void check() {
    if (closed || checking || activity.isFinishing() || activity.isDestroyed()) return;
    dismiss();
    checking = true;
    final int ticket = ++generation;
    final String current = installedVersion(activity);
    final Source source = sources.get();
    activeSource = source;
    ProgressBar progress = new ProgressBar(activity);
    int padding = Math.round(16 * activity.getResources().getDisplayMetrics().density);
    progress.setPadding(padding, padding, padding, padding);
    dialog =
        new AlertDialog.Builder(activity)
            .setTitle("检查更新")
            .setMessage("当前版本：" + current + "\n正在检查安卓正式版…")
            .setView(progress)
            .setNegativeButton("取消", (d, which) -> cancel())
            .create();
    dialog.setOnCancelListener(d -> cancel());
    dialog.show();
    task =
        NETWORK.submit(
            () -> {
              AndroidRelease release = null;
              String failure = null;
              try {
                release = AndroidRelease.latest(source.load());
              } catch (Exception error) {
                failure =
                    error instanceof UpdateFailure ? error.getMessage() : "无法读取更新信息，请检查网络后重试。";
              } finally {
                source.close();
              }
              final AndroidRelease result = release;
              final String error = failure;
              activity.runOnUiThread(
                  () -> {
                    if (closed
                        || ticket != generation
                        || activity.isFinishing()
                        || activity.isDestroyed()) return;
                    checking = false;
                    task = null;
                    activeSource = null;
                    dismiss();
                    if (error != null) showError(current, error);
                    else showResult(current, result);
                  });
            });
  }

  private void showResult(String current, AndroidRelease release) {
    AlertDialog.Builder builder = new AlertDialog.Builder(activity);
    if (release == null) {
      builder.setTitle("检查更新").setMessage("当前版本：" + current + "\n最新正式发布暂未提供安卓安装包。");
    } else {
      final int comparison;
      try {
        comparison = AndroidRelease.compareVersions(release.version, current);
      } catch (IllegalArgumentException error) {
        showError(current, "无法读取当前安装版本，请前往正式发布页查看。");
        return;
      }
      boolean newer = comparison > 0;
      String notes = release.notes.trim();
      if (notes.isEmpty()) notes = "此版本暂无更新说明。";
      if (notes.length() > 6000) notes = notes.substring(0, 6000) + "\n…完整内容请查看发布页。";
      builder
          .setTitle(newer ? "发现安卓新版本" : "检查更新")
          .setMessage(
              "当前版本："
                  + current
                  + "\n最新安卓版本："
                  + release.version
                  + "\n\n"
                  + (newer
                      ? "下载后覆盖安装，可保留学习记录。"
                      : comparison < 0 ? "当前版本高于已发布版本，无需更新。" : "当前已是最新版本，无需更新。")
                  + "\n\n更新说明\n"
                  + notes);
      if (newer) builder.setPositiveButton("下载 APK", (d, which) -> open(release.downloadUrl));
    }
    builder
        .setNeutralButton("发布页", (d, which) -> open(AndroidRelease.RELEASES))
        .setNegativeButton("关闭", null);
    dialog = builder.show();
  }

  private void showError(String current, String error) {
    dialog =
        new AlertDialog.Builder(activity)
            .setTitle("检查更新失败")
            .setMessage("当前版本：" + current + "\n" + error)
            .setPositiveButton("重试", (d, which) -> check())
            .setNeutralButton("发布页", (d, which) -> open(AndroidRelease.RELEASES))
            .setNegativeButton("关闭", null)
            .show();
  }

  private void open(String url) {
    try {
      activity.startActivity(
          new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));
    } catch (ActivityNotFoundException error) {
      Toast.makeText(activity, "无法打开浏览器，请前往 GitHub 的 WordPop 正式发布页下载。", Toast.LENGTH_LONG).show();
    }
  }

  private void dismiss() {
    if (dialog != null) {
      dialog.dismiss();
      dialog = null;
    }
  }

  private void cancel() {
    generation++;
    checking = false;
    if (task != null) {
      task.cancel(true);
      task = null;
    }
    if (activeSource != null) {
      activeSource.close();
      activeSource = null;
    }
    dismiss();
  }

  public void close() {
    closed = true;
    cancel();
  }

  private static final class UpdateFailure extends Exception {
    UpdateFailure(String message) {
      super(message);
    }
  }

  private static final class GithubSource implements Source {
    private final String version;
    private volatile HttpURLConnection connection;
    private volatile boolean cancelled;

    GithubSource(String version) {
      this.version = version;
    }

    public JSONObject load() throws Exception {
      HttpURLConnection request =
          (HttpURLConnection)
              new URL("https://api.github.com/repos/linianchen666/wordpop/releases/latest")
                  .openConnection();
      connection = request;
      request.setConnectTimeout(10000);
      request.setReadTimeout(15000);
      request.setRequestProperty("Accept", "application/vnd.github+json");
      request.setRequestProperty("User-Agent", "WordPop-Android/" + version);
      if (cancelled) throw new InterruptedException();
      int code = request.getResponseCode();
      if (code == 403 || code == 429) throw new UpdateFailure("GitHub 请求受限，请稍后重试，或直接查看发布页。");
      if (code == 404) throw new UpdateFailure("暂时没有可用的正式发布，请稍后重试。");
      if (code != 200) throw new UpdateFailure("GitHub 暂时无法提供更新信息，请稍后重试。");
      try (InputStream input = request.getInputStream();
          ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
          if (cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedException();
          if (bytes.size() + count > 2 * 1024 * 1024) throw new UpdateFailure("更新信息过大，请直接查看发布页。");
          bytes.write(buffer, 0, count);
        }
        return new JSONObject(bytes.toString("UTF-8"));
      }
    }

    public void close() {
      cancelled = true;
      HttpURLConnection current = connection;
      if (current != null) current.disconnect();
    }
  }
}
