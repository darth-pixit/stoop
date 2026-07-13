// Stats view: today's stooping, normalized trend with improving/worsening
// verdict, zone breakdown, and the "what it does to your mobility" section.
import * as store from './store.js';
import { ZONES, IMPACT_FACTS, strainKg, zoneFor, equivalentFor } from './strain.js';
import { lineChart } from './charts.js';
import { createSideFigure } from './figure.js';

const $ = (sel) => document.querySelector(sel);
let impactFigure = null;

export function render(root) {
  root.innerHTML = `
    <p class="eyebrow">Today</p>
    <div class="card">
      <div class="stat-hero">
        <div>
          <div class="big" id="st-today">–</div>
          <div class="unit">spent stooping today</div>
        </div>
        <div id="st-delta"></div>
      </div>
      <p class="sub" style="margin-top:12px" id="st-context"></p>
    </div>

    <p class="eyebrow">The trend</p>
    <div class="card">
      <div class="sheet-head" style="margin-bottom:0">
        <h2>Stoop share of phone time</h2>
      </div>
      <p class="sub">% of monitored phone time spent at 15°+ — normalised, so a heavy-scrolling day can't fake progress.</p>
      <div id="st-verdict"></div>
      <div class="viz" id="trend-chart"></div>
    </div>

    <p class="eyebrow">Where your neck lived</p>
    <div class="card">
      <div class="sheet-head" style="margin-bottom:8px">
        <h2>Stooping by zone</h2>
        <div class="seg" id="zone-seg">
          <button data-range="1" class="active">Today</button>
          <button data-range="7">7 days</button>
        </div>
      </div>
      <div class="zone-rows" id="zone-rows"></div>
    </div>

    <p class="eyebrow">Why it matters</p>
    <div class="card soft">
      <h2>Your angle vs your mobility</h2>
      <p class="sub">Drag the slider — see what each degree of slump costs your neck, live.</p>
      <div class="impact-scrub">
        <input type="range" id="impact-range" min="0" max="60" value="30" step="1" aria-label="Explore a neck angle">
      </div>
      <div class="impact-grid">
        <div id="impact-fig"></div>
        <div>
          <div class="impact-fact" id="impact-fact"></div>
        </div>
      </div>
      <div class="impact-meter">
        <div class="im-track"><div class="im-fill" id="impact-fill"></div></div>
        <div class="im-cap"><span>mobility intact</span><span>stiff &amp; creaky</span></div>
      </div>
    </div>
  `;

  renderToday();
  renderTrend();
  renderZones(1);
  renderImpact();

  $('#zone-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    $('#zone-seg .active')?.classList.remove('active');
    btn.classList.add('active');
    renderZones(+btn.dataset.range);
  });
}

// ── today hero ──────────────────────────────────────────────────
function renderToday() {
  const days = store.lastDays(8);
  const today = days[days.length - 1];
  $('#st-today').textContent = store.fmtDur(today.stoopMs);

  const pct = today.phoneMs > 30000 ? today.stoopMs / today.phoneMs : null;
  const prior = days.slice(0, 7).filter((d) => d.phoneMs > 60000);
  const priorPct = prior.length
    ? prior.reduce((a, d) => a + d.stoopMs / d.phoneMs, 0) / prior.length
    : null;

  let badge = '<span class="delta-badge flat">gathering data…</span>';
  if (pct != null && priorPct != null) {
    const diff = Math.round((pct - priorPct) * 100);
    if (diff <= -3) badge = `<span class="delta-badge good">▼ ${-diff} pts vs your week — nice! 🎉</span>`;
    else if (diff >= 3) badge = `<span class="delta-badge bad">▲ ${diff} pts vs your week</span>`;
    else badge = '<span class="delta-badge flat">≈ on par with your week</span>';
  }
  $('#st-delta').innerHTML = badge;

  let context = pct != null
    ? `That's ${Math.round(pct * 100)}% of the ${store.fmtDur(today.phoneMs)} you've been on your phone with Stoop watching.`
    : 'Keep Stoop open while you use your phone and today\'s picture will fill in.';
  if ((today.unjudgedMs || 0) > 5 * 60000) {
    context += ` Stoop skipped judging for ${store.fmtDur(today.unjudgedMs)} (lying down, moving, or phone resting flat).`;
  }
  $('#st-context').textContent = context;
}

