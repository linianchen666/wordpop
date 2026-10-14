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
  public void engineUsesSharedFsrsAndRejectsStaleActions() throws Exception {
    StudyEngine engine =
        StudyEngine.get(InstrumentationRegistry.getInstrumentation().getTargetContext());
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
