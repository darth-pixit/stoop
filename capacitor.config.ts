import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor wraps the existing buildless web app in `www/` as native iOS and
// Android apps — no Expo, no rewrite. The whole PWA ships inside the binary.
const config: CapacitorConfig = {
  appId: 'app.stoop.mobile',
  appName: 'Stoop',
  webDir: 'www',
  // `stoop://` deep links carry the OAuth (SSO) callback back into the app.
  // The scheme is also registered in the native projects (see docs/NATIVE_BUILD.md).
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  ios: {
    // Allow the SSO system browser (SFSafariViewController) to hand control back.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    // Keep the launch splash brief; the JS boot swaps to the login/app shell.
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#FAF6EF',
      showSpinner: false,
    },
  },
};

export default config;
