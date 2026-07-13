// Regression tests for the bend-test smoothing filter: steady while you hold,
// responsive while you move, immune to single-frame detection glitches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmoother } from '../www/js/pose.js';

const DT = 1000 / 30; // ~30fps camera

test('constant input passes through unchanged', () => {
  const s = createSmoother();
  let out = 0;
  for (let i = 0; i < 30; i++) out = s.push(20, i * DT);
  assert.ok(Math.abs(out - 20) < 0.01, `expected ~20, got ${out}`);
});

test('a single-frame spike is swallowed by the median pre-stage', () => {
  const s = createSmoother();
  let t = 0;
  for (let i = 0; i < 10; i++) s.push(10, t += DT);
  const spiked = s.push(80, t += DT); // one glitched detection frame
  assert.ok(spiked < 15, `spike leaked through: ${spiked}`);
  const after = s.push(10, t += DT);
  assert.ok(Math.abs(after - 10) < 2, `didn't recover: ${after}`);
});

test('a real sustained bend converges without excessive lag', () => {
  const s = createSmoother();
  let t = 0, out = 0;
  for (let i = 0; i < 20; i++) out = s.push(0, t += DT);
  for (let i = 0; i < 90; i++) out = s.push(30, t += DT); // 3s of holding a 30° bend
  assert.ok(Math.abs(out - 30) < 5, `too laggy: ${out} after 3s`);
});

test('reset() forgets all history', () => {
  const s = createSmoother();
  let t = 0;
  for (let i = 0; i < 20; i++) s.push(40, t += DT);
  s.reset();
  const first = s.push(5, t += DT);
  assert.equal(first, 5);
});
