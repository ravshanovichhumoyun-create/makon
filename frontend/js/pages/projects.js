import { progress } from '../core/charts.js';
import { $, html, on, safeUrl, setHTML, uuid } from '../core/dom.js';
import * as D from '../core/dates.js';
import { dateShort, t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import * as store from '../core/store.js';
import { confirmDialog, emptyState, openModal, toast } from '../core/ui.js';

const STATUSES = ['planned', 'active', 'done'];
const ui = { filter: 'all' };
let root = null;

export function deadlineInfo(p) {
  if (!p.deadline || p.status === 'done') return null;
  const d = D.diffDays(D.today(), p.deadline);
  if (d < 0) return { text: t('proj.overdue', { n: -d }), tone: 'bad' };
  if (d === 0) return { text: t('rel.today'), tone: 'warn' };
  return { text: t('proj.daysLeft', { n: d }), tone: d <= 3 ? 'warn' : '' };
}

const pctOf = (p) => {
  const subs = p.subtasks || [];
  if (!subs.length) return p.status === 'done' ? 100 : 0;
  return (subs.filter((s) => s.done).length / subs.length) * 100;
};

function card(p) {
  const subs = p.subtasks || [];
  const dl = deadlineInfo(p);
  const link = safeUrl(p.link);
  return html`
    <article class="card project">
      <header class="project-head">
        <select class="status-select status-${p.status}" data-status="${p.id}" aria-label="${t('proj.status')}">
          ${STATUSES.map((s) => html`<option value="${s}" ${p.status === s ? 'selected' : ''}>${t(`proj.st.${s}`)}</option>`)}
        </select>
        <div class="project-tools">
          ${link ? html`<a class="btn-icon btn-icon-sm" href="${link}" target="_blank" rel="noopener noreferrer" data-tip="${link}" aria-label="${t('proj.link')}">${icon('external', 16)}</a>` : ''}
          <button type="button" class="btn-icon btn-icon-sm" data-edit="${p.id}" aria-label="${t('common.edit')}">${icon('edit', 16)}</button>
        </div>
      </header>
      <h3>${p.title}</h3>
      ${p.description ? html`<p class="muted small clamp-3">${p.description}</p>` : ''}
      ${(p.tags || []).length ? html`<div class="tags">${p.tags.map((tg) => html`<span class="tag">${tg}</span>`)}</div>` : ''}
      <div class="project-progress">
        ${progress(pctOf(p), { tone: p.status === 'done' ? 'good' : 'accent' })}
        <span class="small muted">${subs.filter((s) => s.done).length}/${subs.length}</span>
        ${dl ? html`<span class="due ${dl.tone ? `due-${dl.tone}` : ''}">${icon('clock', 12)}${dl.text}</span>` : p.deadline ? html`<span class="small muted">${dateShort(p.deadline)}</span>` : ''}
      </div>
      <div class="subtasks">
        ${subs.map((s) => html`
          <div class="subtask ${s.done ? 'is-done' : ''}">
            <button type="button" class="check check-sm ${s.done ? 'on' : ''}" data-sub-toggle="${p.id}" data-sub="${s.id}" aria-pressed="${s.done}" aria-label="${s.text}">${icon('check', 12)}</button>
            <span>${s.text}</span>
            <button type="button" class="btn-icon btn-icon-xs" data-sub-del="${p.id}" data-sub="${s.id}" aria-label="${t('common.delete')}">${icon('x', 14)}</button>
          </div>`)}
        <form class="inline-add inline-add-sm" data-sub-add="${p.id}" autocomplete="off">
          <input class="input input-sm" name="text" maxlength="300" placeholder="${t('proj.stepPh')}" aria-label="${t('proj.stepPh')}">
          <button class="btn-icon btn-icon-sm" aria-label="${t('common.add')}">${icon('plus', 16)}</button>
        </form>
      </div>
    </article>`;
}

function openProjectSheet(p = null) {
  const m = openModal({
    title: p ? t('proj.edit') : t('proj.new'),
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('proj.title')}</span><input class="input" name="title" required maxlength="200" value="${p ? p.title : ''}"></label>
      <div class="field"><span class="field-label">${t('proj.status')}</span>
        <div class="chips">${STATUSES.map((s) => html`<label class="chip"><input type="radio" name="status" value="${s}" ${(p ? p.status : 'planned') === s ? 'checked' : ''}><span>${t(`proj.st.${s}`)}</span></label>`)}</div></div>
      <div class="form-row">
        <label class="field"><span class="field-label">${t('proj.deadline')}</span><input class="input" type="date" name="deadline" value="${p && p.deadline ? p.deadline : ''}"></label>
        <label class="field"><span class="field-label">${t('proj.tags')}</span><input class="input" name="tags" maxlength="300" value="${p ? (p.tags || []).join(', ') : ''}" placeholder="Python, Figma"></label>
      </div>
      <label class="field"><span class="field-label">${t('proj.link')}</span><input class="input" type="url" name="link" maxlength="500" inputmode="url" value="${p ? p.link : ''}" placeholder="https://github.com/…"></label>
      <label class="field"><span class="field-label">${t('proj.desc')}</span><textarea class="input" name="description" rows="3" maxlength="20000">${p ? p.description : ''}</textarea></label>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${p ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  const el = form.elements;
  const fail = (msg) => { const b = $('.form-error', form); b.textContent = msg; b.hidden = false; };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    if (!title) return fail(t('err.required'));
    let link = el.link.value.trim();
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
    if (link && !safeUrl(link)) return fail(t('proj.errLink'));
    const tags = [...new Set(el.tags.value.split(',').map((s) => s.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
    store.put('projects', {
      ...(p ? { id: p.id } : { subtasks: [] }),
      title, status: el.status.value || 'planned', deadline: D.isDate(el.deadline.value) ? el.deadline.value : null,
      tags, link, description: el.description.value.trim(),
    });
    m.close();
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    if (await confirmDialog({ title: t('proj.deleteQ') })) {
      const old = store.remove('projects', p.id);
      m.close();
      toast(t('common.deleted'), { action: { label: t('common.undo'), fn: () => store.restore('projects', old) } });
    }
  });
}

function view() {
  const all = store.all('projects');
  if (!all.length) return html`<section class="card">${emptyState('layers', t('proj.empty'), html`<button class="btn btn-primary" data-new>${icon('plus', 18)}${t('proj.new')}</button>`)}</section>`;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((p) => p.status === s).length]));
  const sortFn = (a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || b.updated_at - a.updated_at;
  return html`
    <div class="chips chips-scroll board-filter">
      <button type="button" class="chip-btn ${ui.filter === 'all' ? 'active' : ''}" data-filter="all">${t('common.all')} <span class="count">${all.length}</span></button>
      ${STATUSES.map((s) => html`<button type="button" class="chip-btn ${ui.filter === s ? 'active' : ''}" data-filter="${s}">${t(`proj.st.${s}`)} <span class="count">${counts[s]}</span></button>`)}
    </div>
    <div class="board ${ui.filter !== 'all' ? 'board-single' : ''}">
      ${STATUSES.filter((s) => ui.filter === 'all' || ui.filter === s).map((s) => html`
        <section class="board-col">
          <h4 class="group-title"><span class="status-dot status-${s}"></span>${t(`proj.st.${s}`)} <span>${counts[s]}</span></h4>
          ${all.filter((p) => p.status === s).sort(sortFn).map(card)}
          ${!counts[s] ? html`<p class="muted small week-empty">—</p>` : ''}
        </section>`)}
    </div>`;
}

function paint() {
  if (!root) return;
  const active = document.activeElement;
  const refocus = active && active.closest && active.closest('[data-sub-add]') ? active.closest('[data-sub-add]').dataset.subAdd : null;
  setHTML($('[data-region]', root), view());
  if (refocus) { const f = root.querySelector(`[data-sub-add="${refocus}"] input`); if (f) f.focus(); }
}

function updateSubtasks(projectId, fn) {
  const p = store.get('projects', projectId);
  if (!p) return;
  store.put('projects', { id: p.id, subtasks: fn((p.subtasks || []).map((s) => ({ ...s }))) });
}

export default {
  id: 'projects',
  deps: ['projects'],
  title: () => t('nav.projects'),
  mount(el) {
    root = el;
    setHTML(el, html`
      <header class="page-head"><h1>${t('nav.projects')}</h1>
        <div class="page-actions"><button type="button" class="btn btn-primary hide-mobile" data-new>${icon('plus', 18)}${t('proj.new')}</button></div></header>
      <div data-region></div>`);
    paint();
    on(el, 'click', '[data-new]', () => openProjectSheet());
    on(el, 'click', '[data-edit]', (e, b) => { const p = store.get('projects', b.dataset.edit); if (p) openProjectSheet(p); });
    on(el, 'click', '[data-filter]', (e, b) => { ui.filter = b.dataset.filter; paint(); });
    on(el, 'click', '[data-sub-toggle]', (e, b) => updateSubtasks(b.dataset.subToggle, (subs) => subs.map((s) => (s.id === b.dataset.sub ? { ...s, done: !s.done } : s))));
    on(el, 'click', '[data-sub-del]', (e, b) => updateSubtasks(b.dataset.subDel, (subs) => subs.filter((s) => s.id !== b.dataset.sub)));
    el.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-status]');
      if (sel) store.put('projects', { id: sel.dataset.status, status: sel.value });
    });
    el.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-sub-add]');
      if (!form) return;
      e.preventDefault();
      const text = form.elements.text.value.trim().slice(0, 300);
      if (!text) return;
      updateSubtasks(form.dataset.subAdd, (subs) => (subs.length >= 300 ? subs : [...subs, { id: uuid(), text, done: false }]));
    });
  },
  update() { paint(); },
  unmount() { root = null; },
  fab() { openProjectSheet(); },
};
