// Bend view: ear-to-shoulder flexibility test with live annotations and
// form nudges, flexibility history, and the weekly check-in schedule.
import * as sensors from './sensors.js';
import * as store from './store.js';
import { lineChart } from './charts.js';
import { createFrontFigure } from './figure.js';
import { sheet, toast } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const $ = (sel) => document.querySelector(sel);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function render(root) {
  const s = store.get();
  const last = s.flexLogs[s.flexLogs.length - 1];

  root.innerHTML = `
    <p class="eyebrow">Bend</p>
    ${store.checkinDue() ? `
      <div class="checkin-banner">
        <div style="font-size:28px">📅</div>
        <div class="cb-txt"><b>Weekly check-in time!</b>Take your ear-to-shoulder test and see if the moves are paying off.</div>
        <button class="btn" id="cb-start">Go</button>
      </div>` : ''}

    <div class="card">
      <h2>Ear → shoulder test</h2>
      <p class="sub">Your side-bend range is the canary for phone-neck stiffness. Test any time — we log the angles for you.</p>
      ${last ? `
        <div class="result-split" style="margin-top:4px">
          <div class="result-side"><div class="rs-v" style="color:var(--series-flex-l)">${last.left}°</div><div class="rs-k">left tilt</div></div>
          <div class="result-side"><div class="rs-v" style="color:var(--series-flex-r)">${last.right}°</div><div class="rs-k">right tilt</div></div>
        </div>
        <p class="sub" style="margin:0 0 12px">Last tested ${new Date(last.iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${last.quality === 'retake' ? ' · 🙈 shoulder crept up — worth a redo' : ''}${asymmetryNote(last)}</p>
      ` : ''}
      <button class="btn coral block" id="btn-flex-test">📐 ${last ? 'Test again' : 'Take your first test'}</button>
    </div>

    <p class="eyebrow">Your flexibility over time</p>
    <div id="flex-history"></div>

    <p class="eyebrow">Weekly check-in</p>
    <div class="card">
      <h2>Scheduled nudge</h2>
      <p class="sub">Pick a day — Stoop will bug you (kindly) to re-test and do your moves.</p>
      <div class="chip-row" id="ci-days">
        ${WEEKDAYS.map((d, i) => `<button class="chip ${s.checkin.weekday === i ? 'active' : ''}" data-day="${i}">${d}</button>`).join('')}
      </div>
      <p class="sub" style="margin:12px 0 0" id="ci-next">${nextCheckinText()}</p>
    </div>
  `;

  renderHistory();

  $('#btn-flex-test').addEventListener('click', () => startTest());
  $('#cb-start')?.addEventListener('click', () => startTest());
  $('#ci-days').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    store.get().checkin.weekday = +chip.dataset.day;
    store.save();
    $('#ci-days .active')?.classList.remove('active');
    chip.classList.add('active');
    $('#ci-next').textContent = nextCheckinText();
    toast(`Check-ins on ${WEEKDAYS[+chip.dataset.day]}s 📅`);
  });
}

function asymmetryNote(log) {
  const diff = Math.abs(log.left - log.right);
  if (diff < 8) return '';
  const tighter = log.left < log.right ? 'left' : 'right';
  return ` · your ${tighter} side is ${diff}° tighter — give it extra love`;
}

function nextCheckinText() {
  const { weekday, hour } = store.get().checkin;
  if (store.checkinDue()) return '⏰ One is due right now, actually.';
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  let diff = (weekday - now.getDay() + 7) % 7;
  if (diff === 0 && next <= now) diff = 7;
  next.setDate(next.getDate() + diff);
  return `Next check-in: ${next.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} ✨`;
}

