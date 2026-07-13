// The "Now" view: live neck-angle monitor, animated side profile,
// strain readout, live pill + system notification while stooping.
import * as sensors from './sensors.js';
import * as store from './store.js';
import * as notify from './notify.js';
import { strainKg, zoneFor, equivalentFor, STOOP_ENTER, STOOP_EXIT } from './strain.js';
import { CONTEXTS, createContextTracker, createLatch } from './context.js';
import { createSideFigure } from './figure.js';
import { calibrationWidget } from './calibrate.js';
import { sheet, toast } from './ui.js';

let figure = null;
let smoothed = 0;
let monitoring = true;
let lastSampleTs = null;
let stoopStartedAt = null;     // sustained-stoop timer for notifications
let lastNotifyAt = -Infinity;  // -Infinity, not 0: page-load must not count as "just notified"
let unsubscribe = null;
let rafPending = false;
let notifGranted = false;      // cached; refreshed on render + after permission asks

// Context gate: is this sample judgable posture at all, or is the user lying
// down / on the move / phone parked flat? Unjudgable time is logged separately
// and never credited as upright.
const tracker = createContextTracker();
const stoopLatch = createLatch(STOOP_ENTER, STOOP_EXIT);
let currentCtx = CONTEXTS.judgable;
let wasJudgable = true;
let overheadStartedAt = null;  // sustained lying-back timer for the bed nudge
let bedNudgedThisLie = false;

const $ = (sel) => document.querySelector(sel);

export function render(root) {
  root.innerHTML = `
    <div class="card stage-card">
      <div class="halo"></div>
      <h2 style="position:relative">Right now</h2>
      <p class="sub" style="position:relative">Keep Stoop open while you scroll — it reads your phone's angle live.</p>
      <div class="figure-stage" id="fig-stage"></div>
      <div class="angle-readout">
        <div class="angle-big"><span id="angle-num">–</span><span class="deg">°</span></div>
        <div class="zone-tag" id="zone-tag">reading…</div>
        <div class="strain-line" id="strain-line"></div>
        <button class="chip calib-chip hidden" id="btn-calibrate">🎯 Uncalibrated — teach me your good hold</button>
      </div>
      <div class="monitor-row">
        <button class="btn primary" id="btn-monitor">⏸ Pause watching</button>
      </div>
      <div class="sim-strip hidden" id="sim-strip">
        <label>🖥️ No motion sensors here — drag to preview the slump</label>
        <input type="range" id="sim-range" min="0" max="70" value="0" step="1" aria-label="Simulated neck angle">
      </div>
    </div>

    <p class="eyebrow">Today so far</p>
    <div class="mini-stats">
      <div class="mini-stat"><div class="v" id="ms-stoop">0m</div><div class="k">stooping</div></div>
      <div class="mini-stat"><div class="v" id="ms-phone">0m</div><div class="k">on phone</div></div>
      <div class="mini-stat"><div class="v" id="ms-pct">–</div><div class="k">stoop share</div></div>
    </div>
  `;

  figure = createSideFigure($('#fig-stage'));

  $('#btn-monitor').addEventListener('click', toggleMonitoring);
  const sim = $('#sim-range');
  sim.value = sensors.getSimAngle(); // stay in step with other views' sim sliders
  sim.addEventListener('input', (e) => sensors.setSimAngle(+e.target.value));
  if (!monitoring) $('#btn-monitor').textContent = '▶️ Resume watching';

  $('#btn-calibrate').addEventListener('click', () => {
    let cleanup = () => {};
    const sh = sheet(`
      <div class="sheet-head"><h3>🎯 Calibrate</h3><button class="btn ghost small" data-close>Cancel</button></div>
      <div id="cal-zone" style="margin-top:8px"></div>
    `, { onClose: () => cleanup() });
    cleanup = calibrationWidget(
      sh.el.querySelector('#cal-zone'),
      (beta) => { sh.close(); toast(`Calibrated at ${Math.round(beta)}° 🌤️`); $('#btn-calibrate')?.classList.add('hidden'); },
      () => { sh.close(); toast('Didn\'t catch a reading — check motion access and try again'); },
    );
  });

  if (!unsubscribe) unsubscribe = sensors.subscribe(onReading);
  sensors.start();
  notify.granted().then((v) => { notifGranted = v; });
  setTimeout(() => {
    if (sensors.isSimulated()) $('#sim-strip')?.classList.remove('hidden');
    else if (!store.get().calibrated) $('#btn-calibrate')?.classList.remove('hidden');
  }, 1700);

  updateMiniStats();
}

