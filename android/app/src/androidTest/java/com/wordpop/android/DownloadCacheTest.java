package com.wordpop.android;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DownloadCacheTest {
  @Test
  public void upgradesWithoutChangingStudyStateAndRestoresChunkedAccountCache() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    // Use an isolated database, so the learning and widget fixtures keep their state.
    Context isolated =
        new android.content.ContextWrapper(context) {
          public java.io.File getDatabasePath(String name) {
            return context.getDatabasePath("download-cache-test.db");
          }

          public SQLiteDatabase openOrCreateDatabase(
              String name,
              int mode,
              SQLiteDatabase.CursorFactory factory,
              android.database.DatabaseErrorHandler handler) {
            return context.openOrCreateDatabase("download-cache-test.db", mode, factory, handler);
          }
        };
    context.deleteDatabase("download-cache-test.db");
    try {
      try (SQLiteDatabase old = context.openOrCreateDatabase("download-cache-test.db", 0, null)) {
        old.execSQL("CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL)");
        old.execSQL("INSERT INTO state VALUES(1,'{\"marker\":\"retained\"}')");
        old.setVersion(1);
      }
      try (StudyStore store = new StudyStore(isolated)) {
        assertEquals("retained", store.load().getString("marker"));
        JSONArray events = new JSONArray();
        // More than 2 MB in aggregate; each persisted chunk still fits CursorWindow.
        for (int n = 0; n < 12000; n++)
          events.put(
              new JSONObject()
                  .put("id", "event-" + n)
                  .put(
                      "word",
                      "long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-long-definition-"));
        JSONObject snapshot =
            new JSONObject()
                .put("version", 1)
                .put("count", events.length())
                .put("validatedAt", 123)
                .put("events", events);
        store.saveDownloadCache("project:user", snapshot);
        assertNull(store.loadDownloadCache("different-project:user"));
      }
      try (StudyStore reopened = new StudyStore(isolated)) {
        assertEquals(
            12000, reopened.loadDownloadCache("project:user").getJSONArray("events").length());
        assertEquals("retained", reopened.load().getString("marker"));
        reopened.saveDownloadCache("project:user", null);
        assertNull(reopened.loadDownloadCache("project:user"));
      }
    } finally {
      context.deleteDatabase("download-cache-test.db");
    }
  }
}
