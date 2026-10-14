package com.wordpop.android;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import org.json.JSONObject;

public class WidgetSettingsActivity extends Activity {
  public void onCreate(Bundle state) {
    super.onCreate(state);
    setResult(RESULT_CANCELED);
    int id = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
    LinearLayout panel = new LinearLayout(this);
    panel.setOrientation(LinearLayout.VERTICAL);
    int padding = Math.round(24 * getResources().getDisplayMetrics().density);
    panel.setPadding(padding, padding, padding, padding);
    panel.setBackgroundColor(Color.rgb(16, 20, 28));
    TextView title = new TextView(this);
    title.setText("小组件设置");
    title.setTextSize(24);
    title.setTextColor(Color.WHITE);
    panel.addView(title);
    TextView label = new TextView(this);
    label.setTextColor(Color.LTGRAY);
    label.setPadding(0, padding, 0, padding);
    panel.addView(label);
    SeekBar slider = new SeekBar(this);
    slider.setMax(100);
    slider.setProgress(WidgetAppearance.opacity(this, id));
    label.setText("背景不透明度 " + slider.getProgress() + "% · 0% 为完全透明");
    slider.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onProgressChanged(SeekBar bar, int progress, boolean user) {
            label.setText("背景不透明度 " + progress + "% · 0% 为完全透明");
          }

          public void onStartTrackingTouch(SeekBar bar) {}

          public void onStopTrackingTouch(SeekBar bar) {}
        });
    panel.addView(slider);
    Button transparent = new Button(this);
    transparent.setText("完全透明");
    transparent.setOnClickListener(view -> slider.setProgress(0));
    panel.addView(transparent);
    Switch autoSpeak = new Switch(this);
    autoSpeak.setText("背词时自动发音");
    autoSpeak.setTextColor(Color.WHITE);
    autoSpeak.setPadding(0, padding, 0, padding);
    autoSpeak.setChecked(WidgetAppearance.autoSpeak(this, id));
    panel.addView(autoSpeak);
    TextView explanation = new TextView(this);
    explanation.setText("默认开启：显示释义或评分后切换下一词时播放，同一张卡片不重复自动播放。桌面定时刷新、缩放和云同步保持静音。");
    explanation.setTextColor(Color.LTGRAY);
    panel.addView(explanation);
    Button save = new Button(this);
    save.setText(id < 0 ? "应用到所有桌面小组件" : "保存");
    save.setOnClickListener(
        view -> {
          WidgetAppearance.save(this, id, slider.getProgress());
          WidgetAppearance.saveAutoSpeak(this, id, autoSpeak.isChecked());
          if (id < 0) {
            int[] ids =
                AppWidgetManager.getInstance(this)
                    .getAppWidgetIds(new android.content.ComponentName(this, WordWidget.class));
            for (int widgetId : ids) {
              WidgetAppearance.save(this, widgetId, slider.getProgress());
              WidgetAppearance.saveAutoSpeak(this, widgetId, autoSpeak.isChecked());
            }
          }
          StudyEngine.get(this).submit(new JSONObject(), (data, error) -> {});
          setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id));
          finish();
        });
    panel.addView(save);
    setContentView(panel);
    panel.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          view.setPadding(
              padding,
              padding + insets.getSystemWindowInsetTop(),
              padding,
              padding + insets.getSystemWindowInsetBottom());
          return insets;
        });
  }
}
