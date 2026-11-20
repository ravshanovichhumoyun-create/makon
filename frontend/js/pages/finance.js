import { request } from '../core/api.js';
import { columns, grouped, meter, progress, segmentBar, seriesColor } from '../core/charts.js';
import { $, debounce, downloadBlob, html, on, setHTML } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as F from '../core/finance.js';
import { compact, dateShort, getLang, money, monthTitle, num, percent, t } from '../core/i18n.js';
import { icon, telegramIcon } from '../core/icons.js';
import * as store from '../core/store.js';
import { syncNow } from '../core/sync.js';
import { confirmDialog, emptyState, errorText, openModal, toast } from '../core/ui.js';
import { openTxSheet, previewQuick, quickAdd, txDateLabel, txLabel } from './txsheet.js';

const ui = {
  tab: 'overview',
  kind: 'month',
  anchor: D.today(),
  custom: { from: D.startOfMonth(D.today()), to: D.today() },
  type: 'all',
  cat: '',
  q: '',
  budgetMonth: D.today(),
  trendType: 'expense',
};

const TABS = ['overview', 'list', 'budgets', 'goals'];
let root = null;

const currentPeriod = () => F.period(ui.kind, ui.anchor, ui.custom);

// ------------------------------------------------------------------ shared pieces

export function quickBar() {
  return html`
    <form class="quick" data-quick autocomplete="off">
      <span class="quick-ic">${icon('zap', 18)}</span>
      <input class="quick-input" name="q" placeholder="${t('quick.ph')}" aria-label="${t('quick.label')}" enterkeyhint="done">
      <button type="submit" class="btn btn-primary btn-sm">${t('common.add')}</button>
      <div class="quick-preview" aria-live="polite"></div>
    </form>`;
}

export function bindQuickBar(scope) {
  const form = $('[data-quick]', scope);
  if (!form) return;
  const input = form.elements.q;
  const preview = $('.quick-preview', form);
  const paint = () => {
    const p = input.value.trim() ? previewQuick(input.value) : null;
    setHTML(preview, p ? html`<span class="pv ${p.type}">${p.type === 'income' ? '+' : '−'}${money(p.amount)}</span>
      <span class="pv-cat">${p.cat ? p.cat.icon : ''} ${F.categoryName(p.cat)}</span>${p.note ? html`<span class="pv-note">${p.note}</span>` : ''}`
      : input.value.trim() ? html`<span class="muted">${t('quick.noAmount')}</span>` : '');
    form.classList.toggle('has-preview', !!input.value.trim());
  };
  input.addEventListener('input', paint);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) { openTxSheet(); return; }
    if (quickAdd(input.value)) { input.value = ''; paint(); }
    else toast(t('quick.noAmount'), { tone: 'error' });
  });
}

function deltaBadge(cur, prev, upIsGood) {
  const ch = F.change(cur, prev);
  if (ch === null || !Number.isFinite(ch) || Math.abs(ch) < 1) return '';
  const good = (ch > 0) === upIsGood;
  return html`<span class="delta ${good ? 'good' : 'bad'}">${icon(ch > 0 ? 'up' : 'downArrow', 13)}${percent(Math.abs(ch))}</span>`;
}

function periodBar(p) {
  const kinds = ['day', 'week', 'month', 'year', 'custom'];
  return html`
    <div class="period">
      <div class="chips chips-scroll">
        ${kinds.map((k) => html`<button type="button" class="chip-btn ${ui.kind === k ? 'active' : ''}" data-kind="${k}">${t(`period.${k}`)}</button>`)}
      </div>
      ${ui.kind === 'custom'
        ? html`<div class="range">
            <input type="date" class="input input-sm" data-range="from" value="${ui.custom.from}" aria-label="${t('period.from')}">
            <span>–</span>
            <input type="date" class="input input-sm" data-range="to" value="${ui.custom.to}" aria-label="${t('period.to')}">
          </div>`
        : html`<div class="stepper">
            <button type="button" class="btn-icon" data-shift="-1" aria-label="${t('common.prev')}">${icon('left')}</button>
            <span class="stepper-label">${F.periodLabel(p)}</span>
            <button type="button" class="btn-icon" data-shift="1" aria-label="${t('common.next')}" ${p.isCurrent ? 'disabled' : ''}>${icon('right')}</button>
          </div>`}
    </div>`;
}

