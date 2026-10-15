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
      if (ids == null) {
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        ids = id < 0 ? new int[0] : new int[] {id};
      }
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
      if ("undo".equals(action))
        command
            .put("target_id", intent.getStringExtra("target_id"))
            .put("id", UUID.randomUUID().toString());
      if ("review".equals(action))
        command
            .put("action", intent.getStringExtra("rating"))
            .put("id", UUID.randomUUID().toString());
      StudyEngine.get(context)
          .submit(
              command,
              (view, error) -> {
                if (error != null) {
                  // A stale undo PendingIntent must not replace a newer widget with an error card.
                  if ("undo".equals(action))
                    android.widget.Toast.makeText(context, error, android.widget.Toast.LENGTH_SHORT)
                        .show();
                  else error(context, error);
                } else autoSpeak(context, intent, command.optString("id"), view);
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

  static int[] widgetIds(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] home = manager.getAppWidgetIds(new ComponentName(context, WordWidget.class));
    int[] cover = manager.getAppWidgetIds(new ComponentName(context, CoverWordWidget.class));
    int[] all = java.util.Arrays.copyOf(home, home.length + cover.length);
    System.arraycopy(cover, 0, all, home.length, cover.length);
    return all;
  }

  static boolean isCover(Context context, int id) {
    android.appwidget.AppWidgetProviderInfo info =
        AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
    return info != null && new ComponentName(context, CoverWordWidget.class).equals(info.provider);
  }

  private static android.os.Bundle activityOptions(Context context, int id, Intent intent) {
    if (!isCover(context, id)) return null;
    android.hardware.display.DisplayManager manager =
        context.getSystemService(android.hardware.display.DisplayManager.class);
    android.view.Display display = manager == null ? null : manager.getDisplay(1);
    if (display == null) return null;
    android.app.ActivityManager activities =
        context.getSystemService(android.app.ActivityManager.class);
    if (android.os.Build.VERSION.SDK_INT >= 29
        && (activities == null
            || !activities.isActivityStartAllowedOnDisplay(
                context, display.getDisplayId(), intent))) return null;
    return android.app.ActivityOptions.makeBasic()
        .setLaunchDisplayId(display.getDisplayId())
        .toBundle();
  }

  static void error(Context context, String message) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    for (int id : widgetIds(context)) {
      RemoteViews views =
          new RemoteViews(
              context.getPackageName(),
              isCover(context, id) ? R.layout.word_widget_cover : R.layout.word_widget);
      appearance(context, id, views);
      views.setViewVisibility(R.id.speak, View.GONE);
      views.setTextViewText(R.id.translation, message);
      views.setViewVisibility(R.id.translation, View.VISIBLE);
      views.setViewVisibility(R.id.ratings, View.GONE);
      views.setViewVisibility(R.id.easy, View.GONE);
      views.setViewVisibility(R.id.undo, View.GONE);
      views.setOnClickPendingIntent(R.id.open, open(context, id));
      manager.updateAppWidget(id, views);
    }
  }

  private static PendingIntent open(Context context, int id) {
    Intent intent =
        new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    return PendingIntent.getActivity(
        context,
        id,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
        activityOptions(context, id, intent));
  }

  private static void appearance(Context context, int id, RemoteViews views) {
    views.setInt(
        R.id.background,
        "setImageAlpha",
        Math.round(WidgetAppearance.opacity(context, id) * 2.55f));
    Intent intent =
        new Intent(context, WidgetSettingsActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
    views.setOnClickPendingIntent(
        R.id.appearance,
        PendingIntent.getActivity(
            context,
            id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
            activityOptions(context, id, intent)));
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
    if ("undo".equals(type)) intent.putExtra("target_id", rating);
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
    return buildViews(context, id, data, width, height, isCover(context, id));
  }

  static RemoteViews buildViews(
      Context context, int id, JSONObject data, int width, int height, boolean cover)
      throws Exception {
    boolean compact = !cover && compactForSize(width, height);
    JSONObject word = data.optJSONObject("word");
    boolean revealed = data.optBoolean("revealed");
    String nonce = data.optString("nonce", "");
    RemoteViews views =
        new RemoteViews(
            context.getPackageName(),
            cover
                ? R.layout.word_widget_cover
                : compact ? R.layout.word_widget_compact : R.layout.word_widget);
    appearance(context, id, views);
    JSONObject undo = data.optJSONObject("undo");
    views.setViewVisibility(R.id.undo, undo == null ? View.GONE : View.VISIBLE);
    if (undo != null) {
      views.setContentDescription(R.id.undo, "撤销上次评分：" + undo.optString("word"));
      views.setOnClickPendingIntent(
          R.id.undo, command(context, id, nonce, "undo", undo.getString("id")));
    }
    views.setViewVisibility(R.id.speak, word == null ? View.GONE : View.VISIBLE);
    views.setViewVisibility(R.id.easy, word != null && revealed ? View.VISIBLE : View.GONE);
    views.setTextViewText(
        R.id.status, "待复习 " + data.optInt("dueCount") + " · 待新学 " + data.optInt("newRemaining"));
    views.setTextViewText(R.id.word, word == null ? "暂时完成" : word.optString("word"));
    views.setTextViewText(R.id.phonetic, word == null ? "" : word.optString("phonetic"));
    views.setViewVisibility(R.id.translation, word == null || revealed ? View.VISIBLE : View.GONE);
    views.setContentDescription(
        R.id.study_body, word == null ? "刷新单词" : revealed ? "单词与释义" : "显示释义");
    views.setTextViewText(
        R.id.translation,
        word == null ? "暂无到期单词，点击刷新" : revealed ? word.optString("translationPreview") : "");
    views.setViewVisibility(R.id.ratings, word != null && revealed ? View.VISIBLE : View.GONE);
    views.setOnClickPendingIntent(
        R.id.translation, command(context, id, nonce, word == null ? "view" : "reveal", ""));
    views.setOnClickPendingIntent(R.id.open, open(context, id));
    PendingIntent reveal = command(context, id, nonce, word == null ? "view" : "reveal", "");
    views.setOnClickPendingIntent(R.id.study_body, reveal);
    views.setOnClickPendingIntent(R.id.word, reveal);
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
    for (int id : widgetIds(context)) manager.updateAppWidget(id, buildViews(context, id, data));
  }
}
