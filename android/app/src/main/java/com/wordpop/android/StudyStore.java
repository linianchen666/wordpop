package com.wordpop.android;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;

final class StudyStore extends SQLiteOpenHelper {
  StudyStore(Context context) {
    super(context, "wordpop.db", null, 2);
  }

  public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL)");
    createDownloadCache(db);
  }

  private void createDownloadCache(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE IF NOT EXISTS cloud_download_cache(owner TEXT NOT NULL,part INTEGER NOT"
            + " NULL,json TEXT NOT NULL,PRIMARY KEY(owner,part))");
  }

  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    if (oldVersion < 2) createDownloadCache(db);
  }

  JSONObject loadDownloadCache(String owner) {
    // Keep each row small: a single large JSON value can exceed CursorWindow.
    try (Cursor c =
        getReadableDatabase()
            .rawQuery(
                "SELECT part,json FROM cloud_download_cache WHERE owner=? ORDER BY part",
                new String[] {owner})) {
      if (!c.moveToFirst() || c.getInt(0) != 0) return null;
      JSONObject snapshot = new JSONObject(c.getString(1));
      JSONArray events = new JSONArray();
      int part = 0;
      while (c.moveToNext()) {
        if (c.getInt(0) != ++part) return null;
        JSONArray chunk = new JSONArray(c.getString(1));
        for (int n = 0; n < chunk.length(); n++) events.put(chunk.getJSONObject(n));
      }
      return snapshot.put("events", events);
    } catch (org.json.JSONException error) {
      return null;
    }
  }

  void saveDownloadCache(String owner, JSONObject snapshot) throws Exception {
    SQLiteDatabase database = getWritableDatabase();
    database.beginTransaction();
    try {
      database.delete("cloud_download_cache", "owner=?", new String[] {owner});
      if (snapshot != null) {
        JSONObject metadata =
            new JSONObject()
                .put("version", snapshot.getInt("version"))
                .put("count", snapshot.getLong("count"))
                .put("validatedAt", snapshot.getLong("validatedAt"));
        database.execSQL(
            "INSERT INTO cloud_download_cache VALUES(?,0,?)",
            new Object[] {owner, metadata.toString()});
        JSONArray events = snapshot.getJSONArray("events");
        for (int offset = 0; offset < events.length(); offset += 100) {
          JSONArray chunk = new JSONArray();
          for (int n = offset; n < Math.min(offset + 100, events.length()); n++)
            chunk.put(events.getJSONObject(n));
          database.execSQL(
              "INSERT INTO cloud_download_cache VALUES(?,?,?)",
              new Object[] {owner, offset / 100 + 1, chunk.toString()});
        }
      }
      database.setTransactionSuccessful();
    } finally {
      database.endTransaction();
    }
  }

  JSONObject load() throws Exception {
    try (Cursor c = getReadableDatabase().rawQuery("SELECT json FROM state WHERE id=1", null)) {
      return c.moveToFirst() ? new JSONObject(c.getString(0)) : null;
    }
  }

  void save(JSONObject state) {
    getWritableDatabase()
        .execSQL(
            "INSERT OR REPLACE INTO state(id,json) VALUES(1,?)", new Object[] {state.toString()});
  }
}
