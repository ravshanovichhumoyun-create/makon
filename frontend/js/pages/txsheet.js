// Add / edit a transaction: calculator keypad, category grid, date and note.
import { $, html, setHTML } from '../core/dom.js';
import { evaluate, hasOperator, press, pretty } from '../core/calc.js';
import * as D from '../core/dates.js';
import { categoryName } from '../core/finance.js';
import { currencyLabel, dateShort, money, num, t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { parseEntry } from '../core/parser.js';
import * as store from '../core/store.js';
import { confirmDialog, openModal, toast } from '../core/ui.js';

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '000', '0', '⌫', '+'];

/** Save a transaction and show an undo toast. */
export function saveTx(values, { isNew = true } = {}) {
  const rec = store.put('transactions', values);
  const sign = rec.type === 'income' ? '+' : '−';
  toast(`${isNew ? t('tx.added') : t('common.saved')}: ${sign}${money(rec.amount)}`, {
    tone: 'success',
    action: isNew ? { label: t('common.undo'), fn: () => store.remove('transactions', rec.id) } : null,
  });
  return rec;
}

/** Quick entry from free text ("taksi 25k"). Returns true when something was added. */
export function quickAdd(text) {
  const custom = store.all('categories').filter((c) => c.name).map((c) => ({ id: c.id, type: c.type, name: c.name }));
  const p = parseEntry(text, custom);
  if (!p) return false;
  const cat = (p.category_id && store.get('categories', p.category_id))
    || store.all('categories').find((c) => c.key === p.category_key)
    || store.fallbackCategory(p.type);
  saveTx({ type: p.type, amount: p.amount, category_id: cat ? cat.id : '', date: D.today(), note: p.note, source: 'manual' });
  return true;
}

export function previewQuick(text) {
  const custom = store.all('categories').filter((c) => c.name).map((c) => ({ id: c.id, type: c.type, name: c.name }));
  const p = parseEntry(text, custom);
  if (!p) return null;
  const cat = (p.category_id && store.get('categories', p.category_id))
    || store.all('categories').find((c) => c.key === p.category_key) || store.fallbackCategory(p.type);
  return { ...p, cat };
}

/** Most used category of this type over the last 60 days (falls back to "Other"). */
function favouriteCategory(type, cats) {
  const since = D.addDays(D.today(), -60);
  const counts = new Map();
  store.all('transactions').forEach((tx) => {
    if (tx.type === type && tx.date >= since) counts.set(tx.category_id, (counts.get(tx.category_id) || 0) + 1);
  });
  let best = null;
  let n = 0;
  cats.forEach((c) => { if ((counts.get(c.id) || 0) > n) { best = c.id; n = counts.get(c.id); } });
  return best || (cats.find((c) => c.key === `other_${type}`) || cats[0] || {}).id || null;
}

