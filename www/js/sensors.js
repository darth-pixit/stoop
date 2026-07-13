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
  beta: null,          // phone pitch: 0 flat on table → 90 upright
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

// First real event: retire the simulator if it beat us to it (its interval
// would otherwise keep overwriting genuine readings forever).
function markLive() {
  if (sensorsSeen && !simulated) return;
  sensorsSeen = true;
  stopSimulation();
  emitStatus();
}

function onOrientation(e) {
  if (e.beta == null) return;
  markLive();
  reading.beta = e.beta;
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
// the enable button; everything else has no usable sensors — simulate.
function armFallback() {
  clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(() => {
    if (!running || sensorsSeen || simulated) return;
    if (needsPermissionGate() && permission !== 'granted') emitStatus();
    else startSimulation();
  }, 1500);
}

export function start() {
  if (running) return;
  running = true;
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  armFallback();
}

export function stop() {
  running = false;
  window.removeEventListener('deviceorientation', onOrientation);
  window.removeEventListener('devicemotion', onMotion);
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
