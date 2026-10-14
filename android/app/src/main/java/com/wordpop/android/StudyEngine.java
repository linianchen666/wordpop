package com.wordpop.android;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import androidx.javascriptengine.IsolateStartupParameters;
import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class StudyEngine {
  private static StudyEngine instance;

  static synchronized StudyEngine get(Context context) {
    if (instance == null) instance = new StudyEngine(context.getApplicationContext());
    return instance;
  }

  final Context context;
  final ExecutorService executor = Executors.newSingleThreadExecutor();
  final StudyStore store;
  private JavaScriptSandbox sandbox;
  private JavaScriptIsolate isolate;
  private long revision;
  private final Handler main = new Handler(Looper.getMainLooper());

  interface Callback {
    void done(JSONObject view, String error);
  }

  private StudyEngine(Context context) {
    this.context = context;
    store = new StudyStore(context);
  }

  private String asset(String name) throws Exception {
    try (java.io.InputStream input = context.getAssets().open(name)) {
      java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int count;
      while ((count = input.read(buffer)) != -1) out.write(buffer, 0, count);
      return out.toString("UTF-8");
    }
  }

  private void init() throws Exception {
    if (isolate != null) return;
    if (!JavaScriptSandbox.isSupported())
      throw new Exception("请更新 Android System WebView 后重试；当前 WebView 不支持学习引擎");
    sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context).get(6, TimeUnit.SECONDS);
    IsolateStartupParameters params = new IsolateStartupParameters();
    params.setMaxHeapSizeBytes(64L * 1024 * 1024);
    isolate = sandbox.createIsolate(params);
    isolate
        .evaluateJavaScriptAsync(
            asset("core.js") + "\nglobalThis.vocabulary=" + asset("vocabulary.json") + "; 'ready';")
        .get(3, TimeUnit.SECONDS);
  }

  JSONObject run(JSONObject command) throws Exception {
    init();
    JSONObject state = store.load();
    String code =
        "JSON.stringify(WordPopCore.dispatch("
            + (state == null ? "null" : state.toString())
            + ",vocabulary,"
            + command.toString()
            + ","
            + System.currentTimeMillis()
            + "))";
    JSONObject view =
        new JSONObject(isolate.evaluateJavaScriptAsync(code).get(6, TimeUnit.SECONDS));
    store.save(view.getJSONObject("state"));
    view.put("revision", ++revision);
    return view;
  }

  void submit(JSONObject command, Callback callback) {
    executor.execute(
        () -> {
          JSONObject view = null;
          String error = null;
          try {
            view = run(command);
          } catch (Exception e) {
            error = e.getMessage();
          }
          JSONObject result = view;
          String failure = error;
          main.post(() -> callback.done(result, failure));
          if (result != null && failure == null) {
            try {
              WordWidget.render(context, result);
            } catch (Exception e) {
              android.util.Log.w("WordPop", "Widget update failed", e);
            }
          }
          if (failure == null && !command.optString("type").equals("sync"))
            CloudClient.requestSync(context);
        });
  }
}
