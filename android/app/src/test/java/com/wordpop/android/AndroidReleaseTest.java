package com.wordpop.android;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AndroidReleaseTest {
  private static JSONObject asset(String version) throws Exception {
    String name = "WordPop.Android." + version + ".apk";
    return new JSONObject()
        .put("name", name)
        .put("state", "uploaded")
        .put("size", 12345)
        .put(
            "browser_download_url",
            "https://github.com/linianchen666/wordpop/releases/download/v9.0.0/" + name);
  }

  private static JSONObject release() throws Exception {
    return new JSONObject()
        .put("tag_name", "v9.0.0")
        .put("draft", false)
        .put("prerelease", false)
        .put("body", "改进同步\n修复小组件 <script>literal</script>")
        .put("assets", new JSONArray().put(asset("0.1.4")));
  }

  @Test
  public void readsAndroidAssetVersionIndependentlyOfWindowsTag() throws Exception {
    AndroidRelease latest = AndroidRelease.latest(release());
    assertEquals("0.1.4", latest.version);
    assertEquals(0, AndroidRelease.compareVersions(latest.version, "0.1.4"));
    assertTrue(
        latest.notes.contains("<script>literal</script>")); // Native dialog displays plain text.
    assertTrue(AndroidRelease.compareVersions(latest.version, "0.1.3") > 0);
    assertTrue(AndroidRelease.compareVersions(latest.version, "0.1.5") < 0);
  }

  @Test
  public void comparesNumericVersionsAndPreviewPromotionWithoutDowngrading() {
    assertTrue(AndroidRelease.compareVersions("0.1.10", "0.1.9") > 0);
    assertTrue(AndroidRelease.compareVersions("0.2.0", "0.1.999") > 0);
    assertTrue(AndroidRelease.compareVersions("0.1.4", "0.1.4-beta.1") > 0);
    assertTrue(AndroidRelease.compareVersions("0.1.4", "0.1.5-beta.1") < 0);
    assertEquals(0, AndroidRelease.compareVersions("0.1.4", "0.1.4+local.2"));
    assertTrue(AndroidRelease.compareVersions("0.1.4-beta.10", "0.1.4-beta.2") > 0);
    assertTrue(AndroidRelease.compareVersions("0.1.4-rc.1", "0.1.4-beta.10") > 0);
    assertThrows(
        IllegalArgumentException.class, () -> AndroidRelease.compareVersions("0.1.4", "未知"));
  }

  @Test
  public void selectsHighestUploadedStableApkOnly() throws Exception {
    JSONObject release = release();
    release
        .getJSONArray("assets")
        .put(asset("0.1.10"))
        .put(asset("0.1.9"))
        .put(asset("99.0.0-beta.1"))
        .put(asset("100.0.0").put("state", "new"))
        .put(asset("200.0.0").put("size", 0))
        .put(asset("300.0.0").put("name", "WordPop.Setup.300.0.0.exe"));
    assertEquals("0.1.10", AndroidRelease.latest(release).version);
  }

  @Test
  public void excludesDraftsPrereleasesAndMissingAndroidAssets() throws Exception {
    assertNull(AndroidRelease.latest(release().put("draft", true)));
    assertNull(AndroidRelease.latest(release().put("prerelease", true)));
    assertNull(AndroidRelease.latest(new JSONObject()));
    assertNull(AndroidRelease.latest(release().put("assets", new JSONArray())));
    assertNull(
        AndroidRelease.latest(release().put("assets", new JSONArray().put(asset("0.1.5-beta.1")))));
  }

  @Test
  public void acceptsOnlyExactOfficialHttpsAssetLinks() throws Exception {
    String name = "WordPop.Android.0.1.4.apk";
    String good = asset("0.1.4").getString("browser_download_url");
    assertTrue(AndroidRelease.officialApk(good, name));
    for (String bad :
        new String[] {
          good.replace("https:", "http:"),
          good.replace("github.com", "github.com.evil.example"),
          good.replace("github.com", "github.com@evil.example"),
          good.replace("/wordpop/", "/other/"),
          good + "?redirect=evil",
          good + "#fragment",
          good.replace("v9.0.0/", "../"),
          good.replace("v9.0.0/", "%2e%2e/"),
          good.replace("v9.0.0/", "%2e%2e%2fevil/"),
          good.replace("v9.0.0/", "v9.0.0/nested/"),
          good.replace("github.com", "github.com:444"),
          "javascript:alert(1)",
          "https://github.com/linianchen666/wordpop/releases/download/"
        }) assertFalse(bad, AndroidRelease.officialApk(bad, name));
    JSONObject release = release();
    release
        .getJSONArray("assets")
        .getJSONObject(0)
        .put("browser_download_url", "https://evil.example/" + name);
    assertNull(AndroidRelease.latest(release));
  }
}
