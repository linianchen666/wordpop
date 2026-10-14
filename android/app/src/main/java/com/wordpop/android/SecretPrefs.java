package com.wordpop.android;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecretPrefs {
  private static SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (!store.containsAlias("wordpop-session")) {
      KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
      generator.init(
          new KeyGenParameterSpec.Builder(
                  "wordpop-session", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .build());
      generator.generateKey();
    }
    return (SecretKey) store.getKey("wordpop-session", null);
  }

  static void save(Context context, String value) throws Exception {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    String blob =
        Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
            + ":"
            + Base64.encodeToString(
                cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                Base64.NO_WRAP);
    context.getSharedPreferences("cloud", 0).edit().putString("session", blob).apply();
  }

  static String load(Context context) throws Exception {
    String blob = context.getSharedPreferences("cloud", 0).getString("session", null);
    if (blob == null) return null;
    String[] parts = blob.split(":");
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
        Cipher.DECRYPT_MODE,
        key(),
        new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
    return new String(
        cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)),
        java.nio.charset.StandardCharsets.UTF_8);
  }

  static void clear(Context context) {
    context.getSharedPreferences("cloud", 0).edit().remove("session").apply();
  }
}