export function openTxSheet({ tx = null, type = 'expense', categoryId = null, date = null } = {}) {
  const editing = !!tx;
  const st = {
    type: tx ? tx.type : type,
    expr: tx ? String(tx.amount) : '',
    category: tx ? tx.category_id : categoryId,
    date: tx ? tx.date : date || D.today(),
    note: tx ? tx.note : '',
  };

  const m = openModal({
    title: editing ? t('tx.edit') : t('tx.new'),
    wide: true,
    className: 'tx-sheet',
    content: html`<form class="tx-form" novalidate>
      <div class="tx-left">
        <div class="seg seg-type" role="tablist"></div>
        <div class="amount-box" aria-live="polite"></div>
        <div class="keypad">
          ${KEYS.map((k) => html`<button type="button" class="key ${/[÷×−+]/.test(k) ? 'key-op' : ''}" data-key="${k}" aria-label="${k === '⌫' ? t('common.delete') : k}">${k === '⌫' ? icon('backspace', 22) : k}</button>`)}
        </div>
      </div>
      <div class="tx-right">
        <div class="field"><span class="field-label">${t('tx.category')}</span><div class="cat-grid"></div></div>
        <div class="field"><span class="field-label">${t('tx.date')}</span>
          <div class="date-row">
            <div class="chips date-chips"></div>
            <input type="date" class="input input-date" name="date" required max="${D.addDays(D.today(), 366)}">
          </div>
        </div>
        <label class="field"><span class="field-label">${t('tx.note')}</span>
          <input class="input" name="note" maxlength="500" autocomplete="off" placeholder="${t('tx.notePh')}">
        </label>
        <p class="form-error" hidden></p>
        <div class="modal-actions">
          ${editing ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-delete>${icon('trash', 18)}<span>${t('common.delete')}</span></button>` : ''}
          <button type="submit" class="btn btn-primary btn-wide">${icon('check', 18)}<span>${t('common.save')}</span></button>
        </div>
      </div>
    </form>`,
  });

  const form = $('form', m.body);
  const noteInput = form.elements.note;
  const dateInput = form.elements.date;
  noteInput.value = st.note;
  dateInput.value = st.date;

  const paintType = () => {
    setHTML($('.seg-type', form), html`
      <button type="button" class="seg-btn ${st.type === 'expense' ? 'active' : ''}" data-type="expense">${icon('downArrow', 16)}<span>${t('tx.expense')}</span></button>
      <button type="button" class="seg-btn ${st.type === 'income' ? 'active' : ''}" data-type="income">${icon('up', 16)}<span>${t('tx.income')}</span></button>`);
    form.dataset.type = st.type;
  };

  const paintAmount = () => {
    const value = evaluate(st.expr);
    setHTML($('.amount-box', form), html`
      <div class="amount-expr">${hasOperator(st.expr) ? pretty(st.expr) : ''}</div>
      <div class="amount-value ${value ? '' : 'is-empty'}">
        <span>${value ? (st.type === 'income' ? '+' : '−') : ''}${value !== null ? num(Math.max(0, value)) : '0'}</span>
        <small>${currencyLabel()}</small>
      </div>`);
  };

  const paintCats = () => {
    const cats = store.categoriesOf(st.type);
    if (!cats.find((c) => c.id === st.category)) st.category = favouriteCategory(st.type, cats);
    setHTML($('.cat-grid', form), cats.map((c) => html`
      <button type="button" class="cat-chip ${c.id === st.category ? 'active' : ''}" data-cat="${c.id}" aria-pressed="${c.id === st.category}">
        <span class="cat-emoji">${c.icon || '📦'}</span><span class="cat-name">${categoryName(c)}</span>
      </button>`));
  };

  const paintDates = () => {
    const today = D.today();
    const yesterday = D.addDays(today, -1);
    setHTML($('.date-chips', form), html`
      <button type="button" class="chip-btn ${st.date === today ? 'active' : ''}" data-date="${today}">${t('rel.today')}</button>
      <button type="button" class="chip-btn ${st.date === yesterday ? 'active' : ''}" data-date="${yesterday}">${t('rel.yesterday')}</button>`);
    dateInput.value = st.date;
  };

  const error = (msg) => {
    const box = $('.form-error', form);
    box.textContent = msg || '';
    box.hidden = !msg;
  };

  paintType();
  paintAmount();
  paintCats();
  paintDates();

  const pressKey = (k) => {
    st.expr = press(st.expr, k);
    error('');
    paintAmount();
  };

  form.addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]');
    if (key) { pressKey(key.dataset.key); return; }
    const ty = e.target.closest('[data-type]');
    if (ty && ty.dataset.type !== st.type) { st.type = ty.dataset.type; paintType(); paintAmount(); paintCats(); return; }
    const cat = e.target.closest('[data-cat]');
    if (cat) { st.category = cat.dataset.cat; paintCats(); return; }
    const dt = e.target.closest('[data-date]');
    if (dt) { st.date = dt.dataset.date; paintDates(); return; }
    if (e.target.closest('[data-delete]')) {
      confirmDialog({ title: t('tx.deleteQ') }).then((yes) => {
        if (!yes) return;
        const old = store.remove('transactions', tx.id);
        m.close();
        toast(t('common.deleted'), { action: { label: t('common.undo'), fn: () => store.restore('transactions', old) } });
      });
    }
  });
  dateInput.addEventListener('change', () => { if (D.isDate(dateInput.value)) { st.date = dateInput.value; paintDates(); } });

  // physical keyboard: digits and operators go to the calculator unless typing in a text field
  const onKey = (e) => {
    if (!document.body.contains(form)) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const map = { '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', Backspace: '⌫', Delete: 'C' };
    if (/^\d$/.test(e.key)) { e.preventDefault(); pressKey(e.key); }
    else if (map[e.key]) { e.preventDefault(); pressKey(map[e.key]); }
    else if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  };
  document.addEventListener('keydown', onKey);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = evaluate(st.expr);
    if (!amount || amount <= 0) { error(t('tx.errAmount')); return; }
    if (!st.category) { error(t('tx.errCategory')); return; }
    if (!D.isDate(st.date)) { error(t('tx.errDate')); return; }
    saveTx({
      ...(tx ? { id: tx.id } : {}),
      type: st.type, amount, category_id: st.category, date: st.date,
      note: noteInput.value.trim().slice(0, 500), source: tx ? tx.source || 'manual' : 'manual',
    }, { isNew: !editing });
    document.removeEventListener('keydown', onKey);
    m.close();
  });
  return m;
}

export const txLabel = (tx, cat) => tx.note || categoryName(cat);
export const txDateLabel = (d) => (d === D.today() ? t('rel.today') : d === D.addDays(D.today(), -1) ? t('rel.yesterday') : dateShort(d));
