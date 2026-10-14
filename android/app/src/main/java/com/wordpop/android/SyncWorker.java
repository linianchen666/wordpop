package com.wordpop.android;

import android.content.Context;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
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

  public Result doWork() {
    try {
      CloudClient.syncBlocking(getApplicationContext());
      return Result.success();
    } catch (Exception e) {
      return Result.retry();
    }
  }
}
