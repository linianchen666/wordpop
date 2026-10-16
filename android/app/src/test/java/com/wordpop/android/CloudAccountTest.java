package com.wordpop.android;

import static org.junit.Assert.*;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.json.JSONObject;
import org.junit.Test;

public class CloudAccountTest {
  private JSONObject session() throws Exception {
    return new JSONObject()
        .put("user_id", "private-id")
        .put("access_token", "opaque-token")
        .put("refresh_token", "private-refresh")
        .put("key", "private-key");
  }

  @Test
  public void usesProfileNameAndDoesNotExposeCredentials() throws Exception {
    JSONObject session = session();
    CloudAccount.remember(
        session,
        new JSONObject()
            .put("email", "mail@example.com")
            .put(
                "user_metadata",
                new JSONObject().put("display_name", "  学习者  ").put("full_name", "其他名字")),
        "fallback@example.com");
    JSONObject display = CloudAccount.describe(session);
    assertTrue(display.getBoolean("signedIn"));
    assertEquals("学习者", display.getString("displayName"));
    assertEquals(2, display.length());
    assertFalse(display.toString().contains("private"));
    assertFalse(display.has("email"));
  }

  @Test
  public void emailPrefixIsTheNameForEmailOnlyAccounts() throws Exception {
    JSONObject session = session();
    CloudAccount.remember(session, new JSONObject(), "learner+phone@example.com");
    assertEquals("learner+phone", CloudAccount.describe(session).getString("displayName"));
    assertEquals("learner+phone@example.com", session.getString("email"));
  }

  @Test
  public void restoresNamesFromOldSessionsWithoutRequestingTheServer() throws Exception {
    JSONObject claims =
        new JSONObject()
            .put("email", "old@example.com")
            .put("user_metadata", new JSONObject().put("full_name", "旧账户"));
    String payload =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(claims.toString().getBytes(StandardCharsets.UTF_8));
    JSONObject old = session().put("access_token", "header." + payload + ".signature");
    assertEquals("旧账户", CloudAccount.describe(old).getString("displayName"));
    claims.remove("user_metadata");
    payload =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(claims.toString().getBytes(StandardCharsets.UTF_8));
    old.put("access_token", "header." + payload + ".signature");
    assertEquals("old", CloudAccount.describe(old).getString("displayName"));
    assertFalse(old.has("email"));
  }

  @Test
  public void handlesMissingMalformedAndExpiredProfilesWithoutSigningOut() throws Exception {
    assertFalse(CloudAccount.describe(null).getBoolean("signedIn"));
    assertFalse(CloudAccount.describe(new JSONObject()).getBoolean("signedIn"));
    assertFalse(CloudAccount.describe(session().put("access_token", "")).getBoolean("signedIn"));
    JSONObject signedIn =
        session().put("expires_at", 1).put("access_token", "header.bad.signature");
    assertTrue(CloudAccount.describe(signedIn).getBoolean("signedIn"));
    assertEquals("学习账户", CloudAccount.describe(signedIn).getString("displayName"));
  }
}
