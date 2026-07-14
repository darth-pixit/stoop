// Regression tests for phone-pitch → neck-angle mapping and the iOS
// motion-permission gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neckAngleFrom, needsPermissionGate, getStatus, requestPermission, start, stop } from '../www/js/sensors.js';

test('calibrated hold reads as zero neck flexion', () => {
  assert.equal(neckAngleFrom(75, 75), 0);
});

test('every degree the phone drops below the calibrated hold is a degree of flexion', () => {
  assert.equal(neckAngleFrom(45, 75), 30);
  assert.equal(neckAngleFrom(15, 75), 60);
  assert.equal(neckAngleFrom(0, 75), 75);
});

test('raising the phone above the hold never reads negative', () => {
  assert.equal(neckAngleFrom(90, 75), 0);
});

test('output is clamped to a sane 0–90 range', () => {
  assert.equal(neckAngleFrom(-40, 95), 90);
});

test('lying down / overhead poses are unjudgable — null, never a fake angle', () => {
  assert.equal(neckAngleFrom(130, 75), null);  // lying on back
  assert.equal(neckAngleFrom(-50, 75), null);  // phone overhead
});

test('missing sensor data returns null, not a fake angle', () => {
  assert.equal(neckAngleFrom(null, 75), null);
});

// ── iOS permission gate ─────────────────────────────────────────
// On iOS, motion events stay silent until DeviceOrientationEvent
// .requestPermission() is granted from a user tap. Silence there must read as
// "blocked" (show the enable button) — never as "no hardware, simulate".

function mockGatedPlatform(answer) {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.DeviceOrientationEvent = class {
    static async requestPermission() { return answer; }
  };
  return () => {
    stop();
    delete globalThis.DeviceOrientationEvent;
    delete globalThis.window;
  };
}

test('without an iOS-style gate there is nothing to unlock', () => {
  assert.equal(needsPermissionGate(), false);
});

test('a gated platform with no grant reads as blocked, and a denial keeps it blocked', async () => {
  const cleanup = mockGatedPlatform('denied');
  try {
    start();
    assert.equal(needsPermissionGate(), true);
    assert.equal(getStatus(), 'blocked');
    assert.equal(await requestPermission(), false);
    assert.equal(getStatus(), 'blocked');
  } finally {
    cleanup();
  }
});

test('granting the permission opens the gate', async () => {
  const cleanup = mockGatedPlatform('granted');
  try {
    start();
    assert.equal(getStatus(), 'blocked'); // denial remembered from the previous run
    assert.equal(await requestPermission(), true);
    assert.notEqual(getStatus(), 'blocked');
  } finally {
    cleanup();
  }
});
