// The service worker is cache-first: a JS module missing from its precache
// list (or a stale cache version) ships broken releases to installed PWAs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'www');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

test('every JS module ships in the service-worker precache list', () => {
  const files = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    assert.ok(sw.includes(`'js/${f}'`), `www/js/${f} is missing from sw.js ASSETS`);
  }
});

test('core shell assets are precached', () => {
  for (const a of ['index.html', 'css/app.css', 'manifest.webmanifest']) {
    assert.ok(sw.includes(`'${a}'`), `${a} missing from sw.js ASSETS`);
  }
});

test('cache name carries a version to invalidate old installs', () => {
  assert.match(sw, /const CACHE = 'stoop-v\d+'/);
});
