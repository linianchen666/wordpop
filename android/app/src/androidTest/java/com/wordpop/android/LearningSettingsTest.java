package com.wordpop.android;

import static org.junit.Assert.*;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LearningSettingsTest {
  private final StudyEngine engine =
      StudyEngine.get(InstrumentationRegistry.getInstrumentation().getTargetContext());
  private static final String OWNER = "project:user-a";

  private JSONObject run(JSONObject command) throws Exception {
    return engine.executor.submit(() -> engine.run(command)).get(25, TimeUnit.SECONDS);
  }

  private JSONObject settings(String type, JSONArray rows, JSONArray sent) throws Exception {
    return run(
        new JSONObject().put("type", type).put("owner", OWNER).put("rows", rows).put("sent", sent));
  }

  private JSONArray remote(int daily) throws Exception {
    return new JSONArray()
        .put(
            new JSONObject()
                .put("setting_key", "selectedWordlists")
                .put("value", new JSONArray().put("cet6")))
        .put(
            new JSONObject()
                .put("setting_key", "learningPlan")
                .put(
                    "value",
                    new JSONObject()
                        .put("dailyNewWordsMode", "target")
                        .put("dailyNewWords", daily)
                        .put("targetDate", "2035-06-01")))
        .put(new JSONObject().put("setting_key", "autoBalanceLoad").put("value", false));
  }

  @Test
  public void remoteSettingsAndOfflineEditsPersistWithoutExportingHistory() throws Exception {
    engine
        .executor
        .submit(
            () -> {
              engine.store.getWritableDatabase().execSQL("DELETE FROM state");
              engine.invalidate();
              return null;
            })
        .get();
    // Also exercises settings binding before the first ordinary view.
    JSONObject first = settings("settingsBind", new JSONArray(), new JSONArray());
    assertEquals(0, first.getJSONObject("settingsSync").getJSONObject("pending").length());
    assertFalse(first.has("state"));
    assertFalse(first.has("events"));
    assertTrue(first.toString().length() < 2000);
    JSONObject applied = settings("settingsApply", remote(98), new JSONArray());
    assertTrue(applied.getBoolean("changed"));
    JSONObject view = run(new JSONObject().put("type", "view"));
    assertEquals(
        "cet6",
        view.getJSONObject("state")
            .getJSONObject("config")
            .getJSONArray("selectedWordlists")
            .getString(0));
    assertEquals(0, view.getJSONObject("state").getJSONArray("events").length());
    assertEquals(
        "target",
        view.getJSONObject("state").getJSONObject("config").getString("dailyNewWordsMode"));
    assertFalse(settings("settingsApply", remote(98), new JSONArray()).getBoolean("changed"));
    run(
        new JSONObject()
            .put("type", "config")
            .put("config", new JSONObject().put("dailyNewWords", 42)));
    JSONObject prepared = settings("settingsBind", new JSONArray(), new JSONArray());
    JSONObject oldChange =
        prepared
            .getJSONObject("settingsSync")
            .getJSONObject("pending")
            .getJSONObject("learningPlan");
    java.util.UUID.fromString(oldChange.getString("id"));
    JSONArray oldSent =
        new JSONArray()
            .put(
                new JSONObject()
                    .put("setting_key", "learningPlan")
                    .put("id", oldChange.getString("id")));
    run(
        new JSONObject()
            .put("type", "config")
            .put("config", new JSONObject().put("dailyNewWords", 53)));
    JSONObject stale = settings("settingsApply", remote(42), oldSent);
    assertEquals(53, stale.getJSONObject("config").getInt("dailyNewWords"));
    JSONObject pending = stale.getJSONObject("settingsSync").getJSONObject("pending");
    assertEquals(1, pending.length());
    assertNotEquals(
        oldChange.getString("id"), pending.getJSONObject("learningPlan").getString("id"));
    engine
        .executor
        .submit(
            () -> {
              engine.invalidate();
              return null;
            })
        .get();
    JSONObject restored = settings("settingsBind", new JSONArray(), new JSONArray());
    assertEquals(53, restored.getJSONObject("config").getInt("dailyNewWords"));
    JSONObject change =
        restored
            .getJSONObject("settingsSync")
            .getJSONObject("pending")
            .getJSONObject("learningPlan");
    JSONArray sent =
        new JSONArray()
            .put(
                new JSONObject()
                    .put("setting_key", "learningPlan")
                    .put("id", change.getString("id")));
    JSONObject acknowledged = settings("settingsApply", remote(53), sent);
    assertEquals(0, acknowledged.getJSONObject("settingsSync").getJSONObject("pending").length());
    assertEquals(0, engine.store.load().getJSONArray("events").length());
  }
}
