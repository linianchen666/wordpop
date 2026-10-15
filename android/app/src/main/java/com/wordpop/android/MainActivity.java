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
  private AppUpdateChecker updates;
  private TextToSpeech tts;
  private boolean voiceReady;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Runnable poll =
      new Runnable() {
        public void run() {
          command(new JSONObject());

          handler.postDelayed(this, 5000);
        }
      };

  private final Runnable cloudPoll =
      new Runnable() {
        public void run() {
          CloudClient.poll(MainActivity.this);
          handler.postDelayed(this, 15000);
        }
      };

  public void onCreate(Bundle state) {
    super.onCreate(state);
    active = new WeakReference<>(this);
    updates = new AppUpdateChecker(this);
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
    handler.post(cloudPoll);
    if (web != null) command(new JSONObject());
  }

  protected void onPause() {
    handler.removeCallbacks(poll);
    handler.removeCallbacks(cloudPoll);
    CloudClient.flush(this);
    super.onPause();
  }

  protected void onDestroy() {
    if (active.get() == this) active.clear();
    if (updates != null) updates.close();
    if (tts != null) tts.shutdown();
    if (web != null) {
      web.removeJavascriptInterface("WordPopAndroid");
      web.destroy();
    }
    super.onDestroy();
  }

  private void command(JSONObject command) {
    StudyEngine.get(this)
        .submit(
            command,
            (view, error) -> notifyView(view, error, command.optString("clientRequestId", "")));
  }

  static void notifyView(JSONObject view, String error) {
    notifyView(view, error, "");
  }

  static JSONObject uiView(JSONObject view) throws org.json.JSONException {
    JSONObject display = new JSONObject();
    for (String key :
        new String[] {
          "word",
          "revealed",
          "nonce",
          "dueCount",
          "newRemaining",
          "quota",
          "intervals",
          "revision",
          "undo"
        }) display.put(key, view.opt(key));
    display.put(
        "state",
        new JSONObject().put("config", view.getJSONObject("state").getJSONObject("config")));
    return display;
  }

  private static void notifyView(JSONObject view, String error, String requestId) {
    MainActivity activity = active.get();
    if (activity == null) return;
    String payload = "null";
    try {
      if (error == null) payload = uiView(view).toString();
    } catch (Exception e) {
      error = "读取学习界面失败，请刷新重试";
    }
    final String script =
        "receive("
            + payload
            + ","
            + JSONObject.quote(error)
            + ","
            + JSONObject.quote(requestId)
            + ")";
    activity.runOnUiThread(
        () -> {
          if (activity.web == null) return;
          activity.web.evaluateJavascript(script, null);
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

  static void notifyAuth(String id, String phase, String message) {
    MainActivity activity = active.get();
    if (activity != null)
      activity.runOnUiThread(
          () -> {
            if (activity.web != null)
              activity.web.evaluateJavascript(
                  "authResult({id:"
                      + JSONObject.quote(id)
                      + ",phase:"
                      + JSONObject.quote(phase)
                      + ",message:"
                      + JSONObject.quote(message)
                      + "})",
                  null);
          });
  }

  final class Bridge {
    @JavascriptInterface
    public String versionName() {
      return AppUpdateChecker.installedVersion(MainActivity.this);
    }

    @JavascriptInterface
    public void checkUpdates() {
      runOnUiThread(() -> updates.check());
    }

    @JavascriptInterface
    public void command(String json) {
      try {
        JSONObject command = new JSONObject(json);
        if (command.optString("type").equals("review") || command.optString("type").equals("undo"))
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
    public void speakOnReveal(String word) {
      if (WidgetAppearance.autoSpeak(MainActivity.this, -1)) speak(word);
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
