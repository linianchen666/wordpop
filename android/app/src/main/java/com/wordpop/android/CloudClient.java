package com.wordpop.android;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

final class CloudClient {
  private static final ExecutorService network = Executors.newSingleThreadExecutor();
  private static final AtomicBoolean queued = new AtomicBoolean();
  static volatile String status = "尚未连接云服务";

  private static String request(JSONObject session, String route, String method, String body)
      throws Exception {
    URL url = new URL(session.getString("url") + route);
    if (!url.getProtocol().equals("https")) throw new Exception("云服务地址必须使用 HTTPS");
    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
    connection.setConnectTimeout(10000);
    connection.setReadTimeout(10000);
    connection.setRequestMethod(method);
    connection.setRequestProperty("apikey", session.getString("key"));
    if (!route.startsWith("/auth/") && session.has("access_token"))
      connection.setRequestProperty("Authorization", "Bearer " + session.getString("access_token"));
    connection.setRequestProperty("Content-Type", "application/json");
    connection.setRequestProperty("Prefer", "resolution=ignore-duplicates,return=minimal");
    try {
      if (body != null) {
        connection.setDoOutput(true);
        try (java.io.OutputStream output = connection.getOutputStream()) {
          output.write(body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
      }
      int code = connection.getResponseCode();
      InputStream stream = code < 400 ? connection.getInputStream() : connection.getErrorStream();
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      if (stream != null)
        try (InputStream input = stream) {
          byte[] buffer = new byte[8192];
          int count;
          while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
        }
      String response = bytes.toString("UTF-8");
      if (code >= 400) {
        String errorCode = "";
        try {
          JSONObject error = new JSONObject(response);
          errorCode = error.optString("error_code", error.optString("code"));
        } catch (Exception ignored) {
        }
        throw new Exception(authError(errorCode, code));
      }
      return response;
    } finally {
      connection.disconnect();
    }
  }

  static void login(Context context, JSONObject input, boolean signup) {
    network.execute(
        () -> {
          try {
            JSONObject session =
                new JSONObject()
                    .put("url", input.getString("url").trim().replaceAll("/+$", ""))
                    .put("key", input.getString("key").trim());
            JSONObject credentials =
                new JSONObject()
                    .put("email", input.getString("email").trim())
                    .put("password", input.getString("password"));
            if (!android.util.Patterns.EMAIL_ADDRESS
                .matcher(credentials.getString("email"))
                .matches()) throw new Exception("请填写有效的邮箱地址");
            if (credentials.getString("password").isEmpty()) throw new Exception("请填写密码");
            if (signup && credentials.getString("password").length() < 6)
              throw new Exception("注册密码至少需要 6 个字符，建议使用 8 个以上字符");
            JSONObject result =
                new JSONObject(
                    request(
                        session,
                        signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password",
                        "POST",
                        credentials.toString()));
            if (!result.has("access_token")) {
              status = "注册请求已提交，请查收确认邮件，点击后回软件登录。若跳到 localhost 并打不开，可先尝试登录；已有账户请直接登录。";
              return;
            }
            session
                .put("access_token", result.getString("access_token"))
                .put("refresh_token", result.getString("refresh_token"))
                .put("user_id", result.getJSONObject("user").getString("id"))
                .put(
                    "expires_at",
                    System.currentTimeMillis() / 1000 + result.optLong("expires_in", 3600));
            SecretPrefs.save(context, session.toString());
            status = "已登录，正在同步";
            syncBlocking(context);
          } catch (Exception error) {
            status = error.getMessage();
          } finally {
            MainActivity.notifyStatus();
          }
        });
  }

  static String authError(String errorCode, int code) {
    switch (errorCode) {
      case "email_not_confirmed":
        return "邮箱尚未确认。点击确认邮件后回软件登录；若跳到 localhost 并打不开，可先再次尝试登录。";
      case "invalid_credentials":
        return "邮箱或密码不正确，请检查后重试。";
      case "user_already_exists":
      case "email_exists":
        return "此邮箱已注册，请直接登录。";
      case "weak_password":
        return "密码不符合项目要求，请使用更长、更复杂的密码。";
      case "signup_disabled":
        return "项目未开放注册，请在 Supabase Authentication 设置中启用用户注册。";
      case "over_email_send_rate_limit":
        return "确认邮件发送太频繁或邮件额度已用完，请稍后再试。";
      case "over_request_rate_limit":
        return "请求过于频繁，请稍后再试。";
      case "email_address_invalid":
        return "邮箱格式不正确，请检查邮箱地址。";
      case "email_address_not_authorized":
        return "当前邮件服务不允许发送到此邮箱，请在 Supabase 配置自定义 SMTP。";
      default:
        return "云服务请求失败（" + code + "），请检查项目、账户和数据库配置";
    }
  }

  static void resendConfirmation(JSONObject input) {
    network.execute(
        () -> {
          try {
            String email = input.getString("email").trim();
            if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches())
              throw new Exception("请填写有效的邮箱地址");
            JSONObject project =
                new JSONObject()
                    .put("url", input.getString("url").trim().replaceAll("/+$", ""))
                    .put("key", input.getString("key").trim());
            request(
                project,
                "/auth/v1/resend",
                "POST",
                new JSONObject().put("type", "signup").put("email", email).toString());
            status = "已提交重新发送请求，请查收最新邮件。若已确认，请直接登录；发送受项目邮件额度限制。";
          } catch (Exception error) {
            status = error.getMessage();
          } finally {
            MainActivity.notifyStatus();
          }
        });
  }

  static void requestSync(Context context) {
    if (!queued.compareAndSet(false, true)) return;
    network.execute(
        () -> {
          try {
            syncBlocking(context);
          } catch (Exception error) {
            status = error.getMessage();
          } finally {
            queued.set(false);
            MainActivity.notifyStatus();
          }
        });
  }

  static synchronized void syncBlocking(Context context) throws Exception {
    String saved = SecretPrefs.load(context);
    if (saved == null) return;
    JSONObject session = new JSONObject(saved);
    if (session.optLong("expires_at") < System.currentTimeMillis() / 1000 + 60) {
      JSONObject tokens =
          new JSONObject(
              request(
                  session,
                  "/auth/v1/token?grant_type=refresh_token",
                  "POST",
                  new JSONObject()
                      .put("refresh_token", session.getString("refresh_token"))
                      .toString()));
      session
          .put("access_token", tokens.getString("access_token"))
          .put("refresh_token", tokens.getString("refresh_token"))
          .put(
              "expires_at", System.currentTimeMillis() / 1000 + tokens.optLong("expires_in", 3600));
      SecretPrefs.save(context, session.toString());
    }
    JSONArray base =
        new JSONArray(
            request(session, "/rest/v1/wordpop_baseline?select=state&limit=1", "GET", null));
    if (base.length() == 0) {
      status = "请先在电脑端连接此账户并上传初始记录";
      return;
    }
    StudyEngine engine = StudyEngine.get(context);
    JSONObject state = engine.executor.submit(() -> engine.store.load()).get(20, TimeUnit.SECONDS);
    if (state != null
        && state.has("cloudUser")
        && !state.getString("cloudUser").equals(session.getString("user_id")))
      throw new Exception("学习记录属于其他账户，请先备份并清除本地记录再切换");
    JSONArray upload = new JSONArray();
    if (state != null)
      for (int n = 0; n < state.getJSONArray("events").length(); n++) {
        JSONObject event = new JSONObject(state.getJSONArray("events").getJSONObject(n).toString());
        if (!(state.optJSONObject("cloudSyncedIds") != null
            && state.optJSONObject("cloudSyncedIds").optBoolean(event.getString("id")))) {
          event.put("user_id", session.getString("user_id"));
          upload.put(event);
        }
      }
    if (upload.length() > 0)
      request(session, "/rest/v1/wordpop_events?on_conflict=id", "POST", upload.toString());
    JSONArray events = new JSONArray();
    for (int offset = 0; ; offset += 1000) {
      JSONArray page =
          new JSONArray(
              request(
                  session,
                  "/rest/v1/wordpop_events?select=id,word,action,reviewed_at,target_id&order=reviewed_at.asc,id.asc&limit=1000&offset="
                      + offset,
                  "GET",
                  null));
      for (int n = 0; n < page.length(); n++) events.put(page.get(n));
      if (page.length() < 1000) break;
    }
    JSONObject baseline = base.getJSONObject(0).getJSONObject("state").getJSONObject("data"),
        seeds = new JSONObject();
    JSONArray progress = baseline.getJSONArray("progress");
    for (int n = 0; n < progress.length(); n++) {
      JSONObject row = progress.getJSONObject(n);
      seeds.put(row.getString("word"), row);
    }
    JSONObject command =
        new JSONObject()
            .put("type", "sync")
            .put(
                "initialConfig",
                base.getJSONObject(0).getJSONObject("state").optJSONObject("config"))
            .put("userId", session.getString("user_id"))
            .put("seeds", seeds)
            .put("events", events)
            .put("dailySeeds", baseline.getJSONArray("daily_stats"));
    JSONObject view = engine.executor.submit(() -> engine.run(command)).get(20, TimeUnit.SECONDS);
    WordWidget.render(context, view);
    MainActivity.notifyView(view, null);
    status =
        "已同步 · "
            + new java.text.SimpleDateFormat("HH:mm", java.util.Locale.CHINA)
                .format(new java.util.Date());
  }
}
