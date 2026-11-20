// Finance analytics: periods, totals, category breakdown, series, budgets, forecast and insights.
import * as D from './dates.js';
import { compact, dateShort, money, monthShort, monthTitle, percent, t, weekdayShort } from './i18n.js';
import * as store from './store.js';

// ------------------------------------------------------------------ periods

/** kind: day | week | month | year | custom; anchor: any date inside the period */
export function period(kind, anchor = D.today(), custom = null) {
  let from;
  let to;
  if (kind === 'day') { from = anchor; to = anchor; }
  else if (kind === 'week') { from = D.startOfWeek(anchor); to = D.addDays(from, 6); }
  else if (kind === 'year') { from = D.startOfYear(anchor); to = D.endOfYear(anchor); }
  else if (kind === 'custom' && custom && custom.from && custom.to) {
    from = custom.from <= custom.to ? custom.from : custom.to;
    to = custom.from <= custom.to ? custom.to : custom.from;
  } else { kind = 'month'; from = D.startOfMonth(anchor); to = D.endOfMonth(anchor); }
  const days = D.diffDays(from, to) + 1;
  let prev;
  if (kind === 'month') prev = { from: D.startOfMonth(D.addMonths(from, -1)), to: D.endOfMonth(D.addMonths(from, -1)) };
  else if (kind === 'year') prev = { from: D.addMonths(from, -12), to: D.addDays(from, -1) };
  else prev = { from: D.addDays(from, -days), to: D.addDays(from, -1) };
  const today = D.today();
  return { kind, from, to, days, prev, isCurrent: from <= today && today <= to, anchor };
}

export function shiftPeriod(p, dir) {
  if (p.kind === 'day') return period('day', D.addDays(p.from, dir));
  if (p.kind === 'week') return period('week', D.addDays(p.from, 7 * dir));
  if (p.kind === 'year') return period('year', D.addMonths(p.from, 12 * dir));
  if (p.kind === 'custom') return period('custom', null, { from: D.addDays(p.from, dir * p.days), to: D.addDays(p.to, dir * p.days) });
  return period('month', D.addMonths(p.from, dir));
}

export function periodLabel(p) {
  const today = D.today();
  if (p.kind === 'day') {
    if (p.from === today) return t('rel.today');
    if (p.from === D.addDays(today, -1)) return t('rel.yesterday');
    return dateShort(p.from);
  }
  if (p.kind === 'month') {
    const [y, m] = p.from.split('-').map(Number);
    return monthTitle(y, m);
  }
  if (p.kind === 'year') return p.from.slice(0, 4);
  if (p.kind === 'week' && p.isCurrent) return t('period.thisWeek');
  return `${dateShort(p.from)} – ${dateShort(p.to)}`;
}

// ------------------------------------------------------------------ basic aggregates

export const inRange = (txs, from, to) => txs.filter((tx) => tx.date >= from && tx.date <= to);

export function totals(txs) {
  let income = 0;
  let expense = 0;
  for (const tx of txs) {
    if (tx.type === 'income') income += tx.amount;
    else expense += tx.amount;
  }
  return { income, expense, balance: income - expense };
}

export function categoryMap() {
  const map = new Map();
  store.getState().data.categories.forEach((c) => map.set(c.id, c));
  return map;
}

export function categoryName(cat) {
  if (!cat) return t('cat.other_expense');
  if (cat.name) return cat.name;
  return cat.key ? t(`cat.${cat.key}`) : '—';
}

export function categoryOf(tx, map = categoryMap()) {
  const cat = map.get(tx.category_id);
  if (cat && !cat.deleted) return cat;
  return store.fallbackCategory(tx.type) || { id: '', icon: '📦', color: '#898781', name: '', key: tx.type === 'income' ? 'other_income' : 'other_expense' };
}

