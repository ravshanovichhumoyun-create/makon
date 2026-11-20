import { ApiError, request, upload } from '../core/api.js';
import { progress } from '../core/charts.js';
import { $, debounce, html, on, raw, setHTML } from '../core/dom.js';
import { num, percent, t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { fileDel, fileGet, fileSet } from '../core/idb.js';
import * as D from '../core/dates.js';
import { confettiFrom } from '../core/fx.js';
import { cachedUrl, coverFromPdf, deleteImage, hydrateImages, resizeImage, saveImage } from '../core/images.js';
import * as store from '../core/store.js';
import { confirmDialog, emptyState, errorText, hideToast, openModal, toast } from '../core/ui.js';

const CATS = ['it', 'science', 'business', 'fiction', 'self', 'religion', 'language', 'other'];
const CAT_EMOJI = { it: '💻', science: '🔬', business: '📈', fiction: '📖', self: '🌱', religion: '🕌', language: '🗣️', other: '📚' };
const ui = { q: '', cat: '', status: '' };
let root = null;
let config = { files: { enabled: false, max_mb: 50 } };

export const setLibraryConfig = (c) => { if (c) config = c; };

const localKey = (book) => `book:${book.id}`;
const cloudKey = (book) => `file:${book.file_id}`;

export function bookStatus(b) {
  if (b.finished_at) return 'done';
  if (b.total_pages && b.read_pages >= b.total_pages) return 'done';
  if (b.read_pages > 0) return 'reading';
  return 'new';
}

const pct = (b) => (b.total_pages ? Math.min(100, (b.read_pages / b.total_pages) * 100) : 0);

function fileBadge(b) {
  if (b.file_id) return html`<span class="pill pill-good" data-tip="${t('lib.cloudTip')}">${icon('cloud', 13)}PDF</span>`;
  if (store.hasLocalFile(localKey(b))) return html`<span class="pill" data-tip="${t('lib.deviceTip')}">${icon('phone', 13)}PDF</span>`;
  return '';
}

// ------------------------------------------------------------------ PDF handling

async function storePdf(book, file, onProgress) {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) throw new ApiError('not_pdf');
  const maxBytes = (config.files.max_mb || 50) * 1024 * 1024;
  if (config.files.enabled && file.size <= maxBytes && navigator.onLine) {
    try {
      const res = await upload('/api/files', file, onProgress);
      await fileSet(`file:${res.id}`, file).catch(() => {});
      await fileDel(localKey(book));
      store.markLocalFile(localKey(book), false);
      return { file_id: res.id, file_name: res.name, file_size: res.size, where: 'cloud' };
    } catch (err) {
      if (err.code === 'not_pdf') throw err;
      // fall back to keeping the file on this device
    }
  }
  await fileSet(localKey(book), file);
  store.markLocalFile(localKey(book), true);
  return { file_id: null, file_name: file.name.slice(0, 255), file_size: file.size, where: 'device' };
}

async function getPdf(book) {
  const local = await fileGet(localKey(book));
  if (local) return local;
  if (!book.file_id) return null;
  const cached = await fileGet(cloudKey(book));
  if (cached) return cached;
  const res = await request('GET', `/api/files/${book.file_id}`, { raw: true, timeout: 180000 });
  const blob = await res.blob();
  fileSet(cloudKey(book), blob).catch(() => {});
  return blob;
}

async function readBook(book) {
  toast(t('common.loading'));
  let blob;
  try { blob = await getPdf(book); } catch (err) { toast(errorText(err), { tone: 'error' }); return; }
  if (!blob) { toast(t('lib.noPdf'), { tone: 'error' }); return; }
  const { openPdf } = await import('../core/pdfview.js');
  hideToast();
  const start = book.read_pages > 0 && book.read_pages < (book.total_pages || Infinity) ? book.read_pages : 1;
  openPdf({
    blob, title: book.title, startPage: start, fileName: book.file_name || `${book.title}.pdf`,
    onClose: (page, total) => {
      const cur = store.get('books', book.id);
      if (!cur) return;
      const patch = {};
      if (!cur.total_pages && total) patch.total_pages = total;
      const totalPages = cur.total_pages || total;
      if (page > (cur.read_pages || 0)) patch.read_pages = Math.min(page, totalPages || page);
      if (Object.keys(patch).length) store.put('books', { id: book.id, ...patch });
    },
  });
}

async function deleteBookFiles(book) {
  await fileDel(localKey(book));
  if (book.file_id) await fileDel(cloudKey(book));
  store.markLocalFile(localKey(book), false);
}

