package com.wordpop.android;

import android.content.Context;
import android.content.SharedPreferences;

final class WidgetAppearance {
  static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences("widget_appearance", Context.MODE_PRIVATE);
  }

  static int opacity(Context context, int id) {
    SharedPreferences p = prefs(context);
    return Math.max(0, Math.min(100, p.getInt("opacity_" + id, p.getInt("opacity", 94))));
  }

  static void save(Context context, int id, int opacity) {
    prefs(context).edit().putInt(id < 0 ? "opacity" : "opacity_" + id, opacity).apply();
  }

  static boolean autoSpeak(Context context, int id) {
    SharedPreferences p = prefs(context);
    return p.getBoolean("auto_speak_" + id, p.getBoolean("auto_speak", true));
  }

  static void saveAutoSpeak(Context context, int id, boolean enabled) {
    prefs(context).edit().putBoolean(id < 0 ? "auto_speak" : "auto_speak_" + id, enabled).apply();
  }
}