function txRow(tx, map) {
  const cat = F.categoryOf(tx, map);
  return html`
    <button type="button" class="tx-row" data-tx="${tx.id}">
      <span class="tx-ic" style="--c:${seriesColor(cat.color)}">${cat.icon || '📦'}</span>
      <span class="tx-main">
        <span class="tx-title">${txLabel(tx, cat)}</span>
        <span class="tx-sub">${tx.note ? F.categoryName(cat) : ''}${tx.source === 'telegram' ? html` <span class="src" data-tip="Telegram">${telegramIcon(12)}</span>` : ''}</span>
      </span>
      <span class="tx-amount ${tx.type}">${tx.type === 'income' ? '+' : '−'}${money(tx.amount)}</span>
    </button>`;
}

export function txList(txs, { limit = 0 } = {}) {
  const map = F.categoryMap();
  const sorted = [...txs].sort((a, b) => (b.date === a.date ? b.created_at - a.created_at : b.date < a.date ? -1 : 1));
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const groups = [];
  for (const tx of shown) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== tx.date) { g = { date: tx.date, items: [], total: 0 }; groups.push(g); }
    g.items.push(tx);
    g.total += tx.type === 'income' ? tx.amount : -tx.amount;
  }
  return html`<div class="tx-list">
    ${groups.map((g) => html`
      <div class="tx-group">
        <div class="tx-day"><span>${txDateLabel(g.date)}</span><span class="${g.total >= 0 ? 'pos' : ''}">${g.total > 0 ? '+' : ''}${money(g.total)}</span></div>
        ${g.items.map((tx) => txRow(tx, map))}
      </div>`)}
  </div>`;
}

// ------------------------------------------------------------------ overview

