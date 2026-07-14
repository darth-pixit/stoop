// Regression tests for the fold-at-vertical pitch: raw euler beta keeps
// counting past 90 as the phone wobbles through upright (87 → 93 → 89…), so
// a readout of raw beta never settles on 90. pitchFrom folds symmetrically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pitchFrom } from '../www/js/sensors.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

test('identity below the vertical', () => {
  near(pitchFrom(0), 0);
  near(pitchFrom(45), 45);
  near(pitchFrom(75), 75);
  near(pitchFrom(89), 89);
});

test('exactly vertical reads exactly 90', () => {
  near(pitchFrom(90), 90);
});

test('past-vertical folds back instead of counting on', () => {
  near(pitchFrom(93), 87);   // the wobble that made the raw readout "jump"
  near(pitchFrom(95), 85);
  near(pitchFrom(120), 60);
});

test('a symmetric wobble through vertical stays within its physical range', () => {
  // raw beta 87 → 93 spans 6°; folded pitch spans 3° and never exceeds 90
  const wobble = [87, 89, 91, 93, 91, 89, 87].map(pitchFrom);
  assert.ok(Math.max(...wobble) <= 90);
  assert.ok(Math.max(...wobble) - Math.min(...wobble) <= 3 + 1e-9);
});

test('negative pitch (phone tipped away) passes through', () => {
  near(pitchFrom(-30), -30);
});

test('null-safe', () => {
  assert.equal(pitchFrom(null), null);
});
