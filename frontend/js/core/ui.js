// UI primitives: modal / bottom sheet, confirm dialog, toast, tooltips.
import { $, html, setHTML } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

// ------------------------------------------------------------------ modal

const stack = [];
let ignorePops = 0;
let seq = 0;

window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops -= 1; return; }
  const top = stack[stack.length - 1];
  if (top) top.close({ fromHistory: true });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault();
    stack[stack.length - 1].close();
  }
});

/**
 * openModal({ title, content, wide, onMount(body, ctrl), onClose })
 * Renders as a centred dialog on desktop and a bottom sheet on phones.
 */
export function openModal({ title, content, wide = false, onMount, onClose, className = '' }) {
  const id = `m${++seq}`;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  setHTML(wrap, html`
    <div class="modal-backdrop" data-close></div>
    <section class="modal ${wide ? 'modal-wide' : ''} ${className}" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="modal-head">
        <h2 id="${id}-t">${title}</h2>
        <button type="button" class="btn-icon" data-close aria-label="${t('common.close')}">${icon('x')}</button>
      </header>
      <div class="modal-body">${content}</div>
    </section>`);
  $('#modals').appendChild(wrap);
  document.body.classList.add('modal-open');
  const previousFocus = document.activeElement;

  let closed = false;
  const ctrl = {
    el: wrap,
    body: wrap.querySelector('.modal-body'),
    close({ fromHistory = false } = {}) {
      if (closed) return;
      closed = true;
      const idx = stack.indexOf(ctrl);
      if (idx >= 0) stack.splice(idx, 1);
      if (!fromHistory) { ignorePops += 1; history.back(); }
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 240);
      if (!stack.length) document.body.classList.remove('modal-open');
      if (previousFocus && previousFocus.focus) { try { previousFocus.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
      if (onClose) onClose();
    },
    setTitle(text) { wrap.querySelector('.modal-head h2').textContent = text; },
  };
  stack.push(ctrl);
  history.pushState({ modal: id }, '');
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) ctrl.close();
  });
  requestAnimationFrame(() => {
    wrap.classList.add('open');
    const first = wrap.querySelector('[autofocus], input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select');
    if (first && !matchMedia('(hover: none)').matches) first.focus({ preventScroll: true });
    else wrap.querySelector('.modal').focus?.();
  });
  if (onMount) onMount(ctrl.body, ctrl);
  return ctrl;
}

/** Close every modal without touching history (used on route changes). */
export function closeAllModals() {
  while (stack.length) stack[stack.length - 1].close({ fromHistory: true });
}

export const hasOpenModal = () => stack.length > 0;

export function confirmDialog({ title, text = '', ok = t('common.delete'), danger = true }) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title,
      className: 'modal-small',
      content: html`
        ${text ? html`<p class="muted">${text}</p>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="no">${t('common.cancel')}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="yes">${ok}</button>
        </div>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    m.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      answered = true;
      resolve(b.dataset.act === 'yes');
      m.close();
    });
  });
}

// ------------------------------------------------------------------ toast

let toastTimer = null;

export function toast(text, { action, tone = 'info', duration = 3600 } = {}) {
  const host = $('#toast');
  if (!host) return;
  const glyph = tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info';
  setHTML(host, html`
    <div class="toast toast-${tone}" role="status">
      <span class="toast-ic">${icon(glyph, 18)}</span>
      <span class="toast-text">${text}</span>
      ${action ? html`<button type="button" class="toast-btn">${action.label}</button>` : ''}
    </div>`);
  host.classList.add('show');
  const btn = host.querySelector('.toast-btn');
  if (btn) btn.addEventListener('click', () => { hideToast(); action.fn(); }, { once: true });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? Math.max(duration, 5000) : duration);
}

export function hideToast() {
  const host = $('#toast');
  if (host) host.classList.remove('show');
}

// ------------------------------------------------------------------ tooltips ([data-tip])

export function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let current = null;
  let hideTimer = null;

  const show = (el) => {
    current = el;
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const hide = () => { current = null; tip.classList.remove('show'); };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[data-tip]');
    if (el && el !== current) show(el);
    else if (!el && current) hide();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el || !matchMedia('(hover: none)').matches) return;
    show(el);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 2600);
  });
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
}

// ------------------------------------------------------------------ small render helpers

export const emptyState = (glyph, text, button) => html`
  <div class="empty">
    <div class="empty-ic">${icon(glyph, 26)}</div>
    <p>${text}</p>
    ${button || ''}
  </div>`;

export const field = (label, control, hint) => html`
  <label class="field">
    <span class="field-label">${label}</span>
    ${control}
    ${hint ? html`<span class="field-hint">${hint}</span>` : ''}
  </label>`;

/** Radio chips that work with FormData. options: [{ value, label, icon? }] */
export const chips = (name, options, value, { cls = '' } = {}) => html`
  <div class="chips ${cls}" role="radiogroup">
    ${options.map((o) => html`
      <label class="chip ${o.cls || ''}">
        <input type="radio" name="${name}" value="${o.value}" ${String(o.value) === String(value) ? 'checked' : ''}>
        <span>${o.icon || ''}${o.label}</span>
      </label>`)}
  </div>`;

export const segmented = (name, options, value) => html`
  <div class="seg" role="tablist">
    ${options.map((o) => html`
      <button type="button" role="tab" class="seg-btn ${o.value === value ? 'active' : ''}" data-seg="${name}" data-value="${o.value}" aria-selected="${o.value === value}">
        ${o.icon || ''}<span>${o.label}</span>
      </button>`)}
  </div>`;

/** Show API / validation errors inside a form. */
export function formError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('p');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    const actions = form.querySelector('.modal-actions');
    if (actions) actions.before(box);
    else form.appendChild(box);
  }
  box.textContent = message || '';
  box.hidden = !message;
}

export function errorText(err) {
  const code = err && err.code ? err.code : 'network';
  const key = `err.${code}`;
  const msg = t(key);
  return msg === key ? t('err.generic') : msg;
}
