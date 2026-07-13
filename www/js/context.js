// Context classifier: decides whether a sensor sample is *judgable* posture
// before the neck-angle ladder runs. Phone pitch alone can't tell "sitting
// upright" from "lying on my back scrolling" — but the gravity direction can.
// To read a screen while lying on your back, the phone must tip past vertical
// so the screen faces down at your eyes; that signature (and side-lying,
// phone-flat-on-table, walking) is what we detect here. Pure module, no DOM —
// unit-testable under plain `node --test`.

// ── gravity from orientation angles ─────────────────────────────
// W3C deviceorientation uses intrinsic Z-X'-Y'' rotations. Device frame:
// x = right of screen, y = top of screen, z = out of the screen. The unit
// "up" vector (away from Earth) in device coordinates is the third row of
// Rz(alpha)·Rx(beta)·Ry(gamma) — alpha (compass) drops out entirely.
export function upFromOrientation(beta, gamma) {
  if (beta == null || gamma == null) return null;
  const b = (beta * Math.PI) / 180;
  const g = (gamma * Math.PI) / 180;
  return {
    x: -Math.sin(g) * Math.cos(b),
    y: Math.sin(b),
    z: Math.cos(g) * Math.cos(b),
  };
}

const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const deg = (rad) => (rad * 180) / Math.PI;

// screenTilt: 0° flat screen-up → 90° vertical → 180° flat screen-down.
// pitch: 90° upright portrait. sideTilt: ±90° fully on its side.
export function poseAngles(up) {
  return {
    screenTilt: deg(Math.acos(clamp1(up.z))),
    pitch: deg(Math.asin(clamp1(up.y))),
    sideTilt: deg(Math.asin(clamp1(up.x))),
  };
}

// ── contexts ────────────────────────────────────────────────────
export const CONTEXTS = {
  judgable: { id: 'judgable', judgable: true, emoji: '👀', label: 'Watching' },
  overhead: { id: 'overhead', judgable: false, emoji: '🛏️', label: 'Lying back — not judging' },
  sideways: { id: 'sideways', judgable: false, emoji: '🛋️', label: 'Phone on its side — not judging' },
  flat: { id: 'flat', judgable: false, emoji: '🍽️', label: 'Resting flat — not judging' },
  moving: { id: 'moving', judgable: false, emoji: '🚶', label: 'On the move — paused' },
};

// Enter/exit pairs give each context hysteresis so rolling over in bed or a
// bump on a walk doesn't flap the classification.
export const OVERHEAD_ENTER = 100; // ° screenTilt — screen tipped past vertical toward the face
export const OVERHEAD_EXIT = 92;
export const SIDEWAYS_ENTER = 50;  // ° |sideTilt| — gravity along the x axis
export const SIDEWAYS_EXIT = 42;
export const FLAT_ENTER = 20;      // ° screenTilt — near flat screen-up…
export const FLAT_EXIT = 26;
export const STILL_MS = 2500;      // …and dead-still this long (tables don't jitter, hands do)
export const MOVING_ENTER_MS = 800;
export const MOVING_EXIT_MS = 2000;
export const CONTEXT_DWELL_MS = 1200; // candidate must persist this long before we switch

// Motion thresholds. Primary signal: stddev of |accelerationIncludingGravity|
// magnitude (sign-agnostic, so iOS's inverted sign convention is irrelevant).
// Fallback when DeviceMotion is denied: stddev of raw beta over the window.
const ACCEL_STILL_SD = 0.06;  // m/s² — resting on a surface
const ACCEL_MOVING_SD = 1.0;  // m/s² — walking
const ACCEL_CALM_SD = 0.5;    // m/s² — back below this to leave `moving`
const BETA_STILL_SD = 0.15;   // ° — orientation-only stillness
const BETA_MOVING_SD = 5;     // ° — orientation-only walking
const WINDOW_MS = 2000;

function stddev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const varSum = values.reduce((a, v) => a + (v - mean) * (v - mean), 0);
  return Math.sqrt(varSum / values.length);
}

// Generic hysteresis latch: ≥ enterAt latches true, ≤ exitAt latches false,
// in between it holds. Also reused by the monitor for the stoop threshold.
export function createLatch(enterAt, exitAt) {
  let on = false;
  return {
    update(v) {
      if (v >= enterAt) on = true;
      else if (v <= exitAt) on = false;
      return on;
    },
    get() { return on; },
    reset() { on = false; },
  };
}

