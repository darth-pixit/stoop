// ── Per-user cloud sync ──────────────────────────────────────────────────────
// Offline-first: localStorage stays the working copy; this layer mirrors it into
// a single per-user row in Supabase (public.user_state, one JSONB blob, guarded
// by row-level security). It pulls on sign-in, reconciles by last-write-wins,
// then pushes debounced on every local change. All of it no-ops when the backend
// isn't configured, so the app is unchanged without a backend.
import * as store from './store.js';
import { supabase, onAuthChange } from './auth.js';
import { isConfigured } from './config.js';

const TABLE = 'user_state';
const PUSH_DEBOUNCE_MS = 4000;

let activeUserId = null;
let syncReady = false;     // true only after a successful initial pull for activeUserId
let pushTimer = null;
let pendingPush = false;
let status = 'idle'; // idle | syncing | synced | offline | error
const statusListeners = new Set();

// Lets boot wait for the first pull to land (so a returning user's cloud data is
// applied before we choose onboarding vs. app), with a timeout so we never hang.
let firstSyncDone = false;
let firstSyncWaiters = [];
function markFirstSync() {
  if (firstSyncDone) return;
  firstSyncDone = true;
  firstSyncWaiters.forEach((r) => r());
  firstSyncWaiters = [];
}
export function waitForFirstSync(timeoutMs = 3500) {
  if (firstSyncDone || !isConfigured()) return Promise.resolve();
  return new Promise((res) => {
    firstSyncWaiters.push(res);
    setTimeout(res, timeoutMs);
  });
}

export function onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); }
export const getStatus = () => status;
function setStatus(s) {
  status = s;
  for (const fn of statusListeners) { try { fn(s); } catch { /* listener error */ } }
}

async function fetchRemote(sb, uid) {
  const { data, error } = await sb.from(TABLE)
    .select('state, updated_at').eq('user_id', uid).maybeSingle();
  if (error) { console.warn('[sync] fetch failed', error.message); return undefined; }
  if (!data) return null; // no row yet
  const remote = data.state || {};
  const updatedAt = Number(remote.updatedAt) || Date.parse(data.updated_at) || 0;
  return { state: remote, updatedAt };
}

async function push(sb, uid) {
  const s = store.get();
  s.ownerId = uid;
  const { error } = await sb.from(TABLE).upsert(
    {
      user_id: uid,
      state: s,
      updated_at: new Date(s.updatedAt || Date.now()).toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
}

// Decide, on sign-in, whether the cloud copy or the local copy wins — and never
// leak one account's local data into another account's row. Pushes stay blocked
// (syncReady=false) until this completes successfully, so a failed/slow pull can
// never let local state overwrite the cloud row before it's been reconciled.
async function reconcile(userId) {
  setStatus('syncing');
  let sb;
  try {
    sb = await supabase();
    if (!sb) { setStatus('offline'); return; }
    const remote = await fetchRemote(sb, userId);
    if (remote === undefined) {            // network error — DON'T push over the cloud row
      setStatus('offline');
      scheduleReconcileRetry(userId);
      return;
    }

    const localOwner = store.getOwner();
    const foreignLocal = localOwner != null && localOwner !== userId;

    if (foreignLocal) {
      // This device holds a *different* account's data. Never upload it as this
      // user; take the remote (or a clean slate if the row is empty) instead.
      store.hydrate({ ...(remote ? remote.state : {}), ownerId: userId });
      syncReady = true;
      if (!remote) await push(sb, userId);
    } else if (remote) {
      // Same account (or guest adopting) → merge so neither device loses data.
      const changed = store.mergeRemote(remote.state, userId);
      syncReady = true;
      if (changed) await push(sb, userId);
    } else {
      store.setOwner(userId);              // claim guest/local data as this user's first sync
      syncReady = true;
      await push(sb, userId);
    }
    setStatus('synced');
  } catch (e) {
    console.warn('[sync] reconcile failed', e?.message || e);
    setStatus('error');
    scheduleReconcileRetry(userId);
  } finally {
    markFirstSync();
  }
}

let reconcileRetry = null;
function scheduleReconcileRetry(userId) {
  clearTimeout(reconcileRetry);
  reconcileRetry = setTimeout(() => {
    if (activeUserId === userId && !syncReady) reconcile(userId);
  }, 15000);
}

async function runPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!activeUserId || !syncReady) return; // never push before the initial pull reconciled
  const sb = await supabase();
  if (!sb) return;
  pendingPush = false;
  setStatus('syncing');
  try {
    await push(sb, activeUserId);
    setStatus('synced');
  } catch (e) {
    pendingPush = true; // keep it queued for the next online/flush
    setStatus(navigator.onLine ? 'error' : 'offline');
    console.warn('[sync] push failed', e?.message || e);
  }
}

function schedulePush() {
  if (!activeUserId || !syncReady) return; // hold local edits until reconcile succeeds
  pendingPush = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(runPush, PUSH_DEBOUNCE_MS);
}

// Force any queued write out now (e.g. before the app is backgrounded/reset).
export async function flush() {
  if (pendingPush || pushTimer) await runPush();
}

export function init() {
  if (!isConfigured()) return;

  onAuthChange((user) => {
    if (user?.id) {
      if (user.id === activeUserId) return; // same user (token refresh / boot re-emit): ignore
      activeUserId = user.id;
      syncReady = false;
      reconcile(user.id);
    } else {
      activeUserId = null;
      syncReady = false;
      clearTimeout(pushTimer);
      pushTimer = null;
      setStatus('idle');
    }
  });

  store.onChange(() => schedulePush());

  // Flush queued changes when we come back online or the app is hidden/closed.
  window.addEventListener('online', () => {
    if (activeUserId && !syncReady) reconcile(activeUserId); // retry a failed initial pull
    else if (pendingPush) runPush();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', () => { flush(); });
}
