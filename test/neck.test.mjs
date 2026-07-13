import test from 'node:test';
import assert from 'node:assert/strict';
import { neckAngleFrom } from '../www/js/sensors.js';

test('null beta passes through as null', () => {
  assert.equal(neckAngleFrom(null, 75), null);
});

test('guard band (lying/overhead) is unjudgable — null, not 0/upright', () => {
  assert.equal(neckAngleFrom(130, 75), null);
  assert.equal(neckAngleFrom(-50, 75), null);
});

test('neck angle is calibBeta minus beta, clamped to [0, 90]', () => {
  assert.equal(neckAngleFrom(75, 75), 0);
  assert.equal(neckAngleFrom(55, 75), 20);
  assert.equal(neckAngleFrom(90, 75), 0);   // phone above baseline → no flexion
  assert.equal(neckAngleFrom(-40, 75), 90); // clamped at the top
});