/** [{cat, total, count, share}] sorted by total desc */
export function byCategory(txs, type) {
  const map = categoryMap();
  const sums = new Map();
  let all = 0;
  for (const tx of txs) {
    if (tx.type !== type) continue;
    const cat = categoryOf(tx, map);
    const row = sums.get(cat.id) || { cat, total: 0, count: 0 };
    row.total += tx.amount;
    row.count += 1;
    sums.set(cat.id, row);
    all += tx.amount;
  }
  return Array.from(sums.values())
    .map((r) => ({ ...r, share: all ? (r.total / all) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
}

/** Daily expense columns for a period (≤ 62 days), monthly columns for longer periods. */
export function expenseSeries(txs, p) {
  const expenses = txs.filter((tx) => tx.type === 'expense');
  if (p.days <= 62) {
    const sums = new Map();
    expenses.forEach((tx) => sums.set(tx.date, (sums.get(tx.date) || 0) + tx.amount));
    return D.eachDay(p.from, p.to).map((d) => ({
      key: d,
      value: sums.get(d) || 0,
      label: p.days <= 7 ? weekdayShort(D.weekday(d)) : String(Number(d.slice(8))),
      tip: dateShort(d),
      future: d > D.today(),
    }));
  }
  const sums = new Map();
  expenses.forEach((tx) => sums.set(tx.date.slice(0, 7), (sums.get(tx.date.slice(0, 7)) || 0) + tx.amount));
  const out = [];
  for (let m = p.from.slice(0, 7); m <= p.to.slice(0, 7) && out.length < 36; m = D.addMonths(`${m}-01`, 1).slice(0, 7)) {
    out.push({ key: m, value: sums.get(m) || 0, label: monthShort(Number(m.slice(5))), tip: monthTitle(Number(m.slice(0, 4)), Number(m.slice(5))), future: m > D.today().slice(0, 7) });
  }
  return out;
}

/** Income vs expense for the last n months ending at `endMonth` (YYYY-MM). */
export function monthlyTrend(txs, endMonth, n = 6) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = D.addMonths(`${endMonth}-01`, -i).slice(0, 7);
    out.push({ key: m, label: monthShort(Number(m.slice(5))), tip: monthTitle(Number(m.slice(0, 4)), Number(m.slice(5))), income: 0, expense: 0 });
  }
  const idx = new Map(out.map((r, i) => [r.key, i]));
  for (const tx of txs) {
    const i = idx.get(tx.date.slice(0, 7));
    if (i === undefined) continue;
    out[i][tx.type === 'income' ? 'income' : 'expense'] += tx.amount;
  }
  return out;
}

// ------------------------------------------------------------------ budgets & forecast

export function budgetState(spent, limit) {
  if (!limit) return 'none';
  const r = spent / limit;
  if (r >= 1) return 'over';
  if (r >= 0.8) return 'near';
  return 'ok';
}

/** Budget rows for a calendar month (YYYY-MM-DD anywhere inside it). */
export function budgets(month) {
  const from = D.startOfMonth(month);
  const to = D.endOfMonth(month);
  const txs = inRange(store.all('transactions'), from, to);
  const spentBy = new Map(byCategory(txs, 'expense').map((r) => [r.cat.id, r.total]));
  const total = totals(txs).expense;
  const user = store.getUser() || {};
  const rows = store.categoriesOf('expense').map((cat) => {
    const spent = spentBy.get(cat.id) || 0;
    return { cat, spent, limit: cat.monthly_limit || 0, state: budgetState(spent, cat.monthly_limit) };
  });
  const today = D.today();
  const isCurrent = from <= today && today <= to;
  const daysLeft = isCurrent ? D.diffDays(today, to) + 1 : 0;
  const limit = user.monthly_budget || 0;
  return {
    from, to, total, limit, rows, isCurrent, daysLeft,
    state: budgetState(total, limit),
    perDay: limit && daysLeft ? Math.max(0, Math.floor((limit - total) / daysLeft)) : 0,
  };
}

export function forecast(txs, p) {
  if (p.kind !== 'month' || !p.isCurrent) return null;
  const elapsed = D.diffDays(p.from, D.today()) + 1;
  if (elapsed < 3) return null;
  const spent = totals(inRange(txs, p.from, D.today())).expense;
  return Math.round((spent / elapsed) * p.days);
}

// ------------------------------------------------------------------ insights

export function change(cur, prev) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

/** A handful of plain-language observations for the period, most useful first. */
export function insights(allTxs, p) {
  const cur = inRange(allTxs, p.from, p.to);
  const prev = inRange(allTxs, p.prev.from, p.prev.to);
  const ct = totals(cur);
  const pt = totals(prev);
  const out = [];
  if (!cur.length) return out;

  const fc = forecast(allTxs, p);
  const user = store.getUser() || {};
  if (fc && user.monthly_budget) {
    const diff = fc - user.monthly_budget;
    out.push(diff > 0
      ? { icon: 'alert', tone: 'warn', text: t('ins.forecastOver', { amount: money(fc), over: money(diff) }) }
      : { icon: 'check', tone: 'good', text: t('ins.forecastOk', { amount: money(fc) }) });
  } else if (fc) {
    out.push({ icon: 'trendUp', tone: 'info', text: t('ins.forecast', { amount: money(fc) }) });
  }

  const ch = change(ct.expense, pt.expense);
  if (ch !== null && Math.abs(ch) >= 5 && pt.expense > 0) {
    out.push(ch > 0
      ? { icon: 'trendUp', tone: 'warn', text: t('ins.moreThanPrev', { pct: percent(ch) }) }
      : { icon: 'trendDown', tone: 'good', text: t('ins.lessThanPrev', { pct: percent(-ch) }) });
  }

  const curCats = byCategory(cur, 'expense');
  const prevCats = new Map(byCategory(prev, 'expense').map((r) => [r.cat.id, r.total]));
  const spike = curCats.find((r) => {
    const before = prevCats.get(r.cat.id) || 0;
    return before > 0 && r.total >= before * 1.5 && r.total - before >= ct.expense * 0.08;
  });
  if (spike) {
    out.push({ icon: 'alert', tone: 'warn', text: t('ins.spike', { cat: `${spike.cat.icon} ${categoryName(spike.cat)}`, x: (spike.total / prevCats.get(spike.cat.id)).toFixed(1).replace('.', t('decimal')) }) });
  } else if (curCats[0] && curCats.length > 1) {
    out.push({ icon: 'chart', tone: 'info', text: t('ins.top', { cat: `${curCats[0].cat.icon} ${categoryName(curCats[0].cat)}`, pct: percent(curCats[0].share) }) });
  }

  if (ct.income > 0 && ct.expense > 0) {
    const rate = ((ct.income - ct.expense) / ct.income) * 100;
    if (rate > 0) out.push({ icon: 'target', tone: 'good', text: t('ins.saved', { pct: percent(rate) }) });
    else out.push({ icon: 'alert', tone: 'warn', text: t('ins.overspent', { amount: money(-ct.balance) }) });
  }

  if (p.kind === 'month' || p.kind === 'week') {
    const end = p.isCurrent ? D.today() : p.to;
    const spentDays = new Set(cur.filter((x) => x.type === 'expense').map((x) => x.date));
    const free = D.eachDay(p.from, end).filter((d) => !spentDays.has(d)).length;
    if (free >= 2) out.push({ icon: 'zap', tone: 'good', text: t('ins.freeDays', { n: free }) });
  }

  const biggest = cur.filter((x) => x.type === 'expense').sort((a, b) => b.amount - a.amount)[0];
  if (biggest && ct.expense > 0 && biggest.amount >= ct.expense * 0.25 && cur.length > 2) {
    out.push({ icon: 'info', tone: 'info', text: t('ins.biggest', { amount: money(biggest.amount), what: biggest.note || categoryName(categoryOf(biggest)) }) });
  }
  return out.slice(0, 4);
}

export const fmtAxis = (v) => compact(v);
