// Tiny UI helpers: toasts and bottom-sheet modals.

// Escape a value for safe interpolation into an innerHTML template. Provider
// profile fields and any cloud-synced strings are attacker-influenced, so every
// dynamic string dropped into markup must go through this.
export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Only allow http(s)/data-image URLs into an img src, then escape for the
// attribute — blocks javascript: and attribute-breakout payloads.
export function safeImageUrl(url) {
  const s = String(url || '');
  return /^https?:\/\//i.test(s) || /^data:image\//i.test(s) ? escapeHtml(s) : '';
}

export function toast(msg, ms = 2600) {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s ease';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, ms);
}

// Opens a bottom sheet. Returns { el, close }. onClose fires on any dismissal.
export function sheet(innerHTML, { onClose } = {}) {
  const root = document.getElementById('modal-root');
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `<div class="modal-sheet"><div class="sheet-grab"></div>${innerHTML}</div>`;
  root.appendChild(scrim);

  function close() {
    scrim.remove();
    onClose?.();
  }
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  scrim.querySelector('[data-close]')?.addEventListener('click', close);
  return { el: scrim.firstElementChild, close };
}
