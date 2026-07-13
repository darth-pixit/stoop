---
name: verify
description: Build/launch/drive recipe for verifying Stoop (buildless PWA) changes end-to-end in headless Chromium with synthetic sensor events.
---

# Verifying Stoop

Buildless vanilla-JS PWA in `www/` — no build step; serve and drive.

## Launch

```bash
python3 -m http.server 8000 --directory www &   # occasional ERR_CONNECTION_RESET on parallel asset loads; harmless
```

## Drive (Playwright, headless Chromium)

Bypass the login gate and onboarding with an init script — both are supported overrides:

```js
await page.addInitScript(() => {
  window.STOOP_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', requireLogin: false }; // local-only boot (see www/js/config.js)
  localStorage.setItem('stoop.v1', JSON.stringify({ setupDone: true, calibBeta: 75, notifOn: false }));
});
```

Then wait for `#view-now` visible.

## Synthetic sensors

No hardware in headless — dispatch real events through the window; the app's
listeners (`www/js/sensors.js`) receive them like the real thing. Feed at
~20 Hz **with hand jitter** (`beta ± ~0.8°`, accel-mag wobble ~0.6 m/s²) or the
context tracker will classify the phone as "resting flat":

```js
window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta, gamma }));
window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y, z } }));
```

Keep events flowing within 1.5 s of load or `startSimulation()` takes over and
overwrites readings every 100 ms.

## Gotchas

- **Don't read `localStorage` for live day totals** — `store.save()` is debounced
  250 ms and every ~50 ms sensor sample resets it, so it rarely flushes while
  monitoring. Read the live module instead:
  `await import('/js/store.js')` in `page.evaluate` returns the same instance;
  use `store.dayRecord()`.
- Useful selectors: `#angle-num`, `#zone-tag`, `#strain-line`, `#sim-strip`, `#view-now`.
- Context transitions take seconds by design (dwell 1.2 s, stillness 2.5 s,
  2 s motion window) — sleep 3–6 s after changing the feed before asserting.
