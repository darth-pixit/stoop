// Bend view: a camera-based ear-to-shoulder flexibility test.
//
// The front camera watches your head and shoulders in real time. We measure
// the *actual* angle your head tilts from vertical (the roll of your eye line)
// and — crucially — we watch your shoulders: if one creeps up toward your ear
// to fake extra range, we stop crediting the tilt and coach you to drop it, so
// the number you log is honest neck flexibility, not a shrug.
import * as pose from './pose.js';
import * as store from './store.js';
import { lineChart } from './charts.js';
import { sheet, toast } from './ui.js';

const $ = (sel) => document.querySelector(sel);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Typical lateral neck flexion tops out around ~45°. Grade against that so the
// number means something ("is my flexibility good or bad?"), not just a trend.
function grade(avg) {
  if (avg >= 40) return { label: 'Excellent', emoji: '🌟', color: 'var(--zone-upright)', soft: 'var(--zone-upright-soft)', ink: '#14712B', note: 'Supple neck — lovely range. Keep it up. 💚' };
  if (avg >= 30) return { label: 'Good', emoji: '👍', color: 'var(--teal)', soft: 'var(--teal-soft)', ink: '#0B6A60', note: 'Healthy side-bend. A weekly re-test keeps it honest.' };
  if (avg >= 20) return { label: 'Fair', emoji: '🙂', color: 'var(--zone-mild)', soft: 'var(--zone-mild-soft)', ink: '#8A5A00', note: 'A little tight — the ear-to-shoulder move will loosen it.' };
  return { label: 'Limited', emoji: '🧊', color: 'var(--zone-severe)', soft: 'var(--zone-severe-soft)', ink: '#A32536', note: 'Stiff today. Go gently and re-test after a round of moves.' };
}

