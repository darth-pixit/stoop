// First screen when a backend is configured: Sign in with Apple / Google (and
// optionally an email magic link). Auth state changes are what actually advance
// the app — this screen just kicks off the provider flow and reflects progress.
import { CONFIG } from './config.js';
import { signInWithApple, signInWithGoogle, signInWithEmail, isNative } from './auth.js';
import { toast } from './ui.js';

const APPLE_MARK = '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M16.36 12.9c.03 3.02 2.65 4.02 2.68 4.04-.02.07-.42 1.43-1.38 2.83-.83 1.21-1.69 2.41-3.05 2.44-1.33.02-1.76-.79-3.28-.79-1.53 0-2 .77-3.26.81-1.31.05-2.31-1.31-3.15-2.51-1.71-2.48-3.02-7-1.26-10.05.87-1.51 2.43-2.47 4.12-2.5 1.29-.02 2.5.87 3.28.87.78 0 2.26-1.07 3.8-.92.65.03 2.46.26 3.63 1.97-.09.06-2.17 1.27-2.15 3.8M13.9 4.7c.69-.83 1.15-2 1.02-3.15-.99.04-2.19.66-2.9 1.49-.64.73-1.2 1.9-1.05 3.02 1.1.09 2.24-.56 2.93-1.36"/></svg>';
const GOOGLE_MARK = '<svg viewBox="0 0 48 48" width="19" height="19" aria-hidden="true"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07"/></svg>';

// Render the login screen into `rootEl`. `onSkip` (optional) shows a
// "continue without an account" link for local-only use.
export function renderLogin(rootEl, { onSkip } = {}) {
  rootEl.classList.remove('hidden');
  rootEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'ob-step login-step';

  const p = CONFIG.providers || {};
  const buttons = [];
  if (p.apple) buttons.push(`<button class="sso-btn apple" data-provider="apple">${APPLE_MARK}<span>Continue with Apple</span></button>`);
  if (p.google) buttons.push(`<button class="sso-btn google" data-provider="google">${GOOGLE_MARK}<span>Continue with Google</span></button>`);

  wrap.innerHTML = `
    <div class="login-mark" aria-hidden="true"><span class="logo-mark"></span></div>
    <h1>Welcome to <span class="accent">stoop.</span></h1>
    <p class="lead">Your streaks, calibration and bend tests — on every device.</p>
    <div class="sso-list">${buttons.join('')}</div>
    ${p.email ? `
      <div class="login-or"><span>or</span></div>
      <form class="email-form" novalidate>
        <input type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" aria-label="Email" required>
        <button class="btn ghost block" type="submit">Email me a magic link</button>
      </form>` : ''}
    ${onSkip ? '<button class="login-skip">Continue without an account</button>' : ''}
    <p class="login-fine">Your posture data is private to your account. See the privacy note in Settings.</p>
  `;
  rootEl.appendChild(wrap);

  let busy = false;
  const run = async (fn, label) => {
    if (busy) return;
    busy = true;
    wrap.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    toast(isNative() ? `Opening ${label}…` : `Redirecting to ${label}…`);
    try {
      await fn();
      // Web: a redirect is now under way. Native: the system browser is open and
      // the deep-link callback will complete sign-in — leave buttons disabled.
    } catch (e) {
      busy = false;
      wrap.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      toast(`Couldn't start ${label} sign-in. ${e?.message || ''}`.trim());
    }
  };

  wrap.querySelectorAll('.sso-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prov = btn.dataset.provider;
      if (prov === 'apple') run(signInWithApple, 'Apple');
      else run(signInWithGoogle, 'Google');
    });
  });

  wrap.querySelector('.email-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = e.target.querySelector('input').value.trim();
    if (!email || !email.includes('@')) { toast('Enter a valid email'); return; }
    run(() => signInWithEmail(email).then(() => toast('Check your inbox for the link ✉️')), 'email');
  });

  wrap.querySelector('.login-skip')?.addEventListener('click', () => onSkip?.());
}
