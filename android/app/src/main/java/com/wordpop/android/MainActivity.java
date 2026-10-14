package com.wordpop.android;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.lang.ref.WeakReference;
import java.util.Locale;
import org.json.JSONObject;

public class MainActivity extends Activity {
  private static WeakReference<MainActivity> active = new WeakReference<>(null);
  private WebView web;
  private TextToSpeech tts;
  private boolean voiceReady;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Runnable poll =
      new Runnable() {
        public void run() {
          command(new JSONObject());
          CloudClient.requestSync(MainActivity.this);
          handler.postDelayed(this, 5000);
        }
      };

  public void onCreate(Bundle state) {
    super.onCreate(state);
    active = new WeakReference<>(this);
    web = new WebView(this);
    web.setBackgroundColor(0xff080c13);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.addJavascriptInterface(new Bridge(), "WordPopAndroid");
    web.setWebViewClient(
        new WebViewClient() {
          public void onPageFinished(WebView view, String url) {
            command(new JSONObject());
            notifyStatus();
          }

          public boolean shouldOverrideUrlLoading(
              WebView view, android.webkit.WebResourceRequest request) {
            return true;
          }
        });
    web.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          view.setPadding(
              insets.getSystemWindowInsetLeft(),
              insets.getSystemWindowInsetTop(),
              insets.getSystemWindowInsetRight(),
              insets.getSystemWindowInsetBottom());
          return insets;
        });
    setContentView(web);
    web.loadUrl("file:///android_asset/index.html");
    tts =
        new TextToSpeech(
            this,
            result -> {
              voiceReady = result == TextToSpeech.SUCCESS;
              if (voiceReady)
                voiceReady = tts.setLanguage(Locale.US) >= TextToSpeech.LANG_AVAILABLE;
            });
    SyncWorker.schedule(this);
  }

  protected void onResume() {
    super.onResume();
    active = new WeakReference<>(this);
    handler.post(poll);
    if (web != null) command(new JSONObject());
  }

  protected void onPause() {
    handler.removeCallbacks(poll);
    super.onPause();
  }

  protected void onDestroy() {
    if (active.get() == this) active.clear();
    if (tts != null) tts.shutdown();
    if (web != null) {
      web.removeJavascriptInterface("WordPopAndroid");
      web.destroy();
    }
    super.onDestroy();
  }

  private void command(JSONObject command) {
    StudyEngine.get(this).submit(command, MainActivity::notifyView);
  }

  static void notifyView(JSONObject view, String error) {
    MainActivity activity = active.get();
    if (activity == null) return;
    activity.runOnUiThread(
        () -> {
          if (activity.web == null) return;
          activity.web.evaluateJavascript(
              error == null ? "render(" + view + ")" : "notice(" + JSONObject.quote(error) + ")",
              null);
        });
  }

  static void notifyStatus() {
    MainActivity activity = active.get();
    if (activity != null)
      activity.runOnUiThread(
          () ->
              activity.web.evaluateJavascript(
                  "notice(" + JSONObject.quote(CloudClient.status) + ")", null));
  }

  final class Bridge {
    @JavascriptInterface
    public void command(String json) {
      try {
        JSONObject command = new JSONObject(json);
        if (command.optString("type").equals("review"))
          command.put("id", java.util.UUID.randomUUID().toString());
        MainActivity.this.command(command);
      } catch (Exception e) {
        notifyView(null, "操作失败，请重试");
      }
    }

    @JavascriptInterface
    public void login(String json, boolean signup) {
      try {
        CloudClient.login(MainActivity.this, new JSONObject(json), signup);
      } catch (Exception e) {
        CloudClient.status = "请检查云服务配置";
        notifyStatus();
      }
    }

    @JavascriptInterface
    public void resendConfirmation(String json) {
      try {
        CloudClient.resendConfirmation(new JSONObject(json));
      } catch (Exception e) {
        CloudClient.status = "请检查云服务配置";
        notifyStatus();
      }
    }

    @JavascriptInterface
    public void speak(String word) {
      runOnUiThread(
          () -> {
            if (voiceReady) tts.speak(word, TextToSpeech.QUEUE_FLUSH, null, "wordpop");
            else notice("发音尚未就绪，请在手机文字转语音设置中检查英语语音");
          });
    }

    @JavascriptInterface
    public void widgetAppearance() {
      runOnUiThread(
          () ->
              startActivity(
                  new android.content.Intent(MainActivity.this, WidgetSettingsActivity.class)));
    }

    @JavascriptInterface
    public void addWidget() {
      runOnUiThread(
          () -> {
            AppWidgetManager manager = AppWidgetManager.getInstance(MainActivity.this);
            if (manager.isRequestPinAppWidgetSupported())
              manager.requestPinAppWidget(
                  new ComponentName(MainActivity.this, WordWidget.class), null, null);
            else notice("请长按桌面空白处，选择小组件 → WordPop");
          });
    }

    @JavascriptInterface
    public void sync() {
      CloudClient.requestSync(MainActivity.this);
    }

    private void notice(String value) {
      web.evaluateJavascript("notice(" + JSONObject.quote(value) + ")", null);
    }
  }
}