function renderHistory() {
  const logs = store.get().flexLogs;
  const box = $('#flex-history');
  if (logs.length < 2) {
    box.innerHTML = `<div class="empty-hint"><span class="emo">📈</span>${logs.length === 1 ? 'One test down — take another next week and your trend appears here.' : 'Take the test twice and your progress chart grows here.'}</div>`;
    return;
  }
  box.innerHTML = `
    <div class="card">
      <div class="viz" id="flex-chart"></div>
      <div class="legend">
        <span><span class="sw" style="background:var(--series-flex-l)"></span>Left tilt</span>
        <span><span class="sw" style="background:var(--series-flex-r)"></span>Right tilt</span>
      </div>
    </div>`;
  const recent = logs.slice(-10);
  const labels = recent.map((l) => new Date(l.iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  lineChart($('#flex-chart'), {
    series: [
      { name: 'Left', color: '#7C5CE0', points: recent.map((l, i) => ({ v: l.left, label: labels[i], sub: l.quality === 'retake' ? 'form wobble' : null })) },
      { name: 'Right', color: '#0E8F82', points: recent.map((l, i) => ({ v: l.right, label: labels[i], sub: l.quality === 'retake' ? 'form wobble' : null })) },
    ],
    xTicks: labels.map((l, i) => (recent.length > 5 && i % 2 ? null : l)),
    yFmt: (v) => `${v}°`,
    yMax: 60,
  });
}

// ═══════════════ the guided test ═══════════════
// Phases per side: position → baseline → tilt → locked. Then results.
export function startTest({ embedded = null, onDone = null } = {}) {
  const results = { right: null, left: null };
  let side = 'right';
  let phase = 'position';
  let baseline = 0;
  let maxTilt = 0;
  let plateauSince = null;
  let plateauMaxRef = 0;
  let phaseEnteredAt = performance.now();
  const buf = []; // rolling {t, tilt} for rate/stability checks
  let unsub = null;
  let closed = false;

  const inner = `
    <div class="sheet-head">
      <h3>📐 Ear → shoulder</h3>
      ${embedded ? '' : '<button class="btn ghost small" data-close>Close</button>'}
    </div>
    <div class="flex-phase-dots" id="fx-dots"><i class="on"></i><i></i><i></i><i></i></div>
    <div class="protractor-wrap" id="fx-stage"></div>
    <div class="flex-live-angle">
      <div class="fla-big"><span id="fx-angle">0</span>°</div>
      <div class="pc-sub" id="fx-side">Right side first</div>
    </div>
    <div class="nudge-bubble" id="fx-nudge">Hold your phone flat against your <b>right ear</b>, screen out — like a very slow phone call 📞</div>
    <div class="sim-strip ${sensors.isSimulated() ? '' : 'hidden'}" id="fx-sim">
      <label>🖥️ Simulating the tilt — drag slowly to "bend"</label>
      <input type="range" min="0" max="55" value="0" step="0.5" id="fx-sim-range">
    </div>
    <div class="monitor-row" id="fx-actions"></div>
  `;

  let panel, closeSheet;
  if (embedded) {
    embedded.innerHTML = `<div>${inner}</div>`;
    panel = embedded.firstElementChild;
    closeSheet = () => {};
  } else {
    const sh = sheet(inner, { onClose: () => teardown() });
    panel = sh.el;
    closeSheet = sh.close;
  }

  const q = (sel) => panel.querySelector(sel);
  const fig = createFrontFigure(q('#fx-stage'), { showEarShoulderDots: true });
  const anno = buildAnnotations(fig);

  q('#fx-sim-range')?.addEventListener('input', (e) => sensors.setSimAngle(+e.target.value));

  sensors.start();
  unsub = sensors.subscribe(onReading);
  // sim mode may only be detected ~1.5s after start(); reveal the slider then
  // and zero the sim so a slump left on the Now slider doesn't leak in
  if (sensors.isSimulated()) sensors.setSimAngle(0);
  setTimeout(() => {
    if (!closed && sensors.isSimulated()) {
      sensors.setSimAngle(+(q('#fx-sim-range')?.value ?? 0));
      q('#fx-sim')?.classList.remove('hidden');
    }
  }, 1800);

  function setPhase(p) {
    phase = p;
    phaseEnteredAt = performance.now();
    plateauSince = null;
    const idx = { position: 0, baseline: 1, tilt: 2, locked: 3 }[p];
    q('#fx-dots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= idx));
  }

  function nudge(text, cls = '') {
    const n = q('#fx-nudge');
    if (!n) return;
    n.className = `nudge-bubble ${cls}`;
    n.innerHTML = text;
  }

  function onReading(r) {
    if (closed) return;
    const now = performance.now();
    const rawTilt = r.tiltFromVertical;
    buf.push({ t: now, tilt: rawTilt, fwd: r.forwardness });
    while (buf.length && now - buf[0].t > 1000) buf.shift();

    const eff = Math.max(0, rawTilt - baseline);
    const shown = phase === 'tilt' || phase === 'locked' ? eff : rawTilt;
    q('#fx-angle').textContent = Math.round(phase === 'locked' ? maxTilt : shown);
    const dir = side === 'right' ? 1 : -1;
    fig.set({ tilt: dir * (phase === 'locked' ? maxTilt : eff), mood: eff > 12 ? 'effort' : 'happy' });
    anno.update(dir * (phase === 'locked' ? maxTilt : eff), dir * maxTilt);

    if (phase === 'position') stepPosition(rawTilt, now);
    else if (phase === 'baseline') stepBaseline(now);
    else if (phase === 'tilt') stepTilt(eff, r, now);
  }

  function stability() {
    if (buf.length < 4) return 99;
    const vals = buf.map((b) => b.tilt);
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  }

  function rate() {
    if (buf.length < 2) return 0;
    const a = buf[0], b = buf[buf.length - 1];
    return Math.abs(b.tilt - a.tilt) / Math.max(0.05, (b.t - a.t) / 1000);
  }

  function stepPosition(rawTilt, now) {
    if (now - phaseEnteredAt < 800) return;
    if (rawTilt > 14) {
      nudge('Start tall — imagine a string pulling the crown of your head up 🎈', 'warn');
      return;
    }
    if (stability() > 4 || rate() > 4) {
      nudge('Almost — hold still for a second so I can zero the protractor 🧘');
      return;
    }
    nudge('Perfect. Zeroing… don\'t move ✨', 'ok');
    setPhase('baseline');
  }

  function stepBaseline(now) {
    // a slow steady drift has low variance, so gate on velocity too
    if (stability() > 4 || rate() > 4) { setPhase('position'); return; }
    if (now - phaseEnteredAt < 1200) return;
    baseline = buf.reduce((a, b) => a + b.tilt, 0) / buf.length;
    maxTilt = 0;
    setPhase('tilt');
    nudge(`Now tip your <b>${side} ear</b> toward your shoulder — slow as honey 🍯. Shoulders stay heavy!`);
  }

  function stepTilt(eff, r, now) {
    if (eff > maxTilt) maxTilt = eff;

    // form rules, worst first — one nudge at a time so it stays friendly
    if (rate() > 40) { nudge('Whoa, slow down 🐢 — this is a stretch, not a headbang', 'warn'); plateauSince = null; return; }
    if (r.forwardness > 0.55 && eff > 8) { nudge('You\'re tipping forward — think <b>ear to shoulder</b>, not chin to chest 👂→🤷', 'warn'); return; }
    if (stability() > 7) { nudge('Keep the phone gently pressed to your ear 📱🤝👂', 'warn'); return; }
    if (now - phaseEnteredAt > 30000 && maxTilt < 10) {
      nudge('Hmm, barely moving. Phone snug against your ear? Let\'s reset and try again 🔄', 'warn');
      setPhase('position');
      return;
    }

    // plateau near personal max → lock the measurement after a steady hold.
    // The max must stop GROWING too, else a slow climb would lock early.
    if (maxTilt > 8 && eff > maxTilt - 3) {
      if (plateauSince == null || maxTilt > plateauMaxRef + 1.5) {
        plateauSince = now;
        plateauMaxRef = maxTilt;
      }
      const held = now - plateauSince;
      if (held > 1600) {
        lockSide();
      } else {
        nudge(`Hold it there… ${Math.ceil((1600 - held) / 500)} 🫸`, 'ok');
      }
    } else {
      plateauSince = null;
      if (eff > 4) nudge('Nice — keep sinking until you feel the far side wake up 🌊');
    }
  }

  function lockSide() {
    results[side] = Math.round(maxTilt);
    setPhase('locked');
    nudge(`${side === 'right' ? 'Right' : 'Left'} side: <b>${results[side]}°</b> — lovely bend! 🎉`, 'ok');
    const actions = q('#fx-actions');
    if (side === 'right') {
      actions.innerHTML = '<button class="btn primary block" id="fx-next">👈 Now the left side</button>';
      actions.querySelector('#fx-next').addEventListener('click', () => {
        side = 'left';
        maxTilt = 0;
        q('#fx-side').textContent = 'Left side';
        q('#fx-actions').innerHTML = '';
        q('#fx-sim-range') && (q('#fx-sim-range').value = 0, sensors.setSimAngle(0));
        setPhase('position');
        nudge('Swap: phone flat against your <b>left ear</b> now 📞');
      });
    } else {
      actions.innerHTML = '<button class="btn coral block" id="fx-done">See my results 🎊</button>';
      actions.querySelector('#fx-done').addEventListener('click', showResults);
    }
  }

  function showResults() {
    teardown();
    if (!embedded) closeSheet(); // drop the test sheet before the results sheet
    const honesty = `
      <div class="sheet-head"><h3>🎊 Your bend today</h3></div>
      <div class="result-split">
        <div class="result-side"><div class="rs-v" style="color:var(--series-flex-l)">${results.left}°</div><div class="rs-k">left tilt</div></div>
        <div class="result-side"><div class="rs-v" style="color:var(--series-flex-r)">${results.right}°</div><div class="rs-k">right tilt</div></div>
      </div>
      ${compareLine(results)}
      <p class="sub" style="margin-top:14px"><b>Quick honesty check 😇</b> — did a shoulder sneak up toward your ear?</p>
      <div class="honesty-check">
        <button class="chip" data-q="clean">🙅 Nope, shoulders stayed heavy</button>
        <button class="chip" data-q="retake">🙈 …it crept up a little</button>
      </div>
    `;
    const target = embedded || null;
    if (target) {
      target.innerHTML = `<div>${honesty}</div>`;
      wireHonesty(target, target.firstElementChild);
    } else {
      const sh = sheet(honesty);
      wireHonesty(null, sh.el, sh.close);
    }
  }

  function wireHonesty(embedTarget, el2, close2) {
    el2.querySelectorAll('[data-q]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const quality = chip.dataset.q;
        store.logFlex({ iso: new Date().toISOString(), left: results.left, right: results.right, quality });
        if (quality === 'retake') {
          toast('Logged with a form note — try pinning the shoulder down next time 📌');
        } else {
          toast('Logged clean. Your future neck thanks you 🙏');
        }
        close2?.();
        onDone?.(results);
        const view = document.getElementById('view-flex');
        if (!embedTarget && view && !view.classList.contains('hidden')) render(view);
      });
    });
  }

  function compareLine(res) {
    const logs = store.get().flexLogs;
    const prev = logs[logs.length - 1];
    if (!prev) return '<p class="sub">First entry in the book — this is your baseline 📖</p>';
    const d = Math.round((res.left + res.right) / 2 - (prev.left + prev.right) / 2);
    if (d >= 2) return `<p class="sub" style="color:#14712B;font-weight:700">▲ ${d}° more bend than last time — the moves are working 🎉</p>`;
    if (d <= -2) return `<p class="sub" style="color:#A32536;font-weight:700">▼ ${-d}° less than last time — long week? Extra 🌴 stretches this week.</p>`;
    return '<p class="sub">Holding steady vs last time ➡️</p>';
  }

  function teardown() {
    closed = true;
    unsub?.();
  }
}

