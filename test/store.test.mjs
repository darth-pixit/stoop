// Regression tests for persistence + check-in scheduling logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// store.js touches localStorage at import time — shim it for Node.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import('../www/js/store.js');

function freshState(patch = {}) {
  store.hydrate({ ...patch }); // hydrate resets to DEFAULTS + patch
}

test('defaults: setup not done, uncalibrated, default hold of 75°', () => {
  freshState();
  const s = store.get();
  assert.equal(s.setupDone, false);
  assert.equal(s.calibrated, false);
  assert.equal(s.calibBeta, 75);
});

test('checkinDue is NEVER true before the first bend test', () => {
  freshState({ flexLogs: [] });
  assert.equal(store.checkinDue(), false);
});

test('checkinDue fires once a scheduled moment passes after the last test', () => {
  const old = new Date();
  old.setDate(old.getDate() - 30);
  freshState({ flexLogs: [{ iso: old.toISOString(), left: 20, right: 22, quality: 'clean' }], lastCheckinISO: old.toISOString() });
  assert.equal(store.checkinDue(), true);
});

test('checkinDue stays quiet right after a logged test', () => {
  freshState({ flexLogs: [] });
  store.logFlex({ iso: new Date().toISOString(), left: 25, right: 27, quality: 'clean' });
  assert.equal(store.checkinDue(), false);
});

test('day aggregates: samples accumulate into today, stoop only counts non-upright', () => {
  freshState();
  store.addSample(1000, 'upright');
  store.addSample(500, 'severe');
  const rec = store.dayRecord();
  assert.equal(rec.phoneMs, 1500);
  assert.equal(rec.stoopMs, 500);
  assert.equal(rec.zoneMs.severe, 500);
});

test('todayKey is a stable YYYY-MM-DD', () => {
  assert.match(store.todayKey(new Date('2026-07-12T10:00:00')), /^2026-07-12$/);
});

test('clearSampleData keeps today and real logs, drops flagged ones', () => {
  freshState();
  store.seedSampleData();
  store.logFlex({ iso: new Date().toISOString(), left: 30, right: 30, quality: 'clean' });
  store.clearSampleData();
  const s = store.get();
  assert.equal(s.sampleData, false);
  assert.equal(s.flexLogs.filter((l) => l.sample).length, 0);
  assert.equal(s.flexLogs.length, 1); // the real log survives
});
