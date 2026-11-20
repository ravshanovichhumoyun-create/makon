import { $, debounce, html, on, setHTML } from '../core/dom.js';
import { dateShort, t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import * as D from '../core/dates.js';
import * as store from '../core/store.js';
import { confirmDialog, emptyState, openModal, toast } from '../core/ui.js';

export const NOTE_COLORS = ['amber', 'mint', 'sky', 'rose', 'violet', 'slate'];
const ui = { q: '', tag: '' };
let root = null;

const tagsOf = () => [...new Set(store.all('notes').map((n) => n.tag).filter(Boolean))].sort();

export function noteCard(n, { compact = false } = {}) {
  return html`
    <article class="note note-${n.color || 'amber'}">
      <button type="button" class="note-open" data-open-note="${n.id}" aria-label="${n.title || t('notes.untitled')}">
        ${n.title ? html`<h3>${n.title}</h3>` : ''}
        <p class="${compact ? 'clamp-3' : 'clamp-10'}">${n.content}</p>
      </button>
      <footer>
        <span>${n.tag ? html`<span class="tag">#${n.tag}</span>` : ''}<span class="muted small">${dateShort(D.iso(new Date(n.updated_at || n.created_at)))}</span></span>
        <button type="button" class="btn-icon btn-icon-sm pin ${n.pinned ? 'on' : ''}" data-pin="${n.id}" aria-pressed="${!!n.pinned}" aria-label="${t('notes.pin')}" data-tip="${n.pinned ? t('notes.unpin') : t('notes.pin')}">${icon('pin', 16)}</button>
      </footer>
    </article>`;
}

export function openNoteSheet(note = null) {
  const tags = tagsOf();
  const m = openModal({
    title: note ? t('notes.edit') : t('notes.new'),
    content: html`<form class="form" novalidate>
      <input class="input input-title" name="title" maxlength="200" value="${note ? note.title : ''}" placeholder="${t('notes.titlePh')}" aria-label="${t('notes.titlePh')}">
      <textarea class="input note-text" name="content" rows="8" maxlength="100000" placeholder="${t('notes.contentPh')}" aria-label="${t('notes.contentPh')}">${note ? note.content : ''}</textarea>
      <div class="form-row">
        <label class="field"><span class="field-label">${t('notes.tag')}</span>
          <input class="input" name="tag" maxlength="40" list="note-tags" value="${note ? note.tag : ''}" placeholder="${t('notes.tagPh')}">
          <datalist id="note-tags">${tags.map((tg) => html`<option value="${tg}"></option>`)}</datalist></label>
        <div class="field"><span class="field-label">${t('common.color')}</span>
          <div class="swatches">${NOTE_COLORS.map((c) => html`<label class="swatch note-${c}"><input type="radio" name="color" value="${c}" ${(note ? note.color : 'amber') === c ? 'checked' : ''} aria-label="${c}"><span></span></label>`)}</div></div>
      </div>
      <label class="switch-row"><input type="checkbox" class="switch" name="pinned" ${note && note.pinned ? 'checked' : ''}><span>${icon('pin', 16)} ${t('notes.pin')}</span></label>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${note ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  const el = form.elements;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    const content = el.content.value.trim();
    if (!title && !content) { const b = $('.form-error', form); b.textContent = t('notes.errEmpty'); b.hidden = false; return; }
    store.put('notes', { ...(note ? { id: note.id } : {}), title, content, tag: el.tag.value.trim().replace(/^#/, '').slice(0, 40), color: el.color.value || 'amber', pinned: el.pinned.checked });
    m.close();
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    if (await confirmDialog({ title: t('notes.deleteQ') })) {
      const old = store.remove('notes', note.id);
      m.close();
      toast(t('common.deleted'), { action: { label: t('common.undo'), fn: () => store.restore('notes', old) } });
    }
  });
}

export function bindNoteActions(scope) {
  on(scope, 'click', '[data-open-note]', (e, b) => { const n = store.get('notes', b.dataset.openNote); if (n) openNoteSheet(n); });
  on(scope, 'click', '[data-pin]', (e, b) => { const n = store.get('notes', b.dataset.pin); if (n) store.put('notes', { id: n.id, pinned: !n.pinned }); });
}

function view() {
  const notes = store.all('notes');
  if (!notes.length) return html`<section class="card">${emptyState('note', t('notes.empty'), html`<button class="btn btn-primary" data-new>${icon('plus', 18)}${t('notes.new')}</button>`)}</section>`;
  const q = ui.q.toLowerCase();
  const list = notes
    .filter((n) => (ui.tag === '__pinned' ? n.pinned : !ui.tag || n.tag === ui.tag))
    .filter((n) => !q || `${n.title} ${n.content} ${n.tag}`.toLowerCase().includes(q))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated_at - a.updated_at);
  const tags = tagsOf();
  return html`
    <div class="toolbar">
      <div class="search"><span>${icon('search', 18)}</span><input class="input" type="search" data-search value="${ui.q}" placeholder="${t('common.search')}" aria-label="${t('common.search')}"></div>
      <div class="chips chips-scroll">
        <button type="button" class="chip-btn ${!ui.tag ? 'active' : ''}" data-tag="">${t('common.all')}</button>
        <button type="button" class="chip-btn ${ui.tag === '__pinned' ? 'active' : ''}" data-tag="__pinned">${icon('pin', 14)}${t('notes.pinned')}</button>
        ${tags.map((tg) => html`<button type="button" class="chip-btn ${ui.tag === tg ? 'active' : ''}" data-tag="${tg}">#${tg}</button>`)}
      </div>
    </div>
    ${list.length ? html`<div class="notes-grid">${list.map((n) => noteCard(n))}</div>` : html`<section class="card">${emptyState('search', t('common.nothingFound'))}</section>`}`;
}

function paint() {
  if (!root) return;
  const focused = document.activeElement && document.activeElement.matches('[data-search]');
  setHTML($('[data-region]', root), view());
  if (focused) { const s = $('[data-search]', root); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
}

export default {
  id: 'notes',
  deps: ['notes'],
  title: () => t('nav.notes'),
  mount(el) {
    root = el;
    setHTML(el, html`
      <header class="page-head"><h1>${t('nav.notes')}</h1>
        <div class="page-actions"><button type="button" class="btn btn-primary hide-mobile" data-new>${icon('plus', 18)}${t('notes.new')}</button></div></header>
      <div data-region></div>`);
    paint();
    bindNoteActions(el);
    const search = debounce((v) => { ui.q = v; paint(); }, 200);
    el.addEventListener('input', (e) => { if (e.target.matches('[data-search]')) search(e.target.value); });
    on(el, 'click', '[data-new]', () => openNoteSheet());
    on(el, 'click', '[data-tag]', (e, b) => { ui.tag = b.dataset.tag; paint(); });
  },
  update() { paint(); },
  unmount() { root = null; },
  fab() { openNoteSheet(); },
};
