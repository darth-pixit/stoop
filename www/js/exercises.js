// Moves view: curated animated exercises with a guided start/log flow.
import * as store from './store.js';
import { createSideFigure, createFrontFigure, addTicker } from './figure.js';
import { sheet, toast, escapeHtml } from './ui.js';

const $ = (sel) => document.querySelector(sel);

// Smooth 0→1→0 pulse with a hold at the top; period 1, hold fraction h.
function pulse(p, h = 0.3) {
  const rise = (1 - h) / 2;
  if (p < rise) return ease(p / rise);
  if (p < rise + h) return 1;
  return ease((1 - p) / rise);
}
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

export const EXERCISES = [
  {
    id: 'chin-tuck', name: 'Chin tucks', emoji: '🐢', tint: 'var(--teal-soft)',
    view: 'side', type: 'reps', reps: 10, cadence: 3.6,
    meta: '10 reps · resets forward head',
    steps: ['Sit tall, gaze straight ahead.', 'Glide your chin straight back — make a proud double chin.', 'Hold 2 seconds, release slowly.'],
    cues: ['Glide back…', 'Hold that double chin 🐢', 'Release…'],
    anim(fig, t) {
      const p = pulse((t % this.cadence) / this.cadence, 0.35);
      fig.set({ angle: 24 - 26 * p, zone: p > 0.7 ? 'upright' : 'mild', kg: null });
    },
  },
  {
    id: 'ear-to-shoulder', name: 'Ear to shoulder', emoji: '🌴', tint: 'var(--lilac-soft)',
    view: 'front', type: 'hold', holdSec: 20, sides: 2,
    meta: '20s each side · lateral neck',
    steps: ['Shoulders heavy and level.', 'Tip your right ear toward your right shoulder.', 'Feel the far side lengthen. Swap sides.'],
    cues: ['Melt the shoulder down…', 'Breathe into the stretch 🌬️', 'Little further if easy…'],
    anim(fig, t) {
      const side = Math.floor(t / 4) % 2 ? -1 : 1;
      const p = pulse((t % 4) / 4, 0.5);
      fig.set({ tilt: side * 34 * p, mood: p > 0.6 ? 'effort' : 'happy' });
    },
  },
  {
    id: 'owl-turns', name: 'Owl turns', emoji: '🦉', tint: 'var(--sun-soft)',
    view: 'front', type: 'reps', reps: 10, cadence: 4,
    meta: '5 each way · rotation',
    steps: ['Chin level with the floor.', 'Turn to look over one shoulder — slow like an owl.', 'Back through centre, then the other way.'],
    cues: ['Turn… turn…', 'Peek over that shoulder 🦉', 'Back to centre…'],
    anim(fig, t) {
      fig.set({ turn: Math.sin((t / this.cadence) * Math.PI * 2) });
    },
  },
  {
    id: 'shoulder-rolls', name: 'Shoulder rolls', emoji: '🎡', tint: 'var(--coral-soft)',
    view: 'front', type: 'reps', reps: 12, cadence: 2.6,
    meta: '12 slow rolls · un-shrugs the day',
    steps: ['Let your arms hang like wet noodles.', 'Draw big slow backwards circles with your shoulders.', 'Up… back… down… around.'],
    cues: ['Up…', 'Back…', 'Down and around 🎡'],
    anim(fig, t) {
      const ph = (t / this.cadence) * Math.PI * 2;
      fig.set({ lift: { l: 10 + 10 * Math.sin(ph), r: 10 + 10 * Math.sin(ph + 0.6) } });
    },
  },
  {
    id: 'chest-opener', name: 'Doorway opener', emoji: '🚪', tint: 'var(--teal-soft)',
    view: 'side', type: 'hold', holdSec: 30, sides: 1,
    meta: '30s hold · opens the front',
    steps: ['Forearms on a doorframe, elbows shoulder-height.', 'Step one foot through until the chest opens.', 'Ribs down, neck long. Breathe.'],
    cues: ['Open the chest…', 'Shoulders away from ears', 'Long exhale 🌬️'],
    anim(fig, t) {
      const p = pulse((t % 5) / 5, 0.55);
      fig.set({ angle: -6 * p, zone: 'upright', kg: null, armBack: p });
    },
  },
  {
    id: 'sky-reach', name: 'Sky reach', emoji: '🙆', tint: 'var(--lilac-soft)',
    view: 'front', type: 'reps', reps: 8, cadence: 4.5,
    meta: '8 reaches · wakes the upper back',
    steps: ['Interlace fingers, palms to the sky.', 'Reach up until your ribs lift.', 'Grow one centimetre taller, then float down.'],
    cues: ['Reach…', 'Grow taller 🌱', 'Float down…'],
    anim(fig, t) {
      const p = pulse((t % this.cadence) / this.cadence, 0.3);
      fig.set({ armsUp: p, lift: { l: 4 * p, r: 4 * p } });
    },
  },
];

