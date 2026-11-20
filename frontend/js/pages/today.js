import { challengeStatus } from '../core/activity.js';
import * as A from '../core/activity.js';
import { meter, progress } from '../core/charts.js';
import { $, html, on, raw, setHTML } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as F from '../core/finance.js';
import { confettiFrom, ringSvg } from '../core/fx.js';
import { dateShort, money, percent, t, weekdayShort } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { hydrateImages } from '../core/images.js';
import * as store from '../core/store.js';
import { confirmDialog, openModal, toast } from '../core/ui.js';
import { bindChallengeActions, challengeCard } from './challenges.js';
import { bindQuickBar, quickBar, txList } from './finance.js';
import { bindHero, heroView, refreshHero, tickHero } from './hero.js';
import { bookStatus, readBook } from './library.js';
import { bindNoteActions, openNoteSheet } from './notes.js';
import { deadlineInfo } from './projects.js';
import { bindTaskActions, courseOf, openSlotSheet, openTaskSheet, slotsFor, taskBucket, taskRow } from './study.js';
import { openTxSheet } from './txsheet.js';

let root = null;
let clockTimer = null;
let minuteTimer = null;
let lastLevel = null;

// ------------------------------------------------------------------ plans (to-dos for a day)

const byTime = (a, b) => (a.done - b.done) || (a.time || '99').localeCompare(b.time || '99') || a.created_at - b.created_at;

export function togglePlan(id) {
  const p = store.get('plans', id);
  if (!p) return;
  const done = !p.done;
  store.put('plans', { id, done, done_at: done ? D.today() : null });
}

export function openPlanSheet(plan = null) {
  const m = openModal({
    title: t('plan.edit'),
    className: 'modal-small',
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('plan.edit')}</span>
        <input class="input" name="title" required maxlength="300" value="${plan ? plan.title : ''}" placeholder="${t('plan.ph')}"></label>
      <div class="form-row">
        <label class="field"><span class="field-label">${t('plan.date')}</span><input class="input" type="date" name="date" value="${plan ? plan.date : D.today()}" required></label>
        <label class="field"><span class="field-label">${t('plan.time')}</span><input class="input" type="time" name="time" value="${plan && plan.time ? plan.time : ''}"></label>
      </div>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${plan ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const el = form.elements;
    const title = el.title.value.trim();
    const box = $('.form-error', form);
    if (!title || !D.isDate(el.date.value)) { box.textContent = t('err.required'); box.hidden = false; return; }
    store.put('plans', { ...(plan ? { id: plan.id } : { done: false, done_at: null }), title, date: el.date.value, time: D.isTime(el.time.value) ? el.time.value : null });
    m.close();
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    if (!(await confirmDialog({ title: t('plan.deleteQ') }))) return;
    const removed = store.remove('plans', plan.id);
    m.close();
    toast(t('common.deleted'), { action: { label: t('common.undo'), fn: () => store.restore('plans', removed) } });
  });
}

function planRow(p, { past = false } = {}) {
  return html`<li class="plan ${p.done ? 'is-done' : ''}">
    <button type="button" class="check ${p.done ? 'on' : ''}" data-plan-toggle="${p.id}" aria-pressed="${!!p.done}" aria-label="${t('task.toggle')}">${icon('check', 14)}</button>
    <button type="button" class="plan-main" data-plan-edit="${p.id}">
      ${p.time ? html`<span class="plan-time">${p.time}</span>` : ''}<span class="plan-title">${p.title}</span>
      ${past ? html`<span class="muted small">${dateShort(p.date)}</span>` : ''}</button>
    ${past ? html`<button type="button" class="btn-icon btn-icon-sm" data-plan-move="${p.id}" aria-label="${t('plan.moveToday')}" data-tip="${t('plan.moveToday')}">${icon('right', 16)}</button>` : ''}
  </li>`;
}

