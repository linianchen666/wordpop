package com.wordpop.android;

import static org.junit.Assert.*;

import org.junit.Test;

public class CloudErrorTest {
  @Test
  public void identifiesFailingSyncPhaseAndRetainsPostgrestCode() {
    String upload =
        CloudClient.requestError(
            "/rest/v1/wordpop_events?on_conflict=id", "POST", false, "PGRST102", 400);
    assertTrue(upload.contains("上传评分记录失败"));
    assertTrue(upload.contains("HTTP 400 / PGRST102"));
    assertTrue(upload.contains("本地记录已保留"));
    assertTrue(
        CloudClient.requestError(
                "/rest/v1/wordpop_events?select=id&limit=0", "GET", true, "42703", 400)
            .startsWith("检查记录数量失败"));
    assertTrue(
        CloudClient.requestError("/rest/v1/wordpop_events?select=id", "GET", false, "PGRST100", 400)
            .startsWith("下载评分记录失败"));
    assertTrue(
        CloudClient.requestError(
                "/rest/v1/wordpop_baseline?select=state", "GET", false, "PGRST205", 404)
            .startsWith("读取初始记录失败"));
  }

  @Test
  public void distinguishesSchemaAndPermissionFailuresFromAuthentication() {
    for (String code : new String[] {"PGRST204", "42703", "42P01", "PGRST205", "23514"}) {
      assertTrue(
          CloudClient.requestError("/rest/v1/wordpop_events", "POST", false, code, 400)
              .contains("cloud/supabase.sql"));
    }
    assertTrue(
        CloudClient.requestError("/rest/v1/wordpop_events", "POST", false, "42501", 403)
            .contains("权限"));
    assertEquals(
        CloudClient.authError("invalid_credentials", 400),
        CloudClient.requestError(
            "/auth/v1/token?grant_type=password", "POST", false, "invalid_credentials", 400));
  }

  @Test
  public void doesNotExposeUntrustedServerTextOrRequestQuery() {
    String error =
        CloudClient.requestError(
            "/rest/v1/wordpop_events?private-query",
            "GET",
            false,
            "private email@example.com\nsecret",
            400);
    assertFalse(error.contains("private"));
    assertFalse(error.contains("secret"));
    assertFalse(error.contains("email"));
    assertTrue(error.contains("HTTP 400"));
  }
}
