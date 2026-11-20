import { apiBase } from '../core/api.js';
import { progress } from '../core/charts.js';
import { $, debounce, html, on, setHTML } from '../core/dom.js';
import * as D from '../core/dates.js';
import { dateShort, getLang, relDay, t, weekdayName, weekdayShort } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import * as store from '../core/store.js';
import { confirmDialog, emptyState, openModal, toast } from '../core/ui.js';

export const COLORS = ['indigo', 'sky', 'emerald', 'amber', 'rose', 'violet'];
const TASK_KINDS = ['homework', 'exam', 'independent', 'lab', 'other'];
const SLOT_KINDS = ['lecture', 'practice', 'lab', 'seminar', 'assignment', 'project', 'personal'];

const ui = { tab: 'courses', day: D.weekday(D.today()), courseTab: 'tasks', taskCourse: '', showDone: false };
let root = null;
let courseId = null;
let notesSave = null;

// ------------------------------------------------------------------ helpers

export const courseOf = (id) => (id ? store.get('courses', id) : null);

export function slotsFor(weekday) {
  return store.all('timetable').filter((s) => s.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start));
}

/** 'now' | 'next' | '' for today's slots */
export function slotState(slot, isToday) {
  if (!isToday) return '';
  const now = D.nowMinutes();
  if (D.toMinutes(slot.start) <= now && now < D.toMinutes(slot.end)) return 'now';
  return '';
}

export function nextSlotOfCourse(cid) {
  const today = D.weekday(D.today());
  const now = D.nowMinutes();
  const slots = store.all('timetable').filter((s) => s.course_id === cid);
  let best = null;
  let bestScore = Infinity;
  for (const s of slots) {
    let delta = (s.weekday - today + 7) % 7;
    if (delta === 0 && D.toMinutes(s.start) <= now) delta = 7;
    const score = delta * 1440 + D.toMinutes(s.start);
    if (score < bestScore) { best = s; bestScore = score; }
  }
  return best;
}

export function taskBucket(task) {
  if (task.done) return 'done';
  if (!task.due_date) return 'nodate';
  const d = D.diffDays(D.today(), task.due_date);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d <= 7) return 'week';
  return 'later';
}

const sortTasks = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.due_time || '99').localeCompare(b.due_time || '99');

export function taskRow(task, { showCourse = true } = {}) {
  const course = courseOf(task.course_id);
  const bucket = taskBucket(task);
  return html`
    <div class="task ${task.done ? 'is-done' : ''} ${bucket === 'overdue' ? 'is-overdue' : ''}">
      <button type="button" class="check ${task.done ? 'on' : ''}" data-toggle-task="${task.id}" aria-pressed="${task.done}" aria-label="${t('task.toggle')}">${icon('check', 14)}</button>
      <button type="button" class="task-main" data-edit-task="${task.id}">
        <span class="task-title">${task.title}</span>
        <span class="task-meta">
          ${showCourse && course ? html`<span class="tone-dot tone-${course.color}"></span><span>${course.name}</span>` : ''}
          <span class="pill">${t(`task.kind.${task.kind || 'homework'}`)}</span>
          ${task.due_date ? html`<span class="due">${icon('clock', 12)}${relDay(task.due_date)}${task.due_time ? ` · ${task.due_time}` : ''}</span>` : ''}
        </span>
      </button>
    </div>`;
}

export function toggleTask(id) {
  const task = store.get('tasks', id);
  if (!task) return;
  const done = !task.done;
  // done_at feeds "today's activity"; it is cleared when the task is reopened
  store.put('tasks', { id, done, done_at: done ? D.today() : null });
}

export function bindTaskActions(scope) {
  on(scope, 'click', '[data-toggle-task]', (e, b) => toggleTask(b.dataset.toggleTask));
  on(scope, 'click', '[data-edit-task]', (e, b) => { const task = store.get('tasks', b.dataset.editTask); if (task) openTaskSheet({ task }); });
}

