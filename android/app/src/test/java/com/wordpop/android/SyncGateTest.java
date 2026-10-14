package com.wordpop.android;

import static org.junit.Assert.*;

import org.junit.Test;

public class SyncGateTest {
  @Test
  public void checksCoalesceWithoutEndlessFollowups() {
    SyncGate gate = new SyncGate();
    assertTrue(gate.offer());
    assertFalse(gate.offer());
    gate.begin();
    assertFalse(gate.offer());
    assertFalse(gate.complete(true));
    assertTrue(gate.offer());
  }

  @Test
  public void ratingsDuringUploadGetAnotherPass() {
    SyncGate gate = new SyncGate();
    gate.changed();
    assertTrue(gate.offer());
    gate.begin();
    gate.changed();
    gate.changed();
    assertFalse(gate.offer());
    assertTrue(gate.complete(true));
    assertTrue(gate.offer());
    gate.begin();
    assertFalse(gate.complete(true));
  }

  @Test
  public void failedUploadWaitsForRetryWithoutLosingDirtyState() {
    SyncGate gate = new SyncGate();
    assertTrue(gate.offer());
    gate.begin();
    gate.changed();
    assertFalse(gate.complete(false));
    assertTrue(gate.hasChanges());
    assertTrue(gate.offer());
    gate.begin();
    assertFalse(gate.complete(true));
  }

  @Test
  public void changeAfterCompletionCanStartItsOwnUpload() {
    SyncGate gate = new SyncGate();
    gate.offer();
    gate.begin();
    assertFalse(gate.complete(true));
    gate.changed();
    assertTrue(gate.hasChanges());
    assertTrue(gate.offer());
  }
}