// ── trend ───────────────────────────────────────────────────────
function renderTrend() {
  const days = store.lastDays(14);
  const points = days.map((d) => ({
    v: d.phoneMs > 60000 ? Math.round((d.stoopMs / d.phoneMs) * 100) : null,
    label: d.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    sub: d.phoneMs > 60000 ? `${store.fmtDur(d.stoopMs)} of ${store.fmtDur(d.phoneMs)}` : null,
  }));

  const withData = points.map((p, i) => [p.v, i]).filter(([v]) => v != null);
  let verdict = `<span class="delta-badge flat">📊 Log a few more days to unlock your trend</span>`;
  if (withData.length >= 4) {
    const slope = regressionSlope(withData.map(([v, i]) => [i, v]));
    const perWeek = slope * 7;
    if (perWeek <= -2) verdict = `<span class="delta-badge good">📉 Improving — about ${Math.abs(perWeek).toFixed(0)} pts less stooping per week</span>`;
    else if (perWeek >= 2) verdict = `<span class="delta-badge bad">📈 Creeping up — ${perWeek.toFixed(0)} pts more per week. Time for some Moves?</span>`;
    else verdict = `<span class="delta-badge flat">➡️ Holding steady</span>`;
  }
  $('#st-verdict').innerHTML = verdict;

  lineChart($('#trend-chart'), {
    series: [{ name: 'Stoop share', color: '#0E8F82', points }],
    xTicks: days.map((d, i) => (i % 2 === 0 ? store.fmtDayShort(d.date) : null)),
    yFmt: (v) => `${v}%`,
    yMax: Math.max(60, ...points.map((p) => p.v ?? 0)) * 1.1,
  });
}

function regressionSlope(pairs) {
  const n = pairs.length;
  const sx = pairs.reduce((a, [x]) => a + x, 0);
  const sy = pairs.reduce((a, [, y]) => a + y, 0);
  const sxy = pairs.reduce((a, [x, y]) => a + x * y, 0);
  const sxx = pairs.reduce((a, [x]) => a + x * x, 0);
  const denom = n * sxx - sx * sx;
  return denom ? (n * sxy - sx * sy) / denom : 0;
}

// ── zones ───────────────────────────────────────────────────────
function renderZones(rangeDays) {
  const days = store.lastDays(rangeDays);
  const totals = { upright: 0, mild: 0, moderate: 0, severe: 0 };
  let phone = 0;
  for (const d of days) {
    phone += d.phoneMs;
    totals.mild += d.zoneMs.mild || 0;
    totals.moderate += d.zoneMs.moderate || 0;
    totals.severe += d.zoneMs.severe || 0;
  }
  totals.upright = Math.max(0, phone - totals.mild - totals.moderate - totals.severe);
  const max = Math.max(1, ...Object.values(totals));

  $('#zone-rows').innerHTML = ZONES.map((z) => {
    const ms = totals[z.id];
    return `
      <div class="zone-row">
        <div class="zr-label">
          <span class="zone-dot" style="background:${z.hex}"></span>
          <span>${z.emoji} ${z.label}<small>${z.range}</small></span>
        </div>
        <div class="zr-track"><div class="zr-fill" style="width:0%; background:${z.hex}"></div></div>
        <div class="zr-val">${store.fmtDur(ms)}</div>
      </div>`;
  }).join('');

  // let layout settle so the width transition animates in
  requestAnimationFrame(() => {
    document.querySelectorAll('#zone-rows .zr-fill').forEach((fill, i) => {
      fill.style.width = `${(totals[ZONES[i].id] / max) * 100}%`;
    });
  });
}

// ── mobility impact ─────────────────────────────────────────────
function renderImpact() {
  impactFigure = createSideFigure($('#impact-fig'), { showWeight: true, showArc: false });
  const range = $('#impact-range');
  const update = () => {
    const angle = +range.value;
    const zone = zoneFor(angle);
    const fact = IMPACT_FACTS[zone.id];
    const kg = strainKg(angle);
    impactFigure.set({ angle, zone: zone.id, kg });
    $('#impact-fact').style.background = zone.soft;
    $('#impact-fact').innerHTML = `
      <b>${zone.emoji} ${fact.title}</b> · ${kg.toFixed(1)} kg — ${equivalentFor(kg)}<br>
      ${fact.body}<br><em style="color:var(--ink-2)">${fact.mobility}</em>`;
    const fill = $('#impact-fill');
    fill.style.width = `${fact.pct}%`;
    fill.style.background = zone.hex;
  };
  range.addEventListener('input', update);
  update();
}
