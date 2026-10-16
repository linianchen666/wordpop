package com.wordpop.android;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CloudAccountDeviceTest {
  @Test
  public void logoutWaitsForActiveSyncThenClearsOnlyCredentials() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    StudyEngine engine = StudyEngine.get(context);
    engine
        .executor
        .submit(() -> engine.run(new JSONObject().put("type", "view")))
        .get(25, TimeUnit.SECONDS);
    String before = engine.executor.submit(() -> engine.store.load().toString()).get();
    JSONObject session =
        new JSONObject()
            .put("url", "https://invalid.localhost")
            .put("key", "fixture-public")
            .put("user_id", "fixture-account")
            .put("access_token", "fixture-token")
            .put("refresh_token", "fixture-refresh")
            .put("email", "learner@example.com")
            .put("display_name", "学习者")
            .put("expires_at", System.currentTimeMillis() / 1000 + 3600);
    try {
      synchronized (CloudClient.class) {
        SecretPrefs.save(context, session.toString());
        JSONObject account = CloudClient.account(context);
        assertTrue(account.getBoolean("signedIn"));
        assertEquals("学习者", account.getString("displayName"));
        assertFalse(account.has("access_token"));
        assertFalse(account.has("email"));
        CloudClient.logout(context);
        CloudClient.logout(context);
        assertTrue(CloudClient.account(context).getBoolean("signingOut"));
        // Model a refresh already holding the sync lock when logout was tapped.
        session.put("access_token", "fixture-refreshed-token");
        SecretPrefs.save(context, session.toString());
        assertNotNull(SecretPrefs.load(context));
      }
      long deadline = System.currentTimeMillis() + 5000;
      while (CloudClient.account(context).optBoolean("signingOut")
          && System.currentTimeMillis() < deadline) Thread.sleep(20);
      assertFalse(CloudClient.account(context).optBoolean("signingOut"));
      assertFalse(CloudClient.account(context).optBoolean("signedIn"));
      assertNull(SecretPrefs.load(context));
      CloudClient.syncBlocking(context);
      assertEquals(before, engine.executor.submit(() -> engine.store.load().toString()).get());
    } finally {
      SecretPrefs.clear(context);
    }
  }
}
