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
    if (AppWidgetManager.ACTION_APPWIDGET_DELETED.equals(intent.getAction())) {
      int[] ids = intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS);
      if (ids != null)
        for (int id : ids)
          WidgetAppearance.prefs(context)
              .edit()
              .remove("opacity_" + id)
              .remove("auto_speak_" + id)
              .remove("spoken_nonce_" + id)
              .apply();
      return;
    }
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
                else autoSpeak(context, intent, command.optString("id"), view);
                pending.finish();
              });
    } catch (Exception e) {
      error(context, e.getMessage());
      pending.finish();
    }
  }

  static boolean shouldAutoSpeak(
      String action, String previousNonce, String reviewId, JSONObject view) {
    String nonce = view.optString("nonce", "");
    if (nonce.isEmpty()
        || previousNonce == null
        || previousNonce.isEmpty()
        || view.optJSONObject("word") == null) return false;
    if ("reveal".equals(action)) return nonce.equals(previousNonce) && view.optBoolean("revealed");
    if (!"review".equals(action)
        || nonce.equals(previousNonce)
        || reviewId == null
        || reviewId.isEmpty()) return false;
    JSONObject state = view.optJSONObject("state");
    org.json.JSONArray events = state == null ? null : state.optJSONArray("events");
    if (events != null)
      for (int i = 0; i < events.length(); i++) {
        JSONObject event = events.optJSONObject(i);
        if (event != null && reviewId.equals(event.optString("id"))) return true;
      }
    return false;
  }

  private static void autoSpeak(Context context, Intent intent, String reviewId, JSONObject view) {
    int id = intent.getIntExtra("widget_id", -1);
    if (id < 0
        || !WidgetAppearance.autoSpeak(context, id)
        || !shouldAutoSpeak(
            intent.getStringExtra("command"), intent.getStringExtra("nonce"), reviewId, view))
      return;
    String nonce = view.optString("nonce");
    if (nonce.equals(WidgetAppearance.prefs(context).getString("spoken_nonce_" + id, ""))) return;
    try {
      context.startForegroundService(
          speechIntent(context, id, view.optJSONObject("word").optString("word")));
      WidgetAppearance.prefs(context).edit().putString("spoken_nonce_" + id, nonce).apply();
    } catch (IllegalStateException | SecurityException error) {
      android.widget.Toast.makeText(
              context, "自动发音暂不可用，请点击发音按钮播放", android.widget.Toast.LENGTH_SHORT)
          .show();
    }
  }

  static void error(Context context, String message) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    for (int id : manager.getAppWidgetIds(new ComponentName(context, WordWidget.class))) {
      RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.word_widget);
      appearance(context, id, views);
      views.setViewVisibility(R.id.speak, View.GONE);
      views.setTextViewText(R.id.translation, message);
      views.setViewVisibility(R.id.ratings, View.GONE);
      views.setViewVisibility(R.id.easy, View.GONE);
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

  private static void appearance(Context context, int id, RemoteViews views) {
    views.setInt(
        R.id.background,
        "setImageAlpha",
        Math.round(WidgetAppearance.opacity(context, id) * 2.55f));
    views.setOnClickPendingIntent(
        R.id.appearance,
        PendingIntent.getActivity(
            context,
            id,
            new Intent(context, WidgetSettingsActivity.class)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
  }

  static Intent speechIntent(Context context, int id, String word) {
    return new Intent(context, WidgetSpeechService.class)
        .putExtra("word", word)
        .setData(Uri.parse("wordpop://speech/" + id + "/" + Uri.encode(word)));
  }

  private static PendingIntent command(
      Context context, int id, String nonce, String type, String rating) {
    Intent intent =
        new Intent(context, WordWidget.class)
            .putExtra("widget_id", id)
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
    android.os.Bundle options = AppWidgetManager.getInstance(context).getAppWidgetOptions(id);
    boolean landscape =
        context.getResources().getConfiguration().orientation
            == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
    int width =
        options.getInt(
            landscape
                ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
                : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,
            250);
    int height =
        options.getInt(
            landscape
                ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
                : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,
            options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 240));
    return buildViews(context, id, data, width, height);
  }

  static boolean compactForSize(int width, int height) {
    return width < 240 || height < 240;
  }

  static RemoteViews buildViews(Context context, int id, JSONObject data, int width, int height)
      throws Exception {
    boolean compact = compactForSize(width, height);
    JSONObject word = data.optJSONObject("word");
    boolean revealed = data.optBoolean("revealed");
    String nonce = data.optString("nonce", "");
    RemoteViews views =
        new RemoteViews(
            context.getPackageName(),
            compact ? R.layout.word_widget_compact : R.layout.word_widget);
    appearance(context, id, views);
    views.setViewVisibility(R.id.speak, word == null ? View.GONE : View.VISIBLE);
    views.setViewVisibility(R.id.easy, word != null && revealed ? View.VISIBLE : View.GONE);
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
      views.setOnClickPendingIntent(
          R.id.speak,
          PendingIntent.getForegroundService(
              context,
              0,
              speechIntent(context, id, word.optString("word")),
              PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
      String[] actions = {"unknown", "fuzzy", "known", "easy"};
      String[] labels = {"不认识", "模糊", "认识", "★"};
      int[] ids = {R.id.unknown, R.id.fuzzy, R.id.known, R.id.easy};
      for (int n = 0; n < 4; n++) {
        views.setTextViewText(
            ids[n],
            compact
                ? labels[n]
                : labels[n] + "\n" + interval(data.getJSONObject("intervals").getLong(actions[n])));
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