// Live protractor annotations drawn straight into the figure's SVG:
// plumb line, sweeping arc, and a ghost tick at the session max.
function buildAnnotations(fig) {
  const { svg, refs } = fig;
  const { PIVOT } = refs;
  const R = 118;
  const g = document.createElementNS(NS, 'g');
  svg.appendChild(g);

  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    g.appendChild(n);
    return n;
  };

  mk('line', { x1: PIVOT.x, y1: PIVOT.y - R - 8, x2: PIVOT.x, y2: PIVOT.y - 40, stroke: '#C9C3B8', 'stroke-width': 2, 'stroke-dasharray': '3 6', 'stroke-linecap': 'round' });
  // faint full protractor scale
  mk('path', { d: arcPath(PIVOT, R, -50, 50), fill: 'none', stroke: '#ECE7DE', 'stroke-width': 2 });
  const sweep = mk('path', { fill: 'none', stroke: '#7C5CE0', 'stroke-width': 3.5, 'stroke-linecap': 'round', opacity: 0 });
  const ghost = mk('line', { stroke: '#FF6B5E', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0 });

  function arcPath(c, r, fromDeg, toDeg) {
    const a0 = ((fromDeg - 90) * Math.PI) / 180;
    const a1 = ((toDeg - 90) * Math.PI) / 180;
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M ${c.x + r * Math.cos(a0)} ${c.y + r * Math.sin(a0)} A ${r} ${r} 0 ${large} ${toDeg > fromDeg ? 1 : 0} ${c.x + r * Math.cos(a1)} ${c.y + r * Math.sin(a1)}`;
  }

  return {
    update(tiltSigned, maxSigned) {
      if (Math.abs(tiltSigned) > 2) {
        sweep.setAttribute('d', arcPath(PIVOT, R, 0, tiltSigned));
        sweep.setAttribute('opacity', 0.95);
      } else {
        sweep.setAttribute('opacity', 0);
      }
      if (Math.abs(maxSigned) > 4) {
        const a = ((maxSigned - 90) * Math.PI) / 180;
        ghost.setAttribute('x1', PIVOT.x + (R - 8) * Math.cos(a));
        ghost.setAttribute('y1', PIVOT.y + (R - 8) * Math.sin(a));
        ghost.setAttribute('x2', PIVOT.x + (R + 8) * Math.cos(a));
        ghost.setAttribute('y2', PIVOT.y + (R + 8) * Math.sin(a));
        ghost.setAttribute('opacity', 0.9);
      }
    },
  };
}