function overview() {
  const p = currentPeriod();
  const all = store.all('transactions');
  const cur = F.inRange(all, p.from, p.to);
  const prev = F.inRange(all, p.prev.from, p.prev.to);
  const ct = F.totals(cur);
  const pt = F.totals(prev);
  const overall = F.totals(all);

  if (!all.length) {
    return html`${periodBar(p)}<div class="card">${emptyState('wallet', t('fin.empty'), html`<button class="btn btn-primary" data-add>${icon('plus', 18)}${t('tx.new')}</button>`)}</div>`;
  }

  const breakdownType = ui.trendType;
  const cats = F.byCategory(cur, breakdownType);
  const top = cats.slice(0, 5);
  const restTotal = cats.slice(5).reduce((s, r) => s + r.total, 0);
  const parts = top.map((r) => ({ id: r.cat.id, label: `${r.cat.icon} ${F.categoryName(r.cat)}`, value: r.total, color: seriesColor(r.cat.color) }));
  if (restTotal) parts.push({ id: 'rest', label: t('fin.otherCats'), value: restTotal, color: 'var(--ink-faint)' });

  const series = F.expenseSeries(cur, p);
  const elapsedDays = p.isCurrent ? D.diffDays(p.from, D.today()) + 1 : p.days;
  const avg = p.days <= 62 && ct.expense ? Math.round(ct.expense / Math.max(1, elapsedDays)) : 0;
  const fc = F.forecast(all, p);
  const endMonth = (p.kind === 'year' ? (p.isCurrent ? D.today() : p.to) : p.to > D.today() ? D.today() : p.to).slice(0, 7);
  const trend = F.monthlyTrend(all, endMonth, 6);
  const ins = F.insights(all, p);
  const b = F.budgets(D.today());
  const biggest = cur.filter((x) => x.type === 'expense').sort((a, c) => c.amount - a.amount)[0];

  return html`
    ${periodBar(p)}
    <section class="kpis">
      <div class="card kpi kpi-hero">
        <span class="kpi-label">${t('fin.balancePeriod')}</span>
        <span class="kpi-value ${ct.balance < 0 ? 'neg' : ''}">${money(ct.balance, { sign: true })}</span>
        <span class="kpi-sub">${t('fin.totalBalance')}: <b>${money(overall.balance)}</b></span>
      </div>
      <div class="card kpi">
        <span class="kpi-label">${icon('up', 14)} ${t('fin.income')}</span>
        <span class="kpi-value">${money(ct.income)}</span>
        <span class="kpi-sub">${deltaBadge(ct.income, pt.income, true)} ${pt.income ? html`<span class="muted">${t('fin.vsPrev')}</span>` : ''}</span>
      </div>
      <div class="card kpi">
        <span class="kpi-label">${icon('downArrow', 14)} ${t('fin.expense')}</span>
        <span class="kpi-value">${money(ct.expense)}</span>
        <span class="kpi-sub">${deltaBadge(ct.expense, pt.expense, false)} ${pt.expense ? html`<span class="muted">${t('fin.vsPrev')}</span>` : ''}</span>
      </div>
      <div class="card kpi">
        <span class="kpi-label">${icon('calendar', 14)} ${t('fin.perDay')}</span>
        <span class="kpi-value">${money(Math.round(ct.expense / Math.max(1, elapsedDays)))}</span>
        <span class="kpi-sub muted">${fc ? html`${t('fin.forecast')}: <b>${money(fc)}</b>` : biggest ? html`${t('fin.biggest')}: <b>${money(biggest.amount)}</b>` : ''}</span>
      </div>
    </section>

    <div class="fin-grid">
      <section class="card">
        <header class="card-head">
          <h3>${t('fin.structure')}</h3>
          <div class="seg seg-sm">
            <button type="button" class="seg-btn ${breakdownType === 'expense' ? 'active' : ''}" data-trend="expense">${t('tx.expense')}</button>
            <button type="button" class="seg-btn ${breakdownType === 'income' ? 'active' : ''}" data-trend="income">${t('tx.income')}</button>
          </div>
        </header>
        ${cats.length ? html`
          ${segmentBar(parts, { ariaLabel: t('fin.structure') })}
          <div class="rank">
            ${cats.slice(0, 8).map((r) => html`
              <button type="button" class="rank-row" data-filter-cat="${r.cat.id}">
                <span class="rank-name"><i class="lg-swatch" style="background:${seriesColor(r.cat.color)}"></i>${r.cat.icon} ${F.categoryName(r.cat)}</span>
                <span class="rank-bar"><span style="width:${Math.max(2, (r.total / cats[0].total) * 100)}%;background:${seriesColor(r.cat.color)}"></span></span>
                <span class="rank-val">${money(r.total)} <small>${percent(r.share)}</small></span>
              </button>`)}
          </div>` : html`<p class="muted pad">${t('fin.noneInPeriod')}</p>`}
      </section>

      <section class="card">
        <header class="card-head"><h3>${p.days <= 62 ? t('fin.daily') : t('fin.monthly')}</h3></header>
        ${columns(series, {
          color: 'var(--series-1)', avg, highlight: p.days <= 62 ? D.today() : D.today().slice(0, 7),
          labelEvery: series.length > 16 ? 5 : 1, ariaLabel: t('fin.daily'),
        })}
        ${(() => {
          const past = series.filter((s) => !s.future);
          const top = past.reduce((a, b) => (b.value > a.value ? b : a), { value: 0 });
          const zero = p.days <= 62 ? past.filter((s) => s.value === 0).length : 0;
          return html`<div class="ch-foot">
            <div><span class="kpi-label">${t('fin.peak')}</span><b>${top.value ? money(top.value) : '—'}</b><small class="muted">${top.value ? top.tip : ''}</small></div>
            <div><span class="kpi-label">${t('chart.avg')}</span><b>${avg ? money(avg) : '—'}</b></div>
            ${p.days <= 62 ? html`<div><span class="kpi-label">${t('fin.zeroDays')}</span><b>${zero}</b></div>` : ''}
          </div>`;
        })()}
      </section>

      <section class="card">
        <header class="card-head"><h3>${t('fin.trend')}</h3></header>
        ${grouped(trend, [
          { field: 'income', name: t('tx.income'), color: 'var(--series-income)' },
          { field: 'expense', name: t('tx.expense'), color: 'var(--series-expense)' },
        ], { highlight: endMonth, ariaLabel: t('fin.trend') })}
      </section>

      <section class="card">
        <header class="card-head"><h3>${icon('bulb', 18)} ${t('fin.insights')}</h3></header>
        ${ins.length ? html`<ul class="insights">${ins.map((i) => html`<li class="ins ins-${i.tone}"><span class="ins-ic">${icon(i.icon, 16)}</span><span>${i.text}</span></li>`)}</ul>`
          : html`<p class="muted pad">${t('fin.noInsights')}</p>`}
        ${b.limit ? html`
          <div class="budget-mini">
            <div class="row-between"><span>${t('budget.month')}</span><b>${money(b.total)} / ${money(b.limit)}</b></div>
            ${meter(b.total, b.limit, b.state, { label: t('budget.month') })}
          </div>` : html`<button type="button" class="btn btn-soft btn-sm" data-goto-tab="budgets">${icon('target', 16)}${t('budget.set')}</button>`}
      </section>
    </div>

    <section class="card">
      <header class="card-head"><h3>${t('fin.recent')}</h3><button type="button" class="btn btn-ghost btn-sm" data-goto-tab="list">${t('common.all')}${icon('right', 16)}</button></header>
      ${cur.length ? txList(cur, { limit: 8 }) : html`<p class="muted pad">${t('fin.noneInPeriod')}</p>`}
    </section>`;
}

