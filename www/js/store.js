// Persistence: everything lives in localStorage under one namespaced key.
const KEY = 'stoop.v1';

const DEFAULTS = {
  setupDone: false,
  calibBeta: 75,          // phone pitch (°) captured while user held "good posture"
  calibrated: false,      // true once the user has actually captured a hold
  notifOn: true,
  checkin: { weekday: 6, hour: 10 }, // Saturday 10:00 by default
  lastCheckinISO: null,
  sampleData: false,
  days: {},               // 'YYYY-MM-DD' → { phoneMs, stoopMs, unjudgedMs, zoneMs: {mild,moderate,severe} }
  flexLogs: [],           // { iso, left, right, quality: 'clean'|'retake' }
  exerciseLogs: [],       // { iso, id, name, emoji, amount }
  updatedAt: 0,           // ms epoch of last local change — drives cloud last-write-wins
  ownerId: null,          // Supabase user id this state belongs to (null = guest/local)
};

let state = load();

// Merge a persisted/remote blob onto the defaults WITHOUT dropping nested
// defaults: a partial or older-schema `checkin` (missing `hour`) or a day
// record missing `zoneMs`/`unjudgedMs` would otherwise crash Stats/check-in.
function normalize(raw) {
  const s = { ...structuredClone(DEFAULTS), ...(raw || {}) };
  s.checkin = { ...DEFAULTS.checkin, ...(raw && raw.checkin) };
  s.days = (raw && typeof raw.days === 'object' && raw.days) || {};
  for (const k of Object.keys(s.days)) {
    const r = s.days[k] || {};
    s.days[k] = {
      ...r,
      phoneMs: r.phoneMs || 0,
      stoopMs: r.stoopMs || 0,
      unjudgedMs: r.unjudgedMs || 0,
      zoneMs: { mild: 0, moderate: 0, severe: 0, ...(r.zoneMs || {}) },
    };
  }
  s.flexLogs = Array.isArray(raw && raw.flexLogs) ? raw.flexLogs : [];
  s.exerciseLogs = Array.isArray(raw && raw.exerciseLogs) ? raw.exerciseLogs : [];
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* corrupted state falls through to defaults */ }
  return structuredClone(DEFAULTS);
}

// Two change channels: local edits push to the cloud; remote snapshots refresh
// the UI. Keeping them separate stops a pulled snapshot from echoing back up.
const changeListeners = new Set();   // local edit committed → sync should push
const hydrateListeners = new Set();  // remote snapshot applied → views refresh

export function onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }
export function onHydrate(fn) { hydrateListeners.add(fn); return () => hydrateListeners.delete(fn); }

function writeNow({ stamp = true } = {}) {
  if (stamp) state.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota — keep running in-memory */ }
}

// A pure trailing debounce starves under a continuous event stream (the ~60 Hz
// sensor feed re-arms it every ~16 ms), so localStorage and the sync push never
// fire during a monitoring session. Keep the 250 ms trailing coalesce but cap
// the total wait so a write always lands within MAX_SAVE_WAIT.
const SAVE_DEBOUNCE = 250;
const MAX_SAVE_WAIT = 2000;
let saveTimer = null;
let firstDirtyAt = 0;

function commit() {
  clearTimeout(saveTimer);
  saveTimer = null;
  writeNow();
  for (const fn of changeListeners) { try { fn(state); } catch { /* listener error */ } }
}

export function save() {
  const now = Date.now();
  if (!saveTimer) firstDirtyAt = now;
  clearTimeout(saveTimer);
  const delay = Math.max(0, Math.min(SAVE_DEBOUNCE, MAX_SAVE_WAIT - (now - firstDirtyAt)));
  saveTimer = setTimeout(commit, delay);
}

// Force any pending debounced write out synchronously (before backgrounding).
export function flush() {
  if (saveTimer) commit();
}

// Guarantee the working copy hits localStorage even if the app is killed mid
// session — the sensor stream would otherwise keep the debounce perpetually open.
if (typeof addEventListener === 'function') {
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
}

export function get() { return state; }

export function set(patch) {
  Object.assign(state, patch);
  save();
}

// Replace local state wholesale with a remote snapshot. Does NOT push back up;
// notifies hydrate listeners so open views re-render with the pulled data. Used
// only when the remote belongs to a *different* account than this device's data.
export function hydrate(remote) {
  clearTimeout(saveTimer); saveTimer = null;
  state = normalize(remote);
  writeNow({ stamp: false });
  for (const fn of hydrateListeners) { try { fn(state); } catch { /* listener error */ } }
}

