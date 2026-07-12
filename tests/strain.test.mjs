// Regression tests for the strain model — the numbers the whole app hangs off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strainKg, zoneFor, equivalentFor, STOOP_THRESHOLD, ZONES } from '../www/js/strain.js';

test('strainKg anchors match Hansraj (2014)', () => {
  assert.equal(strainKg(0), 5.4);
  assert.equal(strainKg(15), 12.2);
  assert.equal(strainKg(30), 18.1);
  assert.equal(strainKg(45), 22.2);
  assert.equal(strainKg(60), 27.2);
});

test('strainKg interpolates between anchors and clamps outside them', () => {
  assert.equal(strainKg(7.5), (5.4 + 12.2) / 2);
  assert.equal(strainKg(75), 27.2);   // beyond the curve → last anchor
  assert.equal(strainKg(-10), 5.4);   // negative → neutral
});

test('zone boundaries are stable', () => {
  assert.equal(zoneFor(0).id, 'upright');
  assert.equal(zoneFor(14.9).id, 'upright');
  assert.equal(zoneFor(15).id, 'mild');
  assert.equal(zoneFor(30).id, 'moderate');
  assert.equal(zoneFor(45).id, 'severe');
  assert.equal(zoneFor(90).id, 'severe'); // never falls off the end
  assert.equal(STOOP_THRESHOLD, 15);
  assert.equal(ZONES.length, 4);
});

test('every strain value has a picturable equivalent', () => {
  for (let kg = 0; kg <= 30; kg++) {
    assert.equal(typeof equivalentFor(kg), 'string');
    assert.ok(equivalentFor(kg).length > 0);
  }
  assert.match(equivalentFor(27), /fridge/);
});
