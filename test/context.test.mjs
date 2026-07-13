import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upFromOrientation, poseAngles, CONTEXTS, createContextTracker,
  OVERHEAD_ENTER, OVERHEAD_EXIT, CONTEXT_DWELL_MS, STILL_MS,
} from '../www/js/context.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('upFromOrientation anchor poses', () => {
  let up = upFromOrientation(0, 0); // flat on table, screen up
  close(up.x, 0); close(up.y, 0); close(up.z, 1);

  up = upFromOrientation(90, 0); // upright portrait
  close(up.x, 0); close(up.y, 1); close(up.z, 0);

  up = upFromOrientation(180, 0); // flat, screen down
  close(up.x, 0); close(up.y, 0); close(up.z, -1);

  up = upFromOrientation(0, 90); // landscape, right edge down
  close(up.x, -1); close(up.y, 0); close(up.z, 0);

  assert.equal(upFromOrientation(null, 0), null);
  assert.equal(upFromOrientation(45, null), null);
});

test('poseAngles: overhead pose reads past-vertical screenTilt', () => {
  const { screenTilt } = poseAngles(upFromOrientation(120, 0));
  close(screenTilt, 120, 1e-9);
  const vertical = poseAngles(upFromOrientation(90, 0));
  close(vertical.screenTilt, 90, 1e-9);
  const side = poseAngles(upFromOrientation(0, 85));
  close(Math.abs(side.sideTilt), 85, 1e-9);
});

// Feed a sequence of synthetic readings at 20 Hz; return final context.
function run(tracker, readings, { hz = 20, startTs = 0 } = {}) {
  let ts = startTs;
  let ctx = null;
  for (const r of readings) {
    ts += 1000 / hz;
    ctx = tracker.update(r, ts);
  }
  return { ctx, ts };
}

const HAND_JITTER = (i) => 0.6 * Math.sin(i * 1.3); // m/s² wobble a hand always has
const handheld = (beta, gamma, i) => ({
  beta: beta + Math.sin(i * 0.7) * 0.8,
  gamma,
  gravity: { x: 0, y: -9.81 + HAND_JITTER(i), z: 0.3 * Math.sin(i) },
});

test('lying on back, phone over face → overhead (not upright credit)', () => {
  const tracker = createContextTracker();
  const seq = Array.from({ length: 80 }, (_, i) => handheld(130, 0, i));
  const { ctx } = run(tracker, seq);
  assert.equal(ctx.id, 'overhead');
  assert.equal(ctx.judgable, false);
});

test('lying on side (portrait sideways) → sideways', () => {
  const tracker = createContextTracker();
  const seq = Array.from({ length: 80 }, (_, i) => handheld(5, 85, i));
  const { ctx } = run(tracker, seq);
  assert.equal(ctx.id, 'sideways');
});

test('phone dead-still and flat for 3s → flat; jittery gargoyle stays judgable', () => {
  const table = createContextTracker();
  const still = Array.from({ length: 80 }, () => ({ beta: 3, gamma: 0, gravity: { x: 0, y: 0.5, z: 9.79 } }));
  assert.equal(run(table, still).ctx.id, 'flat');

  const gargoyle = createContextTracker();
  const slouch = Array.from({ length: 80 }, (_, i) => handheld(18, 0, i));
  assert.equal(run(gargoyle, slouch).ctx.id, 'judgable');
});

test('walking (accel-mag oscillation) → moving', () => {
  const tracker = createContextTracker();
  const seq = Array.from({ length: 80 }, (_, i) => ({
    beta: 60 + Math.sin(i * 0.9) * 8,
    gamma: 0,
    gravity: { x: 0, y: -9.81 + 3 * Math.sin(i * 1.7), z: 1.5 * Math.sin(i * 0.5) },
  }));
  const { ctx } = run(tracker, seq);
  assert.equal(ctx.id, 'moving');
});

test('short overhead blip does not switch context (dwell)', () => {
  const tracker = createContextTracker();
  run(tracker, Array.from({ length: 60 }, (_, i) => handheld(75, 0, i)));
  // blip shorter than CONTEXT_DWELL_MS
  const blipSamples = Math.floor((CONTEXT_DWELL_MS - 400) / 50);
  const { ctx } = run(tracker, Array.from({ length: blipSamples }, (_, i) => handheld(130, 0, i)), { startTs: 3000 });
  assert.equal(ctx.id, 'judgable');
});

test('oscillating across the overhead band does not flap (hysteresis)', () => {
  const tracker = createContextTracker();
  // settle into overhead first
  run(tracker, Array.from({ length: 80 }, (_, i) => handheld(130, 0, i)));
  // wobble between enter and exit thresholds — should hold overhead
  const mid = (OVERHEAD_ENTER + OVERHEAD_EXIT) / 2;
  const wobble = Array.from({ length: 120 }, (_, i) => handheld(mid + Math.sin(i) * 3, 0, i));
  const { ctx } = run(tracker, wobble, { startTs: 4000 });
  assert.equal(ctx.id, 'overhead');
});

test('leaving overhead for an upright hold resumes judging', () => {
  const tracker = createContextTracker();
  run(tracker, Array.from({ length: 80 }, (_, i) => handheld(130, 0, i)));
  const { ctx } = run(tracker, Array.from({ length: 80 }, (_, i) => handheld(75, 0, i)), { startTs: 4000 });
  assert.equal(ctx.id, 'judgable');
});

test('no-gamma fallback mirrors the old guard but as overhead context', () => {
  const tracker = createContextTracker();
  const seq = Array.from({ length: 80 }, () => ({ beta: 130, gamma: null, gravity: null }));
  assert.equal(run(tracker, seq).ctx.id, 'overhead');

  const upright = createContextTracker();
  const seq2 = Array.from({ length: 80 }, () => ({ beta: 75, gamma: null, gravity: null }));
  assert.equal(run(upright, seq2).ctx.id, 'judgable');
});

test('flat needs stillness to engage before STILL_MS has passed', () => {
  const tracker = createContextTracker();
  const stillFlat = () => ({ beta: 3, gamma: 0, gravity: { x: 0, y: 0.5, z: 9.79 } });
  // fewer samples than STILL_MS + dwell requires → still judgable
  const samples = Math.floor((STILL_MS - 500) / 50);
  const { ctx } = run(tracker, Array.from({ length: samples }, stillFlat));
  assert.equal(ctx.id, 'judgable');
});
