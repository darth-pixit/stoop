// Posture calibration: capture the phone pitch the user holds with
// deliberately good posture. Used in onboarding and settings.
import * as sensors from './sensors.js';
import * as store from './store.js';
import { upFromOrientation, poseAngles } from './context.js';

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Renders into `container`; calls onDone(calibBeta) after a successful capture,
// or onFail() if the capture window collected no readings (e.g. permission
// denied). Returns a cleanup() the caller MUST invoke on dismissal — it cancels
// a pending capture and removes the sensor listeners.
export function calibrationWidget(container, onDone, onFail) {
  container.innerHTML = `
    <div class="ob-check-row"><span class="emo">🪑</span><span>Sit or stand tall — ears stacked over shoulders.</span></div>
    <div class="ob-check-row"><span class="emo">📱</span><span>Raise the phone until it's comfortably near eye level. That's your "good" hold.</span></div>
    <div class="cal-readout"><span data-cal-live>–</span><span style="font-size:22px;color:var(--ink-3)">° pitch</span></div>
    <button class="btn primary block" data-cal-btn>📸 Capture my good posture</button>
  `;
  const live = container.querySelector('[data-cal-live]');
  const btn = container.querySelector('[data-cal-btn]');

  sensors.start();
  let done = false;
  let captureTimer = null;
  let collect = null;
  const unsub = sensors.subscribe((r) => {
    if (r.beta != null && live.isConnected) live.textContent = Math.round(r.beta);
  });

  function cleanup() {
    if (done) return;
    done = true;
    clearTimeout(captureTimer);
    collect?.();
    unsub();
  }

  btn.addEventListener('click', () => {
    if (done || captureTimer) return;
    btn.disabled = true;
    btn.textContent = 'Hold it… 📸';
    const samples = [];
    const tilts = [];   // screenTilt per sample, for the lying/flat sanity gate
    const sides = [];   // |sideTilt| per sample
    collect = sensors.subscribe((r) => {
      if (r.beta == null) return;
      samples.push(r.beta);
      const up = upFromOrientation(r.beta, r.gamma);
      if (up) {
        const p = poseAngles(up);
        tilts.push(p.screenTilt);
        sides.push(Math.abs(p.sideTilt));
      }
    });
    captureTimer = setTimeout(() => {
      captureTimer = null;
      collect?.(); collect = null;

      // You can't capture "good posture" lying on your back, with the phone
      // nearly flat, or on its side — that baseline would poison every later
      // judgement. (Skipped when gamma is unavailable; the clamp below still
      // keeps the baseline sane.)
      const tilt = median(tilts);
      const side = median(sides);
      if (tilt != null && (tilt > 100 || tilt < 30 || side > 30)) {
        btn.disabled = false;
        btn.textContent = '📸 Capture my good posture';
        live.textContent = '–';
        let hint = container.querySelector('[data-cal-hint]');
        if (!hint) {
          hint = document.createElement('p');
          hint.setAttribute('data-cal-hint', '');
          hint.style.cssText = 'color:var(--ink-2);font-size:13.5px;margin:10px 2px 0';
          btn.insertAdjacentElement('afterend', hint);
        }
        hint.textContent = 'Sit or stand upright and hold the phone near eye level, then try again 🙂';
        return; // keep the live readout running for another attempt
      }

      if (!samples.length) {
        // No readings landed — report failure instead of silently "succeeding"
        // at the existing default hold.
        btn.disabled = false;
        btn.textContent = '📸 Capture my good posture';
        done = true;
        unsub();
        onFail?.();
        return;
      }
      done = true;
      unsub();
      const avg = samples.reduce((a, v) => a + v, 0) / samples.length;
      // clamp to a sane hold — nobody's "good posture" is a phone flat on a table
      const calibBeta = Math.min(95, Math.max(45, avg));
      store.set({ calibBeta, calibrated: true });
      onDone(calibBeta);
    }, 1300);
  });

  return cleanup;
}
