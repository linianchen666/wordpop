package com.wordpop.android;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppUpdateTest {
  private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();

  private MainActivity launch() {
    Context context = instrumentation.getTargetContext();
    return (MainActivity)
        instrumentation.startActivitySync(
            new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  }

  private JSONObject release(String version) throws Exception {
    String name = "WordPop.Android." + version + ".apk";
    return new JSONObject()
        .put("tag_name", "v999.0.0")
        .put("body", "新增手机功能\n<script>这是纯文字</script>")
        .put(
            "assets",
            new JSONArray()
                .put(
                    new JSONObject()
                        .put("name", name)
                        .put("size", 100)
                        .put("state", "uploaded")
                        .put(
                            "browser_download_url",
                            "https://github.com/linianchen666/wordpop/releases/download/v999.0.0/"
                                + name)));
  }

  private String message(AppUpdateChecker checker) {
    if (checker.dialog == null) return "";
    TextView text = checker.dialog.findViewById(android.R.id.message);
    return text == null ? "" : text.getText().toString();
  }

  private void until(BooleanSupplier condition) throws Exception {
    long deadline = android.os.SystemClock.uptimeMillis() + 10000;
    while (android.os.SystemClock.uptimeMillis() < deadline) {
      java.util.concurrent.atomic.AtomicBoolean done =
          new java.util.concurrent.atomic.AtomicBoolean();
      instrumentation.runOnMainSync(() -> done.set(condition.getAsBoolean()));
      if (done.get()) return;
      Thread.sleep(25);
    }
    fail("update dialog did not reach its expected state");
  }

  @Test
  public void loadingBlocksDuplicatesAndDownloadOpensTheOfficialAndroidApk() throws Exception {
    MainActivity activity = launch();
    AtomicInteger requests = new AtomicInteger();
    CountDownLatch started = new CountDownLatch(1), ready = new CountDownLatch(1);
    AtomicReference<Intent> opened = new AtomicReference<>();
    Instrumentation.ActivityMonitor monitor =
        new Instrumentation.ActivityMonitor() {
          public Instrumentation.ActivityResult onStartActivity(Intent intent) {
            if (Intent.ACTION_VIEW.equals(intent.getAction())) {
              opened.set(intent);
              return new Instrumentation.ActivityResult(Activity.RESULT_OK, null);
            }
            return null;
          }
        };
    instrumentation.addMonitor(monitor);
    String current = AppUpdateChecker.installedVersion(activity);
    String next = (Integer.parseInt(current.split("\\.")[0]) + 1) + ".0.0";
    AppUpdateChecker checker =
        new AppUpdateChecker(
            activity,
            () ->
                () -> {
                  requests.incrementAndGet();
                  started.countDown();
                  if (!ready.await(10, TimeUnit.SECONDS)) throw new Exception("fixture timeout");
                  return release(next);
                });
    try {
      instrumentation.runOnMainSync(
          () -> {
            checker.check();
            checker.check();
          });
      assertTrue(started.await(5, TimeUnit.SECONDS));
      assertEquals(1, requests.get());
      instrumentation.runOnMainSync(() -> assertTrue(message(checker).contains("正在检查")));
      ready.countDown();
      until(() -> message(checker).contains("最新安卓版本：" + next));
      instrumentation.runOnMainSync(
          () -> {
            assertTrue(message(checker).contains("当前版本：" + current));
            assertTrue(message(checker).contains("<script>这是纯文字</script>"));
            assertEquals("下载 APK", checker.dialog.getButton(-1).getText().toString());
            checker.dialog.getButton(-1).performClick();
          });
      until(() -> opened.get() != null);
      assertNotNull(opened.get());
      assertEquals(
          "https://github.com/linianchen666/wordpop/releases/download/v999.0.0/WordPop.Android."
              + next
              + ".apk",
          opened.get().getDataString());
      assertTrue(opened.get().hasCategory(Intent.CATEGORY_BROWSABLE));
    } finally {
      ready.countDown();
      instrumentation.removeMonitor(monitor);
      instrumentation.runOnMainSync(
          () -> {
            checker.close();
            activity.finish();
          });
    }
  }

  @Test
  public void failedChecksCanRetryAndInstalledNewerVersionsDoNotOfferDowngrades() throws Exception {
    MainActivity activity = launch();
    AtomicInteger requests = new AtomicInteger();
    AppUpdateChecker checker =
        new AppUpdateChecker(
            activity,
            () ->
                () -> {
                  if (requests.incrementAndGet() == 1)
                    throw new java.io.IOException("offline fixture");
                  return release("0.0.0");
                });
    try {
      instrumentation.runOnMainSync(checker::check);
      until(() -> message(checker).contains("检查网络"));
      instrumentation.runOnMainSync(
          () -> {
            assertEquals("重试", checker.dialog.getButton(-1).getText().toString());
            checker.dialog.getButton(-1).performClick();
          });
      until(() -> message(checker).contains("无需更新"));
      assertEquals(2, requests.get());
      instrumentation.runOnMainSync(
          () ->
              assertTrue(
                  checker.dialog.getButton(-1).getVisibility() != android.view.View.VISIBLE));
    } finally {
      instrumentation.runOnMainSync(
          () -> {
            checker.close();
            activity.finish();
          });
    }
  }

  @Test
  public void cancelAndDestroyDiscardLateResultsWithoutShowingNewDialogs() throws Exception {
    MainActivity activity = launch();
    CountDownLatch started = new CountDownLatch(1),
        release = new CountDownLatch(1),
        finished = new CountDownLatch(1);
    AppUpdateChecker checker =
        new AppUpdateChecker(
            activity,
            () ->
                () -> {
                  started.countDown();
                  // Simulate a transport that does not respond immediately to interruption.
                  while (release.getCount() != 0)
                    try {
                      release.await();
                    } catch (InterruptedException ignored) {
                    }
                  finished.countDown();
                  return release("99.0.0");
                });
    try {
      instrumentation.runOnMainSync(checker::check);
      assertTrue(started.await(5, TimeUnit.SECONDS));
      instrumentation.runOnMainSync(() -> checker.dialog.getButton(-2).performClick());
      // AlertDialog dispatches button listeners through its Handler.
      until(() -> checker.dialog == null);
      instrumentation.runOnMainSync(
          () -> {
            checker.close();
            activity.finish();
          });
      release.countDown();
      assertTrue(finished.await(5, TimeUnit.SECONDS));
      instrumentation.waitForIdleSync();
      instrumentation.runOnMainSync(() -> assertNull(checker.dialog));
    } finally {
      release.countDown();
      instrumentation.runOnMainSync(
          () -> {
            checker.close();
            if (!activity.isFinishing()) activity.finish();
          });
    }
  }
}