/** Mark a book finished (today) or not finished. */
export function toggleBookDone(book, el) {
  const cur = store.get('books', book.id);
  if (!cur) return;
  if (cur.finished_at) {
    store.put('books', { id: cur.id, finished_at: null });
    return;
  }
  store.put('books', { id: cur.id, finished_at: D.today(), ...(cur.total_pages ? { read_pages: cur.total_pages } : {}) });
  if (el) confettiFrom(el, 90);
  toast(t('lib.doneToast'), { tone: 'success' });
}

/** Cover picture (or a generated cover with the title, so every book is recognisable). */
export function coverHtml(b, { size = '' } = {}) {
  const url = b.cover_id ? cachedUrl(b.cover_id) : null;
  return html`<div class="book-cover cover-${b.category || 'other'} ${size} ${b.cover_id ? 'has-photo' : ''} ${url ? 'img-ready' : ''}" data-has-img>
    ${b.cover_id ? html`<img data-img="${b.cover_id}" alt="" loading="lazy" ${url ? raw(`src="${url}"`) : ''}>` : ''}
    <span class="cover-art"><span class="cover-emoji">${CAT_EMOJI[b.category] || '📚'}</span><span class="cover-title">${b.title}</span>${b.author ? html`<span class="cover-author">${b.author}</span>` : ''}</span>
    ${bookStatus(b) === 'done' ? html`<span class="cover-done" aria-label="${t('lib.status.done')}">${icon('check', 14)}</span>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ sheets

function openBookSheet(book = null) {
  const m = openModal({
    title: book ? t('lib.edit') : t('lib.new'),
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('lib.title')}</span><input class="input" name="title" required maxlength="200" value="${book ? book.title : ''}"></label>
      <label class="field"><span class="field-label">${t('lib.author')}</span><input class="input" name="author" maxlength="120" value="${book ? book.author : ''}"></label>
      <div class="field"><span class="field-label">${t('lib.category')}</span>
        <div class="chips">${CATS.map((c) => html`<label class="chip"><input type="radio" name="category" value="${c}" ${(book ? book.category : 'other') === c ? 'checked' : ''}><span>${CAT_EMOJI[c]} ${t(`lib.cat.${c}`)}</span></label>`)}</div></div>
      <div class="form-row">
        <label class="field"><span class="field-label">${t('lib.pages')}</span><input class="input" name="total_pages" inputmode="numeric" type="number" min="0" max="100000" value="${book && book.total_pages ? book.total_pages : ''}"></label>
        <label class="field"><span class="field-label">${t('lib.read')}</span><input class="input" name="read_pages" inputmode="numeric" type="number" min="0" max="100000" value="${book ? book.read_pages || 0 : 0}"></label>
      </div>
      <div class="field cover-field"><span class="field-label">${t('lib.cover')}</span>
        <div class="cover-edit">
          <div class="cover-preview" data-cover-preview>${book ? coverHtml(book) : coverHtml({ title: '', category: 'other' })}</div>
          <div class="cover-btns">
            <label class="btn btn-soft btn-sm">${icon('image', 16)}${t('lib.coverPick')}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-cover-file hidden></label>
            <button type="button" class="btn btn-ghost btn-sm" data-cover-pdf ${book && (book.file_id || store.hasLocalFile(localKey(book))) ? '' : 'hidden'}>${icon('file', 16)}${t('lib.coverFromPdf')}</button>
            <button type="button" class="btn btn-ghost btn-sm btn-danger-text" data-cover-remove ${book && book.cover_id ? '' : 'hidden'}>${icon('x', 16)}${t('lib.coverRemove')}</button>
            <span class="field-hint">${t('lib.coverHint')}</span>
          </div>
        </div></div>
      <label class="field"><span class="field-label">PDF</span>
        <input class="input" type="file" name="file" accept="application/pdf,.pdf">
        <span class="field-hint">${book && (book.file_id || store.hasLocalFile(localKey(book))) ? t('lib.replaceHint') : config.files.enabled ? t('lib.cloudHint', { mb: config.files.max_mb }) : t('lib.deviceHint')}</span></label>
      <label class="field"><span class="field-label">${t('lib.desc')}</span><textarea class="input" name="description" rows="2" maxlength="1000">${book ? book.description : ''}</textarea></label>
      <div class="upload-progress" hidden>${progress(0)}<span class="small muted" data-up-text></span></div>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${book ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary" data-submit>${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  const el = form.elements;
  const fail = (msg) => { const b = $('.form-error', form); b.textContent = msg; b.hidden = !msg; };
  hydrateImages(m.body);
  // cover: undefined = unchanged, null = removed, Blob = new picture
  let coverBlob;
  let previewUrl = null;
  const showCover = (blob) => {
    const box = $('[data-cover-preview]', form);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = blob ? URL.createObjectURL(blob) : null;
    const base = { title: el.title.value.trim(), category: el.category.value || 'other', author: el.author.value.trim() };
    setHTML(box, coverHtml({ ...base, cover_id: blob ? 'preview' : null }));
    if (previewUrl) { const img = $('img', box); img.src = previewUrl; box.firstElementChild.classList.add('img-ready'); }
    $('[data-cover-remove]', form).hidden = !blob && !(book && book.cover_id && coverBlob !== null);
  };
  const pdfAvailable = () => !!el.file.files[0] || (book && (book.file_id || store.hasLocalFile(localKey(book))));
  $('[data-cover-file]', form).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { coverBlob = await resizeImage(f, 'cover'); showCover(coverBlob); fail(''); } catch (err) { fail(errorText(err)); }
  });
  on(form, 'click', '[data-cover-remove]', () => { coverBlob = null; showCover(null); });
  on(form, 'click', '[data-cover-pdf]', async (e, b) => {
    b.disabled = true;
    const label = b.innerHTML;
    b.textContent = t('lib.coverMaking');
    try {
      const pdf = el.file.files[0] || (book ? await getPdf(book) : null);
      if (!pdf) throw new ApiError('not_found');
      coverBlob = await coverFromPdf(pdf);
      showCover(coverBlob);
      fail('');
    } catch (err) { fail(errorText(err)); }
    b.disabled = false;
    b.innerHTML = label;
  });
  el.file.addEventListener('change', () => {
    const f = el.file.files[0];
    if (f && !el.title.value.trim()) el.title.value = f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').slice(0, 200);
    $('[data-cover-pdf]', form).hidden = !pdfAvailable();
  });
  const keepPreviewText = () => { if (coverBlob === undefined && !(book && book.cover_id)) showCover(null); };
  el.title.addEventListener('input', debounce(keepPreviewText, 250));
  let savedId = book ? book.id : null; // a retry after a failed upload must not create a second book
  let coverSaved = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    if (!title) return fail(t('err.required'));
    const btn = $('[data-submit]', form);
    if (btn.disabled) return;
    btn.disabled = true;
    const total = Math.max(0, Math.min(100000, Number(el.total_pages.value) || 0));
    const read = Math.max(0, Math.min(total || 100000, Number(el.read_pages.value) || 0));
    const file = el.file.files[0];
    let coverPatch = {};
    if (!coverSaved) {
      // a new PDF without any cover gets its first page as the cover (best effort)
      if (coverBlob === undefined && file && !(book && book.cover_id)) {
        try { coverBlob = await coverFromPdf(file); } catch (_) { coverBlob = undefined; }
      }
      if (coverBlob) coverPatch = { cover_id: await saveImage(coverBlob, 'cover') };
      else if (coverBlob === null) coverPatch = { cover_id: null };
      if (book && book.cover_id && 'cover_id' in coverPatch) deleteImage(book.cover_id);
      coverSaved = true;
    }
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    const record = store.put('books', {
      ...(savedId ? { id: savedId } : { file_id: null, file_name: '', file_size: null, cover_id: null, finished_at: null }),
      title, author: el.author.value.trim(), category: el.category.value || 'other',
      total_pages: total, read_pages: read, description: el.description.value.trim(), ...coverPatch,
    }, { silent: true });
    savedId = record.id;
    if (file) {
      const bar = $('.upload-progress', form);
      bar.hidden = false;
      try {
        const res = await storePdf(record, file, (p) => {
          $('.progress-fill', bar).style.width = `${Math.round(p * 100)}%`;
          $('[data-up-text]', bar).textContent = `${Math.round(p * 100)}%`;
        });
        if (book && book.file_id && book.file_id !== res.file_id) fileDel(`file:${book.file_id}`);
        store.put('books', { id: record.id, file_id: res.file_id, file_name: res.file_name, file_size: res.file_size });
        toast(res.where === 'cloud' ? t('lib.savedCloud') : t('lib.savedDevice'), { tone: 'success' });
      } catch (err) {
        btn.disabled = false;
        bar.hidden = true;
        store.put('books', { id: record.id });
        return fail(errorText(err));
      }
    } else {
      store.put('books', { id: record.id });
    }
    m.close();
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    if (await confirmDialog({ title: t('lib.deleteQ'), text: book.file_id || store.hasLocalFile(localKey(book)) ? t('lib.deleteText') : '' })) {
      store.remove('books', book.id);
      deleteBookFiles(book);
      if (book.cover_id) deleteImage(book.cover_id);
      m.close();
      toast(t('common.deleted'));
    }
  });
}