// ------------------------------------------------------------------ sheets

const courseOptions = (selected) => html`
  <option value="">${t('task.noCourse')}</option>
  ${store.all('courses').sort((a, b) => a.name.localeCompare(b.name)).map((c) => html`<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.name}</option>`)}`;

export function openTaskSheet({ task = null, courseId: cid = null } = {}) {
  const m = openModal({
    title: task ? t('task.edit') : t('task.new'),
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('task.title')}</span>
        <input class="input" name="title" required maxlength="300" value="${task ? task.title : ''}" placeholder="${t('task.titlePh')}"></label>
      <label class="field"><span class="field-label">${t('task.course')}</span>
        <select class="input select" name="course_id">${courseOptions(task ? task.course_id : cid)}</select></label>
      <div class="field"><span class="field-label">${t('task.kind')}</span>
        <div class="chips">${TASK_KINDS.map((k) => html`<label class="chip"><input type="radio" name="kind" value="${k}" ${(task ? task.kind : 'homework') === k ? 'checked' : ''}><span>${t(`task.kind.${k}`)}</span></label>`)}</div></div>
      <div class="form-row">
        <label class="field"><span class="field-label">${t('task.due')}</span><input class="input" type="date" name="due_date" value="${task && task.due_date ? task.due_date : ''}"></label>
        <label class="field"><span class="field-label">${t('task.time')}</span><input class="input" type="time" name="due_time" value="${task && task.due_time ? task.due_time : ''}"></label>
      </div>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${task ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button>
      </div></form>`,
  });
  const form = $('form', m.body);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const el = form.elements;
    const title = el.title.value.trim();
    if (!title) { const b = $('.form-error', form); b.textContent = t('err.required'); b.hidden = false; return; }
    store.put('tasks', {
      ...(task ? { id: task.id } : { done: false }),
      title, course_id: el.course_id.value || null, kind: el.kind.value || 'homework',
      due_date: D.isDate(el.due_date.value) ? el.due_date.value : null,
      due_time: D.isDate(el.due_date.value) && D.isTime(el.due_time.value) ? el.due_time.value : null,
    });
    m.close();
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    if (await confirmDialog({ title: t('task.deleteQ') })) {
      const old = store.remove('tasks', task.id);
      m.close();
      toast(t('common.deleted'), { action: { label: t('common.undo'), fn: () => store.restore('tasks', old) } });
    }
  });
}

function openCourseSheet(course = null) {
  const m = openModal({
    title: course ? t('course.edit') : t('course.new'),
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('course.name')}</span><input class="input" name="name" required maxlength="120" value="${course ? course.name : ''}" placeholder="${t('course.namePh')}"></label>
      <div class="form-row">
        <label class="field"><span class="field-label">${t('course.teacher')}</span><input class="input" name="teacher" maxlength="120" value="${course ? course.teacher : ''}"></label>
        <label class="field"><span class="field-label">${t('course.room')}</span><input class="input" name="room" maxlength="120" value="${course ? course.room : ''}"></label>
      </div>
      <label class="field"><span class="field-label">${t('course.desc')}</span><textarea class="input" name="description" rows="3" maxlength="1000">${course ? course.description : ''}</textarea></label>
      <div class="field"><span class="field-label">${t('common.color')}</span>
        <div class="swatches">${COLORS.map((c) => html`<label class="swatch tone-${c}"><input type="radio" name="color" value="${c}" ${(course ? course.color : 'indigo') === c ? 'checked' : ''} aria-label="${c}"><span></span></label>`)}</div></div>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${course ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const el = form.elements;
    if (!el.name.value.trim()) { const b = $('.form-error', form); b.textContent = t('err.required'); b.hidden = false; return; }
    const rec = store.put('courses', {
      ...(course ? { id: course.id } : { notes: '' }),
      name: el.name.value.trim(), teacher: el.teacher.value.trim(), room: el.room.value.trim(),
      description: el.description.value.trim(), color: el.color.value || 'indigo',
    });
    m.close();
    if (!course) location.hash = `#/study/course/${rec.id}`;
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    const n = store.all('tasks').filter((x) => x.course_id === course.id).length;
    if (await confirmDialog({ title: t('course.deleteQ'), text: n ? t('course.deleteText', { n }) : '' })) {
      store.remove('courses', course.id);
      m.close();
      location.hash = '#/study';
      toast(t('common.deleted'));
    }
  });
}