function toggleMonitoring() {
  monitoring = !monitoring;
  lastSampleTs = null;
  stoopStartedAt = null;
  stoopLatch.reset();
  overheadStartedAt = null;
  bedNudgedThisLie = false;
  const btn = $('#btn-monitor');
  if (btn) btn.textContent = monitoring ? '⏸ Pause watching' : '▶️ Resume watching';
  if (!monitoring) { hideLivePill(); closeNotification(); } // don't leave a stale "you're stooping" notice up
  toast(monitoring ? 'Watching your angle 👀' : 'Paused — enjoy the slouch 😴');
}

function onReading(r) {
  const settings = store.get();
  // The simulator emits constant, jitter-free readings that would classify as
  // "resting flat" — bypass the tracker so the sim slider keeps working.
  const ctx = r.simulated ? CONTEXTS.judgable : tracker.update(r, r.ts);
  const neck = sensors.neckAngleFrom(r.beta, settings.calibBeta);
  const judgable = ctx.judgable && neck != null;
  // If the pitch guard band vetoes a nominally-judgable context, the phone is
  // tipped overhead/back — report that rather than a stale judged angle.
  currentCtx = judgable ? CONTEXTS.judgable : (ctx.judgable ? CONTEXTS.overhead : ctx);

  if (judgable) {
    if (!wasJudgable) smoothed = neck; // snap past EMA lag when judging resumes
    else smoothed += (neck - smoothed) * 0.18;
  }
  wasJudgable = judgable;

  accumulate(r.ts, judgable);
  maybeNotify(r.ts, judgable);
  maybeBedNudge(r.ts, ctx);

  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; paint(); });
  }
}

function accumulate(ts, judgable) {
  // Never record simulated (desktop demo) readings as real usage — they'd
  // pollute the day stats and get synced to the account.
  if (!monitoring || document.hidden || sensors.isSimulated()) { lastSampleTs = null; return; }
  if (lastSampleTs != null) {
    const dt = Math.min(1000, ts - lastSampleTs); // gaps cap at 1s so sleep doesn't inflate
    store.addSample(dt, judgable ? zoneFor(smoothed).id : 'unjudged');
  }
  lastSampleTs = ts;
}

function paint() {
  const num = $('#angle-num');
  if (!num) return; // view swapped out

  if (!currentCtx.judgable) {
    // Lying back / on the move / phone parked: be honest that we're not judging
    // rather than pretending this is upright time.
    num.textContent = '–';
    const tag = $('#zone-tag');
    tag.textContent = `${currentCtx.emoji} ${currentCtx.label}`;
    tag.style.background = 'var(--card-soft)';
    tag.style.color = 'var(--ink-2)';
    $('#strain-line').innerHTML = 'Not judging posture right now — carry on.';
    document.querySelector('.stage-card .halo')?.style.setProperty('--halo', 'var(--card-soft)');
    figure?.set({ angle: 0, zone: 'upright', kg: strainKg(0) });
    updateMiniStats();
    hideLivePill();
    return;
  }

  const angle = Math.round(smoothed);
  const zone = zoneFor(smoothed);
  const kg = strainKg(smoothed);

  num.textContent = angle;

  const tag = $('#zone-tag');
  tag.textContent = `${zone.emoji} ${zone.label}`;
  tag.style.background = zone.soft;
  tag.style.color = zone.hex;

  $('#strain-line').innerHTML = smoothed < 8
    ? `Neck feels just its own head — <b>${kg.toFixed(1)} kg</b>. Lovely. 🌤️`
    : `Your neck is carrying <b>${kg.toFixed(1)} kg</b> — like ${equivalentFor(kg)}.`;

  document.querySelector('.stage-card .halo')?.style.setProperty('--halo', zone.soft);
  figure?.set({ angle: smoothed, zone: zone.id, kg });

  updateMiniStats();
  updateLivePill(zone, angle, kg);
}

