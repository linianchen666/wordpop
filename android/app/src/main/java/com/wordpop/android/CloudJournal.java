package com.wordpop.android;

import java.net.URLEncoder;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

// A server-time cursor plus exact counts makes late transaction commits safe:
// if a row committed behind our cursor, reconcile in full before saving it.
final class CloudJournal {
  private static final long MAX_AGE = 24 * 60 * 60 * 1000L;
  private static final String SELECT =
      "/rest/v1/wordpop_events?select=id,word,action,reviewed_at,target_id,created_at"
          + "&order=created_at.asc,id.asc&limit=1000";

  interface Transport {
    long count() throws Exception;

    JSONArray page(String route) throws Exception;
  }

  static final class Result {
    final JSONArray events;
    final JSONObject snapshot;

    Result(JSONArray events, JSONObject snapshot) {
      this.events = events;
      this.snapshot = snapshot;
    }
  }

  private static Instant timestamp(JSONObject event) throws Exception {
    String value = event.getString("created_at");
    if (!value.matches(
        "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?(Z|\\+00:00)"))
      throw new Exception("云端记录时间无效，请重试同步");
    return Instant.parse(value);
  }

  private static void validate(JSONObject event) throws Exception {
    if (!event.getString("id").matches("[a-zA-Z0-9-]+")) throw new Exception("云端记录 ID 无效");
    timestamp(event);
  }

  private static int compare(JSONObject a, JSONObject b) throws Exception {
    int result = timestamp(a).compareTo(timestamp(b));
    return result != 0 ? result : a.getString("id").compareTo(b.getString("id"));
  }

  private static boolean usable(JSONObject snapshot, long now) {
    try {
      if (snapshot == null || snapshot.getInt("version") != 1) return false;
      long validatedAt = snapshot.getLong("validatedAt");
      JSONArray events = snapshot.getJSONArray("events");
      if (now < validatedAt
          || now - validatedAt >= MAX_AGE
          || snapshot.getLong("count") != events.length()) return false;
      java.util.HashSet<String> ids = new java.util.HashSet<>();
      for (int n = 0; n < events.length(); n++) {
        JSONObject event = events.getJSONObject(n);
        validate(event);
        ids.add(event.getString("id"));
      }
      return ids.size() == events.length();
    } catch (Exception error) {
      return false;
    }
  }

  static Result download(Transport transport, JSONObject snapshot, boolean forceFull, long now)
      throws Exception {
    long before = transport.count();
    boolean full =
        forceFull || !usable(snapshot, now) || before < 0 || before < snapshot.getLong("count");
    if (!full && before == snapshot.getLong("count"))
      return new Result(snapshot.getJSONArray("events"), snapshot);
    // Never expose an incomplete page or move a durable cursor on failure.
    for (int attempt = 0; attempt < 2; attempt++) {
      Map<String, JSONObject> records = new LinkedHashMap<>();
      JSONObject cursor = null;
      if (!full) {
        JSONArray previous = snapshot.getJSONArray("events");
        for (int n = 0; n < previous.length(); n++) {
          JSONObject event = previous.getJSONObject(n);
          records.put(event.getString("id"), event);
          if (cursor == null || compare(event, cursor) > 0) cursor = event;
        }
      }
      for (; ; ) {
        String filter = "";
        if (cursor != null) {
          String time = cursor.getString("created_at");
          filter =
              "&or="
                  + URLEncoder.encode(
                      "(created_at.gt."
                          + time
                          + ",and(created_at.eq."
                          + time
                          + ",id.gt."
                          + cursor.getString("id")
                          + "))",
                      "UTF-8");
        }
        JSONArray page = transport.page(SELECT + filter);
        for (int n = 0; n < page.length(); n++) {
          JSONObject event = page.getJSONObject(n);
          validate(event);
          if (cursor != null && compare(event, cursor) <= 0)
            throw new Exception("云端记录分页顺序无效，请重试同步");
          records.put(event.getString("id"), event);
          cursor = event;
        }
        // Continue across smaller server page caps too.
        if (page.length() == 0 || (before >= 0 && records.size() >= before)) break;
      }
      JSONArray events = new JSONArray(records.values());
      long after = transport.count();
      if (after == events.length()) {
        JSONObject next =
            new JSONObject()
                .put("version", 1)
                .put("count", after)
                .put("validatedAt", full ? now : snapshot.getLong("validatedAt"))
                .put("events", events);
        return new Result(events, next);
      }
      if (after < 0 && full) return new Result(events, null);
      full = true;
    }
    throw new Exception("云端记录正在变化或数量不一致，已保留本地记录，将重试同步");
  }
}
