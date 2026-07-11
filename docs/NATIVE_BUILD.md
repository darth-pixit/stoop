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

> The native platform folders (`ios/`, `android/`) **are committed**, with the
> `stoop://` deep link and camera/motion permissions already wired in. Build
> outputs, Pods, and cap-sync-copied assets are excluded by each folder's own
> `.gitignore`, so after cloning you populate those with `npx cap sync`.

## 1. Install and sync

```bash
npm install
npx cap sync          # copies www/ into both projects + wires native plugins
```

(`npm run vendor:supabase` re-bundles the Supabase SDK into
`www/js/vendor/supabase.js`; only needed after bumping the SDK version.)

Whenever you change anything in `www/`, copy it into the native projects:

```bash
npx cap copy          # push web assets only (fast)
npx cap sync          # copy + update native plugins (after npm install changes)
```

## 2. What's already wired (reference)

Native SSO opens the system browser and returns to the app via the `stoop`
custom URL scheme — registered in both projects, so nothing to do here. For
reference:

### iOS — `ios/App/App/Info.plist` (done)

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>stoop</string></array>
  </dict>
</array>
```

Also present: `NSCameraUsageDescription` (bend test) and
`NSMotionUsageDescription` (tilt monitoring).

### Android — `android/app/src/main/AndroidManifest.xml` (done)

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="stoop" android:host="auth" />
</intent-filter>
```

Also present: the `CAMERA` permission for the bend test.

### Still manual (Xcode, only when Apple SSO is enabled)

When you turn on Sign in with Apple (see BACKEND_SETUP.md), select the **App**
target in Xcode → **Signing & Capabilities** → **+ Capability** → **Sign in
with Apple**, and set the bundle identifier to your App ID
(`app.stoop.mobile`). Not needed while the login is Google-only.

Make sure the Supabase project lists `stoop://auth/callback` under
**Authentication → URL Configuration → Redirect URLs**.

## 3. App icon & splash (optional but recommended)

Generate all sizes from a single source image with the official tool:

```bash
npx @capacitor/assets generate --iconBackgroundColor '#FAF6EF' --splashBackgroundColor '#FAF6EF'
```

(Provide `assets/icon.png` @ 1024×1024 and `assets/splash.png` @ 2732×2732.)

## 4. Run on a simulator / device

```bash
npx cap open ios        # opens Xcode → pick a simulator/device → ▶
npx cap open android    # opens Android Studio → pick an emulator/device → ▶
```

The camera (bend test), motion sensors and notifications behave like a real app
here — including background-capable behaviour the browser can't offer.

## 5. Distribute to beta testers — without Expo

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

## 6. Updating a beta build

1. Edit the web app in `www/` (or pull new commits).
2. `npm run vendor:supabase` only if the SDK version changed.
3. `npx cap copy` (or `npx cap sync`).
4. Bump the version/build number, re-archive/re-bundle, and re-upload.

Because the UI is plain web assets, most iterations are just steps 1 + 3 + a
rebuild — no Expo, no EAS, no over-the-air service required.
