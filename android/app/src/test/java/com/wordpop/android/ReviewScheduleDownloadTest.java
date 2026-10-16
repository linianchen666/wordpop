package com.wordpop.android;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class ReviewScheduleDownloadTest {
  private static final class Server implements ReviewScheduleDownload.Transport {
    long count = 7;
    int countCalls;
    boolean insertDuringPull, changing, missingCount, duplicate;
    final List<Integer> offsets = new ArrayList<>();

    public long count() {
      return missingCount ? -1 : changing ? ++countCalls : count;
    }

    public JSONArray page(int offset) throws Exception {
      offsets.add(offset);
      if (insertDuringPull) {
        count++;
        insertDuringPull = false;
      }
      JSONArray rows = new JSONArray();
      for (int n = offset; n < Math.min(offset + 3, count); n++)
        rows.put(new JSONObject().put("word", duplicate ? "duplicate" : "word" + n));
      return rows;
    }
  }

  @Test
  public void countOnlyIdleAndManualValidation() throws Exception {
    Server server = new Server();
    assertNull(ReviewScheduleDownload.download(server, 7, false).rows);
    assertTrue(server.offsets.isEmpty());
    assertEquals(7, ReviewScheduleDownload.download(server, 7, true).rows.length());
    assertEquals(java.util.Arrays.asList(0, 3, 6, 7), server.offsets);
  }

  @Test
  public void restartsSnapshotAfterConcurrentInsert() throws Exception {
    Server server = new Server();
    server.insertDuringPull = true;
    ReviewScheduleDownload.Result result = ReviewScheduleDownload.download(server, 0, false);
    assertEquals(8, result.rows.length());
    assertEquals(8, result.count);
    assertEquals(2, java.util.Collections.frequency(server.offsets, 0));
  }

  @Test
  public void unavailableCountStillReadsRows() throws Exception {
    Server server = new Server();
    server.missingCount = true;
    assertEquals(7, ReviewScheduleDownload.download(server, -1, false).rows.length());
  }

  @Test
  public void rejectsChangingOrDuplicateSnapshot() throws Exception {
    Server server = new Server();
    server.changing = true;
    try {
      ReviewScheduleDownload.download(server, -1, false);
      fail("changing snapshot accepted");
    } catch (Exception expected) {
      assertTrue(expected.getMessage().contains("保留本地安排"));
    }
    server = new Server();
    server.duplicate = true;
    try {
      ReviewScheduleDownload.download(server, -1, false);
      fail("duplicate accepted");
    } catch (Exception expected) {
      assertTrue(expected.getMessage().contains("分页正在变化"));
    }
  }
}
