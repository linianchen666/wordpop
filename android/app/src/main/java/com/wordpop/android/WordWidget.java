package com.wordpop.android;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.util.UUID;
import org.json.JSONObject;

public class WordWidget extends AppWidgetProvider {
  public void onReceive(Context context, Intent intent) {
    PendingResult pending = goAsync();
    try {
      SyncWorker.schedule(context);
      JSONObject command = new JSONObject();
      String action = intent.getStringExtra("command");
      command
          .put("type", action == null ? "view" : action)
          .put("nonce", intent.getStringExtra("nonce"));
      if ("review".equals(action))
        command
            .put("action", intent.getStringExtra("rating"))
            .put("id", UUID.randomUUID().toString());
      StudyEngine.get(context)
          .submit(
              command,
              (view, error) -> {
                if (error != null) error(context, error);
                pending.finish();
              });
    } catch (Exception e) {
      error(context, e.getMessage());
      pending.finish();
    }
  }

  static void error(Context context, String message) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    for (int id : manager.getAppWidgetIds(new ComponentName(context, WordWidget.class))) {
      RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.word_widget);
      views.setTextViewText(R.id.translation, message);
      views.setViewVisibility(R.id.ratings, View.GONE);
      views.setOnClickPendingIntent(R.id.open, open(context, id));
      manager.updateAppWidget(id, views);
    }
  }

  private static PendingIntent open(Context context, int id) {
    return PendingIntent.getActivity(
        context,
        id,
        new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private static PendingIntent command(
      Context context, int id, String nonce, String type, String rating) {
    Intent intent =
        new Intent(context, WordWidget.class)
            .putExtra("command", type)
            .putExtra("nonce", nonce)
            .putExtra("rating", rating);
    intent.setData(
        Uri.parse("wordpop://widget/" + id + "/" + Uri.encode(nonce) + "/" + type + "/" + rating));
    return PendingIntent.getBroadcast(
        context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  static String interval(long ms) {
    if (ms < 3600000) return Math.max(1, (ms + 59999) / 60000) + "分";
    if (ms < 86400000) return Math.round(ms / 3600000.0) + "小时";
    return Math.round(ms / 86400000.0) + "天";
  }

  static RemoteViews buildViews(Context context, int id, JSONObject data) throws Exception {
    JSONObject word = data.optJSONObject("word");
    boolean revealed = data.optBoolean("revealed");
    String nonce = data.optString("nonce", "");
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.word_widget);
    views.setTextViewText(
        R.id.status, "待复习 " + data.optInt("dueCount") + " · 待新学 " + data.optInt("newRemaining"));
    views.setTextViewText(R.id.word, word == null ? "暂时完成" : word.optString("word"));
    views.setTextViewText(R.id.phonetic, word == null ? "" : word.optString("phonetic"));
    views.setTextViewText(
        R.id.translation,
        word == null
            ? "暂无到期单词，点击刷新"
            : revealed ? word.optString("translationPreview") : "先回忆，再点这里显示释义");
    views.setViewVisibility(R.id.ratings, word != null && revealed ? View.VISIBLE : View.GONE);
    views.setOnClickPendingIntent(
        R.id.translation, command(context, id, nonce, word == null ? "view" : "reveal", ""));
    views.setOnClickPendingIntent(R.id.open, open(context, id));
    views.setOnClickPendingIntent(R.id.word, open(context, id));
    if (word != null) {
      String[] actions = {"unknown", "fuzzy", "known", "easy"};
      String[] labels = {"不认识", "模糊", "认识", "轻松"};
      int[] ids = {R.id.unknown, R.id.fuzzy, R.id.known, R.id.easy};
      for (int n = 0; n < 4; n++) {
        views.setTextViewText(
            ids[n],
            labels[n] + "\n" + interval(data.getJSONObject("intervals").getLong(actions[n])));
        views.setOnClickPendingIntent(ids[n], command(context, id, nonce, "review", actions[n]));
      }
    }
    return views;
  }

  static void render(Context context, JSONObject data) throws Exception {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    for (int id : manager.getAppWidgetIds(new ComponentName(context, WordWidget.class)))
      manager.updateAppWidget(id, buildViews(context, id, data));
  }
}
