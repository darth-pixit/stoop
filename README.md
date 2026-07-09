# stoop. 🙂→🫠

A playful little web app that watches the angle of your phone while you scroll
and shows you — live, in kilograms — what your slouch is doing to your neck.

## What it does

- **Live monitor** — reads the phone's pitch via the DeviceOrientation API,
  estimates your neck flexion against a personal "good posture" calibration,
  and animates a side-profile character carrying the equivalent strain
  (Hansraj 2014: 0° ≈ 5 kg → 60° ≈ 27 kg… "a mini fridge 🧊").
- **Live nudges** — after ~10s of sustained stooping you get a silent system
  notification with the angle + kg, plus an in-app live pill on other tabs.
- **Stats** — time spent stooping today, a 14-day trend of *stoop share*
  (stooping time as a % of monitored phone time, so heavy-usage days can't
  fake progress) with an improving/worsening verdict, and a breakdown by
  stooping zone (Upright / Mild / Deep / Full gargoyle).
- **Mobility impact** — drag a slider through the angles and watch what each
  degree costs you in strain and side-bend range.
- **Moves** — six curated exercises with animated demos and a guided
  start/log player (chin tucks, ear-to-shoulder, owl turns, shoulder rolls,
  doorway opener, sky reach).
- **Bend tests** — a guided ear-to-shoulder flexibility test that watches
  *you* through the front camera (MediaPipe pose landmarks, on-device). It
  measures the real angle your head tilts from vertical — the roll of your
  eye/ear line — with a live skeleton overlay, then zeroes, tracks, and locks
  your angle in real time. Crucially it also watches your shoulders: if one
  creeps up toward your ear to fake range, that tilt earns nothing and you get
  coached to drop it, so the logged number is honest neck flexibility, not a
  shrug. Each result is graded (Limited → Fair → Good → Excellent against a
  ~45° healthy range) so you know where you stand, not just the trend. Form
  nudges catch the usual cheats (moving too fast, forward nod instead of a
  side-bend, not starting tall, giving up early). Left/right angles are logged
  and charted; a weekly check-in day keeps you re-testing. Where no camera is
  available (or permission is declined) the test drops into a clearly-labelled
  simulation so it stays demoable.

## Run it (web / PWA)

The web app lives in `www/` and needs no build step. Any static server works:

```bash
npm run serve          # python3 -m http.server 8000 --directory www
# → http://localhost:8000 (open on your phone for real sensors)
```

On desktops without motion sensors the app drops into **simulation mode**
automatically — sliders stand in for the sensors so every screen is usable.

For real sensor data on a phone you need HTTPS (or localhost). iOS asks for
motion permission on a button tap during setup.

## iOS & Android apps (Capacitor — not Expo)

The native apps are the same `www/` web app wrapped by
[Capacitor](https://capacitorjs.com): a real Xcode project and a real Android
Studio project, no rewrite and no Expo. Ship them to beta testers via TestFlight
and Google Play internal testing.

```bash
npm install
npx cap add ios        # generates ios/ (gitignored)
npx cap add android    # generates android/ (gitignored)
npx cap copy           # after any change under www/
```

Full walkthrough — deep-link/SSO setup, icons, and beta distribution — in
[`docs/NATIVE_BUILD.md`](docs/NATIVE_BUILD.md).

## Accounts & cloud sync (optional SSO)

Out of the box Stoop is local-only with no login. Drop in a Supabase URL + anon
key ([`docs/BACKEND_SETUP.md`](docs/BACKEND_SETUP.md)) and it gains:

- **Sign in with Apple / Google** (and an optional email magic link) on a login
  screen, gating the app.
- **Per-user cloud sync** — every detail (calibration, day stats, bend tests,
  moves, settings) saved to your account and restored on any device or after a
  reinstall. It's offline-first: `localStorage` stays the working copy and syncs
  in the background, last-write-wins across devices.

With no credentials configured, none of this appears and the app behaves exactly
as it always has.

## Honest limitations

- A browser tab can only watch your posture **while it's open and
  on-screen** — background monitoring and true OS-level overlay
  notifications need the native (Capacitor) app.
- "Phone usage time" is therefore *monitored* time, which is exactly what
  the stoop-share stat normalises against.
- Without a backend configured, all data stays in `localStorage` — no
  accounts, no servers. Add Supabase credentials to enable SSO login and
  per-user cloud sync (see above); data is then private to your account and
  protected by row-level security.
- The bend test's pose model + wasm are fetched once from a CDN
  (`@mediapipe/tasks-vision`) and then cached by the browser; the **camera
  frames themselves never leave the device** — all inference is on-device.
  First use needs a network connection and camera permission (HTTPS/localhost).
- Strain numbers are the Hansraj (2014) cervical-load estimates — playful
  motivation, not medical advice.

## Design notes

- Typeface: Proxima Nova, falling back to Mulish (bundled via Google Fonts)
  for machines without a Proxima Nova licence.
- Chart palette (trend teal `#0E8F82`, flex violet `#7C5CE0`, zone
  green/amber/orange/red) validated for lightness band, chroma, CVD
  separation and surface contrast; the amber zone sits below 3:1 on white so
  it always ships with a direct label.
- No build step, no framework: vanilla ES modules + SVG, installable PWA. The
  native apps reuse the exact same assets via Capacitor; the Supabase SDK is
  vendored to a single self-contained file (`npm run vendor:supabase`) so even
  the auth/sync layer stays buildless at runtime.
