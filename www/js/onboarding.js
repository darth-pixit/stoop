// First-run setup: meet the app, feel the physics, grant sensors, calibrate,
// baseline flexibility test, pick a check-in day.
import * as sensors from './sensors.js';
import * as store from './store.js';
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

  const steps = [stepWelcome, stepPhysics, stepCalibrate, stepFlex, stepSchedule, stepReady];

  function go(n) {
    stopAnim?.(); stopAnim = null;
    step = Math.max(0, Math.min(steps.length - 1, n));
    rootEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'ob-step';
    wrap.innerHTML = `<div class="ob-dots">${steps.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>`;
    rootEl.appendChild(wrap);
    steps[step](wrap);
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
  }

  // 1 ── welcome
  function stepWelcome(wrap) {
    wrap.insertAdjacentHTML('beforeend', `
      <div class="ob-art" id="ob-art"></div>
      <h1>Meet <span class="accent">stoop.</span></h1>
      <p class="lead">Your phone knows exactly how far you're hunching over it. Stoop turns that into a friendly little coach — live strain readouts, playful nudges, and stretches that actually stick.</p>
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
      <p class="lead" id="ob-kg-line">…until you tilt it. At 60° of scroll-slump your neck is holding <b>27 kg</b> — like ${equivalentFor(27)} hanging off your spine. All day.</p>
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
      <p class="lead">I compare every scroll to this hold — so the angle you see is <em>your</em> slump, not a generic one.</p>
      <div id="ob-cal-zone"></div>
    `);
    const zone = wrap.querySelector('#ob-cal-zone');
    const btnWrap = document.createElement('div');
    btnWrap.innerHTML = '<button class="btn primary block">🎛️ Enable motion sensors</button>';
    zone.appendChild(btnWrap);
    btnWrap.querySelector('button').addEventListener('click', async () => {
      const ok = await sensors.requestPermission();
      sensors.start();
      if (!ok) toast('No worries — you can grant it later in Settings');
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      btnWrap.remove();
      calibrationWidget(zone, (beta) => {
        toast(`Calibrated at ${Math.round(beta)}° — that's your happy place 🌤️`);
        go(3);
      });
    });
    foot(wrap, { next: 'Skip for now', onNext: () => go(3), skip: null });
    // make the primary foot button a quiet skip on this step
    const footBtn = wrap.querySelector('.ob-foot .btn');
    footBtn.className = 'ob-skip';
    footBtn.textContent = 'Skip — use the default hold';
  }

  // 4 ── baseline flexibility
  function stepFlex(wrap) {
    wrap.insertAdjacentHTML('beforeend', `
      <h1>How bendy are you <span class="accent">today?</span></h1>
      <p class="lead">A 60-second ear-to-shoulder test sets your baseline. Your front camera measures the real tilt of your head — and keeps you honest about that shoulder. We re-test weekly and you watch the number grow. 🌱</p>
      <div id="ob-flex-slot"></div>
    `);
    const slot = wrap.querySelector('#ob-flex-slot');
    const kick = document.createElement('button');
    kick.className = 'btn primary block';
    kick.textContent = '📸 Take the baseline test';
    slot.appendChild(kick);
    kick.addEventListener('click', () => {
      kick.remove();
      const stage = document.createElement('div');
      slot.appendChild(stage);
      startTest({
        embedded: stage,
        onDone: () => { flexDone = true; go(4); },
      });
    });
    foot(wrap, { next: flexDone ? 'Continue' : 'Skip — test me later', onNext: () => go(4) });
    wrap.querySelector('.ob-foot .btn').classList.replace('coral', 'ghost');
  }

  // 5 ── weekly check-in
  function stepSchedule(wrap) {
    const s = store.get();
    wrap.insertAdjacentHTML('beforeend', `
      <h1>Pick your <span class="accent">check-in</span> day</h1>
      <p class="lead">Once a week Stoop asks for a fresh bend test and a round of moves. Small, regular, kind — like flossing for your neck.</p>
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
      <p class="lead">Keep Stoop open while you scroll and it watches your angle live. The browser can't peek from the background — that superpower needs the (future) native app.</p>
      <label class="ob-check-row" style="cursor:pointer">
        <input type="checkbox" id="ob-sample" style="width:20px;height:20px;accent-color:var(--coral)">
        <span><b>Preview with sample data</b><br><small style="color:var(--ink-3)">See three weeks of pretend history — clearly marked, one tap to clear.</small></span>
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
