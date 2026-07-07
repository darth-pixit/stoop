// App bootstrap: routing, onboarding gate, settings sheet, check-in banner.
import * as store from './store.js';
import * as sensors from './sensors.js';
import * as monitor from './monitor.js';
import * as stats from './stats.js';
import * as exercises from './exercises.js';
import * as flex from './flex.js';
import { runOnboarding } from './onboarding.js';
import { calibrationWidget } from './calibrate.js';
import { sheet, toast } from './ui.js';

const $ = (sel) => document.querySelector(sel);

const VIEWS = {
  now: { el: () => $('#view-now'), render: monitor.render, rendered: false },
  stats: { el: () => $('#view-stats'), render: stats.render, rendered: false },
  moves: { el: () => $('#view-moves'), render: exercises.render, rendered: false },
  flex: { el: () => $('#view-flex'), render: flex.render, rendered: false },
};

// every view re-renders on entry so numbers and sim state are always fresh
const ALWAYS_FRESH = new Set(['now', 'stats', 'flex', 'moves']);

function showTab(name) {
  for (const [key, v] of Object.entries(VIEWS)) {
    const active = key === name;
    v.el().classList.toggle('hidden', !active);
    if (active && (!v.rendered || ALWAYS_FRESH.has(key))) {
      v.render(v.el());
      v.rendered = true;
    }
  }
  document.querySelectorAll('.tabbar .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  renderBanner(name);
  window.scrollTo({ top: 0 });
}

function renderBanner(activeTab) {
  const slot = $('#banner-slot');
  if (activeTab !== 'flex' && store.checkinDue() && store.get().setupDone) {
    slot.innerHTML = `
      <div class="checkin-banner">
        <div style="font-size:28px">📅</div>
        <div class="cb-txt"><b>Weekly check-in due</b>60 seconds: bend test + a move or two.</div>
        <button class="btn" id="banner-go">Go</button>
      </div>`;
    slot.querySelector('#banner-go').addEventListener('click', () => showTab('flex'));
  } else {
    slot.innerHTML = '';
  }
}

// ── settings ────────────────────────────────────────────────────
function openSettings() {
  const s = store.get();
  const { el, close } = sheet(`
    <div class="sheet-head">
      <h3>⚙️ Settings</h3>
      <button class="btn ghost small" data-close>Done</button>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="set-row">
        <div class="sr-label"><b>Live stoop notifications</b><small>A silent nudge after ~10s of sustained stooping (while Stoop is open).</small></div>
        <label class="switch"><input type="checkbox" id="set-notif" ${s.notifOn ? 'checked' : ''}><span class="knob"></span></label>
      </div>
      <div class="set-row">
        <div class="sr-label"><b>Recalibrate good posture</b><small>Currently ${Math.round(s.calibBeta)}° phone pitch.</small></div>
        <button class="btn ghost small" id="set-recal">Redo</button>
      </div>
      <div class="set-row">
        <div class="sr-label"><b>Sample data</b><small>${s.sampleData ? 'Pretend history is loaded.' : 'Load three weeks of pretend history to explore the charts.'}</small></div>
        <button class="btn ghost small" id="set-sample">${s.sampleData ? 'Clear' : 'Load'}</button>
      </div>
      <div class="set-row">
        <div class="sr-label"><b>Start over</b><small>Wipes everything, reruns setup.</small></div>
        <button class="btn ghost small" id="set-reset" style="color:var(--zone-severe);border-color:var(--zone-severe-soft)">Reset</button>
      </div>
    </div>
    <p class="sub" style="padding:0 6px">Stoop is a web app: it can only watch your angle while it's open and on-screen, and all data stays in this browser. Strain figures follow Hansraj (2014) — playful, not medical advice. 💛</p>
  `);

  el.querySelector('#set-notif').addEventListener('change', async (e) => {
    if (e.target.checked && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => {});
    }
    store.set({ notifOn: e.target.checked });
    toast(e.target.checked ? 'Nudges on 🔔' : 'Nudges off 🔕');
  });

  el.querySelector('#set-recal').addEventListener('click', () => {
    close();
    const sh = sheet(`
      <div class="sheet-head"><h3>📸 Recalibrate</h3><button class="btn ghost small" data-close>Cancel</button></div>
      <div id="recal-zone" style="margin-top:8px"></div>
    `);
    calibrationWidget(sh.el.querySelector('#recal-zone'), (beta) => {
      sh.close();
      toast(`Recalibrated at ${Math.round(beta)}° 🌤️`);
    });
  });

  el.querySelector('#set-sample').addEventListener('click', () => {
    if (store.get().sampleData) {
      store.clearSampleData();
      toast('Sample data cleared 🧹');
    } else {
      store.seedSampleData();
      toast('Sample history loaded 🧪');
    }
    close();
    VIEWS.stats.rendered = false;
    showTab('stats');
  });

  el.querySelector('#set-reset').addEventListener('click', () => {
    if (!confirm('Wipe all Stoop data and start over?')) return;
    store.resetAll();
    location.reload();
  });
}

// ── boot ────────────────────────────────────────────────────────
function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) showTab(tab.dataset.tab);
  });
  $('#btn-settings').addEventListener('click', openSettings);
  document.getElementById('live-pill').addEventListener('click', () => showTab('now'));

  const enterApp = () => {
    $('#onboarding').classList.add('hidden');
    $('#app').classList.remove('hidden');
    sensors.start();
    showTab('now');
  };

  if (store.get().setupDone) {
    enterApp();
  } else {
    $('#onboarding').classList.remove('hidden');
    runOnboarding($('#onboarding'), enterApp);
  }
}

boot();
