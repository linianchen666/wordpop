package com.wordpop.android;

import java.math.BigInteger;
import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

// The repository tag belongs to Windows. Android versions come from APK assets.
final class AndroidRelease {
  static final String RELEASES = "https://github.com/linianchen666/wordpop/releases/latest";
  private static final String DOWNLOAD_PATH = "/linianchen666/wordpop/releases/download/";
  private static final Pattern APK =
      Pattern.compile("WordPop\\.Android\\.([0-9]+\\.[0-9]+\\.[0-9]+)\\.apk");
  private static final Pattern VERSION =
      Pattern.compile(
          "([0-9]+)\\.([0-9]+)\\.([0-9]+)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?(?:\\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?");
  final String version, downloadUrl, notes;

  private AndroidRelease(String version, String downloadUrl, String notes) {
    this.version = version;
    this.downloadUrl = downloadUrl;
    this.notes = notes;
  }

  static AndroidRelease latest(JSONObject release) throws Exception {
    if (release.optBoolean("draft") || release.optBoolean("prerelease")) return null;
    JSONArray assets = release.optJSONArray("assets");
    if (assets == null) return null;
    AndroidRelease latest = null;
    for (int n = 0; n < assets.length(); n++) {
      JSONObject asset = assets.optJSONObject(n);
      if (asset == null
          || !"uploaded".equals(asset.optString("state"))
          || asset.optLong("size") <= 0) continue;
      String name = asset.optString("name");
      Matcher apk = APK.matcher(name);
      if (!apk.matches()) continue;
      String version = apk.group(1);
      String url = asset.optString("browser_download_url");
      if (!officialApk(url, name)) continue;
      if (latest == null || compareVersions(version, latest.version) > 0)
        latest = new AndroidRelease(version, url, release.optString("body", ""));
    }
    return latest;
  }

  static boolean officialApk(String url, String name) {
    try {
      URI uri = new URI(url);
      String path = uri.getRawPath();
      if (!"https".equals(uri.getScheme())
          || !"github.com".equals(uri.getHost())
          || uri.getPort() != -1
          || uri.getUserInfo() != null
          || uri.getRawQuery() != null
          || uri.getRawFragment() != null
          || path == null
          || !path.startsWith(DOWNLOAD_PATH)) return false;
      String suffix = path.substring(DOWNLOAD_PATH.length());
      // Exactly one release tag segment, followed by this asset's filename.
      return suffix.indexOf('/') > 0
          && suffix.indexOf('/') == suffix.lastIndexOf('/')
          && suffix.endsWith("/" + name)
          && suffix.substring(0, suffix.indexOf('/')).matches("[A-Za-z0-9][A-Za-z0-9._+-]*");
    } catch (Exception error) {
      return false;
    }
  }

  static int compareVersions(String a, String b) {
    Matcher left = VERSION.matcher(a), right = VERSION.matcher(b);
    if (!left.matches() || !right.matches()) throw new IllegalArgumentException("无法识别安卓版本号");
    for (int n = 1; n <= 3; n++) {
      int result = new BigInteger(left.group(n)).compareTo(new BigInteger(right.group(n)));
      if (result != 0) return result;
    }
    String la = left.group(4), rb = right.group(4);
    if (la == null || rb == null) return la == rb ? 0 : la == null ? 1 : -1;
    String[] pa = la.split("\\."), pb = rb.split("\\.");
    for (int n = 0; n < Math.min(pa.length, pb.length); n++) {
      String x = pa[n], y = pb[n];
      boolean nx = x.matches("[0-9]+"), ny = y.matches("[0-9]+");
      int result =
          nx && ny
              ? new BigInteger(x).compareTo(new BigInteger(y))
              : nx != ny ? (nx ? -1 : 1) : x.compareTo(y);
      if (result != 0) return result;
    }
    return Integer.compare(pa.length, pb.length);
  }
}