const cardTickers = [];

export function render(root) {
  cardTickers.splice(0).forEach((stop) => stop());

  root.innerHTML = `
    <p class="eyebrow">Moves</p>
    <div class="card soft" style="display:flex;align-items:center;gap:12px">
      <div style="font-size:34px">🧃</div>
      <div style="font-size:13.5px;line-height:1.5;color:var(--ink-2)">
        <b style="color:var(--ink)">Two minutes of moves undoes an hour of stoop.</b><br>
        Pick one — the little person shows you how.
      </div>
    </div>
    <div class="ex-grid" id="ex-grid"></div>
    <p class="eyebrow">Your activity</p>
    <div id="ex-log"></div>
  `;

  const grid = $('#ex-grid');
  const doneToday = new Set(
    store.get().exerciseLogs
      // Compare local calendar days: l.iso is UTC, so slice(0,10) drifts a day
      // for any non-UTC user. todayKey() localises both sides.
      .filter((l) => store.todayKey(new Date(l.iso)) === store.todayKey())
      .map((l) => l.id),
  );

  for (const ex of EXERCISES) {
    const card = document.createElement('button');
    card.className = 'ex-card';
    card.style.setProperty('--tint', ex.tint);
    card.innerHTML = `
      <div class="ex-anim"></div>
      <div class="ex-name">${ex.emoji} ${ex.name}</div>
      <div class="ex-meta">${ex.meta}</div>
      ${doneToday.has(ex.id) ? '<span class="ex-done-tick">done ✓</span>' : ''}
    `;
    const fig = ex.view === 'side'
      ? createSideFigure(card.querySelector('.ex-anim'), { showWeight: false, showArc: false })
      : createFrontFigure(card.querySelector('.ex-anim'));
    cardTickers.push(addTicker((t) => ex.anim(fig, t)));
    card.addEventListener('click', () => openPlayer(ex));
    grid.appendChild(card);
  }

  renderLog();
}

function renderLog() {
  const logs = [...store.get().exerciseLogs].reverse().slice(0, 6);
  const weekCount = store.get().exerciseLogs.filter((l) => Date.now() - new Date(l.iso) < 7 * 86400000).length;
  $('#ex-log').innerHTML = logs.length
    ? `<div class="card" style="padding:14px">
         <p class="sub" style="margin:2px 0 10px">🔥 ${weekCount} move${weekCount === 1 ? '' : 's'} this week</p>
         <div class="ex-log-list">
           ${logs.map((l) => `
             <div class="ex-log-item">
               <span>${escapeHtml(l.emoji)}</span><b>${escapeHtml(l.name)}</b><span>${escapeHtml(l.amount)}</span>
               <span class="when">${escapeHtml(relDay(l.iso))}</span>
             </div>`).join('')}
         </div>
       </div>`
    : `<div class="empty-hint"><span class="emo">🌱</span>No moves logged yet.<br>Your neck is waiting. It says hi.</div>`;
}

