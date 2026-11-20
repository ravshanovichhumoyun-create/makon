// Optional app lock (PIN). The PIN never leaves the device; only a salted PBKDF2 hash is stored.
import { html, setHTML } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

const KEY = 'makon.lock';
const MAX_FAILS = 10;
let hiddenAt = 0;
let overlay = null;

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
const write = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (_) { /* ignore */ } };

export const lockAvailable = () => !!(window.crypto && crypto.subtle && window.isSecureContext);

export function lockConfig(userId) {
  const cfg = read();
  return cfg && cfg.userId === userId ? cfg : null;
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function derive(pin, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

export async function setPin(userId, pin, timeout = 5) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  write({ userId, salt, hash: await derive(pin, salt), len: pin.length, timeout, fails: 0, until: 0 });
}

export function setTimeoutMinutes(userId, minutes) {
  const cfg = lockConfig(userId);
  if (cfg) write({ ...cfg, timeout: minutes });
}

export const disableLock = () => write(null);

async function check(cfg, pin) {
  return (await derive(pin, cfg.salt)) === cfg.hash;
}

export function watchVisibility(userId, onLock) {
  document.addEventListener('visibilitychange', () => {
    const cfg = lockConfig(userId);
    if (!cfg) return;
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > cfg.timeout * 60000) { hiddenAt = 0; onLock(); }
  });
}

export const isLocked = () => !!overlay;

/** Show the lock screen; resolves when unlocked. onForgot() signs the user out. */
export function showLock(userId, { onForgot }) {
  const cfg = lockConfig(userId);
  if (!cfg || overlay) return Promise.resolve();
  return new Promise((resolve) => {
    let pin = '';
    overlay = document.createElement('div');
    overlay.className = 'lock';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    const paint = (msg = '') => {
      setHTML(overlay, html`
        <div class="lock-box">
          <div class="lock-logo">${icon('lock', 26)}</div>
          <h2>${t('lock.enter')}</h2>
          <div class="pin-dots ${msg ? 'shake' : ''}" aria-live="polite">
            ${Array.from({ length: cfg.len }, (_, i) => html`<i class="${i < pin.length ? 'on' : ''}"></i>`)}
          </div>
          <p class="lock-msg">${msg}</p>
          <div class="pin-pad">
            ${keys.map((k) => (k ? html`<button type="button" class="pin-key" data-k="${k}" aria-label="${k === '⌫' ? t('common.delete') : k}">${k === '⌫' ? icon('backspace', 22) : k}</button>` : html`<span></span>`))}
          </div>
          <button type="button" class="btn btn-link" data-forgot>${t('lock.forgot')}</button>
        </div>`);
    };
    const submit = async () => {
      const cur = read();
      if (!cur) return;
      if (cur.until && Date.now() < cur.until) {
        pin = '';
        paint(t('lock.wait', { n: Math.ceil((cur.until - Date.now()) / 1000) }));
        return;
      }
      if (await check(cur, pin)) {
        write({ ...cur, fails: 0, until: 0 });
        overlay.remove();
        overlay = null;
        document.removeEventListener('keydown', onKey);
        resolve();
        return;
      }
      const fails = (cur.fails || 0) + 1;
      pin = '';
      if (fails >= MAX_FAILS) {
        // someone is guessing: sign out and wipe this device (the data stays safe on the server)
        write(null);
        paint(t('lock.wiped'));
        setTimeout(() => onForgot(), 1600);
        return;
      }
      // 5th miss: 30 s, then 1, 2, 4… minutes (max 15)
      const wait = fails >= 5 ? Math.min(15 * 60, 30 * 2 ** (fails - 5)) : 0;
      write({ ...cur, fails, until: wait ? Date.now() + wait * 1000 : 0 });
      const left = MAX_FAILS - fails;
      paint(wait ? `${t('lock.wait', { n: wait })} · ${t('lock.attemptsLeft', { n: left })}`
        : fails >= 3 ? `${t('lock.wrong')} · ${t('lock.attemptsLeft', { n: left })}` : t('lock.wrong'));
    };
    const pressKey = (k) => {
      if (k === '⌫') pin = pin.slice(0, -1);
      else if (/^\d$/.test(k) && pin.length < cfg.len) pin += k;
      paint();
      if (pin.length === cfg.len) setTimeout(submit, 60);
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) pressKey(e.key);
      else if (e.key === 'Backspace') pressKey('⌫');
    };
    overlay.addEventListener('click', (e) => {
      const key = e.target.closest('[data-k]');
      if (key) pressKey(key.dataset.k);
      if (e.target.closest('[data-forgot]')) onForgot();
    });
    document.addEventListener('keydown', onKey);
    paint();
    document.body.appendChild(overlay);
  });
}

export function removeLockScreen() {
  if (overlay) { overlay.remove(); overlay = null; }
}
