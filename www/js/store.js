// Persistence: everything lives in localStorage under one namespaced key.
const KEY = 'stoop.v1';

const DEFAULTS = {
  setupDone: false,
  calibBeta: 75,          // phone pitch (°) captured while user held "good posture"
  notifOn: true,
  checkin: { weekday: 6, hour: 10 }, // Saturday 10:00 by default
  lastCheckinISO: null,
  sampleData: false,
  days: {},               // 'YYYY-MM-DD' → { phoneMs, stoopMs, zoneMs: {mild,moderate,severe} }
  flexLogs: [],           // { iso, left, right, quality: 'clean'|'retake' }
  exerciseLogs: [],       // { iso, id, name, emoji, amount }
  updatedAt: 0,           // ms epoch of last local change — drives cloud last-write-wins
  ownerId: null,          // Supabase user id this state belongs to (null = guest/local)
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
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

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeNow();
    for (const fn of changeListeners) { try { fn(state); } catch { /* listener error */ } }
  }, 250);
}

export function get() { return state; }

export function set(patch) {
  Object.assign(state, patch);
  save();
}

// Replace local state wholesale with a remote snapshot. Does NOT push back up;
// notifies hydrate listeners so open views re-render with the pulled data.
export function hydrate(remote) {
  clearTimeout(saveTimer);
  state = { ...structuredClone(DEFAULTS), ...remote };
  writeNow({ stamp: false });
  for (const fn of hydrateListeners) { try { fn(state); } catch { /* listener error */ } }
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
    state.days[key] = { phoneMs: 0, stoopMs: 0, zoneMs: { mild: 0, moderate: 0, severe: 0 } };
  }
  return state.days[key];
}

export function addSample(dtMs, zoneId) {
  const rec = dayRecord();
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
    const rec = state.days[key] || { phoneMs: 0, stoopMs: 0, zoneMs: { mild: 0, moderate: 0, severe: 0 } };
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
    if (!state.days[key] || i < 20) {
      const phoneMin = 140 + rand() * 110;                    // 2.3–4h monitored
      const improve = i / 21;                                  // trends better over time
      const stoopPct = 0.55 - improve * 0.22 + (rand() - 0.5) * 0.12;
      const stoopMin = phoneMin * Math.max(0.08, stoopPct);
      const sev = Math.max(0.05, 0.3 - improve * 0.18 + (rand() - 0.5) * 0.08);
      const mod = 0.35 + (rand() - 0.5) * 0.1;
      state.days[key] = {
        phoneMs: phoneMin * 60000,
        stoopMs: stoopMin * 60000,
        zoneMs: {
          mild: stoopMin * (1 - mod - sev) * 60000,
          moderate: stoopMin * mod * 60000,
          severe: stoopMin * sev * 60000,
        },
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
  // sample day records are indistinguishable from real ones, so wipe days
  // older than today and remove flagged logs
  const today = todayKey();
  for (const k of Object.keys(state.days)) if (k !== today) delete state.days[k];
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
