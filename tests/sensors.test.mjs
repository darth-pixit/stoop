// Regression tests for phone-pitch → neck-angle mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neckAngleFrom } from '../www/js/sensors.js';

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

test('lying down / overhead poses are not judged', () => {
  assert.equal(neckAngleFrom(130, 75), 0);  // lying on back
  assert.equal(neckAngleFrom(-50, 75), 0);  // phone overhead
});

test('missing sensor data returns null, not a fake angle', () => {
  assert.equal(neckAngleFrom(null, 75), null);
});
