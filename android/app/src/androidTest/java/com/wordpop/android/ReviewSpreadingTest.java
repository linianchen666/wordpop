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
public class ReviewSpreadingTest {
  private final StudyEngine engine =
      StudyEngine.get(InstrumentationRegistry.getInstrumentation().getTargetContext());

  private JSONObject run(JSONObject command) throws Exception {
    return engine.executor.submit(() -> engine.run(command)).get(25, TimeUnit.SECONDS);
  }

  @Test
  public void spreadingPersistsAndAppliesCloudDatesWithoutRatings() throws Exception {
    engine
        .executor
        .submit(
            () -> {
              engine.store.getWritableDatabase().execSQL("DELETE FROM state");
              engine.invalidate();
              return null;
            })
        .get();
    // Reuse an actual local FSRS result, shifted two days into the past.
    JSONObject fresh = run(new JSONObject().put("type", "view"));
    run(new JSONObject().put("type", "reveal").put("nonce", fresh.getString("nonce")));
    JSONObject rated =
        run(
            new JSONObject()
                .put("type", "review")
                .put("nonce", fresh.getString("nonce"))
                .put("id", java.util.UUID.randomUUID().toString())
                .put("action", "known"));
    JSONObject state = rated.getJSONObject("state");
    JSONObject sample =
        new JSONObject(
            state
                .getJSONObject("progress")
                .getJSONObject(fresh.getJSONObject("word").getString("word"))
                .toString());
    long shift = 2 * 86400000L;
    sample.put("last_review_at", sample.getLong("last_review_at") - shift);
    sample.put("next_review_at", sample.getLong("next_review_at") - shift);
    JSONObject card = new JSONObject(sample.getString("fsrs_card"));
    card.put("due", java.time.Instant.ofEpochMilli(sample.getLong("next_review_at")).toString());
    card.put(
        "last_review", java.time.Instant.ofEpochMilli(sample.getLong("last_review_at")).toString());
    sample.put("fsrs_card", card.toString());
    JSONArray vocabulary;
    try (java.io.InputStream input =
            InstrumentationRegistry.getInstrumentation()
                .getTargetContext()
                .getAssets()
                .open("vocabulary.json");
        java.util.Scanner scanner = new java.util.Scanner(input, "UTF-8")) {
      vocabulary = new JSONArray(scanner.useDelimiter("\\A").next());
    }
    JSONObject seeds = new JSONObject();
    for (int n = 0; n < vocabulary.length() && seeds.length() < 71; n++) {
      JSONObject w = vocabulary.getJSONObject(n);
      if (w.getJSONArray("wordlists").toString().contains("cet4"))
        seeds.put(w.getString("word"), new JSONObject(sample.toString()));
    }
    state
        .put("seeds", seeds)
        .put("progress", new JSONObject(seeds.toString()))
        .put("events", new JSONArray())
        .put("current", JSONObject.NULL)
        .put("undo", JSONObject.NULL);
    engine
        .executor
        .submit(
            () -> {
              engine.store.save(state);
              engine.invalidate();
              return null;
            })
        .get();
    JSONObject first = run(new JSONObject().put("type", "view"));
    assertEquals(71, first.getInt("dueCount"));
    JSONObject spread = run(new JSONObject().put("type", "spread").put("days", 7));
    assertEquals(70, spread.getJSONObject("spreadResult").getInt("count"));
    assertEquals(11, spread.getInt("dueCount"));
    assertEquals(first.getString("nonce"), spread.getString("nonce"));
    assertEquals(0, spread.getJSONObject("state").getJSONArray("events").length());
    JSONObject prepared =
        run(new JSONObject().put("type", "scheduleBind").put("owner", "project:user"));
    JSONArray pending = prepared.getJSONArray("pending");
    assertEquals(70, pending.length());
    java.util.UUID.fromString(pending.getJSONObject(0).getString("id"));
    assertFalse(prepared.has("state"));
    assertFalse(prepared.has("events"));
    JSONObject row = new JSONObject(pending.getJSONObject(0).toString());
    String word = row.getString("word");
    row.put("id", java.util.UUID.randomUUID().toString())
        .put("due_at", System.currentTimeMillis() + 3 * 86400000L);
    JSONObject applied =
        run(
            new JSONObject()
                .put("type", "scheduleApply")
                .put("owner", "project:user")
                .put("rows", new JSONArray().put(row))
                .put("sent", pending)
                .put("count", 71));
    assertTrue(applied.getBoolean("changed"));
    assertEquals(0, applied.getJSONArray("pending").length());
    assertEquals(
        row.getLong("due_at"),
        engine
            .store
            .load()
            .getJSONObject("progress")
            .getJSONObject(word)
            .getLong("next_review_at"));
    engine
        .executor
        .submit(
            () -> {
              engine.invalidate();
              return null;
            })
        .get();
    JSONObject restarted =
        run(new JSONObject().put("type", "scheduleBind").put("owner", "project:user"));
    assertFalse(restarted.has("scheduleSync"));
    assertFalse(restarted.getBoolean("changed"));
    assertTrue(restarted.toString().length() < 1000);
    assertEquals(0, engine.store.load().getJSONArray("events").length());
    JSONObject view = run(new JSONObject().put("type", "view"));
    assertEquals(first.getString("nonce"), view.getString("nonce"));
    assertEquals(
        first
            .getJSONObject("state")
            .getJSONObject("progress")
            .getJSONObject(word)
            .getString("fsrs_card"),
        view.getJSONObject("state")
            .getJSONObject("progress")
            .getJSONObject(word)
            .getString("fsrs_card"));
  }
}
