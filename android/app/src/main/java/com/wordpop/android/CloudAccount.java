package com.wordpop.android;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.json.JSONObject;

/** Public display information only; tokens and cloud credentials stay native. */
final class CloudAccount {
  private static String text(JSONObject object, String key) {
    Object value = object == null ? null : object.opt(key);
    return value instanceof String ? ((String) value).trim().replaceAll("\\s+", " ") : "";
  }

  private static String name(JSONObject metadata) {
    for (String key : new String[] {"display_name", "full_name", "name", "user_name", "username"}) {
      String value = text(metadata, key);
      if (!value.isEmpty()) return value.substring(0, Math.min(value.length(), 80));
    }
    return "";
  }

  static void remember(JSONObject session, JSONObject user, String email) throws Exception {
    String address = text(user, "email");
    if (address.isEmpty()) address = email;
    if (address != null && !address.isEmpty()) session.put("email", address);
    String displayName = name(user == null ? null : user.optJSONObject("user_metadata"));
    if (!displayName.isEmpty()) session.put("display_name", displayName);
  }

  static JSONObject describe(JSONObject session) throws Exception {
    boolean signedIn =
        session != null
            && !text(session, "access_token").isEmpty()
            && !text(session, "user_id").isEmpty();
    JSONObject result = new JSONObject().put("signedIn", signedIn);
    if (!signedIn) return result;
    String displayName = text(session, "display_name"), email = text(session, "email");
    // Older sessions did not save email/name. Read JWT claims for display only;
    // authentication and record ownership still use the existing server checks.
    if (displayName.isEmpty()) {
      try {
        String token = session.getString("access_token");
        String[] parts = token.split("\\.");
        if (parts.length == 3 && token.length() < 65536) {
          JSONObject claims =
              new JSONObject(
                  new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8));
          displayName = name(claims.optJSONObject("user_metadata"));
          if (email.isEmpty()) email = text(claims, "email");
        }
      } catch (Exception ignored) {
        // An opaque/expired token must not turn an offline account into a login form.
      }
    }
    if (displayName.isEmpty() && email.contains("@"))
      displayName = email.substring(0, email.indexOf('@'));
    if (displayName.isEmpty()) displayName = "学习账户";
    return result.put("displayName", displayName.substring(0, Math.min(displayName.length(), 80)));
  }
}