export function openSlotSheet({ slot = null, weekday = null, courseId: cid = null } = {}) {
  const days = [1, 2, 3, 4, 5, 6, 7];
  const selDays = slot ? [slot.weekday] : [weekday || D.weekday(D.today())];
  const m = openModal({
    title: slot ? t('slot.edit') : t('slot.new'),
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('task.course')}</span>
        <select class="input select" name="course_id">${courseOptions(slot ? slot.course_id : cid)}</select></label>
      <label class="field"><span class="field-label">${t('slot.title')}</span>
        <input class="input" name="title" required maxlength="120" value="${slot ? slot.title : cid && courseOf(cid) ? courseOf(cid).name : ''}" placeholder="${t('slot.titlePh')}"></label>
      <div class="field"><span class="field-label">${slot ? t('slot.day') : t('slot.days')}</span>
        <div class="chips">${days.map((d) => html`<label class="chip"><input type="${slot ? 'radio' : 'checkbox'}" name="weekday" value="${d}" ${selDays.includes(d) ? 'checked' : ''}><span>${weekdayShort(d)}</span></label>`)}</div></div>
      <div class="form-row">
        <label class="field"><span class="field-label">${t('slot.start')}</span><input class="input" type="time" name="start" required value="${slot ? slot.start : '09:00'}"></label>
        <label class="field"><span class="field-label">${t('slot.end')}</span><input class="input" type="time" name="end" required value="${slot ? slot.end : '10:20'}"></label>
      </div>
      <div class="field"><span class="field-label">${t('slot.kind')}</span>
        <div class="chips">${SLOT_KINDS.map((k) => html`<label class="chip"><input type="radio" name="kind" value="${k}" ${(slot ? slot.kind : 'lecture') === k ? 'checked' : ''}><span>${t(`slot.kind.${k}`)}</span></label>`)}</div></div>
      <label class="field"><span class="field-label">${t('slot.location')}</span><input class="input" name="location" maxlength="120" value="${slot ? slot.location : cid && courseOf(cid) ? courseOf(cid).room : ''}"></label>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${slot ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  const el = form.elements;
  el.course_id.addEventListener('change', () => {
    const c = courseOf(el.course_id.value);
    if (c && !el.title.value.trim()) el.title.value = c.name;
    if (c && !el.location.value.trim()) el.location.value = c.room || '';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const box = $('.form-error', form);
    const fail = (msg) => { box.textContent = msg; box.hidden = false; };
    const title = el.title.value.trim();
    const picked = Array.from(form.querySelectorAll('[name=weekday]:checked')).map((i) => Number(i.value));
    if (!title) return fail(t('err.required'));
    if (!picked.length) return fail(t('slot.errDay'));
    if (!D.isTime(el.start.value) || !D.isTime(el.end.value)) return fail(t('slot.errTime'));
    if (el.end.value <= el.start.value) return fail(t('slot.errOrder'));
    const base = { title, start: el.start.value, end: el.end.value, kind: el.kind.value || 'lecture', location: el.location.value.trim(), course_id: el.course_id.value || null };
    if (slot) store.put('timetable', { id: slot.id, ...base, weekday: picked[0] });
    else store.putMany('timetable', picked.map((d) => ({ ...base, weekday: d })));
    m.close();
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    if (await confirmDialog({ title: t('slot.deleteQ') })) {
      const old = store.remove('timetable', slot.id);
      m.close();
      toast(t('common.deleted'), { action: { label: t('common.undo'), fn: () => store.restore('timetable', old) } });
    }
  });
}

export function openCalendarSheet() {
  const user = store.getUser() || {};
  const https = `${user.calendar_url || apiBase() + (user.calendar_path || '')}?lang=${getLang()}`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  const m = openModal({
    title: t('cal.title'),
    content: html`
      <p class="muted">${t('cal.text')}</p>
      <div class="copy-row"><input class="input" readonly value="${https}" aria-label="URL"><button type="button" class="btn btn-soft" data-copy>${icon('copy', 18)}${t('common.copy')}</button></div>
      <ol class="steps">
        <li><b>Google</b>: ${t('cal.google')}</li>
        <li><b>iPhone / Mac</b>: ${t('cal.apple')}</li>
      </ol>
      <div class="modal-actions">
        <a class="btn btn-ghost" href="${https}" download="makon.ics">${icon('download', 18)}${t('cal.download')}</a>
        <a class="btn btn-primary" href="${webcal}">${icon('calendar', 18)}${t('cal.subscribe')}</a>
      </div>`,
  });
  on(m.body, 'click', '[data-copy]', async () => {
    try { await navigator.clipboard.writeText(https); toast(t('common.copied'), { tone: 'success' }); }
    catch (_) { $('input', m.body).select(); }
  });
}

// ------------------------------------------------------------------ views

function coursesView() {
  const courses = store.all('courses').sort((a, b) => a.created_at - b.created_at);
  if (!courses.length) return html`<section class="card">${emptyState('study', t('course.empty'), html`<button class="btn btn-primary" data-new-course>${icon('plus', 18)}${t('course.new')}</button>`)}</section>`;
  const tasks = store.all('tasks');
  return html`<div class="course-grid">
    ${courses.map((c) => {
      const ct = tasks.filter((x) => x.course_id === c.id);
      const open = ct.filter((x) => !x.done).sort(sortTasks);
      const next = nextSlotOfCourse(c.id);
      const done = ct.length - open.length;
      return html`
        <a class="card course tone-${c.color}" href="#/study/course/${c.id}">
          <span class="course-bar"></span>
          <h3>${c.name}</h3>
          <p class="course-meta">${c.teacher ? html`<span>${icon('user', 14)}${c.teacher}</span>` : ''}${c.room ? html`<span>${icon('mapPin', 14)}${c.room}</span>` : ''}</p>
          ${next ? html`<p class="course-next">${icon('clock', 14)}${weekdayShort(next.weekday)} ${next.start}</p>` : ''}
          <div class="course-foot">
            ${ct.length ? html`${progress((done / ct.length) * 100)}<span class="small muted">${done}/${ct.length}</span>` : html`<span class="small muted">${t('course.noTasks')}</span>`}
            ${open[0] && open[0].due_date ? html`<span class="due ${taskBucket(open[0]) === 'overdue' ? 'is-overdue' : ''}">${relDay(open[0].due_date)}</span>` : ''}
          </div>
        </a>`;
    })}
  </div>`;
}

function slotCard(s, isToday) {
  const course = courseOf(s.course_id);
  const state = slotState(s, isToday);
  return html`
    <button type="button" class="slot ${course ? `tone-${course.color}` : 'tone-slate'} ${state ? 'is-now' : ''}" data-edit-slot="${s.id}">
      <span class="slot-time">${s.start}–${s.end}</span>
      <span class="slot-title">${s.title}</span>
      <span class="slot-meta">${t(`slot.kind.${s.kind}`)}${s.location ? html` · ${s.location}` : ''}</span>
      ${state === 'now' ? html`<span class="now-badge">${t('slot.now')}</span>` : ''}
    </button>`;
}

function timetableView() {
  const todayWd = D.weekday(D.today());
  const weekStart = D.startOfWeek(D.today());
  const total = store.all('timetable').length;
  const days = [1, 2, 3, 4, 5, 6, 7];
  return html`
    <div class="toolbar">
      <div class="chips chips-scroll day-chips show-mobile">
        ${days.map((d) => html`<button type="button" class="chip-btn ${ui.day === d ? 'active' : ''} ${d === todayWd ? 'is-today' : ''}" data-day="${d}">${weekdayShort(d)}</button>`)}
      </div>
      <div class="toolbar-end">
        <button type="button" class="btn btn-ghost btn-sm" data-calendar>${icon('calendar', 16)}${t('cal.button')}</button>
      </div>
    </div>
    ${!total ? html`<section class="card">${emptyState('calendar', t('slot.empty'), html`<button class="btn btn-primary" data-new-slot>${icon('plus', 18)}${t('slot.new')}</button>`)}</section>` : html`
      <div class="week">
        ${days.map((d) => {
          const items = slotsFor(d);
          return html`
            <section class="week-col ${d === todayWd ? 'is-today' : ''} ${d === ui.day ? 'is-selected' : ''}">
              <header><b>${weekdayName(d)}</b><span>${dateShort(D.addDays(weekStart, d - 1), { year: false })}</span></header>
              ${items.length ? items.map((s) => slotCard(s, d === todayWd)) : html`<p class="muted small week-empty">${t('slot.free')}</p>`}
              <button type="button" class="slot-add" data-new-slot="${d}" aria-label="${t('slot.new')}">${icon('plus', 16)}</button>
            </section>`;
        })}
      </div>`}`;
}

function tasksView() {
  const courses = store.all('courses');
  let tasks = store.all('tasks');
  if (ui.taskCourse) tasks = tasks.filter((x) => x.course_id === ui.taskCourse);
  const buckets = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate'];
  const groups = Object.fromEntries([...buckets, 'done'].map((b) => [b, []]));
  tasks.forEach((x) => groups[taskBucket(x)].push(x));
  Object.values(groups).forEach((g) => g.sort(sortTasks));
  groups.done.sort((a, b) => b.updated_at - a.updated_at);
  return html`
    <div class="toolbar">
      ${courses.length ? html`<div class="chips chips-scroll">
        <button type="button" class="chip-btn ${!ui.taskCourse ? 'active' : ''}" data-task-course="">${t('common.all')}</button>
        ${courses.map((c) => html`<button type="button" class="chip-btn ${ui.taskCourse === c.id ? 'active' : ''}" data-task-course="${c.id}"><span class="tone-dot tone-${c.color}"></span>${c.name}</button>`)}
      </div>` : ''}
    </div>
    ${!tasks.length ? html`<section class="card">${emptyState('checkSquare', t('task.empty'), html`<button class="btn btn-primary" data-new-task>${icon('plus', 18)}${t('task.new')}</button>`)}</section>` : html`
      <section class="card">
        ${buckets.filter((b) => groups[b].length).map((b) => html`
          <div class="task-group"><h4 class="group-title ${b === 'overdue' ? 'danger' : ''}">${t(`task.bucket.${b}`)} <span>${groups[b].length}</span></h4>
          ${groups[b].map((x) => taskRow(x))}</div>`)}
        ${groups.done.length ? html`
          <button type="button" class="btn btn-ghost btn-sm" data-show-done>${icon(ui.showDone ? 'down' : 'right', 16)}${t('task.bucket.done')} · ${groups.done.length}</button>
          ${ui.showDone ? groups.done.slice(0, 50).map((x) => taskRow(x)) : ''}` : ''}
      </section>`}`;
}

function courseView() {
  const c = courseOf(courseId);
  if (!c) return html`<section class="card">${emptyState('study', t('course.notFound'), html`<a class="btn btn-soft" href="#/study">${t('common.back')}</a>`)}</section>`;
  const tasks = store.all('tasks').filter((x) => x.course_id === c.id);
  const open = tasks.filter((x) => !x.done).sort(sortTasks);
  const done = tasks.filter((x) => x.done).sort((a, b) => b.updated_at - a.updated_at);
  const slots = store.all('timetable').filter((s) => s.course_id === c.id).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  const tabs = ['tasks', 'notes', 'schedule'];
  let content;
  if (ui.courseTab === 'notes') {
    content = html`<section class="card">
      <textarea class="input notes-area" data-course-notes rows="14" maxlength="100000" placeholder="${t('course.notesPh')}">${c.notes || ''}</textarea>
      <p class="small muted save-state" data-save-state>${icon('check', 14)}${t('common.autosave')}</p></section>`;
  } else if (ui.courseTab === 'schedule') {
    content = html`<section class="card">
      ${slots.length ? html`<div class="slot-list">${slots.map((s) => html`<div class="slot-line"><b>${weekdayName(s.weekday)}</b>${slotCard(s, s.weekday === D.weekday(D.today()))}</div>`)}</div>`
        : html`<p class="muted pad">${t('course.noSlots')}</p>`}
      <button type="button" class="btn btn-soft btn-sm" data-new-slot-course>${icon('plus', 16)}${t('slot.new')}</button></section>`;
  } else {
    content = html`<section class="card">
      <form class="inline-add" data-inline-task autocomplete="off">
        <input class="input" name="title" maxlength="300" placeholder="${t('task.quickPh')}" aria-label="${t('task.new')}">
        <input class="input input-date" type="date" name="due" aria-label="${t('task.due')}">
        <button class="btn btn-primary btn-sm">${icon('plus', 16)}<span class="hide-mobile">${t('common.add')}</span></button>
      </form>
      ${open.length ? open.map((x) => taskRow(x, { showCourse: false })) : html`<p class="muted pad">${t('course.allDone')}</p>`}
      ${done.length ? html`<button type="button" class="btn btn-ghost btn-sm" data-show-done>${icon(ui.showDone ? 'down' : 'right', 16)}${t('task.bucket.done')} · ${done.length}</button>
        ${ui.showDone ? done.map((x) => taskRow(x, { showCourse: false })) : ''}` : ''}
    </section>`;
  }
  return html`
    <a class="back" href="#/study">${icon('left', 18)}${t('nav.study')}</a>
    <section class="card course-head tone-${c.color}">
      <span class="course-bar"></span>
      <div class="row-between">
        <div>
          <h2>${c.name}</h2>
          <p class="course-meta">${c.teacher ? html`<span>${icon('user', 14)}${c.teacher}</span>` : ''}${c.room ? html`<span>${icon('mapPin', 14)}${c.room}</span>` : ''}</p>
        </div>
        <button type="button" class="btn-icon" data-edit-course aria-label="${t('common.edit')}">${icon('edit', 18)}</button>
      </div>
      ${c.description ? html`<p class="muted">${c.description}</p>` : ''}
    </section>
    <nav class="tabs tabs-sm">${tabs.map((k) => html`<button type="button" class="tab ${ui.courseTab === k ? 'active' : ''}" data-course-tab="${k}">${t(`course.tab.${k}`)}${k === 'tasks' && open.length ? html`<span class="count">${open.length}</span>` : ''}</button>`)}</nav>
    <div data-course-body>${content}</div>`;
}

// ------------------------------------------------------------------ page

function paint() {
  if (!root) return;
  const region = $('[data-region]', root);
  // never re-render the notes editor while the user is typing in it
  const ta = $('[data-course-notes]', region);
  if (ta && document.activeElement === ta) return;
  let content;
  if (courseId) content = courseView();
  else if (ui.tab === 'timetable') content = timetableView();
  else if (ui.tab === 'tasks') content = tasksView();
  else content = coursesView();
  setHTML(region, content);
  root.querySelectorAll('[data-tabnav]').forEach((a) => a.classList.toggle('active', !courseId && a.dataset.tabnav === ui.tab));
  const notes = $('[data-course-notes]', region);
  if (notes) {
    notesSave = debounce((value) => {
      const c = courseOf(courseId);
      if (!c || c.notes === value) return;
      store.put('courses', { id: courseId, notes: value });
      const s = $('[data-save-state]', root);
      if (s) s.classList.add('saved');
    }, 700);
    notes.addEventListener('input', () => {
      const s = $('[data-save-state]', root);
      if (s) s.classList.remove('saved');
      notesSave(notes.value);
    });
    notes.addEventListener('blur', () => notesSave.flush(notes.value));
  }
}

export default {
  id: 'study',
  deps: ['courses', 'tasks', 'timetable', 'user'],
  title: () => t('nav.study'),
  mount(el, params) {
    root = el;
    courseId = params[0] === 'course' ? params[1] : null;
    if (!courseId) ui.tab = ['courses', 'timetable', 'tasks'].includes(params[0]) ? params[0] : 'courses';
    ui.showDone = false;
    setHTML(el, html`
      <header class="page-head">
        <h1>${t('nav.study')}</h1>
        <div class="page-actions"><button type="button" class="btn btn-primary hide-mobile" data-primary>${icon('plus', 18)}<span data-primary-label></span></button></div>
      </header>
      ${courseId ? '' : html`<nav class="tabs">${['courses', 'timetable', 'tasks'].map((k) => html`<a class="tab" href="#/study/${k}" data-tabnav="${k}">${t(`study.tab.${k}`)}</a>`)}</nav>`}
      <div data-region></div>`);
    const label = $('[data-primary-label]', el);
    label.textContent = courseId ? t('task.new') : ui.tab === 'timetable' ? t('slot.new') : ui.tab === 'tasks' ? t('task.new') : t('course.new');
    paint();
    bindTaskActions(el);
    on(el, 'click', '[data-primary]', () => this.fab());
    on(el, 'click', '[data-new-course]', () => openCourseSheet());
    on(el, 'click', '[data-edit-course]', () => openCourseSheet(courseOf(courseId)));
    on(el, 'click', '[data-new-task]', () => openTaskSheet({ courseId: ui.taskCourse || null }));
    on(el, 'click', '[data-new-slot]', (e, b) => openSlotSheet({ weekday: Number(b.dataset.newSlot) || ui.day }));
    on(el, 'click', '[data-new-slot-course]', () => openSlotSheet({ courseId }));
    on(el, 'click', '[data-edit-slot]', (e, b) => { const s = store.get('timetable', b.dataset.editSlot); if (s) openSlotSheet({ slot: s }); });
    on(el, 'click', '[data-day]', (e, b) => { ui.day = Number(b.dataset.day); paint(); });
    on(el, 'click', '[data-calendar]', () => openCalendarSheet());
    on(el, 'click', '[data-task-course]', (e, b) => { ui.taskCourse = b.dataset.taskCourse; paint(); });
    on(el, 'click', '[data-show-done]', () => { ui.showDone = !ui.showDone; paint(); });
    on(el, 'click', '[data-course-tab]', (e, b) => {
      const ta = $('[data-course-notes]', el);
      if (ta && notesSave) notesSave.flush(ta.value);
      ui.courseTab = b.dataset.courseTab;
      if (ta) ta.blur();
      paint();
    });
    el.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-inline-task]');
      if (!form) return;
      e.preventDefault();
      const title = form.elements.title.value.trim();
      if (!title) return;
      store.put('tasks', { title, course_id: courseId, kind: 'homework', due_date: D.isDate(form.elements.due.value) ? form.elements.due.value : null, due_time: null, done: false });
      form.reset();
      form.elements.title.focus();
    });
  },
  update() { paint(); },
  unmount() {
    const ta = root && $('[data-course-notes]', root);
    if (ta && notesSave) notesSave.flush(ta.value);
    root = null;
  },
  fab() {
    if (courseId) openTaskSheet({ courseId });
    else if (ui.tab === 'timetable') openSlotSheet({ weekday: ui.day });
    else if (ui.tab === 'tasks') openTaskSheet({ courseId: ui.taskCourse || null });
    else openCourseSheet();
  },
};