function plansCard() {
  const today = D.today();
  const list = store.all('plans').filter((p) => p.date === today).sort(byTime);
  const left = list.filter((p) => !p.done).length;
  const past = store.all('plans').filter((p) => !p.done && p.date < today && D.diffDays(p.date, today) <= 14)
    .sort((a, b) => b.date.localeCompare(a.date));
  return html`
    <section class="card plans-card">
      <header class="card-head"><h3>${icon('checkSquare', 18)} ${t('plan.title')}</h3>
        ${list.length ? html`<span class="state ${left ? '' : 'state-ok'}">${left ? t('plan.left', { n: left }) : html`${icon('check', 14)}${t('plan.allDone')}`}</span>` : ''}</header>
      <form class="plan-add" data-plan-add autocomplete="off">
        <input class="input" name="title" maxlength="300" placeholder="${t('plan.ph')}" aria-label="${t('plan.ph')}" enterkeyhint="done">
        <input class="input plan-time-input" name="time" type="time" aria-label="${t('plan.time')}">
        <button class="btn btn-primary btn-square" aria-label="${t('common.add')}">${icon('plus', 20)}</button>
      </form>
      ${list.length ? html`<ul class="plan-list">${list.map((p) => planRow(p))}</ul>` : html`<p class="muted small pad">${t('plan.empty')}</p>`}
      ${past.length ? html`<details class="plan-past"><summary>${t('plan.fromPast')} · ${past.length}</summary>
        <ul class="plan-list">${past.slice(0, 8).map((p) => planRow(p, { past: true }))}</ul></details>` : ''}
    </section>`;
}

// ------------------------------------------------------------------ activity

function activityCard() {
  const a = A.dayActivity();
  const lvl = A.level(a);
  const week = A.recentDays(7);
  const parts = Object.entries(a.parts).filter(([, p]) => p.total > 0);
  return html`
    <section class="card act-card lvl-${lvl}">
      <header class="card-head"><h3>${icon('activity', 18)} ${t('act.title')}</h3><span class="act-level">${t(`act.level.${lvl}`)}</span></header>
      <div class="act-body">
        <div class="act-ring">${raw(ringSvg(a.pct, { size: 124, stroke: 12 }))}
          <span class="act-center"><b>${a.total ? percent(a.pct) : '—'}</b><small>${a.done}/${a.total}</small></span></div>
        <div class="act-side">
          ${parts.length ? html`<ul class="act-parts">${parts.map(([k, p]) => html`<li>
              <span>${t(`act.${k}`)}</span><b>${p.done}/${p.total}</b>
              ${progress(p.total ? (p.done / p.total) * 100 : 0, { tone: p.done >= p.total ? 'good' : 'accent' })}</li>`)}</ul>`
            : html`<p class="muted small">${t('act.none')}</p>`}
        </div>
      </div>
      <div class="act-week" role="img" aria-label="${t('act.week')}">
        ${week.map((d) => html`<div class="aw-day ${d.day === D.today() ? 'is-today' : ''}" data-tip="${t('act.dayTip', { day: dateShort(d.day), n: d.done })}">
          <div class="aw-bar"><i style="height:${d.total ? Math.max(6, d.pct) : 0}%"></i></div>
          <span>${weekdayShort(D.weekday(d.day))}</span></div>`)}
      </div>
      <p class="muted small">${t('act.hint')}</p>
    </section>`;
}

/** Confetti the moment everything planned for today is done. */
function checkPerfect(el) {
  const lvl = A.level(A.dayActivity());
  if (lastLevel !== null && lastLevel < 5 && lvl === 5) {
    confettiFrom(el && el.isConnected ? el : root && root.querySelector('.act-card'), 140);
    toast(t('act.perfect'), { tone: 'success' });
  }
  lastLevel = lvl;
}

// ------------------------------------------------------------------ other cards