export function render(root) {
  const s = store.get();
  const last = s.flexLogs[s.flexLogs.length - 1];
  const g = last ? grade((last.left + last.right) / 2) : null;

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
      <p class="sub">Your front camera tracks how far your head really tilts — and watches that your shoulder stays down, so the reading is true side-bend, not a shrug.</p>
      ${last ? `
        <div class="flex-rating" style="background:${g.soft};color:${g.ink}">
          <span class="fr-emoji">${g.emoji}</span>
          <div><b>${g.label} flexibility</b><span>${g.note}</span></div>
        </div>
        <div class="result-split" style="margin-top:10px">
          <div class="result-side"><div class="rs-v" style="color:var(--series-flex-l)">${last.left}°</div><div class="rs-k">left tilt</div></div>
          <div class="result-side"><div class="rs-v" style="color:var(--series-flex-r)">${last.right}°</div><div class="rs-k">right tilt</div></div>
        </div>
        <p class="sub" style="margin:0 0 12px">Last tested ${new Date(last.iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${last.quality === 'retake' ? ' · 🙈 shoulder crept up — worth a redo' : ''}${asymmetryNote(last)}</p>
      ` : ''}
      <button class="btn coral block" id="btn-flex-test">📸 ${last ? 'Test again' : 'Take your first test'}</button>
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

// ═══════════════ the guided camera test ═══════════════
// Phases per side: position → baseline → tilt → locked. Then results.
const CREEP_GATE = 0.10;    // shoulder rise (× shoulder-width) that counts as a shrug
const REAL_BEND = 8;        // ° below which we don't consider it a bend yet

export function startTest({ embedded = null, onDone = null } = {}) {
  const results = { right: null, left: null };
  const clean = { right: true, left: true }; // shoulders stayed down?
  let side = 'right';
  let phase = 'position';
  let base = null;         // { roll, shoulderTiltY, shoulderWidth, eyeMidY }
  let maxTilt = 0;
  let plateauSince = null;
  let plateauMaxRef = 0;
  let phaseEnteredAt = performance.now();
  const buf = [];          // rolling {t, roll} for rate/stability checks
  let closed = false;

  // camera / sim plumbing
  let stream = null;
  let rafId = null;
  let lastTs = 0;
  let simMode = false;
  let simTilt = 0;
  let simCreep = 0;
  let video, canvas, ctx, wrap;

  const inner = `
    <div class="sheet-head">
      <h3>📸 Ear → shoulder</h3>
      ${embedded ? '' : '<button class="btn ghost small" data-close>Close</button>'}
    </div>
    <div class="flex-phase-dots" id="fx-dots"><i class="on"></i><i></i><i></i><i></i></div>
    <div class="flex-cam-wrap" id="fx-cam">
      <video id="fx-video" playsinline muted></video>
      <canvas id="fx-overlay"></canvas>
      <div class="cam-creep hidden" id="fx-creep">🙈 shoulder up</div>
      <div class="cam-status" id="fx-status">
        <div class="cam-spinner"></div>
        <div>Waking up the camera…</div>
      </div>
    </div>
    <div class="flex-live-angle">
      <div class="fla-big"><span id="fx-angle">0</span>°</div>
      <div class="pc-sub" id="fx-side">Right side first</div>
    </div>
    <div class="nudge-bubble" id="fx-nudge">Get your head <b>and both shoulders</b> in frame, sitting tall 🪞</div>
    <div class="sim-strip hidden" id="fx-sim">
      <label>🖥️ No camera here — simulating. Drag to "bend"</label>
      <input type="range" min="0" max="55" value="0" step="0.5" id="fx-sim-range">
      <label class="sim-check"><input type="checkbox" id="fx-sim-creep"> 🙈 fake a shoulder shrug</label>
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
  video = q('#fx-video');
  canvas = q('#fx-overlay');
  ctx = canvas.getContext('2d');
  wrap = q('#fx-cam');

  q('#fx-sim-range').addEventListener('input', (e) => { simTilt = +e.target.value; });
  q('#fx-sim-creep').addEventListener('change', (e) => { simCreep = e.target.checked ? 0.18 : 0; });

  boot();

  // ── startup: camera + model, else simulation ──────────────────────
  async function boot() {
    if (!pose.cameraSupported()) return fallToSim('This device has no camera we can use');
    // Assign `stream` the moment the camera opens, so if the model load fails
    // afterwards we can still stop the camera we opened.
    const camP = pose.openCamera(video).then((s) => { stream = s; });
    try {
      await Promise.all([pose.loadDetector(), camP]);
      if (closed) { pose.stopCamera(stream); return; }
      status(null);
      loop();
    } catch (err) {
      pose.stopCamera(stream);
      // permission denied, model/CDN failure, or no camera → still usable
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      fallToSim(denied ? 'Camera permission was blocked' : "Couldn't start the camera");
    }
  }

  function fallToSim(why) {
    if (closed) return;
    simMode = true;
    base = { roll: 0, shoulderTiltY: 0, shoulderWidth: 1, eyeMidY: 0.4 };
    wrap.classList.add('hidden');
    q('#fx-sim').classList.remove('hidden');
    setPhase('tilt');
    nudge(`${why} — you can still demo it below 👇`);
    loop();
  }

  function status(msg) {
    const el = q('#fx-status');
    if (!el) return;
    if (msg == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="cam-spinner"></div><div>${msg}</div>`;
  }

  // ── per-frame loop ────────────────────────────────────────────────
  function loop() {
    if (closed) return;
    const ts = Math.max(lastTs + 1, performance.now());
    lastTs = ts;

    let sample;
    if (simMode) {
      sample = { framed: true, roll: simTilt, creep: simCreep, read: null };
    } else {
      const r = pose.readPose(video, ts);
      sample = r.ok
        ? {
            framed: true,
            roll: r.rollDeg,
            creep: base ? Math.abs(r.shoulderTiltY - base.shoulderTiltY) / base.shoulderWidth : 0,
            read: r,
          }
        : { framed: false };
      drawOverlay(sample);
    }

    onSample(sample);
    rafId = requestAnimationFrame(loop);
  }

  function onSample(sample) {
    if (closed) return;
    const now = performance.now();

    if (!sample.framed) {
      if (phase === 'position') nudge('Line your head and both shoulders up in the frame 🪞', 'warn');
      else nudge('I lost you — get back in frame 🪞', 'warn');
      return;
    }

    buf.push({ t: now, roll: sample.roll });
    while (buf.length && now - buf[0].t > 1000) buf.shift();

    const eff = base ? Math.abs(sample.roll - base.roll) : 0;
    const shown = phase === 'locked' ? maxTilt : eff;
    q('#fx-angle').textContent = Math.round(shown);

    q('#fx-creep').classList.toggle('hidden', !(phase === 'tilt' && sample.creep > CREEP_GATE));

    if (phase === 'position') stepPosition(sample, now);
    else if (phase === 'baseline') stepBaseline(sample, now);
    else if (phase === 'tilt') stepTilt(eff, sample, now);
  }

  function stability() {
    if (buf.length < 4) return 99;
    const vals = buf.map((b) => b.roll);
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  }

  function rate() {
    if (buf.length < 2) return 0;
    const a = buf[0], b = buf[buf.length - 1];
    return Math.abs(b.roll - a.roll) / Math.max(0.05, (b.t - a.t) / 1000);
  }

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

  function stepPosition(sample, now) {
    if (now - phaseEnteredAt < 700) return;
    if (Math.abs(sample.roll) > 22) {
      nudge('Start tall and level — imagine a string pulling the crown of your head up 🎈', 'warn');
      return;
    }
    if (stability() > 3 || rate() > 5) {
      nudge('Almost — hold still a moment so I can zero it 🧘');
      return;
    }
    nudge('Perfect. Zeroing… don\'t move ✨', 'ok');
    setPhase('baseline');
  }

  function stepBaseline(sample, now) {
    if (stability() > 3 || rate() > 5) { setPhase('position'); return; }
    if (now - phaseEnteredAt < 1000) return;
    base = {
      roll: buf.reduce((a, b) => a + b.roll, 0) / buf.length,
      shoulderTiltY: sample.read ? sample.read.shoulderTiltY : 0,
      shoulderWidth: sample.read ? sample.read.shoulderWidth : 1,
      eyeMidY: sample.read ? sample.read.eyeMidY : 0.4,
    };
    maxTilt = 0;
    clean[side] = true;
    setPhase('tilt');
    nudge(`Now tip your <b>${side} ear</b> toward your shoulder — slow as honey 🍯. Keep that shoulder <b>heavy</b>!`);
  }

  function stepTilt(eff, sample, now) {
    const creeping = sample.creep > CREEP_GATE;
    // Only credit range earned with the shoulder down — a shrug earns nothing.
    if (!creeping && eff > maxTilt) maxTilt = eff;
    if (creeping && eff > REAL_BEND) clean[side] = false;

    // form rules, worst first — one nudge at a time so it stays friendly
    if (rate() > 55) { nudge('Whoa, slow down 🐢 — this is a stretch, not a headbang', 'warn'); plateauSince = null; return; }
    if (creeping && eff > 5) {
      nudge('Shoulder\'s sneaking up! 🙈 Melt it down and let the <b>neck</b> do the bending', 'warn');
      plateauSince = null;
      return;
    }
    // forward nod instead of a side-bend: head drops but the eye line barely rolls
    if (!simMode && sample.read && eff < REAL_BEND &&
        sample.read.eyeMidY - base.eyeMidY > 0.06) {
      nudge('That\'s a forward nod — think <b>ear to shoulder</b>, not chin to chest 👂→🤷', 'warn');
      return;
    }
    if (now - phaseEnteredAt > 30000 && maxTilt < 10) {
      nudge('Barely moving — let\'s reset and try again. Sit tall first 🔄', 'warn');
      setPhase('position');
      return;
    }

    // plateau near personal max → lock after a steady hold. The max must stop
    // GROWING too, else a slow climb would lock early.
    if (maxTilt > REAL_BEND && eff > maxTilt - 3) {
      if (plateauSince == null || maxTilt > plateauMaxRef + 1.5) {
        plateauSince = now;
        plateauMaxRef = maxTilt;
      }
      const held = now - plateauSince;
      if (held > 1500) lockSide();
      else nudge(`Hold it there… ${Math.ceil((1500 - held) / 500)} 🫸`, 'ok');
    } else {
      plateauSince = null;
      if (eff > 4) nudge('Nice — keep sinking until you feel the far side wake up 🌊');
    }
  }

  function lockSide() {
    results[side] = Math.round(maxTilt);
    setPhase('locked');
    q('#fx-angle').textContent = results[side];
    nudge(`${side === 'right' ? 'Right' : 'Left'} side: <b>${results[side]}°</b>${clean[side] ? ' — lovely bend! 🎉' : ' 🙈'}`, clean[side] ? 'ok' : 'warn');
    const actions = q('#fx-actions');
    if (side === 'right') {
      actions.innerHTML = '<button class="btn primary block" id="fx-next">👈 Now the left side</button>';
      actions.querySelector('#fx-next').addEventListener('click', () => {
        side = 'left';
        maxTilt = 0;
        base = simMode ? base : null; // recapture an upright baseline for the new side
        buf.length = 0;
        q('#fx-side').textContent = 'Left side';
        q('#fx-actions').innerHTML = '';
        if (simMode) { simTilt = 0; q('#fx-sim-range').value = 0; q('#fx-sim-creep').checked = false; simCreep = 0; }
        q('#fx-creep').classList.add('hidden');
        setPhase(simMode ? 'tilt' : 'position');
        nudge(simMode ? 'Drag to bend the <b>left</b> side 👇' : 'Sit tall again — then tip your <b>left ear</b> down 🪞');
      });
    } else {
      actions.innerHTML = '<button class="btn coral block" id="fx-done">See my results 🎊</button>';
      actions.querySelector('#fx-done').addEventListener('click', showResults);
    }
  }

  function showResults() {
    teardown();
    if (!embedded) closeSheet(); // drop the test sheet before the results sheet
    const avg = (results.left + results.right) / 2;
    const g = grade(avg);
    const cleanBoth = clean.left && clean.right;
    const out = `
      <div class="sheet-head"><h3>🎊 Your bend today</h3></div>
      <div class="flex-rating big" style="background:${g.soft};color:${g.ink}">
        <span class="fr-emoji">${g.emoji}</span>
        <div><b>${g.label} flexibility</b><span>${g.note}</span></div>
      </div>
      <div class="result-split">
        <div class="result-side"><div class="rs-v" style="color:var(--series-flex-l)">${results.left}°</div><div class="rs-k">left tilt</div></div>
        <div class="result-side"><div class="rs-v" style="color:var(--series-flex-r)">${results.right}°</div><div class="rs-k">right tilt</div></div>
      </div>
      ${compareLine(results)}
      <div class="form-verdict ${cleanBoth ? 'ok' : 'warn'}">
        ${cleanBoth
          ? '✅ Shoulders stayed heavy the whole time — clean, honest reading.'
          : '🙈 A shoulder crept up during the test — we didn\'t count the shrug, but a cleaner redo will read truer.'}
      </div>
      <div class="fx-result-actions">
        <button class="btn coral block" id="fx-log">Log it 📌</button>
        <button class="btn ghost block" id="fx-retake">🔄 Re-take the test</button>
      </div>
    `;
    let close2 = null;
    let rootEl;
    if (embedded) {
      embedded.innerHTML = `<div>${out}</div>`;
      rootEl = embedded;
    } else {
      const sh = sheet(out);
      close2 = sh.close;
      rootEl = sh.el;
    }
    rootEl.querySelector('#fx-log').addEventListener('click', () => {
      store.logFlex({
        iso: new Date().toISOString(),
        left: results.left,
        right: results.right,
        quality: cleanBoth ? 'clean' : 'retake',
      });
      toast(cleanBoth ? 'Logged clean. Your future neck thanks you 🙏' : 'Logged with a form note — pin that shoulder down next time 📌');
      close2?.();
      onDone?.(results);
      const view = document.getElementById('view-flex');
      if (!embedded && view && !view.classList.contains('hidden')) render(view);
    });
    // Secondary: throw this reading away and run a fresh test in the same spot.
    rootEl.querySelector('#fx-retake').addEventListener('click', () => {
      close2?.();                      // drop the results sheet (sheet mode)
      startTest({ embedded, onDone }); // fresh run, same context — nothing logged
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

  // ── overlay: mirror the skeleton onto the live video ──────────────
  function drawOverlay(sample) {
    if (!ctx) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width, H = rect.height;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!sample || !sample.framed || !sample.read) return;

    // Map normalized video coords → displayed px, matching object-fit:cover
    // and the horizontal mirror of the selfie view.
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    const scale = Math.max(W / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    const P = (p) => ({ x: W - (ox + p.x * dw), y: oy + p.y * dh });

    const pts = sample.read.pts;
    const shouldersDown = sample.creep <= CREEP_GATE;

    const line = (a, b, color, w) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.stroke();
    };
    const dot = (p, color, r) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    };

    const shL = P(pts.shL), shR = P(pts.shR);
    const eyeL = P(pts.eyeL), eyeR = P(pts.eyeR);
    const earL = P(pts.earL), earR = P(pts.earR);
    const eyeMid = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };

    // shoulder line — green when down, coral when shrugging
    line(shL, shR, shouldersDown ? '#17B8A6' : '#FF6B5E', 6);
    dot(shL, shouldersDown ? '#0E8F82' : '#E8503F', 7);
    dot(shR, shouldersDown ? '#0E8F82' : '#E8503F', 7);

    // reference plumb through the head + the head's up-axis, so the gap
    // between them *is* the tilt being measured
    const len = dh * 0.22;
    line({ x: eyeMid.x, y: eyeMid.y - len }, { x: eyeMid.x, y: eyeMid.y + len * 0.2 }, 'rgba(255,255,255,.55)', 2);
    const ex = eyeR.x - eyeL.x, ey = eyeR.y - eyeL.y;
    const el = Math.hypot(ex, ey) || 1;
    const up = { x: eyeMid.x + (ey / el) * len, y: eyeMid.y - (ex / el) * len };
    line(eyeMid, up, '#7C5CE0', 4);

    // eye + ear markers
    line(eyeL, eyeR, '#7C5CE0', 3);
    dot(eyeL, '#7C5CE0', 4); dot(eyeR, '#7C5CE0', 4);
    dot(earL, '#7C5CE0', 4); dot(earR, '#7C5CE0', 4);
  }

  function teardown() {
    if (closed) return;
    closed = true;
    if (rafId) cancelAnimationFrame(rafId);
    pose.stopCamera(stream);
  }
}
