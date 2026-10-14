package com.wordpop.android;

/** Coalesces checks, while retaining changes made during a running upload. */
final class SyncGate {
  private boolean queued;
  private boolean dirty;

  synchronized void changed() {
    dirty = true;
  }

  synchronized boolean hasChanges() {
    return dirty;
  }

  synchronized boolean offer() {
    if (queued) return false;
    queued = true;
    return true;
  }

  synchronized void begin() {
    dirty = false;
  }

  synchronized boolean complete(boolean succeeded) {
    queued = false;
    return succeeded && dirty;
  }
}
