package com.wordpop.android;

import java.util.HashSet;
import org.json.JSONArray;
import org.json.JSONObject;

/** Only current per-word plans are downloaded, and only after the count changes. */
final class ReviewScheduleDownload {
  static final String TABLE = "/rest/v1/wordpop_review_schedules";
  static final String CURRENT = "/rest/v1/wordpop_current_review_schedules";

  interface Transport {
    long count() throws Exception;

    JSONArray page(int offset) throws Exception;
  }

  static final class Result {
    final JSONArray rows;
    final long count;

    Result(JSONArray rows, long count) {
      this.rows = rows;
      this.count = count;
    }
  }

  static Result download(Transport transport, long cachedCount, boolean force) throws Exception {
    long count = transport.count();
    if (!force && count >= 0 && count == cachedCount) return new Result(null, count);
    for (int attempt = 0; attempt < 2; attempt++) {
      JSONArray rows = new JSONArray();
      HashSet<String> words = new HashSet<>();
      for (int offset = 0; ; ) {
        JSONArray page = transport.page(offset);
        if (page.length() == 0) break;
        for (int n = 0; n < page.length(); n++) {
          JSONObject row = page.getJSONObject(n);
          if (!words.add(row.getString("word"))) throw new Exception("复习安排分页正在变化，请重试同步");
          rows.put(row);
        }
        offset += page.length();
      }
      long after = transport.count();
      if (count < 0 || after < 0 || after == count) return new Result(rows, after);
      count = after;
    }
    throw new Exception("复习安排正在更新，已保留本地安排，将重试同步");
  }
}
