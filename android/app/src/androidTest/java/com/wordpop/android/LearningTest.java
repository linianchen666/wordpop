package com.wordpop.android;

import static org.junit.Assert.*;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LearningTest {
  @Test
  public void sessionChangesPersistAndSurviveReload() throws Exception {
    StudyEngine engine =
        StudyEngine.get(InstrumentationRegistry.getInstrumentation().getTargetContext());
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
    String nonce = initial.getString("nonce");
    engine
        .executor
        .submit(() -> engine.run(new JSONObject().put("type", "reveal").put("nonce", nonce)))
        .get(10, TimeUnit.SECONDS);
    assertTrue(engine.store.load().getJSONObject("current").getBoolean("revealed"));
    JSONObject graded =
        engine
            .executor
            .submit(
                () ->
                    engine.run(
                        new JSONObject()
                            .put("type", "review")
                            .put("nonce", nonce)
                            .put("id", "persisted-review")
                            .put("action", "known")))
            .get(10, TimeUnit.SECONDS);
    String progress = graded.getJSONObject("state").getJSONObject("progress").toString();
    engine
        .executor
        .submit(
            () -> {
              engine.invalidate();
              return null;
            })
        .get();
    JSONObject reloaded =
        engine
            .executor
            .submit(() -> engine.run(new JSONObject().put("type", "view")))
            .get(10, TimeUnit.SECONDS);
    assertEquals(progress, reloaded.getJSONObject("state").getJSONObject("progress").toString());
    assertEquals(1, reloaded.getJSONObject("state").getJSONArray("events").length());
    assertEquals(graded.getString("nonce"), reloaded.getString("nonce"));
    assertEquals("persisted-review", reloaded.getJSONObject("undo").getString("id"));
    JSONObject undone =
        engine
            .executor
            .submit(
                () ->
                    engine.run(
                        new JSONObject()
                            .put("type", "undo")
                            .put("id", "persisted-undo")
                            .put("target_id", "persisted-review")))
            .get(10, TimeUnit.SECONDS);
    assertEquals(2, engine.store.load().getJSONArray("events").length());
    assertEquals(0, engine.store.load().getJSONObject("progress").length());
    assertEquals(
        initial.getJSONObject("word").getString("word"),
        undone.getJSONObject("word").getString("word"));
    assertTrue(undone.getBoolean("revealed"));
  }

  @Test
  public void appReceivesDisplayDataWithoutFullLearningHistory() throws Exception {
    JSONObject state =
        new JSONObject()
            .put("config", new JSONObject().put("dailyNewWords", 20))
            .put(
                "events",
                new org.json.JSONArray().put(new JSONObject().put("id", "private-history")))
            .put("progress", new JSONObject().put("test", new JSONObject().put("stage", 3)));
    JSONObject view =
        new JSONObject()
            .put("state", state)
            .put("nonce", "card")
            .put("revealed", true)
            .put("revision", 5)
            .put("word", new JSONObject().put("word", "test"))
            .put("intervals", new JSONObject().put("known", 600000));
    JSONObject ui = MainActivity.uiView(view);
    assertEquals(1, ui.getJSONObject("state").length());
    assertEquals(20, ui.getJSONObject("state").getJSONObject("config").getInt("dailyNewWords"));
    assertEquals("test", ui.getJSONObject("word").getString("word"));
    assertEquals(5, ui.getInt("revision"));
    assertEquals(600000, ui.getJSONObject("intervals").getLong("known"));
    assertFalse(ui.toString().contains("private-history"));
    assertTrue(state.has("events"));
  }

  @Test
  public void engineUsesSharedFsrsAndRejectsStaleActions() throws Exception {
    StudyEngine engine =
        StudyEngine.get(InstrumentationRegistry.getInstrumentation().getTargetContext());
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
    assertNotNull(initial.optJSONObject("word"));
    assertFalse(initial.getBoolean("revealed"));
    assertEquals(60000, initial.getJSONObject("intervals").getLong("unknown"));
    String nonce = initial.getString("nonce");
    JSONObject reveal =
        engine
            .executor
            .submit(() -> engine.run(new JSONObject().put("type", "reveal").put("nonce", nonce)))
            .get(10, TimeUnit.SECONDS);
    assertTrue(reveal.getBoolean("revealed"));
    JSONObject reviewed =
        engine
            .executor
            .submit(
                () ->
                    engine.run(
                        new JSONObject()
                            .put("type", "review")
                            .put("nonce", nonce)
                            .put("id", "first")
                            .put("action", "unknown")))
            .get(10, TimeUnit.SECONDS);
    assertEquals(1, reviewed.getJSONObject("state").getJSONArray("events").length());
    JSONObject stale =
        engine
            .executor
            .submit(
                () ->
                    engine.run(
                        new JSONObject()
                            .put("type", "review")
                            .put("nonce", nonce)
                            .put("id", "duplicate")
                            .put("action", "easy")))
            .get(10, TimeUnit.SECONDS);
    assertEquals(1, stale.getJSONObject("state").getJSONArray("events").length());
    assertEquals(reviewed.getString("nonce"), stale.getString("nonce"));
  }
}
