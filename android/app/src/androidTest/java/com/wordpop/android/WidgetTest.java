package com.wordpop.android;

import static org.junit.Assert.*;

import android.content.Context;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class WidgetTest {
  @Test
  public void autoSpeechOnlyFollowsValidWidgetInteraction() throws Exception {
    JSONObject view =
        new JSONObject()
            .put("nonce", "next-card")
            .put("word", new JSONObject().put("word", "test"))
            .put("revealed", true);
    view.put(
        "state",
        new JSONObject()
            .put("events", new org.json.JSONArray().put(new JSONObject().put("id", "review-id"))));
    assertTrue(WordWidget.shouldAutoSpeak("review", "old-card", "review-id", view));
    assertFalse(WordWidget.shouldAutoSpeak("review", "stale-card", "missing-event", view));
    assertFalse(WordWidget.shouldAutoSpeak("review", null, "review-id", view));
    assertTrue(WordWidget.shouldAutoSpeak("reveal", "next-card", "review-id", view));
    assertFalse(WordWidget.shouldAutoSpeak("review", "next-card", "review-id", view));
    assertFalse(WordWidget.shouldAutoSpeak("reveal", "old-card", "review-id", view));
    assertFalse(WordWidget.shouldAutoSpeak("view", "old-card", "review-id", view));
    assertFalse(WordWidget.shouldAutoSpeak(null, "old-card", "review-id", view));
    view.put("word", JSONObject.NULL);
    assertFalse(WordWidget.shouldAutoSpeak("review", "old-card", "review-id", view));
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    int id = 9878;
    try {
      WidgetAppearance.prefs(context).edit().remove("auto_speak_" + id).commit();
      assertEquals(
          WidgetAppearance.prefs(context).getBoolean("auto_speak", true),
          WidgetAppearance.autoSpeak(context, id));
      WidgetAppearance.saveAutoSpeak(context, id, false);
      assertFalse(WidgetAppearance.autoSpeak(context, id));
      WidgetAppearance.saveAutoSpeak(context, id, true);
      assertTrue(WidgetAppearance.autoSpeak(context, id));
    } finally {
      WidgetAppearance.prefs(context).edit().remove("auto_speak_" + id).commit();
    }
  }

  @Test
  public void resizeKeepsFeedbackAndMeaningInsideWidget() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    JSONObject data =
        new JSONObject()
            .put(
                "word",
                new JSONObject()
                    .put("word", "identification")
                    .put("translationPreview", "n. 识别；身份证明")
                    .put("phonetic", "/aɪˌdentɪfɪˈkeɪʃən/"))
            .put("revealed", true)
            .put("nonce", "resize-test")
            .put(
                "intervals",
                new JSONObject()
                    .put("unknown", 60000)
                    .put("fuzzy", 60000)
                    .put("known", 600000)
                    .put("easy", 86400000));
    for (int[] size : new int[][] {{180, 160}, {220, 200}, {320, 300}, {520, 400}}) {
      AtomicReference<View> root = new AtomicReference<>();
      float density = context.getResources().getDisplayMetrics().density;
      int width = Math.round(size[0] * density), height = Math.round(size[1] * density);
      InstrumentationRegistry.getInstrumentation()
          .runOnMainSync(
              () -> {
                try {
                  View view =
                      WordWidget.buildViews(context, 9877, data, size[0], size[1])
                          .apply(context, new FrameLayout(context));
                  view.measure(
                      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
                  view.layout(0, 0, width, height);
                  root.set(view);
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              });
      boolean compact = WordWidget.compactForSize(size[0], size[1]);
      assertEquals(
          compact ? View.GONE : View.VISIBLE,
          root.get().findViewById(R.id.phonetic).getVisibility());
      assertTrue(root.get().findViewById(R.id.translation).getHeight() >= Math.round(20 * density));
      assertEquals(View.VISIBLE, root.get().findViewById(R.id.speak).getVisibility());
      assertEquals(View.VISIBLE, root.get().findViewById(R.id.easy).getVisibility());
      assertEquals(
          compact ? "不认识" : "不认识\n1分",
          ((TextView) root.get().findViewById(R.id.unknown)).getText().toString());
      int[] location = new int[2], origin = new int[2];
      root.get().getLocationOnScreen(origin);
      root.get().findViewById(R.id.known).getLocationOnScreen(location);
      assertTrue(
          location[1] - origin[1] + root.get().findViewById(R.id.known).getHeight() <= height);
    }
  }

  @Test
  public void transparentBackgroundPersistsAndSpeechTargetsDisplayedWord() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    int id = 9876;
    try {
      WidgetAppearance.save(context, id, 0);
      assertEquals(0, WidgetAppearance.opacity(context, id));
      JSONObject data =
          new JSONObject()
              .put("word", new JSONObject().put("word", "test"))
              .put("revealed", false)
              .put("nonce", "appearance-test")
              .put(
                  "intervals",
                  new JSONObject()
                      .put("unknown", 60000)
                      .put("fuzzy", 60000)
                      .put("known", 600000)
                      .put("easy", 86400000));
      AtomicReference<View> root = new AtomicReference<>();
      InstrumentationRegistry.getInstrumentation()
          .runOnMainSync(
              () -> {
                try {
                  root.set(
                      WordWidget.buildViews(context, id, data)
                          .apply(context, new FrameLayout(context)));
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              });
      assertEquals(
          0, ((android.widget.ImageView) root.get().findViewById(R.id.background)).getImageAlpha());
      assertEquals(View.VISIBLE, root.get().findViewById(R.id.speak).getVisibility());
      android.content.Intent speech = WordWidget.speechIntent(context, id, "test");
      assertEquals("test", speech.getStringExtra("word"));
      assertEquals(WidgetSpeechService.class.getName(), speech.getComponent().getClassName());
      WidgetAppearance.save(context, id, 100);
      assertEquals(100, WidgetAppearance.opacity(context, id));
    } finally {
      WidgetAppearance.prefs(context).edit().remove("opacity_" + id).commit();
    }
  }

  @Test
  public void realWidgetClickPersistsExactlyOneFeedback() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    StudyEngine engine = StudyEngine.get(context);
    engine
        .executor
        .submit(
            () -> {
              engine.store.getWritableDatabase().execSQL("DELETE FROM state");
              return null;
            })
        .get();
    JSONObject initial =
        engine
            .executor
            .submit(() -> engine.run(new JSONObject().put("type", "view")))
            .get(25, TimeUnit.SECONDS);
    AtomicReference<View> root = new AtomicReference<>();
    InstrumentationRegistry.getInstrumentation()
        .runOnMainSync(
            () -> {
              try {
                root.set(
                    WordWidget.buildViews(context, 999, initial)
                        .apply(context, new FrameLayout(context)));
              } catch (Exception e) {
                throw new RuntimeException(e);
              }
            });
    assertEquals(View.GONE, root.get().findViewById(R.id.ratings).getVisibility());
    assertEquals(View.GONE, root.get().findViewById(R.id.easy).getVisibility());
    assertTrue(
        ((TextView) root.get().findViewById(R.id.translation)).getText().toString().contains("回忆"));
    JSONObject reveal =
        engine
            .executor
            .submit(
                () ->
                    engine.run(
                        new JSONObject()
                            .put("type", "reveal")
                            .put("nonce", initial.getString("nonce"))))
            .get(10, TimeUnit.SECONDS);
    InstrumentationRegistry.getInstrumentation()
        .runOnMainSync(
            () -> {
              try {
                root.set(
                    WordWidget.buildViews(context, 999, reveal)
                        .apply(context, new FrameLayout(context)));
                assertEquals(View.VISIBLE, root.get().findViewById(R.id.easy).getVisibility());
                assertNotSame(
                    root.get().findViewById(R.id.ratings),
                    root.get().findViewById(R.id.easy).getParent());
                assertEquals(
                    3,
                    ((android.view.ViewGroup) root.get().findViewById(R.id.ratings))
                        .getChildCount());
                root.get().findViewById(R.id.unknown).performClick();
              } catch (Exception e) {
                throw new RuntimeException(e);
              }
            });
    long end = System.currentTimeMillis() + 10000;
    JSONObject state = null;
    while (System.currentTimeMillis() < end) {
      state = engine.store.load();
      if (state.getJSONArray("events").length() == 1) break;
      Thread.sleep(50);
    }
    assertNotNull(state);
    assertEquals(1, state.getJSONArray("events").length());
    assertEquals("unknown", state.getJSONArray("events").getJSONObject(0).getString("action"));
  }
}
