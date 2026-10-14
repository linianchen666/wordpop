package com.wordpop.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Handler;
import android.os.IBinder;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.widget.Toast;
import java.util.Locale;

public class WidgetSpeechService extends Service {
  private final Handler handler = new Handler(android.os.Looper.getMainLooper());
  private TextToSpeech tts;
  private String word = "", utterance = "";
  private boolean ready, destroyed;
  private int requestId;
  private final Runnable timeout = this::finishSpeech;

  public void onCreate() {
    super.onCreate();
    NotificationManager manager = getSystemService(NotificationManager.class);
    manager.createNotificationChannel(
        new NotificationChannel("pronunciation", "单词发音", NotificationManager.IMPORTANCE_LOW));
    tts =
        new TextToSpeech(
            this,
            result ->
                handler.post(
                    () -> {
                      if (destroyed) return;
                      if (result != TextToSpeech.SUCCESS) {
                        fail();
                        return;
                      }
                      int language = tts.setLanguage(Locale.US);
                      if (language < TextToSpeech.LANG_AVAILABLE) {
                        fail();
                        return;
                      }
                      ready = true;
                      tts.setAudioAttributes(
                          new AudioAttributes.Builder()
                              .setUsage(AudioAttributes.USAGE_MEDIA)
                              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                              .build());
                      tts.setOnUtteranceProgressListener(
                          new UtteranceProgressListener() {
                            public void onStart(String id) {}

                            public void onDone(String id) {
                              handler.post(
                                  () -> {
                                    if (id.equals(utterance)) finishSpeech();
                                  });
                            }

                            public void onError(String id) {
                              handler.post(
                                  () -> {
                                    if (id.equals(utterance)) fail();
                                  });
                            }
                          });
                      speak();
                    }));
  }

  public int onStartCommand(Intent intent, int flags, int startId) {
    startForeground(
        42,
        new Notification.Builder(this, "pronunciation")
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle("WordPop 单词发音")
            .setContentText("正在播放英语发音")
            .setOngoing(true)
            .build());
    word = intent == null ? "" : intent.getStringExtra("word");
    if (word == null || word.trim().isEmpty() || word.length() > 200) {
      finishSpeech();
      return START_NOT_STICKY;
    }
    requestId++;
    handler.removeCallbacks(timeout);
    handler.postDelayed(timeout, 20000);
    if (ready) speak();
    return START_NOT_STICKY;
  }

  private void speak() {
    if (word.isEmpty()) return;
    utterance = "wordpop-" + requestId;
    if (tts.speak(word, TextToSpeech.QUEUE_FLUSH, null, utterance) == TextToSpeech.ERROR) fail();
  }

  private void fail() {
    Toast.makeText(this, "英语发音不可用，请在手机的文字转语音设置中安装英语语音并检查媒体音量", Toast.LENGTH_LONG).show();
    finishSpeech();
  }

  private void finishSpeech() {
    handler.removeCallbacks(timeout);
    stopForeground(STOP_FOREGROUND_REMOVE);
    stopSelf();
  }

  public void onDestroy() {
    destroyed = true;
    handler.removeCallbacksAndMessages(null);
    if (tts != null) {
      tts.stop();
      tts.shutdown();
    }
    super.onDestroy();
  }

  public IBinder onBind(Intent intent) {
    return null;
  }
}
