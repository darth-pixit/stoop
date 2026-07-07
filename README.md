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
- **Bend tests** — a guided ear-to-shoulder flexibility test using the
  phone's gravity sensor: hold the phone to your ear, tilt, and it zeroes,
  annotates, and locks your angle in real time. Form nudges catch the usual
  cheats (moving too fast, tipping forward instead of sideways, jittery
  phone, not starting tall, giving up early) and a post-test honesty check
  flags shoulder-creep. Left/right angles are logged and charted; a weekly
  check-in day keeps you re-testing.

## Run it

Any static server works:

```bash
python3 -m http.server 8000
# → http://localhost:8000 (open on your phone for real sensors)
```

On desktops without motion sensors the app drops into **simulation mode**
automatically — sliders stand in for the sensors so every screen is usable.

For real sensor data on a phone you need HTTPS (or localhost). iOS asks for
motion permission on a button tap during setup.

## Honest limitations

- A browser tab can only watch your posture **while it's open and
  on-screen** — background monitoring and true OS-level overlay
  notifications need a native wrapper (the UI says so too).
- "Phone usage time" is therefore *monitored* time, which is exactly what
  the stoop-share stat normalises against.
- All data stays in `localStorage`. No accounts, no servers.
- Strain numbers are the Hansraj (2014) cervical-load estimates — playful
  motivation, not medical advice.

## Design notes

- Typeface: Proxima Nova, falling back to Mulish (bundled via Google Fonts)
  for machines without a Proxima Nova licence.
- Chart palette (trend teal `#0E8F82`, flex violet `#7C5CE0`, zone
  green/amber/orange/red) validated for lightness band, chroma, CVD
  separation and surface contrast; the amber zone sits below 3:1 on white so
  it always ships with a direct label.
- No build step, no framework: vanilla ES modules + SVG, installable PWA.