// ── tracker ─────────────────────────────────────────────────────
// Stateful wrapper: rolling sample window for motion, per-context hysteresis,
// dwell timing. update(reading, ts) → one of CONTEXTS. All time math is
// timestamp-based because orientation event rates vary wildly (15–60 Hz).
export function createContextTracker() {
  const window_ = []; // {ts, accelMag, beta}
  const overheadLatch = createLatch(OVERHEAD_ENTER, OVERHEAD_EXIT);
  const sidewaysLatch = createLatch(SIDEWAYS_ENTER, SIDEWAYS_EXIT);
  let current = CONTEXTS.judgable;
  let candidate = null;
  let candidateSince = 0;
  let stillSince = null;   // ts when the phone last became table-still
  let movingSince = null;  // ts when motion first exceeded the walking level
  let calmSince = null;    // ts when motion last dropped back to calm

  function motionState() {
    const accel = [];
    const betas = [];
    for (const s of window_) {
      if (s.accelMag != null) accel.push(s.accelMag);
      if (s.beta != null) betas.push(s.beta);
    }
    const sd = stddev(accel);
    if (sd != null) {
      return { still: sd <= ACCEL_STILL_SD, walking: sd >= ACCEL_MOVING_SD, calm: sd <= ACCEL_CALM_SD };
    }
    const bsd = stddev(betas); // DeviceMotion denied — orientation jitter fallback
    if (bsd != null) {
      return { still: bsd <= BETA_STILL_SD, walking: bsd >= BETA_MOVING_SD, calm: bsd < BETA_MOVING_SD };
    }
    return { still: false, walking: false, calm: true };
  }

  // Raw classification for this instant (before dwell smoothing), in priority
  // order: overhead → sideways → flat → moving → judgable.
  function classify(reading, ts) {
    const up = upFromOrientation(reading.beta, reading.gamma);
    const motion = motionState();

    if (motion.still) { if (stillSince == null) stillSince = ts; } else stillSince = null;
    if (motion.walking) { if (movingSince == null) movingSince = ts; calmSince = null; }
    else if (motion.calm) { if (calmSince == null) calmSince = ts; movingSince = null; }

    if (up == null) {
      // No gamma (older desktops): beta-only degrade that mirrors the old
      // guard band, except the time is now logged as unjudged, not upright.
      if (reading.beta != null && (reading.beta > 100 || reading.beta < -40)) return CONTEXTS.overhead;
      return CONTEXTS.judgable;
    }

    const { screenTilt, sideTilt } = poseAngles(up);
    if (overheadLatch.update(screenTilt)) return CONTEXTS.overhead;
    if (sidewaysLatch.update(Math.abs(sideTilt))) return CONTEXTS.sideways;

    const flatNow = current === CONTEXTS.flat
      ? screenTilt < FLAT_EXIT && motion.still
      : screenTilt <= FLAT_ENTER && stillSince != null && ts - stillSince >= STILL_MS;
    if (flatNow) return CONTEXTS.flat;

    const movingNow = current === CONTEXTS.moving
      ? !(calmSince != null && ts - calmSince >= MOVING_EXIT_MS)
      : movingSince != null && ts - movingSince >= MOVING_ENTER_MS;
    if (movingNow) return CONTEXTS.moving;

    return CONTEXTS.judgable;
  }

  return {
    update(reading, ts) {
      window_.push({ ts, accelMag: reading.gravity ? Math.hypot(reading.gravity.x, reading.gravity.y, reading.gravity.z) : null, beta: reading.beta });
      while (window_.length && ts - window_[0].ts > WINDOW_MS) window_.shift();

      const raw = classify(reading, ts);
      if (raw === current) { candidate = null; return current; }
      if (raw !== candidate) { candidate = raw; candidateSince = ts; return current; }
      if (ts - candidateSince >= CONTEXT_DWELL_MS) { current = raw; candidate = null; }
      return current;
    },
    get() { return current; },
    reset() {
      window_.length = 0;
      overheadLatch.reset();
      sidewaysLatch.reset();
      current = CONTEXTS.judgable;
      candidate = null;
      stillSince = movingSince = calmSince = null;
    },
  };
}
