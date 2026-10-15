package com.wordpop.android;

import static org.junit.Assert.*;

import java.net.URLDecoder;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CloudJournalTest {
  private static final long NOW = Instant.parse("2026-10-15T01:00:00Z").toEpochMilli();

  private static JSONObject event(int n) throws Exception {
    return new JSONObject()
        .put("id", String.format(java.util.Locale.ROOT, "00000000-0000-0000-0000-%012d", n))
        .put(
            "created_at", String.format(java.util.Locale.ROOT, "2026-10-15T00:00:00.%06d+00:00", n))
        .put("word", "test")
        .put("action", "known")
        .put("reviewed_at", NOW + n)
        .put("target_id", JSONObject.NULL);
  }

  private static final class Server implements CloudJournal.Transport {
    final List<JSONObject> events = new ArrayList<>();
    final List<String> routes = new ArrayList<>();
    int delivered, cap = 1000, counts;
    boolean missingCount, failPage;
    Runnable onCount;

    public long count() {
      counts++;
      if (onCount != null) onCount.run();
      return missingCount ? -1 : events.size();
    }

    public JSONArray page(String route) throws Exception {
      if (failPage) throw new Exception("offline page");
      routes.add(route);
      String filter =
          route.contains("&or=") ? URLDecoder.decode(route.split("&or=")[1], "UTF-8") : null;
      String cursorTime =
          filter == null
              ? null
              : filter.substring("(created_at.gt.".length(), filter.indexOf(",and("));
      String cursorId =
          filter == null
              ? null
              : filter.substring(filter.indexOf(",id.gt.") + 7, filter.length() - 2);
      List<JSONObject> sorted = new ArrayList<>(events);
      sorted.sort(
          Comparator.comparing((JSONObject e) -> Instant.parse(e.optString("created_at")))
              .thenComparing(e -> e.optString("id")));
      JSONArray page = new JSONArray();
      for (JSONObject e : sorted) {
        int time =
            filter == null
                ? 1
                : Instant.parse(e.getString("created_at")).compareTo(Instant.parse(cursorTime));
        if (filter == null
            || time > 0
            || (time == 0 && e.getString("id").compareTo(cursorId) > 0)) {
          page.put(e);
          if (page.length() >= cap) break;
        }
      }
      delivered += page.length();
      return page;
    }
  }

  @Test
  public void downloadsOnlyNewOfflineReviewsAndUndosAfterRestart() throws Exception {
    Server server = new Server();
    server.cap = 400;
    for (int n = 1; n <= 1005; n++) server.events.add(event(n));
    CloudJournal.Result first = CloudJournal.download(server, null, false, NOW);
    assertEquals(1005, first.events.length());
    assertEquals(3, server.routes.size());
    JSONObject restored = new JSONObject(first.snapshot.toString());
    server.routes.clear();
    server.delivered = 0;
    CloudJournal.Result idle = CloudJournal.download(server, restored, false, NOW + 1000);
    assertTrue(server.routes.isEmpty());
    assertSame(restored, idle.snapshot);
    server.events.add(event(1006).put("reviewed_at", NOW - 86400000));
    server.events.add(
        event(1007).put("action", "undo").put("target_id", event(1006).getString("id")));
    CloudJournal.Result delta = CloudJournal.download(server, restored, false, NOW + 2000);
    assertEquals(2, server.delivered);
    assertEquals(1007, delta.events.length());
    assertEquals(NOW, delta.snapshot.getLong("validatedAt"));
  }

  @Test
  public void retainsMicrosecondPrecisionAndEqualTimestampIds() throws Exception {
    Server server = new Server();
    server.events.add(event(1).put("created_at", "2026-10-15T00:00:00.001+00:00"));
    CloudJournal.Result first = CloudJournal.download(server, null, false, NOW);
    server.delivered = 0;
    server.events.add(event(2).put("created_at", "2026-10-15T00:00:00.001000+00:00"));
    server.events.add(event(3).put("created_at", "2026-10-15T00:00:00.001001+00:00"));
    CloudJournal.Result delta = CloudJournal.download(server, first.snapshot, false, NOW);
    assertEquals(2, server.delivered);
    assertEquals(3, delta.events.length());
  }

  @Test
  public void catchesLateCommitsBehindTheCursor() throws Exception {
    Server server = new Server();
    server.events.add(event(2));
    CloudJournal.Result first = CloudJournal.download(server, null, false, NOW);
    server.events.add(event(1));
    server.routes.clear();
    CloudJournal.Result recovered = CloudJournal.download(server, first.snapshot, false, NOW);
    assertEquals(2, recovered.events.length());
    assertTrue(server.routes.get(0).contains("&or="));
    assertFalse(server.routes.get(1).contains("&or="));
  }

  @Test
  public void failedPageDoesNotAdvanceCheckpoint() throws Exception {
    Server server = new Server();
    server.events.add(event(1));
    CloudJournal.Result first = CloudJournal.download(server, null, false, NOW);
    String saved = first.snapshot.toString();
    server.events.add(event(2));
    server.failPage = true;
    assertThrows(Exception.class, () -> CloudJournal.download(server, first.snapshot, false, NOW));
    assertEquals(saved, first.snapshot.toString());
    server.failPage = false;
    assertEquals(2, CloudJournal.download(server, first.snapshot, false, NOW).events.length());
  }

  @Test
  public void reconcilesMissingCountsManualChecksExpiredOrCorruptCacheAndDecreases()
      throws Exception {
    Server server = new Server();
    server.events.add(event(1));
    server.events.add(event(2));
    CloudJournal.Result first = CloudJournal.download(server, null, false, NOW);
    for (int mode = 0; mode < 5; mode++) {
      server.routes.clear();
      server.missingCount = mode == 0;
      JSONObject snapshot = new JSONObject(first.snapshot.toString());
      if (mode == 3) snapshot.put("count", 1);
      if (mode == 4) server.events.remove(1);
      CloudJournal.Result checked =
          CloudJournal.download(server, snapshot, mode == 1, mode == 2 ? NOW + 86400001 : NOW);
      assertFalse(server.routes.get(0).contains("&or="));
      if (mode == 0) assertNull(checked.snapshot);
    }
  }

  @Test
  public void catchesConcurrentInsertsAndRejectsContinuousIncompleteSnapshots() throws Exception {
    Server server = new Server();
    server.events.add(event(1));
    CloudJournal.Result first = CloudJournal.download(server, null, false, NOW);
    server.events.add(event(2));
    server.counts = 0;
    server.onCount =
        () -> {
          if (server.counts == 2)
            try {
              server.events.add(event(3));
            } catch (Exception e) {
              throw new RuntimeException(e);
            }
        };
    CloudJournal.Result recovered = CloudJournal.download(server, first.snapshot, false, NOW);
    assertEquals(3, recovered.events.length());
    server.events.add(event(4));
    server.onCount =
        () -> {
          try {
            server.events.add(event(100 + server.counts));
          } catch (Exception e) {
            throw new RuntimeException(e);
          }
        };
    Exception error =
        assertThrows(
            Exception.class, () -> CloudJournal.download(server, recovered.snapshot, false, NOW));
    assertTrue(error.getMessage().contains("数量不一致"));
  }
}
