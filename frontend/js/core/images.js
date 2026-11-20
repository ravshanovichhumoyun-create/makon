// Pictures: profile photo, home background and book covers.
// A picture is resized on the device, kept in IndexedDB at once (works offline) and uploaded
// to the server under an id chosen here; other devices download it once and cache it.
import { ApiError, apiBase, getToken, request } from './api.js';
import { uuid } from './dom.js';
import { fileDel, fileGet, fileSet } from './idb.js';

const QUEUE_KEY = 'makon.imgq';
const urls = new Map(); // id → object URL (kept for the page's lifetime)
const loading = new Map(); // id → Promise<string|null>
const key = (id) => `img:${id}`;

export const SIZES = {
  avatar: { w: 320, h: 320, crop: true, quality: 0.86 },
  cover: { w: 420, h: 630, crop: true, quality: 0.84 },
  background: { w: 1920, h: 1280, crop: false, quality: 0.82 },
};

// ------------------------------------------------------------------ resize

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Resize (and for avatars/covers centre-crop) to a JPEG blob. Throws ApiError('image_read'). */
export async function resizeImage(file, kind) {
  const spec = SIZES[kind];
  if (!file || !/^image\//.test(file.type || '') || /svg/i.test(file.type)) throw new ApiError('not_image');
  let src;
  try { src = await decode(file); } catch (_) { throw new ApiError('image_read'); }
  return drawToJpeg(src, src.width, src.height, spec);
}

function drawToJpeg(src, sw, sh, spec) {
  let dw;
  let dh;
  let sx = 0;
  let sy = 0;
  let cw = sw;
  let ch = sh;
  if (spec.crop) {
    const ratio = spec.w / spec.h;
    if (sw / sh > ratio) { cw = sh * ratio; sx = (sw - cw) / 2; } else { ch = sw / ratio; sy = (sh - ch) / 2; }
    const scale = Math.min(1, spec.w / cw);
    dw = Math.round(cw * scale);
    dh = Math.round(ch * scale);
  } else {
    const scale = Math.min(1, spec.w / sw, spec.h / sh);
    dw = Math.round(sw * scale);
    dh = Math.round(sh * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, dw);
  canvas.height = Math.max(1, dh);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white page instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ApiError('image_read'))), 'image/jpeg', spec.quality);
  });
}

/** First page of a PDF as a book cover (PDF.js is loaded only when needed). */
export async function coverFromPdf(pdfBlob) {
  const base = new URL('../../vendor/pdfjs/', import.meta.url);
  const lib = await import(new URL('pdf.min.mjs', base).href);
  lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
  const doc = await lib.getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, (SIZES.cover.w * 1.5) / vp1.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return await drawToJpeg(canvas, canvas.width, canvas.height, SIZES.cover);
  } finally {
    doc.destroy();
  }
}

// ------------------------------------------------------------------ upload queue

const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || []; } catch (_) { return []; } };
const writeQueue = (q) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (_) { /* ignore */ } };

async function put(id, kind, blob) {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', blob, `${id}.jpg`);
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${apiBase()}/api/images/${encodeURIComponent(id)}`, { method: 'PUT', body: fd, headers, cache: 'no-store' });
  } catch (_) {
    throw new ApiError('network');
  }
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch (_) { /* not json */ }
    throw new ApiError(data.error || `http_${res.status}`, res.status);
  }
}

/**
 * Save a picture locally and upload it. { wait: true } (avatar, background) waits for the server
 * and throws on failure; covers are queued and retried, so they work offline.
 */
export async function saveImage(blob, kind, { wait = false } = {}) {
  const id = uuid();
  await fileSet(key(id), blob).catch(() => {});
  remember(id, blob);
  if (wait) {
    await put(id, kind, blob);
    return id;
  }
  writeQueue([...readQueue(), { id, kind }]);
  flushImages();
  return id;
}

let flushing = false;
export async function flushImages() {
  if (flushing || !navigator.onLine || !getToken()) return;
  flushing = true;
  try {
    for (const item of readQueue()) {
      const blob = await fileGet(key(item.id));
      let drop = !blob;
      if (blob) {
        try {
          await put(item.id, item.kind, blob);
          drop = true;
        } catch (err) {
          // network / server trouble / signed out: keep for later; refused for good (bad file, quota): drop
          const temporary = err.code === 'network' || err.code === 'timeout' || err.status === 401
            || (err.status >= 500 && err.status !== 507);
          if (temporary) break;
          drop = true;
        }
      }
      if (drop) writeQueue(readQueue().filter((x) => x.id !== item.id));
    }
  } finally {
    flushing = false;
  }
}

export function forgetImage(id) {
  if (!id) return;
  writeQueue(readQueue().filter((x) => x.id !== id));
  fileDel(key(id));
  const url = urls.get(id);
  if (url) { URL.revokeObjectURL(url); urls.delete(id); }
}

/** The server deletes pictures that a record or the profile stops pointing at; this one is explicit. */
export function deleteImage(id) {
  if (!id) return;
  forgetImage(id);
  request('DELETE', `/api/images/${encodeURIComponent(id)}`).catch(() => {});
}

// ------------------------------------------------------------------ display

function remember(id, blob) {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
  return urls.get(id);
}

/** Object URL for a picture id: memory → IndexedDB → server. null when unavailable. */
export function imageUrl(id) {
  if (!id) return Promise.resolve(null);
  if (urls.has(id)) return Promise.resolve(urls.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    const local = await fileGet(key(id));
    if (local) return remember(id, local);
    try {
      const res = await request('GET', `/api/images/${encodeURIComponent(id)}`, { raw: true, timeout: 60000 });
      const blob = await res.blob();
      if (!/^image\/(jpeg|png|webp)$/.test(blob.type)) return null;
      fileSet(key(id), blob).catch(() => {});
      return remember(id, blob);
    } catch (_) {
      return null;
    }
  })();
  loading.set(id, p);
  p.finally(() => loading.delete(id));
  return p;
}

export const cachedUrl = (id) => (id ? urls.get(id) || null : null);

/**
 * Fill <img data-img="id"> and [data-bg-img="id"] elements inside root.
 * Already-known pictures are set synchronously by the templates (cachedUrl), so this only
 * handles the ones that have to be loaded first.
 */
export function hydrateImages(root) {
  if (!root) return;
  root.querySelectorAll('img[data-img]').forEach((img) => {
    const id = img.dataset.img;
    if (img.getAttribute('src')) return;
    imageUrl(id).then((url) => {
      if (url && img.isConnected && img.dataset.img === id) { img.src = url; img.closest('[data-has-img]')?.classList.add('img-ready'); }
    });
  });
  root.querySelectorAll('[data-bg-img]').forEach((el) => {
    const id = el.dataset.bgImg;
    imageUrl(id).then((url) => {
      if (url && el.isConnected && el.dataset.bgImg === id) {
        el.style.backgroundImage = `url("${url}")`;
        el.classList.add('img-ready');
      }
    });
  });
}
