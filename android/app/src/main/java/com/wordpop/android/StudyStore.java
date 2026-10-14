package com.wordpop.android;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONObject;

final class StudyStore extends SQLiteOpenHelper {
  StudyStore(Context context) {
    super(context, "wordpop.db", null, 1);
  }

  public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL)");
  }

  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

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
