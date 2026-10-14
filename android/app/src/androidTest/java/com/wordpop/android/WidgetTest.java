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
