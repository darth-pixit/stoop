import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatch } from '../www/js/context.js';

test('latch engages at enter threshold, not before', () => {
  const latch = createLatch(15, 12);
  assert.equal(latch.update(14.9), false);
  assert.equal(latch.update(15), true);
});

test('brief dip below enter but above exit stays latched', () => {
  const latch = createLatch(15, 12);
  latch.update(16);
  assert.equal(latch.update(14.9), true); // the flicker that used to reset the nudge
  assert.equal(latch.update(13), true);
  assert.equal(latch.update(12), false);  // real recovery releases
});

test('boundary oscillation between 14 and 16 never releases', () => {
  const latch = createLatch(15, 12);
  latch.update(16);
  for (let i = 0; i < 50; i++) {
    latch.update(i % 2 ? 14 : 16);
    assert.equal(latch.get(), true);
  }
});

test('reset clears the latch', () => {
  const latch = createLatch(15, 12);
  latch.update(20);
  latch.reset();
  assert.equal(latch.get(), false);
});
