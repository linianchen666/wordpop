package com.wordpop.android;

import android.content.Context;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

public class SyncWorker extends Worker {
  public SyncWorker(Context context, WorkerParameters parameters) {
    super(context, parameters);
  }

  static void schedule(Context context) {
    WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork(
            "wordpop-sync",
            ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(SyncWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(
                    new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build());
  }

  static void uploadSoon(Context context) {
    WorkManager.getInstance(context)
        .enqueueUniqueWork(
            "wordpop-upload",
            ExistingWorkPolicy.KEEP,
            new OneTimeWorkRequest.Builder(SyncWorker.class)
                .setInputData(new Data.Builder().putBoolean("uploadOnly", true).build())
                .setInitialDelay(10, TimeUnit.SECONDS)
                .setConstraints(
                    new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build());
  }

  public Result doWork() {
    try {
      if (SecretPrefs.load(getApplicationContext()) == null) return Result.success();
      StudyEngine engine = StudyEngine.get(getApplicationContext());
      if (getInputData().getBoolean("uploadOnly", false)
          && CloudClient.pendingCount(
                  engine.executor.submit(() -> engine.store.load()).get(20, TimeUnit.SECONDS))
              == 0) return Result.success();
      CloudClient.syncBlocking(getApplicationContext());
      if (CloudClient.pendingCount(
              engine.executor.submit(() -> engine.store.load()).get(20, TimeUnit.SECONDS))
          > 0) return Result.retry();
      return Result.success();
    } catch (Exception e) {
      return Result.retry();
    }
  }
}