function openProgressSheet(book) {
  const total = book.total_pages || 0;
  const m = openModal({
    title: book.title,
    className: 'modal-small',
    content: html`<form class="form">
      <label class="field"><span class="field-label">${t('lib.readOf', { n: total ? num(total) : '—' })}</span>
        <input class="input input-lg" name="read" type="number" inputmode="numeric" min="0" max="${total || 100000}" value="${book.read_pages || 0}"></label>
      ${total ? html`<input type="range" class="range-input" name="slider" min="0" max="${total}" value="${book.read_pages || 0}" aria-label="${t('lib.read')}">` : ''}
      <div class="chips">${[10, 20, 50].map((n) => html`<button type="button" class="chip-btn" data-plus="${n}">+${n}</button>`)}
        ${total ? html`<button type="button" class="chip-btn" data-plus="all">${t('lib.finished')}</button>` : ''}</div>
      <div class="modal-actions"><button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  const el = form.elements;
  const clamp = (v) => Math.max(0, Math.min(total || 100000, Math.round(Number(v) || 0)));
  const sync = (v) => { el.read.value = clamp(v); if (el.slider) el.slider.value = clamp(v); };
  if (el.slider) el.slider.addEventListener('input', () => sync(el.slider.value));
  el.read.addEventListener('input', () => { if (el.slider) el.slider.value = clamp(el.read.value); });
  on(form, 'click', '[data-plus]', (e, b) => sync(b.dataset.plus === 'all' ? total : clamp(el.read.value) + Number(b.dataset.plus)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const read = clamp(el.read.value);
    const finished = total > 0 && read >= total;
    const cur = store.get('books', book.id) || book;
    store.put('books', { id: book.id, read_pages: read, finished_at: finished ? (cur.finished_at || D.today()) : null });
    m.close();
    if (finished && !cur.finished_at) toast(t('lib.doneToast'), { tone: 'success' });
  });
}

// ------------------------------------------------------------------ view

function view() {
  const books = store.all('books');
  if (!books.length) return html`<section class="card">${emptyState('book', t('lib.empty'), html`<button class="btn btn-primary" data-new-book>${icon('plus', 18)}${t('lib.new')}</button>`)}</section>`;
  const q = ui.q.toLowerCase();
  const list = books
    .filter((b) => (!ui.cat || b.category === ui.cat) && (!ui.status || bookStatus(b) === ui.status))
    .filter((b) => !q || `${b.title} ${b.author} ${b.description}`.toLowerCase().includes(q))
    .sort((a, b) => b.updated_at - a.updated_at);
  const reading = books.filter((b) => bookStatus(b) === 'reading').length;
  const done = books.filter((b) => bookStatus(b) === 'done').length;
  const pages = books.reduce((s, b) => s + (b.read_pages || 0), 0);
  const usedCats = CATS.filter((c) => books.some((b) => b.category === c));
  return html`
    <section class="stats">
      <div class="card stat"><span class="stat-value">${books.length}</span><span class="stat-label">${t('lib.total')}</span></div>
      <div class="card stat"><span class="stat-value">${reading}</span><span class="stat-label">${t('lib.reading')}</span></div>
      <div class="card stat"><span class="stat-value">${done}</span><span class="stat-label">${t('lib.done')}</span></div>
      <div class="card stat"><span class="stat-value">${num(pages)}</span><span class="stat-label">${t('lib.pagesRead')}</span></div>
    </section>
    <div class="toolbar">
      <div class="search"><span>${icon('search', 18)}</span><input class="input" type="search" data-search value="${ui.q}" placeholder="${t('common.search')}" aria-label="${t('common.search')}"></div>
      <div class="chips chips-scroll">
        ${['', 'reading', 'new', 'done'].map((s) => html`<button type="button" class="chip-btn ${ui.status === s ? 'active' : ''}" data-status="${s}">${s ? t(`lib.status.${s}`) : t('common.all')}</button>`)}
      </div>
      ${usedCats.length > 1 ? html`<select class="input input-sm select" data-cat aria-label="${t('lib.category')}">
        <option value="">${t('lib.allCats')}</option>
        ${usedCats.map((c) => html`<option value="${c}" ${ui.cat === c ? 'selected' : ''}>${CAT_EMOJI[c]} ${t(`lib.cat.${c}`)}</option>`)}</select>` : ''}
    </div>
    ${!list.length ? html`<section class="card">${emptyState('search', t('common.nothingFound'))}</section>` : html`
    <div class="book-grid">
      ${list.map((b) => {
        const hasPdf = !!b.file_id || store.hasLocalFile(localKey(b));
        return html`
          <article class="card book ${bookStatus(b) === 'done' ? 'is-done' : ''}">
            <button type="button" class="book-cover-btn" ${hasPdf ? raw(`data-read="${b.id}"`) : raw(`data-edit-book="${b.id}"`)} aria-label="${b.title}">${coverHtml(b)}</button>
            <div class="book-body">
              <div class="book-top"><button type="button" class="btn-icon btn-icon-sm" data-edit-book="${b.id}" aria-label="${t('common.edit')}">${icon('edit', 16)}</button></div>
              <h3 class="book-title">${b.title}</h3>
              <p class="muted small book-meta">${b.author ? html`<span>${b.author}</span>` : ''}${fileBadge(b)}</p>
              <div class="book-progress">
                ${progress(pct(b), { tone: bookStatus(b) === 'done' ? 'good' : 'accent' })}
                <span class="small muted">${b.total_pages ? `${num(b.read_pages || 0)} / ${num(b.total_pages)} · ${percent(pct(b))}` : t('lib.noPages')}</span>
              </div>
              <div class="book-actions">
                ${hasPdf ? html`<button type="button" class="btn btn-primary btn-sm" data-read="${b.id}">${icon('book', 16)}${t('lib.open')}</button>`
                  : html`<button type="button" class="btn btn-soft btn-sm" data-edit-book="${b.id}">${icon('upload', 16)}PDF</button>`}
                <button type="button" class="btn btn-ghost btn-sm" data-progress="${b.id}">${icon('edit', 16)}${t('lib.progress')}</button>
                <button type="button" class="btn btn-sm ${b.finished_at ? 'btn-good' : 'btn-ghost'} book-done" data-book-done="${b.id}" aria-pressed="${!!b.finished_at}"
                  data-tip="${b.finished_at ? t('lib.undoDone') : t('lib.markDone')}">${icon('check', 16)}<span>${b.finished_at ? t('lib.status.done') : t('lib.markDone')}</span></button>
              </div>
            </div>
          </article>`;
      })}
    </div>`}`;
}

function paint() {
  if (!root) return;
  const region = $('[data-region]', root);
  const focused = document.activeElement && document.activeElement.matches('[data-search]');
  setHTML(region, view());
  hydrateImages(region);
  if (focused) { const s = $('[data-search]', region); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
}

export default {
  id: 'library',
  deps: ['books', 'files'],
  title: () => t('nav.library'),
  mount(el) {
    root = el;
    setHTML(el, html`
      <header class="page-head"><h1>${t('nav.library')}</h1>
        <div class="page-actions"><button type="button" class="btn btn-primary hide-mobile" data-new-book>${icon('plus', 18)}${t('lib.new')}</button></div></header>
      <div data-region></div>`);
    paint();
    const search = debounce((v) => { ui.q = v; paint(); }, 200);
    el.addEventListener('input', (e) => { if (e.target.matches('[data-search]')) search(e.target.value); });
    el.addEventListener('change', (e) => { if (e.target.matches('[data-cat]')) { ui.cat = e.target.value; paint(); } });
    on(el, 'click', '[data-new-book]', () => openBookSheet());
    on(el, 'click', '[data-edit-book]', (e, b) => { const book = store.get('books', b.dataset.editBook); if (book) openBookSheet(book); });
    on(el, 'click', '[data-progress]', (e, b) => { const book = store.get('books', b.dataset.progress); if (book) openProgressSheet(book); });
    on(el, 'click', '[data-read]', (e, b) => { const book = store.get('books', b.dataset.read); if (book) readBook(book); });
    on(el, 'click', '[data-status]', (e, b) => { ui.status = b.dataset.status; paint(); });
    on(el, 'click', '[data-book-done]', (e, b) => { const book = store.get('books', b.dataset.bookDone); if (book) toggleBookDone(book, b); });
  },
  update() { paint(); },
  unmount() { root = null; },
  fab() { openBookSheet(); },
};

export { readBook, openProgressSheet };
