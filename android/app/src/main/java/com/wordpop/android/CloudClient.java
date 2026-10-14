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
      if (code >= 400) throw new Exception("云服务请求失败（" + code + "），请检查项目、账户和数据库配置");
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
                    .put("url", input.getString("url").replaceAll("/+$", ""))
                    .put("key", input.getString("key"));
            JSONObject credentials =
                new JSONObject()
                    .put("email", input.getString("email"))
                    .put("password", input.getString("password"));
            JSONObject result =
                new JSONObject(
                    request(
                        session,
                        signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password",
                        "POST",
                        credentials.toString()));
            if (!result.has("access_token")) {
              status = "请查收确认邮件，确认后登录";
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
