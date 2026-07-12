// First-run setup: meet the app, feel the physics, grant sensors, calibrate,
// baseline flexibility test, pick a check-in day.
import * as sensors from './sensors.js';
import * as store from './store.js';
import * as pose from './pose.js';
import * as notify from './notify.js';
import { strainKg, zoneFor, equivalentFor } from './strain.js';
import { createSideFigure, addTicker } from './figure.js';
import { calibrationWidget } from './calibrate.js';
import { startTest } from './flex.js';
import { toast } from './ui.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function runOnboarding(rootEl, onFinish) {
  let step = 0;
  let stopAnim = null;
  let flexDone = false;
  let lastNav = -1000;

  const steps = [stepWelcome, stepPhysics, stepCalibrate, stepFlex, stepSchedule, stepReady];

  function go(n) {
    // One step per gesture: if the webview ever replays a burst of queued
    // taps (seen after the OAuth browser hand-back), don't let it blow
    // through permission/calibration screens invisibly. Replayed queues
    // dispatch within a few ms; deliberate fast taps stay above ~150ms.
    const now = performance.now();
    if (now - lastNav < 120) return;
    lastNav = now;

    stopAnim?.(); stopAnim = null;
    step = Math.max(0, Math.min(steps.length - 1, n));
    rootEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'ob-step';
    rootEl.appendChild(wrap);
    steps[step](wrap);
    // progress dots live at the bottom, just above the CTA
    const dots = document.createElement('div');
    dots.className = 'ob-dots';
    dots.innerHTML = steps.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('');
    const f = wrap.querySelector('.ob-foot');
    if (f) wrap.insertBefore(dots, f); else wrap.appendChild(dots);
    rootEl.scrollTop = 0;
  }

  function foot(wrap, { next = 'Continue', onNext, skip = null }) {
    const f = document.createElement('div');
    f.className = 'ob-foot';
    f.innerHTML = `
      <button class="btn coral block">${next}</button>
      ${skip ? `<button class="ob-skip">${skip}</button>` : ''}`;
    f.querySelector('.btn').addEventListener('click', onNext);
    f.querySelector('.ob-skip')?.addEventListener('click', () => go(step + 1));
    wrap.appendChild(f);
    return f;
  }

  // 1 ── welcome
  function stepWelcome(wrap) {
    wrap.insertAdjacentHTML('beforeend', `
      <div class="ob-art" id="ob-art"></div>
      <h1>Meet <span class="accent">stoop.</span></h1>
      <p class="lead">Your phone knows exactly how far you hunch over it.</p>
      <div class="ob-bullets">
        <span>📐 Live strain readout</span>
        <span>🔔 Playful nudges</span>
        <span>🤸 Stretches that stick</span>
      </div>
    `);
    const fig = createSideFigure(wrap.querySelector('#ob-art'), { showWeight: true });
    stopAnim = addTicker((t) => {
      const a = 27 + 27 * Math.sin(t * 0.9);
      fig.set({ angle: a, zone: zoneFor(a).id, kg: strainKg(a) });
    });
    foot(wrap, { next: "Let's fix my neck →", onNext: () => go(1) });
  }

  // 2 ── the physics
  function stepPhysics(wrap) {
    wrap.insertAdjacentHTML('beforeend', `
      <div class="ob-art" id="ob-art2"></div>
      <h1>Your head weighs <span class="accent">5 kg</span>…</h1>
      <p class="lead">…until you tilt it. At 60° your neck holds <b>27 kg</b> — like ${equivalentFor(27)}.</p>
    `);
    const fig = createSideFigure(wrap.querySelector('#ob-art2'), { showWeight: true });
    stopAnim = addTicker((t) => {
      const a = 30 + 30 * Math.sin(t * 0.7 - 1.5);
      fig.set({ angle: a, zone: zoneFor(a).id, kg: strainKg(a) });
    });
    foot(wrap, { next: 'Yikes. Continue', onNext: () => go(2) });
  }

  // 3 ── permissions + calibration
  function stepCalibrate(wrap) {
    wrap.insertAdjacentHTML('beforeend', `
      <h1>Teach me your <span class="accent">good</span> posture</h1>
      <p class="lead">Hold the phone like you're sitting tall — every scroll is compared to that.</p>
      <div id="ob-cal-zone"></div>
    `);
    const zone = wrap.querySelector('#ob-cal-zone');
    const f = foot(wrap, {
      next: '🎛️ Enable motion sensors',
      onNext: async () => {
        const ok = await sensors.requestPermission();
        sensors.start();
        if (!ok) toast('No worries — you can grant it later in Settings');
        notify.requestPermission().catch(() => {});
        f.querySelector('.btn').remove(); // the widget brings its own capture CTA
        calibrationWidget(zone, (beta) => {
          toast(`Calibrated at ${Math.round(beta)}° — that's your happy place 🌤️`);
          go(3);
        });
      },
      skip: 'Skip — use the default hold',
    });
  }

  // 4 ── baseline flexibility
  function stepFlex(wrap) {
    wrap.insertAdjacentHTML('beforeend', `
      <h1>How bendy are you <span class="accent">today?</span></h1>
      <p class="lead">A 60-second ear-to-shoulder test sets your baseline. The front camera keeps it honest.</p>
      <div id="ob-flex-slot"></div>
    `);
    pose.loadDetector().catch(() => {}); // warm the model while the user reads
    const slot = wrap.querySelector('#ob-flex-slot');
    const f = foot(wrap, {
      next: '📸 Take the baseline test',
      onNext: () => {
        f.querySelector('.btn').remove(); // the test brings its own actions
        const stage = document.createElement('div');
        slot.appendChild(stage);
        startTest({
          embedded: stage,
          onDone: () => { flexDone = true; go(4); },
        });
      },
      skip: flexDone ? null : 'Skip — test me later',
    });
  }

  // 5 ── weekly check-in
  function stepSchedule(wrap) {
    const s = store.get();
    wrap.insertAdjacentHTML('beforeend', `
      <h1>Pick your <span class="accent">check-in</span> day</h1>
      <p class="lead">Once a week, Stoop nudges you to re-test and stretch.</p>
      <div class="chip-row" style="justify-content:center" id="ob-days">
        ${WEEKDAYS.map((d, i) => `<button class="chip ${s.checkin.weekday === i ? 'active' : ''}" data-day="${i}">${d}</button>`).join('')}
      </div>
    `);
    wrap.querySelector('#ob-days').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      store.get().checkin.weekday = +chip.dataset.day;
      store.save();
      wrap.querySelector('#ob-days .active')?.classList.remove('active');
      chip.classList.add('active');
    });
    foot(wrap, { next: 'Lock it in 📅', onNext: () => go(5) });
  }

  // 6 ── ready
  function stepReady(wrap) {
    wrap.insertAdjacentHTML('beforeend', `
      <div class="ob-art" style="font-size:76px">🎉</div>
      <h1>You're all set</h1>
      <p class="lead">Keep Stoop open while you scroll — it reads your angle live.</p>
      <label class="ob-check-row" style="cursor:pointer">
        <input type="checkbox" id="ob-sample" style="width:20px;height:20px;accent-color:var(--coral)">
        <span><b>Preview with sample data</b><br><small style="color:var(--ink-3)">Three weeks of pretend history — one tap to clear.</small></span>
      </label>
    `);
    foot(wrap, {
      next: 'Open stoop. →',
      onNext: () => {
        if (wrap.querySelector('#ob-sample').checked) store.seedSampleData();
        store.set({ setupDone: true });
        onFinish();
      },
    });
  }

  go(0);
}
