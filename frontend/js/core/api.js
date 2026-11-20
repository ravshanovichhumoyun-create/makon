// HTTP client for the Makon API (same origin by default).
const BASE = (document.querySelector('meta[name="makon-api"]')?.content || '').replace(/\/$/, '');
const TOKEN_KEY = 'makon.token';

export class ApiError extends Error {
  constructor(code, status = 0, fields = []) {
    super(code);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) { /* private mode */ }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function request(method, path, { body, timeout = 25000, raw = false, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload, signal: ctrl.signal, cache: 'no-store' });
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch (_) { /* not json */ }
    if (res.status === 401 && token && !path.startsWith('/api/auth/login')) onUnauthorized();
    throw new ApiError(data.error || `http_${res.status}`, res.status, data.fields || []);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (p, o) => request('GET', p, o),
  post: (p, body, o = {}) => request('POST', p, { ...o, body }),
  patch: (p, body, o = {}) => request('PATCH', p, { ...o, body }),
  del: (p, o) => request('DELETE', p, o),
};

/** Upload with progress (fetch has no upload progress). */
export function upload(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + path);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || `http_${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('network'));
    xhr.ontimeout = () => reject(new ApiError('timeout'));
    xhr.timeout = 10 * 60 * 1000;
    const fd = new FormData();
    fd.append('file', file, file.name);
    xhr.send(fd);
  });
}

export const apiBase = () => BASE || window.location.origin;
