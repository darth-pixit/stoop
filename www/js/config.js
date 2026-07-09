// ── Backend configuration ───────────────────────────────────────────────────
// Stoop works with NO backend at all (local-only, exactly like before). Fill in
// a Supabase URL + anon key below to switch on SSO login and per-user cloud sync.
//
// The Supabase *anon* key is a publishable client key — it is designed to ship
// inside apps and is safe to commit. Your data is protected by Row-Level
// Security (see supabase/migrations), NOT by hiding this key.
//
// Prefer not to edit this committed file? Define `window.STOOP_CONFIG` from an
// inline script in index.html (or a gitignored js/config.local.js you load
// before the app module) — its keys override the defaults below with no
// extra network request. See docs/BACKEND_SETUP.md for the full walkthrough.

const DEFAULT = {
  supabaseUrl: '',
  supabaseAnonKey: '',

  // Which SSO buttons to show on the login screen.
  providers: { apple: true, google: true, email: false },

  // Deep-link scheme for the native OAuth callback. Must match the custom URL
  // scheme registered in the iOS/Android projects and capacitor.config.ts.
  authScheme: 'stoop',

  // When configured, require sign-in before using the app. Set false to keep a
  // "continue without an account" (local-only) escape hatch.
  requireLogin: true,
};

// Optional runtime override (kept out of git if you prefer): set before boot via
//   <script>window.STOOP_CONFIG = { supabaseUrl: '…', supabaseAnonKey: '…' }</script>
const overrides = (typeof globalThis !== 'undefined' && globalThis.STOOP_CONFIG) || {};

export const CONFIG = { ...DEFAULT, ...overrides };

// True once real Supabase credentials are present. Everything auth/sync-related
// no-ops until then, so the app stays fully demoable with zero configuration.
export const isConfigured = () =>
  Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