// ── per-key merge for same-account reconcile ────────────────────
// The day map is a monotonically-growing per-day aggregate and the logs are
// append-only, so a whole-blob last-write-wins overwrite silently discards the
// losing device's data. Merge instead: max each day field (furthest-along
// device wins per day), union the logs, and let the newer side win the scalar
// settings. This makes reconcile idempotent (equal snapshots merge to a no-op)
// so an hourly token-refresh pull can never roll a live session back.
function mergeDays(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = (a && a[k]) || {}; const y = (b && b[k]) || {};
    out[k] = {
      phoneMs: Math.max(x.phoneMs || 0, y.phoneMs || 0),
      stoopMs: Math.max(x.stoopMs || 0, y.stoopMs || 0),
      unjudgedMs: Math.max(x.unjudgedMs || 0, y.unjudgedMs || 0),
      zoneMs: {
        mild: Math.max(x.zoneMs?.mild || 0, y.zoneMs?.mild || 0),
        moderate: Math.max(x.zoneMs?.moderate || 0, y.zoneMs?.moderate || 0),
        severe: Math.max(x.zoneMs?.severe || 0, y.zoneMs?.severe || 0),
      },
      ...(x.sample || y.sample ? { sample: true } : {}),
    };
  }
  return out;
}

function mergeLogs(a, b, keyOf) {
  const seen = new Set(); const out = [];
  for (const l of [...(a || []), ...(b || [])]) {
    const k = keyOf(l);
    if (seen.has(k)) continue;
    seen.add(k); out.push(l);
  }
  return out.sort((x, y) => (x.iso < y.iso ? -1 : x.iso > y.iso ? 1 : 0));
}

// Merge a same-account remote snapshot into local state. Returns true if the
// merged result differs from the remote (i.e. local contributed something and
// the caller should push the union back up).
export function mergeRemote(remoteState, ownerId) {
  const remote = normalize(remoteState);
  const localNewer = getUpdatedAt() >= (remote.updatedAt || 0);
  const winner = localNewer ? state : remote;   // scalar settings winner
  const merged = normalize({ ...remote, ...state,
    calibBeta: winner.calibBeta,
    calibrated: state.calibrated || remote.calibrated,
    notifOn: winner.notifOn,
    checkin: winner.checkin,
    lastCheckinISO: winner.lastCheckinISO,
    sampleData: winner.sampleData,
    setupDone: state.setupDone || remote.setupDone,
  });
  merged.days = mergeDays(state.days, remote.days);
  merged.flexLogs = mergeLogs(state.flexLogs, remote.flexLogs, (l) => l.iso);
  merged.exerciseLogs = mergeLogs(state.exerciseLogs, remote.exerciseLogs, (l) => `${l.iso}|${l.id}`);
  merged.ownerId = ownerId;
  merged.updatedAt = Math.max(getUpdatedAt(), remote.updatedAt || 0);

  const sansMeta = (s) => JSON.stringify({ ...s, updatedAt: 0, ownerId: null });
  const changed = sansMeta(merged) !== sansMeta(remote);

  state = merged;
  writeNow({ stamp: false });
  for (const fn of hydrateListeners) { try { fn(state); } catch { /* listener error */ } }
  return changed;
}

export function getUpdatedAt() { return state.updatedAt || 0; }
export function getOwner() { return state.ownerId || null; }
export function setOwner(id) { state.ownerId = id; writeNow({ stamp: false }); }

export function resetAll() {
  const owner = state.ownerId || null;      // keep the account link so the wipe syncs up
  state = structuredClone(DEFAULTS);
  state.ownerId = owner;
  writeNow();                                // persist an empty, freshly-stamped state
  for (const fn of changeListeners) { try { fn(state); } catch { /* listener error */ } }
}

// ── day aggregates ──────────────────────────────────────────────
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayRecord(key = todayKey()) {
  if (!state.days[key]) {
    state.days[key] = { phoneMs: 0, stoopMs: 0, unjudgedMs: 0, zoneMs: { mild: 0, moderate: 0, severe: 0 } };
  }
  return state.days[key];
}

