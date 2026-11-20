// In-app PDF reader built on PDF.js (works the same on iPhone, Android and desktop).
// Pages render lazily as they scroll into view; the last page read is reported on close.
// Full screen uses the Fullscreen API where it exists and an "immersive" layout everywhere
// (iPhone Safari has no element full screen), with the toolbar hiding while you read.
import { $, downloadBlob, html, setHTML } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { openModal } from './ui.js';

let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    const base = new URL('../../vendor/pdfjs/', import.meta.url);
    pdfjsPromise = import(new URL('pdf.min.mjs', base).href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

/**
 * openPdf({ blob, title, startPage, onClose(lastPage, totalPages) })
 */
export async function openPdf({ blob, title, startPage = 1, fileName = 'book.pdf', onClose }) {
  const url = URL.createObjectURL(blob);
  let doc = null;
  let current = Math.max(1, startPage);
  let zoom = 1;
  let observer = null;
  let resizeObs = null;
  let hideTimer = null;
  let lastWidth = 0;
  const rendered = new Map();

  const cleanup = [];
  const m = openModal({
    title,
    className: 'pdf-modal',
    content: html`
      <div class="pdf-bar">
        <div class="pdf-nav">
          <button type="button" class="btn-icon" data-step="-1" aria-label="${t('common.prev')}">${icon('left', 18)}</button>
          <span class="pdf-page" data-page>…</span>
          <button type="button" class="btn-icon" data-step="1" aria-label="${t('common.next')}">${icon('right', 18)}</button>
        </div>
        <div class="pdf-tools">
          <button type="button" class="btn-icon" data-zoom="-1" aria-label="−">${icon('minus', 18)}</button>
          <button type="button" class="btn-icon" data-zoom="1" aria-label="+">${icon('plus', 18)}</button>
          <button type="button" class="btn-icon" data-download aria-label="${t('common.download')}">${icon('download', 18)}</button>
          <button type="button" class="btn-icon pdf-fs-btn" data-fs aria-label="${t('pdf.fullscreen')}" data-tip="${t('pdf.fullscreen')}">${icon('maximize', 18)}</button>
          <button type="button" class="btn-icon pdf-exit-btn" data-fs-exit aria-label="${t('pdf.exitFullscreen')}">${icon('minimize', 18)}</button>
        </div>
      </div>
      <div class="pdf-scroll" data-scroll><div class="pdf-loading">${t('common.loading')}</div></div>`,
    onClose: () => {
      cleanup.forEach((fn) => fn());
      if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
      if (observer) observer.disconnect();
      if (resizeObs) resizeObs.disconnect();
      clearTimeout(hideTimer);
      if (doc) doc.destroy();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (onClose && doc) onClose(current, doc.numPages);
    },
  });
  const modalEl = m.el.querySelector('.modal');
  const scroller = $('[data-scroll]', m.body);
  const pageLabel = $('[data-page]', m.body);

  // ---------------------------------------------------------------- full screen

  const immersive = () => modalEl.classList.contains('pdf-immersive');
  const showBar = () => {
    modalEl.classList.remove('bar-hidden');
    clearTimeout(hideTimer);
    if (immersive()) hideTimer = setTimeout(() => modalEl.classList.add('bar-hidden'), 2600);
  };
  const enterFs = async () => {
    modalEl.classList.add('pdf-immersive');
    try {
      if (modalEl.requestFullscreen) await modalEl.requestFullscreen({ navigationUI: 'hide' });
      else if (modalEl.webkitRequestFullscreen) modalEl.webkitRequestFullscreen();
    } catch (_) { /* immersive layout still works */ }
    showBar();
  };
  const exitFs = () => {
    modalEl.classList.remove('pdf-immersive', 'bar-hidden');
    clearTimeout(hideTimer);
    if (fsElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { const r = exit && exit.call(document); if (r && r.catch) r.catch(() => {}); } catch (_) { /* ignore */ }
    }
  };
  const onFsChange = () => { if (!fsElement() && immersive()) exitFs(); };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  cleanup.push(() => {
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
  });

  const goTo = (n) => {
    if (!doc) return;
    const target = scroller.querySelector(`[data-n="${Math.max(1, Math.min(doc.numPages, n))}"]`);
    if (target) target.scrollIntoView({ block: 'start' });
  };
  // Esc leaves full screen first; arrows / PageUp / PageDown turn pages
  const onKey = (e) => {
    if (e.key === 'Escape' && immersive()) { e.stopImmediatePropagation(); e.preventDefault(); exitFs(); return; }
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goTo(current + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goTo(current - 1); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); if (immersive()) exitFs(); else enterFs(); }
  };
  window.addEventListener('keydown', onKey, true);
  cleanup.push(() => window.removeEventListener('keydown', onKey, true));

  m.body.addEventListener('click', (e) => {
    if (e.target.closest('[data-download]')) { downloadBlob(blob, fileName); return; }
    if (e.target.closest('[data-fs]')) { enterFs(); return; }
    if (e.target.closest('[data-fs-exit]')) { exitFs(); return; }
    const step = e.target.closest('[data-step]');
    if (step) { goTo(current + Number(step.dataset.step)); showBar(); return; }
    if (immersive() && e.target.closest('[data-scroll]')) {
      if (modalEl.classList.contains('bar-hidden')) showBar(); else modalEl.classList.add('bar-hidden');
    }
  });
  scroller.addEventListener('scroll', () => { if (immersive() && !modalEl.classList.contains('bar-hidden')) showBar(); }, { passive: true });

  // ---------------------------------------------------------------- document

  try {
    const pdfjs = await loadPdfjs();
    doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (err) {
    console.error(err);
    setHTML(scroller, html`<div class="pdf-loading">${t('pdf.error')}</div>`);
    return m;
  }
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const ratio = base.height / base.width;

  const layout = () => {
    const avail = scroller.clientWidth - 16;
    const width = (immersive() ? Math.min(avail, 1100) : Math.min(avail, 900)) * zoom;
    scroller.style.setProperty('--pw', `${Math.round(width)}px`);
    scroller.style.setProperty('--ph', `${Math.round(width * ratio)}px`);
    return width;
  };

  setHTML(scroller, html`${Array.from({ length: doc.numPages }, (_, i) => html`<div class="pdf-pg" data-n="${i + 1}"></div>`)}`);
  layout();
  lastWidth = scroller.clientWidth;

  const renderPage = async (n) => {
    const holder = scroller.querySelector(`[data-n="${n}"]`);
    const key = `${zoom}:${lastWidth}`;
    if (!holder || rendered.get(n) === key) return;
    rendered.set(n, key);
    const page = await doc.getPage(n);
    const width = layout();
    const vp1 = page.getViewport({ scale: 1 });
    const scale = width / vp1.width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
    canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
    holder.style.height = canvas.style.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    holder.replaceChildren(canvas);
  };

  const relayout = () => {
    const keep = current;
    scroller.querySelectorAll('.pdf-pg').forEach((el) => { el.style.height = ''; });
    layout();
    rendered.clear();
    const el = scroller.querySelector(`[data-n="${keep}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
    renderPage(keep);
    renderPage(keep + 1);
  };

  observer = new IntersectionObserver((entries) => {
    let best = null;
    entries.forEach((en) => {
      if (en.isIntersecting) {
        const n = Number(en.target.dataset.n);
        renderPage(n);
        renderPage(n + 1);
        if (!best || en.intersectionRatio > best.ratio) best = { n, ratio: en.intersectionRatio };
      }
    });
    if (best) { current = best.n; pageLabel.textContent = `${current} / ${doc.numPages}`; }
  }, { root: scroller, threshold: [0.01, 0.5] });
  scroller.querySelectorAll('.pdf-pg').forEach((el) => observer.observe(el));
  pageLabel.textContent = `${current} / ${doc.numPages}`;
  const target = scroller.querySelector(`[data-n="${Math.min(current, doc.numPages)}"]`);
  if (target && current > 1) target.scrollIntoView({ block: 'start' });

  // re-render sharp pages when the reader changes size (full screen, rotation, window resize)
  if (window.ResizeObserver) {
    let pending = null;
    resizeObs = new ResizeObserver(() => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        const w = scroller.clientWidth;
        if (Math.abs(w - lastWidth) < 24) return;
        lastWidth = w;
        relayout();
      }, 160);
    });
    resizeObs.observe(scroller);
  }

  m.body.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (!z) return;
    zoom = Math.max(0.6, Math.min(2.5, zoom + Number(z.dataset.zoom) * 0.2));
    relayout();
  });
  return m;
}
