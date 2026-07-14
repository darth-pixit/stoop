// Sensor abstraction for the posture monitor: DeviceOrientation gives the
// phone pitch we compare against your "good posture" calibration. (The
// ear-to-shoulder flexibility test no longer uses phone tilt — it watches you
// through the front camera; see pose.js/flex.js.) Falls back to a simulation
// source on hardware without sensors (desktop), so every screen stays usable.
// gamma + the DeviceMotion gravity field feed the context tracker (context.js)
// that decides whether a sample is judgable posture at all.

const listeners = new Set();
const statusListeners = new Set();
let running = false;
let sensorsSeen = false;
let simulated = false;
let simAngleDeg = 0; // simulated *neck* angle for monitor / tilt for flex
let permission = 'unknown'; // iOS gate: 'unknown' | 'granted' | 'denied'
let fallbackTimer = null;

export const reading = {
  beta: null,          // raw pitch euler angle: 0 flat on table → 90 upright → >90 past vertical
  pitch: null,         // display-stable pitch: folds at the vertical (never exceeds 90)
  gamma: null,         // phone roll: ±90 on its side — context detection only
  gravity: null,       // {x,y,z} m/s² including gravity
  tiltFromVertical: 0, // ° the phone's long axis leans away from plumb
  sideways: 0,         // signed ° of that tilt in the frontal (ear-to-shoulder) plane
  forwardness: 0,      // 0..1 share of tilt that is forward/back nod, not side-bend
  simulated: false,
  ts: 0,
};

export function isSimulated() { return simulated; }
export function setSimAngle(deg) { simAngleDeg = deg; }
export function getSimAngle() { return simAngleDeg; }

// iOS 13+ gates motion events behind a permission call that must come from a
// user tap — the app can't fire it on boot. While the gate is closed the UI
// shows an "allow motion access" button instead of the desktop simulator.
export function needsPermissionGate() {
  return (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') ||
         (typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function');
}

export function getStatus() {
  if (simulated) return 'simulated';   // sensor-less hardware, slider drives readings
  if (sensorsSeen) return 'live';      // real events flowing
  if (running && needsPermissionGate() && permission !== 'granted') return 'blocked';
  return 'waiting';                    // listeners armed, nothing arrived yet
}

export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function emitStatus() {
  const s = getStatus();
  for (const fn of statusListeners) fn(s);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  reading.ts = performance.now();
  reading.simulated = simulated;
  for (const fn of listeners) fn(reading);
}

// A real sensor event arrived — stop any simulation that had kicked in so fake
// readings can't interleave with (or override) the genuine hardware feed.
function markLive() {
  if (sensorsSeen && !simulated) return;
  sensorsSeen = true;
  stopSimulation();
  emitStatus();
}

// Raw beta is an euler angle with a singularity at the vertical: as the phone
// wobbles through upright, beta keeps counting past 90 (87 → 93 → 89…), so a
// pitch readout never settles on 90 and appears to jump. Folding through the
// gravity up-vector (up.y = sin β → pitch = asin(sin β)) is wobble-symmetric:
// vertical reads a steady 90 and a ±3° wobble shows as 87…90…87, not 87…93.
export function pitchFrom(beta) {
  if (beta == null) return null;
  const s = Math.sin((beta * Math.PI) / 180);
  return (Math.asin(Math.max(-1, Math.min(1, s))) * 180) / Math.PI;
}

function onOrientation(e) {
  if (e.beta == null) return;
  markLive();
  reading.beta = e.beta;
  reading.pitch = pitchFrom(e.beta);
  reading.gamma = e.gamma;
  emit();
}

function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null) return;
  markLive();
  const mag = Math.hypot(g.x, g.y, g.z) || 9.81;
  // Angle between the phone's long (y) axis and gravity. Held upright against
  // the ear this reads ~0°; ear-to-shoulder head tilt grows it directly.
  const cos = Math.min(1, Math.max(-1, Math.abs(g.y) / mag));
  reading.gravity = { x: g.x, y: g.y, z: g.z };
  reading.tiltFromVertical = (Math.acos(cos) * 180) / Math.PI;
  const horiz = Math.hypot(g.x, g.z) || 1e-6;
  // x = across the screen → side-bend; z = out of the screen → forward nod
  reading.forwardness = Math.abs(g.z) / horiz > 1 ? 1 : Math.abs(g.z) / horiz;
  reading.sideways = Math.sign(g.x || 1) * reading.tiltFromVertical;
  emit();
}

let simTimer = null;
function stopSimulation() {
  simulated = false;
  clearInterval(simTimer);
  simTimer = null;
}

function startSimulation() {
  simulated = true;
  clearInterval(simTimer);
  simTimer = setInterval(() => {
    // For the monitor: sim slider drives neck angle → synthesize matching beta.
    reading.beta = 75 - simAngleDeg;
    reading.pitch = 75 - simAngleDeg;
    reading.gamma = 0;
    // For the flex test: sim slider drives tilt directly, clean side-bend.
    reading.tiltFromVertical = simAngleDeg;
    reading.sideways = simAngleDeg;
    reading.forwardness = 0.05;
    reading.gravity = { x: 0, y: -9.81, z: 0 };
    emit();
  }, 100);
  emitStatus();
}

// iOS 13+ requires an explicit user-gesture permission request. Remember the
// answer so missing events read as "blocked, show the enable button" rather
// than "no hardware, simulate".
export async function requestPermission() {
  let granted = true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      granted = (await DeviceOrientationEvent.requestPermission()) === 'granted';
    }
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      await DeviceMotionEvent.requestPermission().catch(() => {});
    }
  } catch {
    granted = false; // denied earlier this session, or called outside a tap
  }
  permission = granted ? 'granted' : 'denied';
  if (granted && running && !sensorsSeen) armFallback(); // events should flow now; if not, simulate
  emitStatus();
  return granted;
}

// If nothing arrives shortly: gated platforms (iOS) wait for the user to tap
// the enable button; everything else has no usable sensors — simulate. Only
// conclude "no sensors" while the page is visible: a page loaded (or app-
// switched away) while hidden gets no orientation events, and simulating then
// would wrongly latch a real phone into fake readings, so defer the verdict.
function armFallback() {
  clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(() => {
    if (!running || sensorsSeen || simulated) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (needsPermissionGate() && permission !== 'granted') emitStatus();
    else startSimulation();
  }, 1500);
}

function onVisibleRecheck() {
  if (document.visibilityState === 'visible' && running && !sensorsSeen && !simulated) {
    armFallback();
  }
}

export function start() {
  if (running) return;
  running = true;
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  window.addEventListener('visibilitychange', onVisibleRecheck);
  armFallback();
}

export function stop() {
  running = false;
  window.removeEventListener('deviceorientation', onOrientation);
  window.removeEventListener('devicemotion', onMotion);
  window.removeEventListener('visibilitychange', onVisibleRecheck);
  clearTimeout(fallbackTimer);
  stopSimulation();
}

// Phone pitch → estimated neck flexion, personalised by calibration.
// calibBeta is the pitch the user holds with deliberately good posture;
// every degree the phone drops below it reads as a degree of neck flexion.
export function neckAngleFrom(beta, calibBeta) {
  if (beta == null) return null;
  if (beta > 120 || beta < -40) return null; // lying down / overhead — unjudgable, not "upright"
  return Math.max(0, Math.min(90, calibBeta - beta));
}