export function addSample(dtMs, zoneId) {
  const rec = dayRecord();
  // Lying down, walking, phone resting flat: neither upright credit nor stoop
  // debit — its own bucket, so stoopMs/phoneMs stays "share of judged time".
  if (zoneId === 'unjudged') {
    rec.unjudgedMs = (rec.unjudgedMs || 0) + dtMs;
    save();
    return;
  }
  rec.phoneMs += dtMs;
  if (zoneId !== 'upright') {
    rec.stoopMs += dtMs;
    rec.zoneMs[zoneId] = (rec.zoneMs[zoneId] || 0) + dtMs;
  }
  save();
}

// Last n days as an ordered array (oldest first), including empty days.
export function lastDays(n) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const key = todayKey(d);
    const rec = state.days[key] || { phoneMs: 0, stoopMs: 0, unjudgedMs: 0, zoneMs: { mild: 0, moderate: 0, severe: 0 } };
    out.push({ key, date: new Date(d), ...structuredClone(rec) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function logFlex(entry) {
  state.flexLogs.push(entry);
  state.lastCheckinISO = entry.iso;
  save();
}

export function logExercise(entry) {
  state.exerciseLogs.push(entry);
  save();
}

// ── weekly check-in scheduling ──────────────────────────────────
export function checkinDue() {
  // No check-in cycle until there's a first test to check in against —
  // a brand-new user gets the "take your first test" CTA, not a re-test nudge.
  if (!state.flexLogs.length) return false;
  const { weekday, hour } = state.checkin;
  const now = new Date();
  // most recent scheduled moment at or before now
  const due = new Date(now);
  due.setHours(hour, 0, 0, 0);
  const diff = (now.getDay() - weekday + 7) % 7;
  due.setDate(due.getDate() - diff);
  if (due > now) due.setDate(due.getDate() - 7);
  const last = state.lastCheckinISO ? new Date(state.lastCheckinISO) : null;
  return !last || last < due;
}

// ── sample data so first-time users can see a living app ────────
export function seedSampleData() {
  const rand = mulberry(42);
  const d = new Date();
  d.setDate(d.getDate() - 20);
  for (let i = 0; i < 21; i++) {
    const key = todayKey(d);
    // Only fill days with no real data, and tag what we add so Clear can remove
    // exactly the sample records without touching genuine history.
    if (!state.days[key]) {
      const phoneMin = 140 + rand() * 110;                    // 2.3–4h monitored
      const improve = i / 21;                                  // trends better over time
      const stoopPct = 0.55 - improve * 0.22 + (rand() - 0.5) * 0.12;
      const stoopMin = phoneMin * Math.max(0.08, stoopPct);
      const sev = Math.max(0.05, 0.3 - improve * 0.18 + (rand() - 0.5) * 0.08);
      const mod = 0.35 + (rand() - 0.5) * 0.1;
      state.days[key] = {
        phoneMs: phoneMin * 60000,
        stoopMs: stoopMin * 60000,
        unjudgedMs: 0,
        zoneMs: {
          mild: stoopMin * (1 - mod - sev) * 60000,
          moderate: stoopMin * mod * 60000,
          severe: stoopMin * sev * 60000,
        },
        sample: true,
      };
    }
    d.setDate(d.getDate() + 1);
  }
  // three weekly flex logs, slowly improving, small L/R asymmetry
  const f = new Date();
  for (let i = 3; i >= 1; i--) {
    const fd = new Date(f); fd.setDate(fd.getDate() - i * 7);
    state.flexLogs.push({
      iso: fd.toISOString(),
      left: Math.round(28 + (3 - i) * 2.5 + rand() * 2),
      right: Math.round(34 + (3 - i) * 2 + rand() * 2),
      quality: 'clean',
      sample: true,
    });
  }
  const yest = new Date(); yest.setDate(yest.getDate() - 1); yest.setHours(18, 12, 0, 0);
  state.exerciseLogs.push({ iso: yest.toISOString(), id: 'chin-tuck', name: 'Chin tucks', emoji: '🐢', amount: '10 reps', sample: true });
  state.sampleData = true;
  save();
}

export function clearSampleData() {
  // Remove only the records we tagged as sample data — real history is untouched.
  for (const k of Object.keys(state.days)) if (state.days[k]?.sample) delete state.days[k];
  state.flexLogs = state.flexLogs.filter((l) => !l.sample);
  state.exerciseLogs = state.exerciseLogs.filter((l) => !l.sample);
  state.sampleData = false;
  save();
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── formatting helpers ──────────────────────────────────────────
export function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function fmtDayShort(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' })[0];
}