function classesCard() {
  const wd = D.weekday(D.today());
  const slots = slotsFor(wd);
  const now = D.nowMinutes();
  const nextIdx = slots.findIndex((s) => D.toMinutes(s.end) > now);
  return html`
    <section class="card">
      <header class="card-head"><h3>${icon('study', 18)} ${t('today.classes')}</h3><a class="btn btn-ghost btn-sm" href="#/study/timetable">${t('today.week')}${icon('right', 16)}</a></header>
      ${slots.length ? html`<ol class="timeline">
        ${slots.map((s, i) => {
          const course = courseOf(s.course_id);
          const live = D.toMinutes(s.start) <= now && now < D.toMinutes(s.end);
          const past = D.toMinutes(s.end) <= now;
          return html`<li class="tl ${live ? 'is-now' : ''} ${past ? 'is-past' : ''} ${i === nextIdx && !live ? 'is-next' : ''}">
            <span class="tl-time">${s.start}<small>${s.end}</small></span>
            <span class="tl-dot ${course ? `tone-${course.color}` : 'tone-slate'}"></span>
            <button type="button" class="tl-body" data-slot="${s.id}">
              <b>${s.title}</b>
              <span class="muted small">${t(`slot.kind.${s.kind}`)}${s.location ? ` · ${s.location}` : ''}</span>
              ${live ? html`<span class="now-badge">${t('slot.now')}</span>` : i === nextIdx ? html`<span class="next-badge">${t('slot.next')}</span>` : ''}
            </button>
          </li>`;
        })}
      </ol>` : html`<p class="muted pad">${t('today.noClasses')}</p>`}
    </section>`;
}

function tasksCard() {
  const tasks = store.all('tasks').filter((x) => !x.done && x.due_date && D.diffDays(D.today(), x.due_date) <= 3);
  tasks.sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.due_time || '99').localeCompare(b.due_time || '99'));
  const overdue = tasks.filter((x) => taskBucket(x) === 'overdue').length;
  return html`
    <section class="card">
      <header class="card-head"><h3>${icon('clock', 18)} ${t('today.deadlines')}</h3>
        ${overdue ? html`<span class="state state-over">${icon('alert', 14)}${t('today.overdue', { n: overdue })}</span>` : ''}
        <button type="button" class="btn-icon" data-new-task aria-label="${t('task.new')}">${icon('plus', 18)}</button></header>
      ${tasks.length ? tasks.slice(0, 6).map((x) => taskRow(x)) : html`<p class="muted pad">${t('today.noDeadlines')}</p>`}
      ${tasks.length > 6 ? html`<a class="btn btn-ghost btn-sm" href="#/study/tasks">${t('common.all')} · ${tasks.length}</a>` : ''}
    </section>`;
}

function moneyCard() {
  const today = D.today();
  const txs = store.all('transactions');
  const todays = txs.filter((x) => x.date === today);
  const spent = F.totals(todays).expense;
  const b = F.budgets(today);
  return html`
    <section class="card">
      <header class="card-head"><h3>${icon('wallet', 18)} ${t('today.money')}</h3><button type="button" class="btn-icon" data-add-tx aria-label="${t('tx.new')}">${icon('plus', 18)}</button></header>
      <div class="money-today">
        <div><span class="kpi-label">${t('today.spentToday')}</span><span class="kpi-value">${money(spent)}</span></div>
        <div><span class="kpi-label">${t('today.spentMonth')}</span><span class="kpi-value kpi-sm">${money(b.total)}</span></div>
      </div>
      ${b.limit ? html`<div class="budget-mini">${meter(b.total, b.limit, b.state, { label: t('budget.month') })}
        <div class="row-between small"><span class="muted">${percent((b.total / b.limit) * 100)}</span>
        <span>${b.total <= b.limit ? (b.perDay ? t('budget.perDay', { amount: money(b.perDay) }) : '') : t('budget.overBy', { amount: money(b.total - b.limit) })}</span></div></div>` : ''}
      ${todays.length ? txList(todays, { limit: 4 }) : ''}
    </section>`;
}

