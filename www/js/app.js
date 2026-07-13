// App bootstrap: routing, auth/login gate, onboarding, settings, check-in banner.
import * as store from './store.js';
import * as sensors from './sensors.js';
import * as monitor from './monitor.js';
import * as stats from './stats.js';
import * as exercises from './exercises.js';
import * as flex from './flex.js';
import * as pose from './pose.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import * as notify from './notify.js';
import { CONFIG, isConfigured } from './config.js';
import { renderLogin } from './login.js';
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
// Account block: signed-in identity + live sync status, or a prompt to sign in.
function accountSectionHTML() {
  if (!isConfigured()) return '';
  const u = auth.currentUser();
  if (u) {
    const av = u.avatar
      ? `<img class="account-av" src="${u.avatar}" alt="">`
      : `<span class="account-av">🙂</span>`;
    return `
      <div class="card" style="margin-top:10px">
        <div class="account-row">
          ${av}
          <div class="account-meta">
            <b>${u.name || 'Signed in'}</b>
            <small>${u.email || (u.provider ? `via ${u.provider}` : '')}</small>
            <small id="sync-status"><span class="sync-dot ${sync.getStatus()}"></span>${syncLabel(sync.getStatus())}</small>
          </div>
          <button class="btn ghost small" id="set-signout">Sign out</button>
        </div>
      </div>`;
  }
  return `
    <div class="card" style="margin-top:10px">
      <div class="set-row">
        <div class="sr-label"><b>Sign in to sync</b><small>Keep your streaks, calibration and bend tests on every device.</small></div>
        <button class="btn primary small" id="set-signin">Sign in</button>
      </div>
    </div>`;
}

function syncLabel(s) {
  return { synced: 'Synced to your account', syncing: 'Syncing…', offline: 'Offline — will sync later', error: 'Sync paused', idle: 'Local only' }[s] || 'Local only';
}

function openSettings() {
  const s = store.get();
  let unsubStatus = null;
  const { el, close } = sheet(`
    <div class="sheet-head">
      <h3>⚙️ Settings</h3>
      <button class="btn ghost small" data-close>Done</button>
    </div>
    ${accountSectionHTML()}
    <div class="card" style="margin-top:10px">
      ${sensors.needsPermissionGate() ? `
      <div class="set-row">
        <div class="sr-label"><b>Motion access</b><small id="set-motion-note">${sensors.getStatus() === 'live'
          ? 'On — reading your phone’s angle.'
          : 'Off — Stoop needs it to see your angle.'}</small></div>
        ${sensors.getStatus() === 'live' ? '' : '<button class="btn ghost small" id="set-motion">Allow</button>'}
      </div>` : ''}
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
    <p class="sub" style="padding:0 6px">${isConfigured()
      ? 'Your posture data is saved privately to your account and synced across your devices. '
      : 'All data stays on this device. '}Strain figures follow Hansraj (2014) — playful, not medical advice. 💛</p>
  `, { onClose: () => unsubStatus?.() });

  // account: live sync dot + sign in / sign out
  if (isConfigured() && auth.currentUser()) {
    unsubStatus = sync.onStatus((st) => {
      const node = el.querySelector('#sync-status');
      if (node) node.innerHTML = `<span class="sync-dot ${st}"></span>${syncLabel(st)}`;
    });
  }
  el.querySelector('#set-signin')?.addEventListener('click', () => { close(); showLogin(); });
  el.querySelector('#set-signout')?.addEventListener('click', async () => {
    if (!confirm('Sign out of Stoop on this device?')) return;
    await sync.flush().catch(() => {});
    await auth.signOut();
    location.reload();
  });

  el.querySelector('#set-motion')?.addEventListener('click', async (e) => {
    const ok = await sensors.requestPermission();
    if (ok) {
      toast('Motion access on 🎛️');
      el.querySelector('#set-motion-note').textContent = 'On — reading your phone’s angle.';
      e.target.remove();
    } else {
      toast('iOS didn’t re-ask — fully close Stoop, reopen it, then try again');
    }
  });

  el.querySelector('#set-notif').addEventListener('change', async (e) => {
    if (e.target.checked) await notify.requestPermission().catch(() => {});
    await monitor.refreshNotifPermission().catch(() => {});
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

  el.querySelector('#set-reset').addEventListener('click', async () => {
    if (!confirm('Wipe all Stoop data and start over?')) return;
    store.resetAll();
    await sync.flush().catch(() => {}); // push the wipe up before we reload
    location.reload();
  });
}

// ── app entry / login gate ──────────────────────────────────────
let entered = false; // committed to the app (past login + onboarding gate)

function enterApp() {
  $('#login')?.classList.add('hidden');
  $('#onboarding').classList.add('hidden');
  $('#app').classList.remove('hidden');
  sensors.start();
  showTab('now');
}

// Move past the login gate into onboarding (first run) or the app.
function proceed() {
  if (entered) return;
  entered = true;
  $('#login')?.classList.add('hidden');
  if (store.get().setupDone) {
    enterApp();
  } else {
    $('#onboarding').classList.remove('hidden');
    runOnboarding($('#onboarding'), enterApp);
  }
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#onboarding').classList.add('hidden');
  renderLogin($('#login'), {
    onSkip: CONFIG.requireLogin ? null : () => { $('#login').classList.add('hidden'); proceed(); },
  });
}

// Re-render whatever view is on screen (e.g. after a cloud pull hydrates state).
function refreshVisibleViews() {
  if ($('#app').classList.contains('hidden')) return;
  for (const v of Object.values(VIEWS)) v.rendered = false;
  const active = document.querySelector('.tabbar .tab.active')?.dataset.tab || 'now';
  showTab(active);
}

// After hand-backs from the system (OAuth browser, backgrounding), WKWebView
// occasionally comes back with its render loop paused: JS and touches work
// but nothing paints. If rAF doesn't tick shortly after such a transition,
// poke the compositor with a forced layout.
function ensureRendererAlive() {
  let ticked = false;
  requestAnimationFrame(() => { ticked = true; });
  setTimeout(() => {
    if (ticked) return;
    document.body.style.transform = 'translateZ(0)';
    void document.body.offsetHeight;
    document.body.style.transform = '';
  }, 1200);
}

// ── boot ────────────────────────────────────────────────────────
async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) showTab(tab.dataset.tab);
  });
  $('#btn-settings').addEventListener('click', openSettings);
  document.getElementById('live-pill').addEventListener('click', () => showTab('now'));

  // A cloud pull replaces local state → refresh any open view.
  store.onHydrate(refreshVisibleViews);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureRendererAlive();
  });

  // Warm the bend-test pose model in the background so the first real test
  // doesn't sit behind a multi-MB CDN download.
  setTimeout(() => { pose.loadDetector().catch(() => {}); }, 2500);

  await auth.init();
  sync.init();

  const needLogin = isConfigured() && CONFIG.requireLogin;
  let bootHandled = false;

  // Sign-ins that happen after boot (login screen or settings "Sign in").
  auth.onAuthChange((user) => {
    if (!bootHandled || !user) return;
    ensureRendererAlive(); // we just came back from the OAuth browser
    $('#login')?.classList.add('hidden');
    if (!entered) {
      sync.waitForFirstSync().then(proceed);
    } else {
      $('#app').classList.remove('hidden'); // guest upgraded to an account
      refreshVisibleViews();
    }
  });

  if (auth.currentUser()) {
    await sync.waitForFirstSync(); // pull this user's cloud data before deciding
    proceed();
  } else if (needLogin) {
    showLogin();
  } else {
    proceed(); // no backend configured, or optional-login guest
  }
  bootHandled = true;
}

boot();
