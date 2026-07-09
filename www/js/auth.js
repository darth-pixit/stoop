// ── Authentication (SSO) ─────────────────────────────────────────────────────
// Thin wrapper over Supabase Auth that works both on the web (PWA) and inside
// the Capacitor native shell. Providers: Sign in with Apple + Google.
//
//  • Web:    signInWithOAuth() does a full-page redirect back to the app; the
//            Supabase client picks the session out of the return URL.
//  • Native: we ask Supabase for the provider URL, open it in the system
//            browser (@capacitor/browser), and catch the `stoop://auth/callback`
//            deep link (@capacitor/app) to exchange the code for a session.
//
// If the backend isn't configured, every call here is a safe no-op so the app
// keeps running local-only.
import { CONFIG, isConfigured } from './config.js';

// Capacitor injects `window.Capacitor` only inside the native runtime. On the
// plain web it's undefined and we take the redirect path.
const cap = () => (typeof window !== 'undefined' ? window.Capacitor : undefined);
export const isNative = () => Boolean(cap()?.isNativePlatform?.());

// Buildless plugin access: the native runtime exposes `Capacitor.registerPlugin`
// which returns a proxy routed to the installed native plugin (no bundler, no
// per-plugin import needed). Memoised so listeners attach to one instance.
const _plugins = {};
function plugin(name) {
  const c = cap();
  if (!c) return undefined;
  if (_plugins[name]) return _plugins[name];
  const p = c.registerPlugin ? c.registerPlugin(name) : c.Plugins?.[name];
  if (p) _plugins[name] = p;
  return p;
}

let _client = null;
let _clientPromise = null;
const listeners = new Set();
let _user = null;

// Lazily build the Supabase client (loads the vendored SDK on first use only).
async function client() {
  if (!isConfigured()) return null;
  if (_client) return _client;
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const { createClient } = await import('./vendor/supabase.js');
      _client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // On native the return trip is a deep link, not a page load, so we
          // exchange the code by hand; on web let the SDK read the URL.
          detectSessionInUrl: !isNative(),
          flowType: 'pkce',
        },
      });
      return _client;
    })();
  }
  return _clientPromise;
}

function emit(user) {
  _user = user;
  for (const fn of listeners) { try { fn(user); } catch { /* listener error */ } }
}

// Subscribe to auth changes. Fires immediately with the current user (or null).
export function onAuthChange(fn) {
  listeners.add(fn);
  fn(_user);
  return () => listeners.delete(fn);
}

export const currentUser = () => _user;

// Normalise a Supabase user into the small shape the UI needs.
function shape(u) {
  if (!u) return null;
  const m = u.user_metadata || {};
  return {
    id: u.id,
    email: u.email || m.email || null,
    name: m.full_name || m.name || (u.email ? u.email.split('@')[0] : 'You'),
    avatar: m.avatar_url || m.picture || null,
    provider: u.app_metadata?.provider || null,
  };
}

// Call once at boot. Restores an existing session and wires listeners.
export async function init() {
  if (!isConfigured()) { emit(null); return; }
  const sb = await client();

  sb.auth.onAuthStateChange((_event, session) => emit(shape(session?.user)));

  // Native: catch the OAuth callback deep link and finish the PKCE exchange.
  const App = plugin('App');
  if (isNative() && App) {
    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url || !url.includes('auth/callback')) return;
      try {
        const code = new URL(url).searchParams.get('code');
        if (code) await sb.auth.exchangeCodeForSession(code);
      } catch (e) {
        console.warn('[auth] callback exchange failed', e);
      } finally {
        plugin('Browser')?.close?.().catch?.(() => {});
      }
    });
  }

  const { data } = await sb.auth.getSession();
  emit(shape(data?.session?.user));
}

async function oauth(provider) {
  const sb = await client();
  if (!sb) throw new Error('Backend not configured');

  if (isNative()) {
    const redirectTo = `${CONFIG.authScheme}://auth/callback`;
    const { data, error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    // Open the provider page in the system browser; the deep-link listener in
    // init() takes over when it redirects back to stoop://auth/callback.
    const Browser = plugin('Browser');
    if (Browser) await Browser.open({ url: data.url });
    else window.location.href = data.url;
    return;
  }

  // Web: full-page redirect back to wherever we are now.
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.href.split('#')[0] },
  });
  if (error) throw error;
}

export const signInWithApple = () => oauth('apple');
export const signInWithGoogle = () => oauth('google');

// Passwordless email (magic link / OTP), only used if enabled in config.
export async function signInWithEmail(email) {
  const sb = await client();
  if (!sb) throw new Error('Backend not configured');
  const emailRedirectTo = isNative()
    ? `${CONFIG.authScheme}://auth/callback`
    : window.location.href.split('#')[0];
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) throw error;
}

export async function signOut() {
  const sb = await client();
  if (sb) await sb.auth.signOut().catch(() => {});
  emit(null);
}

// Shared client accessor for the sync layer (returns null until configured).
export const supabase = client;
