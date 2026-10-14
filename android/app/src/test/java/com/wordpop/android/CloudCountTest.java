package com.wordpop.android;

import static org.junit.Assert.*;

import org.junit.Test;

public class CloudCountTest {
  @Test
  public void parsesExactCountsIncludingEmptyAccounts() {
    assertEquals(0, CloudClient.parseRemoteCount("*/0"));
    assertEquals(10005, CloudClient.parseRemoteCount("*/10005"));
    assertEquals(2, CloudClient.parseRemoteCount("0-0/2"));
  }

  @Test
  public void unknownCountsRequireAFullPull() {
    assertEquals(-1, CloudClient.parseRemoteCount(null));
    assertEquals(-1, CloudClient.parseRemoteCount("*/ *"));
    assertEquals(-1, CloudClient.parseRemoteCount("0-0/*"));
    assertEquals(-1, CloudClient.parseRemoteCount("*/-3"));
    assertEquals(-1, CloudClient.parseRemoteCount("*/99999999999999999999999999"));
  }
}
