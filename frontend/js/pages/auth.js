import { api, apiBase } from '../core/api.js';
import { setPrefs } from '../core/appctl.js';
import { $, html, setHTML } from '../core/dom.js';
import { LANGS, getLang, setLang, t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { errorText } from '../core/ui.js';

let mode = 'login'; // login | register | reset
let resetStep = 1; // 1: e-mail, 2: code + new password
let resetEmail = '';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function passwordField(name, autocomplete, hint = '') {
  return html`<label class="field"><span class="field-label">${name === 'password' && mode === 'reset' ? t('auth.newPassword') : t('auth.password')}</span>
    <div class="input-affix">
      <input class="input" type="password" name="password" autocomplete="${autocomplete}" minlength="${mode === 'login' ? 1 : 8}" maxlength="200" required>
      <button type="button" class="btn-icon btn-icon-sm" data-eye aria-label="${t('auth.show')}">${icon('eye', 18)}</button>
    </div>
    ${hint ? html`<span class="field-hint">${hint}</span>` : ''}
  </label>`;
}

function formView() {
  if (mode === 'reset') {
    return html`<form class="form" novalidate>
      <h2 class="auth-sub">${t('auth.resetTitle')}</h2>
      ${resetStep === 1 ? html`
        <p class="muted small">${t('auth.resetText')}</p>
        <label class="field"><span class="field-label">${t('auth.email')}</span><input class="input" type="email" name="email" autocomplete="email" inputmode="email" maxlength="255" value="${resetEmail}" required></label>
        <p class="muted small inline-note">${icon('info', 14)}<span>${t('auth.noTelegram')}</span></p>`
      : html`
        <p class="notice">${icon('send', 16)} ${t('auth.codeSent')}</p>
        <label class="field"><span class="field-label">${t('auth.code')}</span><input class="input input-lg code-input" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required></label>
        ${passwordField('password', 'new-password', t('auth.passwordHint'))}`}
      <p class="form-error" hidden></p>
      <button class="btn btn-primary btn-wide" data-submit>${resetStep === 1 ? t('auth.sendCode') : t('common.save')}</button>
      <button type="button" class="btn btn-link" data-mode="login">${icon('left', 16)}${t('auth.backToLogin')}</button>
    </form>`;
  }
  return html`
    <div class="seg seg-full">
      <button type="button" class="seg-btn ${mode === 'login' ? 'active' : ''}" data-mode="login">${t('auth.login')}</button>
      <button type="button" class="seg-btn ${mode === 'register' ? 'active' : ''}" data-mode="register">${t('auth.register')}</button>
    </div>
    <form class="form" novalidate>
      ${mode === 'register' ? html`<label class="field"><span class="field-label">${t('auth.name')}</span><input class="input" name="name" autocomplete="name" maxlength="80" required></label>` : ''}
      <label class="field"><span class="field-label">${t('auth.email')}</span><input class="input" type="email" name="email" autocomplete="email" inputmode="email" maxlength="255" required></label>
      ${passwordField('password', mode === 'login' ? 'current-password' : 'new-password', mode === 'register' ? t('auth.passwordHint') : '')}
      <p class="form-error" hidden></p>
      <p class="muted small" data-wait hidden>${t('auth.waking')}</p>
      <button class="btn btn-primary btn-wide" data-submit>${mode === 'login' ? t('auth.login') : t('auth.create')}</button>
      ${mode === 'login' ? html`<button type="button" class="btn btn-link" data-mode="reset">${t('auth.forgot')}</button>` : ''}
    </form>`;
}

/** Renders the sign-in / sign-up / reset screen; calls onSession({ token, user }) on success. */
export function renderAuth(host, onSession) {
  const paint = () => {
    setHTML(host, html`
      <div class="auth">
        <div class="auth-top">
          <div class="seg seg-sm">
            ${LANGS.map((l) => html`<button type="button" class="seg-btn ${getLang() === l ? 'active' : ''}" data-lang="${l}" lang="${l}">${l.toUpperCase()}</button>`)}
          </div>
        </div>
        <section class="auth-card card">
          <div class="brand brand-lg"><span class="logo">✦</span><div><b>Makon</b><small>${t('brand.tagline')}</small></div></div>
          ${formView()}
        </section>
        <p class="auth-foot muted small">${icon('shield', 14)} ${t('auth.privacy')} · <a href="${apiBase()}/privacy" target="_blank" rel="noopener">${t('set.privacy')}</a></p>
      </div>`);
    const form = $('form', host);
    const err = $('.form-error', form);
    const fail = (msg) => { err.textContent = msg; err.hidden = !msg; };

    host.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { setPrefs({ lang: b.dataset.lang }); setLang(b.dataset.lang); paint(); }));
    host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      resetStep = 1;
      paint();
    }));
    const eye = $('[data-eye]', form);
    if (eye) {
      eye.addEventListener('click', () => {
        const p = form.elements.password;
        p.type = p.type === 'password' ? 'text' : 'password';
      });
    }
    const first = form.querySelector('input');
    if (first && mode === 'reset') first.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const el = form.elements;
      const btn = $('[data-submit]', form);
      fail('');

      if (mode === 'reset') {
        try {
          btn.disabled = true;
          if (resetStep === 1) {
            const email = el.email.value.trim().toLowerCase();
            if (!EMAIL_RE.test(email)) { btn.disabled = false; return fail(t('auth.errEmail')); }
            await api.post('/api/auth/reset/request', { email }, { timeout: 75000 });
            resetEmail = email;
            resetStep = 2;
            paint();
            return;
          }
          const code = el.code.value.replace(/\D/g, '');
          if (code.length !== 6) { btn.disabled = false; return fail(t('err.bad_code')); }
          if (el.password.value.length < 8) { btn.disabled = false; return fail(t('auth.passwordHint')); }
          const res = await api.post('/api/auth/reset/confirm', { email: resetEmail, code, password: el.password.value }, { timeout: 75000 });
          mode = 'login';
          resetStep = 1;
          onSession(res);
        } catch (ex) {
          fail(errorText(ex));
          btn.disabled = false;
        }
        return;
      }

      const email = el.email.value.trim().toLowerCase();
      const password = el.password.value;
      if (mode === 'register' && !el.name.value.trim()) return fail(t('auth.errName'));
      if (!EMAIL_RE.test(email)) return fail(t('auth.errEmail'));
      if (mode === 'register' && password.length < 8) return fail(t('auth.passwordHint'));
      if (!password) return fail(t('err.required'));
      btn.disabled = true;
      const wait = setTimeout(() => { const w = $('[data-wait]', form); if (w) w.hidden = false; }, 3500);
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent';
        const res = mode === 'register'
          ? await api.post('/api/auth/register', { name: el.name.value.trim(), email, password, lang: getLang(), tz }, { timeout: 75000 })
          : await api.post('/api/auth/login', { email, password }, { timeout: 75000 });
        onSession(res);
      } catch (ex) {
        fail(errorText(ex));
        btn.disabled = false;
      } finally {
        clearTimeout(wait);
        const w = $('[data-wait]', form);
        if (w) w.hidden = true;
      }
    });
  };
  paint();
}