function challengesRow() {
  const list = store.all('challenges').filter((c) => challengeStatus(c) === 'active')
    .sort((a, b) => ((a.checkins || []).includes(D.today()) - (b.checkins || []).includes(D.today())))
    .slice(0, 3);
  if (!list.length) return '';
  return html`<div class="ch-grid today-ch">${list.map(challengeCard)}</div>`;
}

function readingCard() {
  const books = store.all('books').filter((b) => bookStatus(b) !== 'done').sort((a, b) => b.updated_at - a.updated_at);
  const b = books.find((x) => bookStatus(x) === 'reading') || books[0];
  if (!b) return '';
  const pct = b.total_pages ? (b.read_pages / b.total_pages) * 100 : 0;
  return html`
    <section class="card">
      <header class="card-head"><h3>${icon('book', 18)} ${t('today.reading')}</h3><a class="btn btn-ghost btn-sm" href="#/library">${t('nav.library')}${icon('right', 16)}</a></header>
      <div class="reading">
        ${b.cover_id ? html`<span class="reading-cover" data-has-img><img data-img="${b.cover_id}" alt=""></span>` : ''}
        <div class="reading-body">
          <b>${b.title}</b>${b.author ? html`<span class="muted small">${b.author}</span>` : ''}
          ${progress(pct)}<span class="small muted">${b.read_pages || 0} / ${b.total_pages || '—'}</span>
          ${b.file_id || store.hasLocalFile(`book:${b.id}`) ? html`<button type="button" class="btn btn-soft btn-sm" data-read="${b.id}">${icon('book', 16)}${t('lib.continue')}</button>` : ''}
        </div>
      </div>
    </section>`;
}

function projectsCard() {
  const list = store.all('projects').filter((p) => p.status === 'active').sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999')).slice(0, 3);
  if (!list.length) return '';
  return html`
    <section class="card">
      <header class="card-head"><h3>${icon('layers', 18)} ${t('today.projects')}</h3><a class="btn btn-ghost btn-sm" href="#/projects">${t('common.all')}${icon('right', 16)}</a></header>
      <ul class="mini-list">${list.map((p) => {
        const dl = deadlineInfo(p);
        const subs = p.subtasks || [];
        return html`<li><a href="#/projects"><b>${p.title}</b><span class="small muted">${subs.filter((s) => s.done).length}/${subs.length}</span>
          ${dl ? html`<span class="due ${dl.tone ? `due-${dl.tone}` : ''}">${dl.text}</span>` : ''}</a></li>`;
      })}</ul>
    </section>`;
}

function firstRun() {
  const empty = !store.all('transactions').length && !store.all('courses').length && !store.all('timetable').length
    && !store.all('books').length && !store.all('plans').length && !store.all('challenges').length;
  if (!empty) return '';
  return html`
    <section class="card welcome">
      <h3>${t('today.welcome')}</h3>
      <div class="welcome-actions">
        <button type="button" class="btn btn-soft" data-add-tx>${icon('wallet', 18)}${t('today.startMoney')}</button>
        <button type="button" class="btn btn-soft" data-new-slot>${icon('calendar', 18)}${t('today.startTimetable')}</button>
        <a class="btn btn-soft" href="#/library">${icon('book', 18)}${t('today.startBook')}</a>
        <a class="btn btn-soft" href="#/challenges">${icon('flame', 18)}${t('ch.new')}</a>
        <a class="btn btn-ghost" href="#/settings">${icon('upload', 18)}${t('today.startImport')}</a>
      </div>
    </section>`;
}

// ------------------------------------------------------------------ page

function paintHero() {
  const slot = $('[data-hero-slot]', root);
  setHTML(slot, heroView());
  hydrateImages(slot);
}

