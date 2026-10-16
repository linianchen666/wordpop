package com.wordpop.android;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CloudSettingsQueueTest {
  @Test
  public void settingsOnlyChangesParticipateInBackgroundUploads() throws Exception {
    JSONObject state =
        new JSONObject()
            .put("events", new JSONArray())
            .put(
                "settingsSync",
                new JSONObject()
                    .put(
                        "pending",
                        new JSONObject()
                            .put("learningPlan", new JSONObject().put("id", "change"))));
    assertEquals(0, CloudClient.pendingCount(state));
    assertEquals(1, CloudClient.pendingSettingsCount(state));
    assertEquals(1, CloudClient.pendingUploads(state));
    state.put(
        "scheduleSync",
        new JSONObject()
            .put("pending", new JSONObject().put("test", new JSONObject().put("id", "schedule"))));
    assertEquals(1, CloudClient.pendingSchedulesCount(state));
    assertEquals(2, CloudClient.pendingUploads(state));
    state.getJSONArray("events").put(new JSONObject().put("id", "review"));
    assertEquals(3, CloudClient.pendingUploads(state));
    state.put("cloudSyncedIds", new JSONObject().put("review", true));
    assertEquals(2, CloudClient.pendingUploads(state));
  }

  @Test
  public void legacyStateAndSettingsSchemaFailuresRemainDistinct() throws Exception {
    assertEquals(0, CloudClient.pendingSettingsCount(null));
    assertEquals(0, CloudClient.pendingUploads(new JSONObject().put("events", new JSONArray())));
    String error =
        CloudClient.requestError(
            "/rest/v1/wordpop_current_settings?select=value", "GET", false, "PGRST205", 404);
    assertTrue(error.startsWith("同步学习设置失败"));
    assertTrue(error.contains("cloud/supabase.sql"));
  }
}