let msTimer = 0;
function updateMiniStats() {
  const now = performance.now();
  if (now - msTimer < 1000) return;
  msTimer = now;
  const rec = store.dayRecord();
  const s = $('#ms-stoop'); if (!s) return;
  s.textContent = store.fmtDur(rec.stoopMs);
  $('#ms-phone').textContent = store.fmtDur(rec.phoneMs);
  $('#ms-pct').textContent = rec.phoneMs > 30000 ? `${Math.round((rec.stoopMs / rec.phoneMs) * 100)}%` : '–';
}

// ── live pill + system notification ─────────────────────────────
const SUSTAIN_MS = 8000;    // stoop this long before we speak up
const RENOTIFY_MS = 20000;  // refresh cadence while still stooping

// Called after settings/onboarding ask for permission, so the cached flag
// doesn't lag behind until the next render.
export async function refreshNotifPermission() {
  notifGranted = await notify.granted();
  return notifGranted;
}

function meterFor(angle) {
  const filled = Math.min(6, Math.max(1, Math.round(angle / 12)));
  return '▮'.repeat(filled) + '▯'.repeat(6 - filled);
}

function maybeNotify(ts, judgable) {
  if (!monitoring) return;
  if (!judgable) { stoopLatch.reset(); stoopStartedAt = null; closeNotification(); hideLivePill(); return; }
  // Hysteresis: latch on at STOOP_ENTER, release only at STOOP_EXIT — a one-
  // sample dip below the threshold no longer resets the sustain timer.
  const stooping = stoopLatch.update(smoothed);
  if (!stooping) { stoopStartedAt = null; closeNotification(); hideLivePill(); return; }
  if (stoopStartedAt == null) stoopStartedAt = ts;
  if (ts - stoopStartedAt < SUSTAIN_MS) return;

  const settings = store.get();
  if (!settings.notifOn || !notifGranted) return;
  if (ts - lastNotifyAt < RENOTIFY_MS) return;
  lastNotifyAt = ts;

  const zone = zoneFor(smoothed);
  const kg = strainKg(smoothed);
  notify.showLive(
    `${zone.emoji} ${Math.round(smoothed)}° stoop — ${kg.toFixed(0)} kg on your neck`,
    `${meterFor(smoothed)}\nThat's like ${equivalentFor(kg)}. Lift your phone to eye level 👆`,
  );
  notified = true;
}

let notified = false;
function closeNotification() {
  if (!notified) return;
  notified = false;
  notify.closeLive();
}

// One gentle heads-up per lying-down session once scrolling on your back has
// gone on a while. Neck-neutral, so it's soft — and never repeated until the
// user actually gets up (context leaves `overhead`).
const BED_SUSTAIN_MS = 10 * 60000;

function maybeBedNudge(ts, ctx) {
  if (ctx.id !== 'overhead' || !monitoring) {
    overheadStartedAt = null;
    bedNudgedThisLie = false;
    return;
  }
  if (overheadStartedAt == null) overheadStartedAt = ts;
  if (bedNudgedThisLie || ts - overheadStartedAt < BED_SUSTAIN_MS) return;

  const settings = store.get();
  if (!settings.notifOn || !notifGranted) return;
  bedNudgedThisLie = true;
  notify.showBed(
    '🛏️ Been scrolling on your back for a while',
    'Your neck is fine down there — just so you know Stoop isn\'t counting this as good posture 😴',
  );
}

function updateLivePill(zone, angle, kg) {
  const pill = document.getElementById('live-pill');
  const onNowTab = !document.getElementById('view-now').classList.contains('hidden');
  const stoopingLong = stoopStartedAt != null && performance.now() - stoopStartedAt > SUSTAIN_MS;
  if (!monitoring || onNowTab || !stoopingLong || !stoopLatch.get()) { hideLivePill(); return; }
  pill.innerHTML = `<span class="pulse"></span> ${zone.emoji} ${angle}° · ${kg.toFixed(0)} kg on your neck`;
  pill.classList.remove('hidden');
}

function hideLivePill() {
  document.getElementById('live-pill')?.classList.add('hidden');
}

export function isMonitoring() { return monitoring; }
export function currentAngle() { return smoothed; }
