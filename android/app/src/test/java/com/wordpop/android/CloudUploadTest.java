package com.wordpop.android;

import static org.junit.Assert.*;

import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CloudUploadTest {
  private static final String USER = "00000000-0000-0000-0000-000000000099";

  private JSONObject review(int id) throws Exception {
    return new JSONObject()
        .put("id", String.format(java.util.Locale.ROOT, "00000000-0000-0000-0000-%012d", id))
        .put("word", "test")
        .put("action", "known")
        .put("reviewed_at", 1760000000000L + id);
  }

  private Set<String> keys(JSONObject row) {
    Set<String> keys = new HashSet<>();
    row.keys().forEachRemaining(keys::add);
    return keys;
  }

  @Test
  public void mixedReviewsAndUndosHaveIdenticalInsertColumns() throws Exception {
    JSONObject first = review(1);
    JSONObject undo = review(2).put("action", "undo").put("target_id", first.getString("id"));
    JSONObject state = new JSONObject().put("events", new JSONArray().put(first).put(undo));
    String original = state.toString();
    JSONArray upload = CloudClient.pendingUpload(state, USER);
    Set<String> columns = Set.of("id", "user_id", "word", "action", "reviewed_at", "target_id");
    assertEquals(2, upload.length());
    for (int i = 0; i < upload.length(); i++) assertEquals(columns, keys(upload.getJSONObject(i)));
    assertTrue(upload.getJSONObject(0).isNull("target_id"));
    assertEquals(first.getString("id"), upload.getJSONObject(1).getString("target_id"));
    assertEquals(original, state.toString());
  }

  @Test
  public void stripsDownloadedMetadataAndPreservesUnsyncedEventsUntilAcknowledgement()
      throws Exception {
    JSONObject downloaded =
        review(1)
            .put("target_id", JSONObject.NULL)
            .put("created_at", "2026-10-15T00:00:00.000001+00:00")
            .put("user_id", USER);
    JSONObject local = review(2);
    JSONObject sent = new JSONObject().put(downloaded.getString("id"), true);
    JSONObject state =
        new JSONObject()
            .put("events", new JSONArray().put(downloaded).put(local))
            .put("cloudSyncedIds", sent);
    JSONArray upload = CloudClient.pendingUpload(state, USER);
    assertEquals(1, upload.length());
    assertEquals(local.getString("id"), upload.getJSONObject(0).getString("id"));
    assertFalse(sent.has(local.getString("id")));
    sent.put(downloaded.getString("id"), false);
    upload = CloudClient.pendingUpload(state, USER);
    assertEquals(2, upload.length());
    for (int i = 0; i < upload.length(); i++) {
      assertFalse(upload.getJSONObject(i).has("created_at"));
      assertEquals(USER, upload.getJSONObject(i).getString("user_id"));
      assertTrue(upload.getJSONObject(i).has("target_id"));
    }
    assertTrue(downloaded.has("created_at"));
  }

  @Test
  public void handlesEmptyAndFullyAcknowledgedState() throws Exception {
    assertEquals(0, CloudClient.pendingUpload(null, USER).length());
    JSONObject event = review(1);
    JSONObject state =
        new JSONObject()
            .put("events", new JSONArray().put(event))
            .put("cloudSyncedIds", new JSONObject().put(event.getString("id"), true));
    assertEquals(0, CloudClient.pendingUpload(state, USER).length());
  }
}