function paintBody() {
  const focus = document.activeElement;
  const typing = focus && root.contains(focus) && focus.matches('[data-plan-add] input[name=title]') ? focus.value : null;
  const region = $('[data-region]', root);
  setHTML(region, html`
    ${firstRun()}
    <div class="today-top">
      ${activityCard()}
      ${plansCard()}
    </div>
    ${challengesRow()}
    <div class="today-grid">
      ${classesCard()}
      ${tasksCard()}
      ${moneyCard()}
      ${readingCard()}
      ${projectsCard()}
    </div>`);
  hydrateImages(region);
  if (typing !== null) {
    const input = $('[data-plan-add] input[name=title]', root);
    if (input) { input.value = typing; input.focus(); }
  }
}

export default {
  id: 'today',
  deps: ['transactions', 'tasks', 'timetable', 'courses', 'books', 'projects', 'notes', 'user', 'files', 'plans', 'challenges', 'weather'],
  title: () => t('nav.today'),
  mount(el) {
    root = el;
    setHTML(el, html`<div data-hero-slot></div>${quickBar()}<div data-region></div>`);
    paintHero();
    paintBody();
    lastLevel = A.level(A.dayActivity());
    bindHero(el, {
      onNote: (id) => { const n = store.get('notes', id); if (n) openNoteSheet(n); },
      onNewNote: () => openNoteSheet(),
    });
    bindQuickBar(el);
    bindTaskActions(el);
    bindNoteActions(el);
    bindChallengeActions(el);
    on(el, 'click', '[data-add-tx]', () => openTxSheet());
    on(el, 'click', '[data-new-task]', () => openTaskSheet());
    on(el, 'click', '[data-new-slot]', () => openSlotSheet());
    on(el, 'click', '[data-slot]', (e, b) => { const s = store.get('timetable', b.dataset.slot); if (s) openSlotSheet({ slot: s }); });
    on(el, 'click', '[data-read]', (e, b) => { const book = store.get('books', b.dataset.read); if (book) readBook(book); });
    on(el, 'click', '[data-tx]', (e, b) => { const tx = store.get('transactions', b.dataset.tx); if (tx) openTxSheet({ tx }); });
    on(el, 'click', '[data-plan-toggle]', (e, b) => {
      const rect = b.getBoundingClientRect();
      togglePlan(b.dataset.planToggle);
      checkPerfect({ isConnected: true, getBoundingClientRect: () => rect });
    });
    on(el, 'click', '[data-plan-edit]', (e, b) => { const p = store.get('plans', b.dataset.planEdit); if (p) openPlanSheet(p); });
    on(el, 'click', '[data-plan-move]', (e, b) => store.put('plans', { id: b.dataset.planMove, date: D.today() }));
    el.addEventListener('submit', (e) => {
      if (!e.target.matches('[data-plan-add]')) return;
      e.preventDefault();
      const f = e.target.elements;
      const title = f.title.value.trim();
      if (!title) { f.title.focus(); return; }
      const time = D.isTime(f.time.value) ? f.time.value : null;
      f.title.value = '';
      f.time.value = '';
      store.put('plans', { title, date: D.today(), time, done: false, done_at: null });
      setTimeout(() => $('[data-plan-add] input[name=title]', root)?.focus(), 0);
    });
    clearInterval(clockTimer);
    clockTimer = setInterval(() => tickHero(root), 1000);
    clearInterval(minuteTimer);
    // keeps "now / next" class markers and the time-of-day scene current
    minuteTimer = setInterval(() => { if (root) { paintBody(); if (!refreshHero(root, new Set())) paintHero(); } }, 60000);
  },
  update(kinds) {
    if (!root) return;
    if (!refreshHero(root, kinds)) paintHero();
    if ([...kinds].some((k) => k !== 'weather')) paintBody();
    if (kinds.has('tasks') || kinds.has('challenges') || kinds.has('books')) checkPerfect();
  },
  unmount() { clearInterval(clockTimer); clearInterval(minuteTimer); root = null; },
  fab() { openTxSheet(); },
};
