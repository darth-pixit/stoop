# Building & shipping the iOS / Android apps (no Expo)

Stoop's native apps are the **existing web app wrapped by [Capacitor](https://capacitorjs.com)**.
There is no rewrite and no Expo: `www/` ships inside a normal Xcode project and a
normal Android Studio / Gradle project, which you build and hand to beta testers
through TestFlight and Google Play internal testing.

```
www/  ──►  Capacitor  ──►  ios/App/App.xcworkspace   (→ TestFlight)
                      └►  android/ (Gradle project)  (→ Play internal testing)
```

## Prerequisites

| For | Install |
| --- | --- |
| Everything | Node 18+ and npm |
| iOS | macOS, **Xcode** 15+, CocoaPods (`sudo gem install cocoapods`), an Apple Developer account ($99/yr) |
| Android | **Android Studio** (bundles the SDK + JDK); a Google Play Developer account ($25 once) for Play distribution |

> The native platform folders (`ios/`, `android/`) are **not committed** — they
> are generated per-machine (see `.gitignore`). Everything below regenerates
> them from the committed config.

## 1. Install and vendor

```bash
npm install
npm run vendor:supabase        # bundles the Supabase SDK into www/js/vendor/supabase.js
```

`www/js/vendor/supabase.js` is committed, so this is only needed after bumping
the SDK version in `package.json`.

## 2. Add the native platforms

```bash
npx cap add ios
npx cap add android
```

This reads `capacitor.config.ts` (appId `app.stoop.mobile`, appName `Stoop`,
`webDir: www`) and scaffolds both projects.

Whenever you change anything in `www/`, copy it into the native projects:

```bash
npx cap copy          # push web assets only (fast)
npx cap sync          # copy + update native plugins (after npm install changes)
```

## 3. Register the SSO deep link (`stoop://auth/callback`)

Native Sign in with Apple / Google opens the system browser and returns to the
app via a custom URL scheme. Register `stoop` in each platform.

### iOS — `ios/App/App/Info.plist`

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>stoop</string></array>
  </dict>
</array>
```

Then in Xcode select the **App** target → **Signing & Capabilities** → **+
Capability** → **Sign in with Apple**. Set the bundle identifier to the App ID
you created in [BACKEND_SETUP.md](./BACKEND_SETUP.md) (e.g. `app.stoop.mobile`).

### Android — `android/app/src/main/AndroidManifest.xml`

Inside the main `<activity>`:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="stoop" android:host="auth" />
</intent-filter>
```

Make sure the Supabase project lists `stoop://auth/callback` under
**Authentication → URL Configuration → Redirect URLs**.

## 4. App icon & splash (optional but recommended)

Generate all sizes from a single source image with the official tool:

```bash
npx @capacitor/assets generate --iconBackgroundColor '#FAF6EF' --splashBackgroundColor '#FAF6EF'
```

(Provide `assets/icon.png` @ 1024×1024 and `assets/splash.png` @ 2732×2732.)

## 5. Run on a simulator / device

```bash
npx cap open ios        # opens Xcode → pick a simulator/device → ▶
npx cap open android    # opens Android Studio → pick an emulator/device → ▶
```

The camera (bend test), motion sensors and notifications behave like a real app
here — including background-capable behaviour the browser can't offer.

## 6. Distribute to beta testers — without Expo

### iOS → TestFlight

1. In Xcode: set your Team under Signing, bump the build number.
2. **Product → Archive**, then **Distribute App → App Store Connect → Upload**.
3. In [App Store Connect](https://appstoreconnect.apple.com) open **TestFlight**,
   add the build, and invite testers (up to 100 internal, up to 10 000 external
   via a public link). No full App Store review is needed for internal testers;
   external testers get a lightweight review.

### Android → Google Play internal testing

1. In Android Studio: **Build → Generate Signed Bundle / APK → Android App
   Bundle** (create/keep an upload keystore).
2. In the [Play Console](https://play.google.com/console) create the app, go to
   **Testing → Internal testing**, upload the `.aab`, and add testers by email
   (or a Google Group). Testers get an opt-in link and install from the Play
   Store — usually live within minutes.

### Android → Firebase App Distribution (quickest, no Play Console)

Prefer to skip the Play Console for early builds? Build a debug/release `.apk`
and push it with the Firebase CLI:

```bash
firebase appdistribution:distribute app-release.apk \
  --app <firebase-app-id> --groups "beta"
```

Testers install directly from an email invite.

## 7. Updating a beta build

1. Edit the web app in `www/` (or pull new commits).
2. `npm run vendor:supabase` only if the SDK version changed.
3. `npx cap copy` (or `npx cap sync`).
4. Bump the version/build number, re-archive/re-bundle, and re-upload.

Because the UI is plain web assets, most iterations are just steps 1 + 3 + a
rebuild — no Expo, no EAS, no over-the-air service required.
