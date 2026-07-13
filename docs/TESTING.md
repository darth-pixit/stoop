# Release checklist

Run this before every release — automated gates first, then the on-device
pass. Each manual item exists because it caught a real regression once;
don't skip them.

## Automated (every commit / PR)

```bash
npm test
```

That runs two gates:

- `npm run check` — esbuild bundles `www/js/app.js`, catching syntax errors
  and broken imports across every module (the app is buildless, so nothing
  else validates this before runtime).
- `node --test test/` — unit regression tests for the pure logic:
  - `strain.test.mjs` — Hansraj strain curve anchors, zone boundaries,
    kg equivalents.
  - `sensors.test.mjs` — phone-pitch → neck-angle mapping (calibration math,
    clamping, lying-down guard).
  - `store.test.mjs` — persistence defaults, **check-in due only after the
    first bend test**, day aggregates, sample-data seeding/clearing.
  - `smoother.test.mjs` — bend-test filter: steady on hold, spike-immune,
    low-lag on real movement.
  - `context.test.mjs` / `latch.test.mjs` / `neck.test.mjs` — the context
    classifier (lying down / sideways / parked flat / moving), hysteresis
    latch, and neck-angle guard bands.

## Manual — desktop browser (~5 min)

`npm run serve`, open `http://localhost:8000`:

1. **Onboarding order**: all 6 steps advance one per tap; progress dots at
   the bottom; CTA anchored at the bottom on every step; copy fits without
   walls of text.
2. **Bend test (sim mode)**: with no camera the sim strip appears with a
   working slider; **↻ Restart the test** starts a clean run.
3. **Now view (sim mode)**: sim slider moves the figure; the neck bends as a
   curve (no rigid hinge); numbers track the slider.
4. **Bend tab empty state**: with no logged test there is NO weekly check-in
   banner — only "Take your first test".

## Manual — iPhone device build (~10 min)

`npm i && npx cap sync ios`, run from Xcode on a real device:

1. **OAuth round-trip (the freeze)**: sign in with Google. The moment
   onboarding appears, the welcome figure must be ANIMATING and the first
   tap must visibly advance the step. If the screen is static, the WKWebView
   render-freeze regressed.
2. **Motion permission + calibration**: step 3's "Enable motion sensors"
   prompts, calibration captures, and the toast shows your angle.
3. **Camera step**: starting the test auto-scrolls the camera into view;
   the status reads "loading the pose model" (not "waking up the camera")
   while the model downloads; if you throttle the network it falls back to
   sim mode within ~20 s instead of spinning forever.
4. **Flat-phone guard**: on the Now tab, put the phone flat on a table.
   Within ~8 s it must read "😴 Phone at rest", NOT a 60°+ stoop.
5. **Uncalibrated chip**: fresh install, skip calibration → the Now tab
   shows the "Uncalibrated" chip; tapping it opens calibration.
6. **Live notification**: enable nudges, background-lock nothing — with the
   app open, stoop hard for ~8 s → a silent local notification appears
   (requires `@capacitor/local-notifications` synced into the iOS project).
7. **Safe areas**: the settings gear and logo clear the notch; the tab bar
   clears the home indicator; onboarding dots/CTA clear the bottom inset.
8. **Sign out / Start over**: both reload into a clean, working login.

## Known non-issues

- Xcode warnings `'WKProcessPool' is deprecated` come from the
  `CapacitorCordova` pod (Capacitor 6's Cordova compat layer) — harmless,
  not our code; they go away with a future Capacitor major upgrade.
- `[CP] Embed Pods Frameworks … every build` is standard CocoaPods behavior.