// ------------------------------------------------------------------ list

function listView() {
  const p = currentPeriod();
  const q = ui.q.toLowerCase();
  const map = F.categoryMap();
  const txs = F.inRange(store.all('transactions'), p.from, p.to).filter((tx) => {
    if (ui.type !== 'all' && tx.type !== ui.type) return false;
    if (ui.cat && F.categoryOf(tx, map).id !== ui.cat) return false;
    if (q) {
      const cat = F.categoryOf(tx, map);
      if (!`${tx.note} ${F.categoryName(cat)} ${tx.amount}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const tot = F.totals(txs);
  const cats = [...store.categoriesOf('expense'), ...store.categoriesOf('income')];
  return html`
    ${periodBar(p)}
    <div class="toolbar">
      <div class="search"><span>${icon('search', 18)}</span><input class="input" type="search" data-search value="${ui.q}" placeholder="${t('common.search')}" aria-label="${t('common.search')}"></div>
      <div class="seg seg-sm">
        ${['all', 'expense', 'income'].map((k) => html`<button type="button" class="seg-btn ${ui.type === k ? 'active' : ''}" data-type-filter="${k}">${t(k === 'all' ? 'common.all' : `tx.${k}`)}</button>`)}
      </div>
      <select class="input input-sm select" data-cat-filter aria-label="${t('tx.category')}">
        <option value="">${t('fin.allCats')}</option>
        ${cats.map((c) => html`<option value="${c.id}" ${ui.cat === c.id ? 'selected' : ''}>${c.icon} ${F.categoryName(c)}</option>`)}
      </select>
      <div class="toolbar-end">
        <button type="button" class="btn btn-soft btn-sm" data-export="xlsx" data-tip="${t('fin.exportXlsx')}">${icon('download', 16)}Excel</button>
        <button type="button" class="btn btn-ghost btn-sm" data-export="csv">CSV</button>
      </div>
    </div>
    <div class="list-summary">
      <span>${t('fin.count', { n: txs.length })}</span>
      ${tot.income ? html`<span class="pos">+${money(tot.income)}</span>` : ''}
      ${tot.expense ? html`<span>−${money(tot.expense)}</span>` : ''}
    </div>
    <section class="card card-flush">
      ${txs.length ? txList(txs) : emptyState('search', t('fin.nothingFound'))}
    </section>`;
}

// ------------------------------------------------------------------ budgets

function budgetsView() {
  const b = F.budgets(ui.budgetMonth);
  const [y, m] = b.from.split('-').map(Number);
  const isCurrentMonth = b.isCurrent;
  const stateText = (row) => (row.state === 'over' ? html`<span class="state state-over">${icon('alert', 14)}${t('budget.over')}</span>`
    : row.state === 'near' ? html`<span class="state state-near">${icon('alert', 14)}${t('budget.near')}</span>` : '');
  return html`
    <div class="stepper stepper-solo">
      <button type="button" class="btn-icon" data-bmonth="-1" aria-label="${t('common.prev')}">${icon('left')}</button>
      <span class="stepper-label">${monthTitle(y, m)}</span>
      <button type="button" class="btn-icon" data-bmonth="1" aria-label="${t('common.next')}" ${isCurrentMonth ? 'disabled' : ''}>${icon('right')}</button>
    </div>
    <section class="card budget-total">
      <div class="row-between">
        <div>
          <span class="kpi-label">${t('budget.month')}</span>
          <div class="kpi-value">${money(b.total)}${b.limit ? html` <small class="muted">/ ${money(b.limit)}</small>` : ''}</div>
        </div>
        <button type="button" class="btn btn-soft btn-sm" data-edit-total>${icon(b.limit ? 'edit' : 'plus', 16)}${b.limit ? t('common.edit') : t('budget.set')}</button>
      </div>
      ${b.limit ? html`
        ${meter(b.total, b.limit, b.state, { label: t('budget.month') })}
        <div class="row-between small">
          <span>${b.total <= b.limit ? t('budget.left', { amount: money(b.limit - b.total) }) : t('budget.overBy', { amount: money(b.total - b.limit) })}</span>
          ${isCurrentMonth && b.perDay ? html`<span class="muted">${t('budget.perDay', { amount: money(b.perDay) })}</span>` : stateText(b)}
        </div>` : html`<p class="muted small">${t('budget.hint')}</p>`}
    </section>
    <section class="card">
      <header class="card-head"><h3>${t('budget.byCategory')}</h3></header>
      <div class="meter-list">
        ${b.rows.map((r) => html`
          <button type="button" class="meter-row" data-edit-limit="${r.cat.id}">
            <span class="meter-name">${r.cat.icon} ${F.categoryName(r.cat)}</span>
            <span class="meter-fig">${money(r.spent)}${r.limit ? html` <small>/ ${compact(r.limit)}</small>` : ''}</span>
            ${r.limit ? meter(r.spent, r.limit, r.state, { label: F.categoryName(r.cat) }) : html`<span class="meter-empty">${icon('plus', 14)}${t('budget.addLimit')}</span>`}
            ${stateText(r)}
          </button>`)}
      </div>
    </section>`;
}

function amountField(name, value, label) {
  return html`<label class="field"><span class="field-label">${label}</span>
    <div class="input-affix"><input class="input" name="${name}" inputmode="numeric" autocomplete="off" value="${value ? num(value) : ''}" data-money>
    <span>${t('common.currency')}</span></div></label>`;
}

export const readMoney = (s) => Number(String(s || '').replace(/\D/g, '')) || 0;

function bindMoneyInputs(scope) {
  scope.querySelectorAll('[data-money]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const v = readMoney(inp.value);
      inp.value = v ? num(Math.min(v, 1e13)) : '';
    });
  });
}

function openLimitSheet(cat) {
  const m = openModal({
    title: `${cat.icon} ${F.categoryName(cat)}`,
    className: 'modal-small',
    content: html`<form>${amountField('limit', cat.monthly_limit, t('budget.limit'))}
      <div class="modal-actions">
        ${cat.monthly_limit ? html`<button type="button" class="btn btn-ghost" data-clear>${t('budget.remove')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  bindMoneyInputs(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    store.put('categories', { id: cat.id, monthly_limit: readMoney(form.elements.limit.value) || null });
    m.close();
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { store.put('categories', { id: cat.id, monthly_limit: null }); m.close(); }
  });
}

function openTotalBudgetSheet() {
  const user = store.getUser() || {};
  const m = openModal({
    title: t('budget.month'),
    className: 'modal-small',
    content: html`<form>${amountField('limit', user.monthly_budget, t('budget.limit'))}
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${user.monthly_budget ? html`<button type="button" class="btn btn-ghost" data-clear>${t('budget.remove')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  bindMoneyInputs(form);
  const save = async (value) => {
    try {
      const res = await request('PATCH', '/api/auth/me', { body: { monthly_budget: value } });
      store.setUser(res);
      m.close();
    } catch (err) {
      const box = $('.form-error', form);
      box.textContent = errorText(err);
      box.hidden = false;
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(readMoney(form.elements.limit.value) || null); });
  form.addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) save(null); });
}

// ------------------------------------------------------------------ goals

const GOAL_ICONS = ['🎯', '💻', '📱', '✈️', '🏠', '🚗', '🎓', '💍', '🏖️', '💰'];

function goalsView() {
  const goals = store.all('goals').sort((a, b) => a.created_at - b.created_at);
  if (!goals.length) {
    return html`<section class="card">${emptyState('target', t('goal.empty'), html`<button class="btn btn-primary" data-new-goal>${icon('plus', 18)}${t('goal.new')}</button>`)}</section>`;
  }
  return html`
    <div class="toolbar"><div class="toolbar-end"><button type="button" class="btn btn-soft btn-sm" data-new-goal>${icon('plus', 16)}${t('goal.new')}</button></div></div>
    <div class="goal-grid">
      ${goals.map((g) => {
        const pct = g.target ? (g.saved / g.target) * 100 : 0;
        const left = Math.max(0, g.target - g.saved);
        let plan = '';
        if (g.deadline && left > 0) {
          const days = D.diffDays(D.today(), g.deadline);
          plan = days <= 0 ? t('goal.deadlinePassed') : t('goal.perMonth', { amount: money(Math.ceil(left / Math.max(1, Math.ceil(days / 30)))) });
        }
        return html`
          <article class="card goal">
            <header class="goal-head">
              <span class="goal-ic">${g.icon || '🎯'}</span>
              <div class="goal-title"><h3>${g.title}</h3>${g.deadline ? html`<span class="muted small">${icon('calendar', 13)} ${dateShort(g.deadline)}</span>` : ''}</div>
              <button type="button" class="btn-icon" data-edit-goal="${g.id}" aria-label="${t('common.edit')}">${icon('edit', 18)}</button>
            </header>
            <div class="goal-fig"><b>${money(g.saved)}</b><span class="muted">/ ${money(g.target)}</span><span class="goal-pct">${percent(Math.min(100, pct))}</span></div>
            ${progress(pct, { tone: pct >= 100 ? 'good' : 'accent' })}
            <p class="small muted">${left > 0 ? html`${t('goal.left', { amount: money(left) })}${plan ? html` · ${plan}` : ''}` : html`🎉 ${t('goal.done')}`}</p>
            <div class="goal-actions">
              <button type="button" class="btn btn-soft btn-sm" data-goal-add="${g.id}">${icon('plus', 16)}${t('goal.deposit')}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-goal-take="${g.id}">${icon('minus', 16)}${t('goal.withdraw')}</button>
            </div>
          </article>`;
      })}
    </div>`;
}

function openGoalSheet(goal = null) {
  const m = openModal({
    title: goal ? t('goal.edit') : t('goal.new'),
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('goal.title')}</span><input class="input" name="title" required maxlength="120" value="${goal ? goal.title : ''}" placeholder="${t('goal.titlePh')}"></label>
      <div class="form-row">
        ${amountField('target', goal && goal.target, t('goal.target'))}
        ${amountField('saved', goal && goal.saved, t('goal.saved'))}
      </div>
      <label class="field"><span class="field-label">${t('goal.deadline')}</span><input class="input" type="date" name="deadline" value="${goal && goal.deadline ? goal.deadline : ''}"></label>
      <div class="field"><span class="field-label">${t('common.icon')}</span>
        <div class="chips emoji-chips">${GOAL_ICONS.map((ic) => html`<label class="chip chip-emoji"><input type="radio" name="icon" value="${ic}" ${(goal ? goal.icon : '🎯') === ic ? 'checked' : ''}><span>${ic}</span></label>`)}</div>
      </div>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${goal ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button>
      </div></form>`,
  });
  const form = $('form', m.body);
  bindMoneyInputs(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const el = form.elements;
    const target = readMoney(el.target.value);
    const box = $('.form-error', form);
    if (!el.title.value.trim()) { box.textContent = t('err.required'); box.hidden = false; return; }
    if (!target) { box.textContent = t('goal.errTarget'); box.hidden = false; return; }
    store.put('goals', { ...(goal ? { id: goal.id } : {}), title: el.title.value.trim(), target, saved: readMoney(el.saved.value),
      deadline: el.deadline.value || null, icon: el.icon.value || '🎯', color: '' });
    m.close();
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    if (await confirmDialog({ title: t('goal.deleteQ') })) {
      const old = store.remove('goals', goal.id);
      m.close();
      toast(t('common.deleted'), { action: { label: t('common.undo'), fn: () => store.restore('goals', old) } });
    }
  });
}

function openGoalMoney(goal, dir) {
  const m = openModal({
    title: `${goal.icon || '🎯'} ${dir > 0 ? t('goal.deposit') : t('goal.withdraw')}`,
    className: 'modal-small',
    content: html`<form>${amountField('amount', 0, t('goal.amount'))}<div class="modal-actions"><button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  bindMoneyInputs(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = readMoney(form.elements.amount.value);
    if (!v) return;
    store.put('goals', { id: goal.id, saved: Math.max(0, Math.min(1e13, (goal.saved || 0) + dir * v)) });
    m.close();
  });
}

// ------------------------------------------------------------------ page

async function exportTx(fmt) {
  const p = currentPeriod();
  try {
    await syncNow();
    const res = await request('GET', `/api/export/transactions.${fmt}?from=${p.from}&to=${p.to}&lang=${getLang()}`, { raw: true, timeout: 60000 });
    downloadBlob(await res.blob(), `makon-${p.from}_${p.to}.${fmt}`);
  } catch (err) {
    toast(errorText(err), { tone: 'error' });
  }
}

function body() {
  if (ui.tab === 'list') return listView();
  if (ui.tab === 'budgets') return budgetsView();
  if (ui.tab === 'goals') return goalsView();
  return overview();
}

function paint() {
  if (!root) return;
  const region = $('[data-region]', root);
  const searchFocused = document.activeElement && document.activeElement.matches('[data-search]');
  const caret = searchFocused ? document.activeElement.selectionStart : null;
  setHTML(region, body());
  if (searchFocused) {
    const s = $('[data-search]', region);
    if (s) { s.focus(); try { s.setSelectionRange(caret, caret); } catch (_) { /* ignore */ } }
  }
  root.querySelectorAll('[data-tabnav]').forEach((a) => a.classList.toggle('active', a.dataset.tabnav === ui.tab));
}

export default {
  id: 'finance',
  deps: ['transactions', 'categories', 'goals', 'user'],
  title: () => t('nav.finance'),
  mount(el, params) {
    root = el;
    ui.tab = TABS.includes(params[0]) ? params[0] : 'overview';
    setHTML(el, html`
      <header class="page-head">
        <h1>${t('nav.finance')}</h1>
        <div class="page-actions">
          <button type="button" class="btn btn-primary hide-mobile" data-add>${icon('plus', 18)}${t('tx.new')}</button>
        </div>
      </header>
      <nav class="tabs" aria-label="${t('nav.finance')}">
        ${TABS.map((k) => html`<a href="#/finance/${k}" class="tab ${ui.tab === k ? 'active' : ''}" data-tabnav="${k}">${t(`fin.tab.${k}`)}</a>`)}
      </nav>
      ${quickBar()}
      <div data-region></div>`);
    bindQuickBar(el);
    paint();
    if (params[0] === 'add') {
      history.replaceState(null, '', '#/finance');
      openTxSheet();
    }

    const searchInput = debounce((v) => { ui.q = v; paint(); }, 200);
    el.addEventListener('input', (e) => { if (e.target.matches('[data-search]')) searchInput(e.target.value); });
    el.addEventListener('change', (e) => {
      if (e.target.matches('[data-cat-filter]')) { ui.cat = e.target.value; paint(); }
      if (e.target.matches('[data-range]')) {
        const v = e.target.value;
        if (D.isDate(v)) { ui.custom[e.target.dataset.range] = v; paint(); }
      }
    });
    on(el, 'click', '[data-add]', () => openTxSheet());
    on(el, 'click', '[data-tx]', (e, b) => { const tx = store.get('transactions', b.dataset.tx); if (tx) openTxSheet({ tx }); });
    on(el, 'click', '[data-kind]', (e, b) => { ui.kind = b.dataset.kind; ui.anchor = D.today(); paint(); });
    on(el, 'click', '[data-shift]', (e, b) => {
      const np = F.shiftPeriod(currentPeriod(), Number(b.dataset.shift));
      if (np.from > D.today()) return;
      ui.anchor = np.from;
      if (np.kind === 'custom') ui.custom = { from: np.from, to: np.to };
      paint();
    });
    on(el, 'click', '[data-trend]', (e, b) => { ui.trendType = b.dataset.trend; paint(); });
    on(el, 'click', '[data-type-filter]', (e, b) => { ui.type = b.dataset.typeFilter; paint(); });
    on(el, 'click', '[data-filter-cat]', (e, b) => { ui.cat = b.dataset.filterCat === 'rest' ? '' : b.dataset.filterCat; ui.type = 'all'; location.hash = '#/finance/list'; });
    on(el, 'click', '[data-goto-tab]', (e, b) => { location.hash = `#/finance/${b.dataset.gotoTab}`; });
    on(el, 'click', '[data-export]', (e, b) => exportTx(b.dataset.export));
    on(el, 'click', '[data-bmonth]', (e, b) => {
      const next = D.addMonths(D.startOfMonth(ui.budgetMonth), Number(b.dataset.bmonth));
      if (next <= D.today()) { ui.budgetMonth = next; paint(); }
    });
    on(el, 'click', '[data-edit-total]', () => openTotalBudgetSheet());
    on(el, 'click', '[data-edit-limit]', (e, b) => { const c = store.get('categories', b.dataset.editLimit); if (c) openLimitSheet(c); });
    on(el, 'click', '[data-new-goal]', () => openGoalSheet());
    on(el, 'click', '[data-edit-goal]', (e, b) => { const g = store.get('goals', b.dataset.editGoal); if (g) openGoalSheet(g); });
    on(el, 'click', '[data-goal-add]', (e, b) => { const g = store.get('goals', b.dataset.goalAdd); if (g) openGoalMoney(g, 1); });
    on(el, 'click', '[data-goal-take]', (e, b) => { const g = store.get('goals', b.dataset.goalTake); if (g) openGoalMoney(g, -1); });
  },
  update() { paint(); },
  unmount() { root = null; },
  fab() { if (ui.tab === 'goals') openGoalSheet(); else openTxSheet(); },
};

