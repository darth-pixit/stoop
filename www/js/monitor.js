// The "Now" view: live neck-angle monitor, animated side profile,
// strain readout, live pill + system notification while stooping.
import * as sensors from './sensors.js';
import * as store from './store.js';
import * as notify from './notify.js';
import { strainKg, zoneFor, equivalentFor, STOOP_THRESHOLD } from './strain.js';
import { createSideFigure } from './figure.js';
import { calibrationWidget } from './calibrate.js';
import { sheet, toast } from './ui.js';

let figure = null;
let smoothed = 0;
let monitoring = true;
let lastSampleTs = null;
let stoopStartedAt = null;     // sustained-stoop timer for notifications
let lastNotifyAt = 0;
let unsubscribe = null;
let rafPending = false;
let notifGranted = false;      // cached; refreshed on render + after permission asks
let resting = false;           // phone motionless → it's on a table, not a neck
const restBuf = [];            // rolling {t, beta} to detect the motionless phone

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
    const sh = sheet(`
      <div class="sheet-head"><h3>🎯 Calibrate</h3><button class="btn ghost small" data-close>Cancel</button></div>
      <div id="cal-zone" style="margin-top:8px"></div>
    `);
    calibrationWidget(sh.el.querySelector('#cal-zone'), (beta) => {
      sh.close();
      toast(`Calibrated at ${Math.round(beta)}° 🌤️`);
      $('#btn-calibrate')?.classList.add('hidden');
    });
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
  const btn = $('#btn-monitor');
  if (btn) btn.textContent = monitoring ? '⏸ Pause watching' : '▶️ Resume watching';
  if (!monitoring) hideLivePill();
  toast(monitoring ? 'Watching your angle 👀' : 'Paused — enjoy the slouch 😴');
}

// A phone that is essentially motionless for a few seconds is lying on a
// table or stand — not being held over a neck. Hands always jitter a little,
// so near-zero pitch variance is a reliable "at rest" signal. (Never true in
// sim mode: the simulator emits perfectly constant values by design.)
const REST_WINDOW_MS = 8000;
const REST_MIN_SPAN_MS = 5000;
const REST_MAX_WOBBLE = 0.8; // ° of beta range that still counts as "still"

function updateResting(r) {
  if (r.simulated || r.beta == null) { resting = false; restBuf.length = 0; return; }
  restBuf.push({ t: r.ts, b: r.beta });
  while (restBuf.length && r.ts - restBuf[0].t > REST_WINDOW_MS) restBuf.shift();
  if (r.ts - restBuf[0].t < REST_MIN_SPAN_MS) { resting = false; return; }
  let min = Infinity, max = -Infinity;
  for (const s of restBuf) { if (s.b < min) min = s.b; if (s.b > max) max = s.b; }
  resting = max - min < REST_MAX_WOBBLE;
}

function onReading(r) {
  const settings = store.get();
  updateResting(r);
  if (resting) {
    stoopStartedAt = null;
    lastSampleTs = null;
    closeNotification();
    hideLivePill();
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; paintResting(); });
    }
    return;
  }
  const neck = sensors.neckAngleFrom(r.beta, settings.calibBeta);
  if (neck == null) return;
  smoothed += (neck - smoothed) * 0.18;

  accumulate(r.ts);
  maybeNotify(r.ts);

  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; paint(); });
  }
}

function paintResting() {
  const num = $('#angle-num');
  if (!num) return;
  num.textContent = '–';
  const tag = $('#zone-tag');
  tag.textContent = '😴 Phone at rest';
  tag.style.background = 'var(--lilac-soft)';
  tag.style.color = 'var(--lilac)';
  $('#strain-line').innerHTML = 'Pick your phone up and I\'ll read your angle.';
  figure?.set({ angle: 0, zone: 'upright', kg: null });
}

function accumulate(ts) {
  if (!monitoring || document.hidden) { lastSampleTs = null; return; }
  if (lastSampleTs != null) {
    const dt = Math.min(1000, ts - lastSampleTs); // gaps cap at 1s so sleep doesn't inflate
    store.addSample(dt, zoneFor(smoothed).id);
  }
  lastSampleTs = ts;
}

function paint() {
  const angle = Math.round(smoothed);
  const zone = zoneFor(smoothed);
  const kg = strainKg(smoothed);

  const num = $('#angle-num');
  if (!num) return; // view swapped out
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

function maybeNotify(ts) {
  if (!monitoring) return;
  const stooping = smoothed >= STOOP_THRESHOLD;
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

function updateLivePill(zone, angle, kg) {
  const pill = document.getElementById('live-pill');
  const onNowTab = !document.getElementById('view-now').classList.contains('hidden');
  const stoopingLong = stoopStartedAt != null && performance.now() - stoopStartedAt > SUSTAIN_MS;
  if (!monitoring || onNowTab || !stoopingLong || angle < STOOP_THRESHOLD) { hideLivePill(); return; }
  pill.innerHTML = `<span class="pulse"></span> ${zone.emoji} ${angle}° · ${kg.toFixed(0)} kg on your neck`;
  pill.classList.remove('hidden');
}

function hideLivePill() {
  document.getElementById('live-pill')?.classList.add('hidden');
}

export function isMonitoring() { return monitoring; }
export function currentAngle() { return smoothed; }