function relDay(iso) {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

// ── guided player ───────────────────────────────────────────────
function openPlayer(ex) {
  const totalSec = ex.type === 'reps' ? ex.reps * ex.cadence : ex.holdSec * ex.sides;
  let stopAnim = null;
  let timer = null;
  let startedAt = null;
  let elapsed = 0;

  const { el, close } = sheet(`
    <div class="sheet-head">
      <h3>${ex.emoji} ${ex.name}</h3>
      <button class="btn ghost small" data-close>Close</button>
    </div>
    <div class="player-stage"><div id="pl-fig"></div></div>
    <div class="player-count">
      <div class="pc-big" id="pl-big">${ex.type === 'reps' ? `0<span style="font-size:22px;color:var(--ink-3)">/${ex.reps}</span>` : fmtSec(totalSec)}</div>
      <div class="pc-sub">${ex.type === 'reps' ? 'reps' : ex.sides === 2 ? 'hold — we\'ll call the side switch' : 'hold'}</div>
    </div>
    <div class="player-cue" id="pl-cue">Press start when you're set 🎬</div>
    <div class="monitor-row">
      <button class="btn coral block" id="pl-start">▶️ Start</button>
    </div>
    <ol class="steps-list">
      ${ex.steps.map((s, i) => `<li><span class="n">${i + 1}</span><span>${s}</span></li>`).join('')}
    </ol>
  `, { onClose: () => { stopAnim?.(); clearInterval(timer); } });

  const fig = ex.view === 'side'
    ? createSideFigure(el.querySelector('#pl-fig'), { showWeight: false, showArc: false })
    : createFrontFigure(el.querySelector('#pl-fig'));
  stopAnim = addTicker((t) => ex.anim(fig, t));

  const big = el.querySelector('#pl-big');
  const cue = el.querySelector('#pl-cue');
  const startBtn = el.querySelector('#pl-start');

  startBtn.addEventListener('click', () => {
    if (startedAt == null) {
      startedAt = performance.now();
      startBtn.textContent = '✅ Finish & log';
      timer = setInterval(tick, 250);
    } else {
      finish();
    }
  });

  function tick() {
    elapsed = (performance.now() - startedAt) / 1000;
    if (ex.type === 'reps') {
      const reps = Math.min(ex.reps, Math.floor(elapsed / ex.cadence));
      big.innerHTML = `${reps}<span style="font-size:22px;color:var(--ink-3)">/${ex.reps}</span>`;
      cue.textContent = ex.cues[Math.floor((elapsed % ex.cadence) / ex.cadence * ex.cues.length) % ex.cues.length];
      if (reps >= ex.reps) finish();
    } else {
      const remain = Math.max(0, totalSec - elapsed);
      big.textContent = fmtSec(remain);
      if (ex.sides === 2 && elapsed < totalSec) {
        const secondSide = elapsed >= ex.holdSec;
        cue.textContent = secondSide
          ? `Other side now! ${ex.cues[Math.floor(elapsed / 5) % ex.cues.length]}`
          : ex.cues[Math.floor(elapsed / 5) % ex.cues.length];
      } else {
        cue.textContent = ex.cues[Math.floor(elapsed / 6) % ex.cues.length];
      }
      if (remain <= 0) finish();
    }
  }

  function finish() {
    clearInterval(timer);
    const amount = ex.type === 'reps'
      ? `${Math.min(ex.reps, Math.max(1, Math.floor(elapsed / ex.cadence)))} reps`
      : `${Math.round(Math.min(totalSec, elapsed))}s`;
    store.logExercise({ iso: new Date().toISOString(), id: ex.id, name: ex.name, emoji: ex.emoji, amount });
    close();
    toast(`Logged ${ex.emoji} ${ex.name} — your neck sends a thank-you note 💌`);
    const view = document.getElementById('view-moves');
    if (!view.classList.contains('hidden')) render(view);
  }
}

function fmtSec(s) {
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(Math.ceil(s % 60)).padStart(2, '0')}` : `${Math.ceil(s)}s`;
}
