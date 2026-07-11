// Posture calibration: capture the phone pitch the user holds with
// deliberately good posture. Used in onboarding and settings.
import * as sensors from './sensors.js';
import * as store from './store.js';

// Renders into `container`; calls onDone(calibBeta) after capture.
export function calibrationWidget(container, onDone) {
  container.innerHTML = `
    <div class="ob-check-row"><span class="emo">🪑</span><span>Sit or stand tall — ears stacked over shoulders.</span></div>
    <div class="ob-check-row"><span class="emo">📱</span><span>Raise the phone until it's comfortably near eye level. That's your "good" hold.</span></div>
    <div class="cal-readout"><span data-cal-live>–</span><span style="font-size:22px;color:var(--ink-3)">° pitch</span></div>
    <button class="btn primary block" data-cal-btn>📸 Capture my good posture</button>
  `;
  const live = container.querySelector('[data-cal-live]');
  const btn = container.querySelector('[data-cal-btn]');

  sensors.start();
  const unsub = sensors.subscribe((r) => {
    if (r.beta != null && live.isConnected) live.textContent = Math.round(r.beta);
  });

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Hold it… 📸';
    const samples = [];
    const collect = sensors.subscribe((r) => { if (r.beta != null) samples.push(r.beta); });
    setTimeout(() => {
      collect();
      unsub();
      const avg = samples.length
        ? samples.reduce((a, v) => a + v, 0) / samples.length
        : store.get().calibBeta;
      // clamp to a sane hold — nobody's "good posture" is a phone flat on a table
      const calibBeta = Math.min(95, Math.max(45, avg));
      store.set({ calibBeta });
      onDone(calibBeta);
    }, 1300);
  });

  return () => unsub();
}
