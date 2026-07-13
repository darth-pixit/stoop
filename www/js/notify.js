// Unified notifications: the Web Notification API on the web, Capacitor's
// LocalNotifications plugin inside the native shell. WKWebView has NO
// `window.Notification` at all, so without the plugin the native app can
// never nudge — every call here degrades to a safe no-op if neither backend
// is available.
const cap = () => (typeof window !== 'undefined' ? window.Capacitor : undefined);
const isNative = () => Boolean(cap()?.isNativePlatform?.());

let _ln;
function nativePlugin() {
  const c = cap();
  if (!c?.registerPlugin && !c?.Plugins) return null;
  if (_ln === undefined) {
    try { _ln = c.registerPlugin ? c.registerPlugin('LocalNotifications') : c.Plugins?.LocalNotifications; }
    catch { _ln = null; }
  }
  return _ln || null;
}

const LIVE_ID = 4242; // one stable id → each nudge replaces the previous one
const BED_ID = 4243;  // the once-per-lie "scrolling on your back" heads-up

export function supported() {
  return isNative() ? Boolean(nativePlugin()) : 'Notification' in window;
}

export async function granted() {
  try {
    if (isNative()) {
      const p = nativePlugin();
      if (!p) return false;
      const s = await p.checkPermissions();
      return s?.display === 'granted';
    }
    return 'Notification' in window && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

// Ask for permission (must be called from a user gesture on both platforms).
export async function requestPermission() {
  try {
    if (isNative()) {
      const p = nativePlugin();
      if (!p) return false;
      const s = await p.requestPermissions();
      return s?.display === 'granted';
    }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    return Notification.permission === 'granted';
  } catch {
    return false;
  }
}

let webNotif = null;

// Show/refresh a silent nudge. Same id replaces the previous notification.
async function show(id, tag, title, body, remember = false) {
  try {
    if (isNative()) {
      const p = nativePlugin();
      if (!p) return;
      await p.schedule({ notifications: [{ id, title, body, sound: null }] });
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, {
      tag, renotify: false, silent: true, body,
      icon: 'icons/icon.svg', badge: 'icons/icon.svg',
    });
    n.onclick = () => window.focus();
    if (remember) webNotif = n;
  } catch { /* some platforms only allow notifications from a service worker */ }
}

// The live stoop readout nudge (refreshed while the slump continues).
export const showLive = (title, body) => show(LIVE_ID, 'stoop-live', title, body, true);

// One gentle lying-down heads-up per session.
export const showBed = (title, body) => show(BED_ID, 'stoop-bed', title, body);

export async function closeLive() {
  try {
    if (isNative()) {
      await nativePlugin()?.cancel({ notifications: [{ id: LIVE_ID }] });
      return;
    }
    webNotif?.close();
    webNotif = null;
  } catch { /* already gone */ }
}
