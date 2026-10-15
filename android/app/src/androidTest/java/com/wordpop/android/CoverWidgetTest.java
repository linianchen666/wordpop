package com.wordpop.android;

import static org.junit.Assert.*;

import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.XmlResourceParser;
import android.view.View;
import android.widget.FrameLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CoverWidgetTest {
  private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  private static final String ANDROID = "http://schemas.android.com/apk/res/android";

  @Test
  public void declaresSeparateSamsungSubScreenProviderAndRetainsHomeProvider() throws Exception {
    ActivityInfo cover =
        context
            .getPackageManager()
            .getReceiverInfo(
                new ComponentName(context, CoverWordWidget.class), PackageManager.GET_META_DATA);
    ActivityInfo home =
        context
            .getPackageManager()
            .getReceiverInfo(
                new ComponentName(context, WordWidget.class), PackageManager.GET_META_DATA);
    assertEquals("WordPop 外屏背词", cover.loadLabel(context.getPackageManager()).toString());
    assertEquals(R.xml.cover_word_widget, cover.metaData.getInt("android.appwidget.provider"));
    assertEquals(R.xml.word_widget, home.metaData.getInt("android.appwidget.provider"));
    try (XmlResourceParser xml =
        cover.loadXmlMetaData(
            context.getPackageManager(), "com.samsung.android.appwidget.provider")) {
      while (xml.next() != org.xmlpull.v1.XmlPullParser.START_TAG) {}
      assertEquals("samsung-appwidget-provider", xml.getName());
      assertEquals("sub_screen", xml.getAttributeValue(null, "display"));
    }
    try (XmlResourceParser xml =
        cover.loadXmlMetaData(context.getPackageManager(), "android.appwidget.provider")) {
      while (xml.next() != org.xmlpull.v1.XmlPullParser.START_TAG) {}
      assertEquals(
          AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD,
          xml.getAttributeIntValue(ANDROID, "widgetCategory", 0));
    }
    assertTrue(
        context.getApplicationInfo().loadIcon(context.getPackageManager())
            instanceof android.graphics.drawable.AdaptiveIconDrawable);
  }

  private View measure(JSONObject data, int width, int height) throws Exception {
    AtomicReference<View> result = new AtomicReference<>();
    InstrumentationRegistry.getInstrumentation()
        .runOnMainSync(
            () -> {
              try {
                View root =
                    WordWidget.buildViews(context, 9879, data, width, height, true)
                        .apply(context, new FrameLayout(context));
                float density = context.getResources().getDisplayMetrics().density;
                int w = Math.round(width * density), h = Math.round(height * density);
                root.measure(
                    View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
                root.layout(0, 0, w, h);
                result.set(root);
              } catch (Exception e) {
                throw new RuntimeException(e);
              }
            });
    return result.get();
  }

  @Test
  public void coverLayoutKeepsRecallCenteredAndFeedbackTouchTargetsVisible() throws Exception {
    JSONObject data =
        new JSONObject()
            .put(
                "word",
                new JSONObject()
                    .put("word", "identification")
                    .put("phonetic", "/aɪˌdentɪfɪˈkeɪʃn/")
                    .put("translationPreview", "n. 识别；身份证明"))
            .put("nonce", "cover-layout")
            .put(
                "intervals",
                new JSONObject()
                    .put("unknown", 60000)
                    .put("fuzzy", 60000)
                    .put("known", 600000)
                    .put("easy", 86400000));
    float density = context.getResources().getDisplayMetrics().density;
    for (int[] size : new int[][] {{352, 339}, {320, 300}, {400, 400}, {480, 300}}) {
      data.put("revealed", false);
      View recall = measure(data, size[0], size[1]);
      assertEquals(View.GONE, recall.findViewById(R.id.translation).getVisibility());
      assertTrue(recall.findViewById(R.id.word).getTop() > 0);
      data.put("revealed", true);
      View revealed = measure(data, size[0], size[1]);
      assertTrue(
          revealed.findViewById(R.id.word).getTop() < recall.findViewById(R.id.word).getTop());
      assertTrue(revealed.findViewById(R.id.translation).getHeight() >= Math.round(20 * density));
      for (int id : new int[] {R.id.unknown, R.id.fuzzy, R.id.known}) {
        assertTrue(revealed.findViewById(id).getHeight() >= Math.round(48 * density));
        assertTrue(revealed.findViewById(id).hasOnClickListeners());
      }
    }
  }

  @Test
  public void coverPendingIntentsRevealGradeAndUndoUsingTheSameLearningRecord() throws Exception {
    StudyEngine engine = StudyEngine.get(context);
    WidgetAppearance.saveAutoSpeak(context, 9879, false);
    try {
      engine
          .executor
          .submit(
              () -> {
                engine.store.getWritableDatabase().execSQL("DELETE FROM state");
                engine.invalidate();
                return null;
              })
          .get();
      JSONObject initial =
          engine
              .executor
              .submit(() -> engine.run(new JSONObject().put("type", "view")))
              .get(25, TimeUnit.SECONDS);
      View recall = measure(initial, 352, 339);
      InstrumentationRegistry.getInstrumentation()
          .runOnMainSync(() -> recall.findViewById(R.id.word).performClick());
      await(() -> engine.store.load().getJSONObject("current").getBoolean("revealed"));
      JSONObject revealed =
          engine.executor.submit(() -> engine.run(new JSONObject().put("type", "view"))).get();
      View card = measure(revealed, 352, 339);
      InstrumentationRegistry.getInstrumentation()
          .runOnMainSync(() -> card.findViewById(R.id.unknown).performClick());
      await(() -> engine.store.load().getJSONArray("events").length() == 1);
      JSONObject graded =
          engine.executor.submit(() -> engine.run(new JSONObject().put("type", "view"))).get();
      View next = measure(graded, 352, 339);
      assertEquals(View.VISIBLE, next.findViewById(R.id.undo).getVisibility());
      InstrumentationRegistry.getInstrumentation()
          .runOnMainSync(() -> next.findViewById(R.id.undo).performClick());
      await(() -> engine.store.load().getJSONArray("events").length() == 2);
      assertEquals(0, engine.store.load().getJSONObject("progress").length());
    } finally {
      WidgetAppearance.prefs(context)
          .edit()
          .remove("auto_speak_9879")
          .remove("spoken_nonce_9879")
          .apply();
    }
  }

  private interface Condition {
    boolean get() throws Exception;
  }

  private void await(Condition condition) throws Exception {
    long deadline = android.os.SystemClock.uptimeMillis() + 10000;
    while (android.os.SystemClock.uptimeMillis() < deadline) {
      if (condition.get()) return;
      Thread.sleep(25);
    }
    fail("cover widget command not committed");
  }
}
