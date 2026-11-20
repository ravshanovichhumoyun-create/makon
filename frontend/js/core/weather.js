// Weather for the home screen: fetched through our server (Open-Meteo), cached for 15 minutes,
// last answer kept so the widget still shows something offline.
import { api } from './api.js';
import { appctl } from './appctl.js';
import { $, debounce, html, on, setHTML } from './dom.js';
import { getLang, t } from './i18n.js';
import { icon } from './icons.js';
import * as store from './store.js';
import { errorText, openModal, toast } from './ui.js';

const CACHE_KEY = 'makon.weather';
const FRESH_MS = 15 * 60 * 1000;
export const DEFAULT_PLACE = { city: 'Toshkent', lat: 41.2995, lon: 69.2401 };

/** WMO weather code → emoji + text key */
export function describe(code, isDay = true) {
  const c = Number(code);
  if (c === 0) return { emoji: isDay ? '☀️' : '🌙', key: 'w.clear', tone: isDay ? 'sun' : 'night' };
  if (c === 1) return { emoji: isDay ? '🌤️' : '🌙', key: 'w.mostlyClear', tone: isDay ? 'sun' : 'night' };
  if (c === 2) return { emoji: isDay ? '⛅' : '☁️', key: 'w.partly', tone: 'cloud' };
  if (c === 3) return { emoji: '☁️', key: 'w.cloudy', tone: 'cloud' };
  if (c === 45 || c === 48) return { emoji: '🌫️', key: 'w.fog', tone: 'cloud' };
  if (c >= 51 && c <= 57) return { emoji: '🌦️', key: 'w.drizzle', tone: 'rain' };
  if (c === 66 || c === 67) return { emoji: '🌧️', key: 'w.freezing', tone: 'rain' };
  if (c >= 61 && c <= 65) return { emoji: '🌧️', key: 'w.rain', tone: 'rain' };
  if (c >= 71 && c <= 77) return { emoji: '❄️', key: 'w.snow', tone: 'snow' };
  if (c >= 80 && c <= 82) return { emoji: '🌧️', key: 'w.showers', tone: 'rain' };
  if (c === 85 || c === 86) return { emoji: '🌨️', key: 'w.snowShowers', tone: 'snow' };
  if (c >= 95) return { emoji: '⛈️', key: 'w.thunder', tone: 'rain' };
  return { emoji: '🌡️', key: 'w.title', tone: 'cloud' };
}

const DEFAULT_CITY = { uz: 'Toshkent', ru: 'Ташкент', en: 'Tashkent' };

export function place() {
  const u = store.getUser() || {};
  if (typeof u.lat === 'number' && typeof u.lon === 'number') return { city: u.city || t('w.myPlace'), lat: u.lat, lon: u.lon };
  return { ...DEFAULT_PLACE, city: DEFAULT_CITY[getLang()] || DEFAULT_PLACE.city };
}

const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; } };
const placeKey = (p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

/** Cached answer for the current place (may be stale), or null. */
export function cachedWeather() {
  const c = readCache();
  const p = place();
  return c && c.key === placeKey(p) ? { ...c.data, stale: Date.now() - c.at > FRESH_MS } : null;
}

let inflight = null;

// Direct Open-Meteo calls are the fallback when our server is rate limited
// (free hosts share outgoing IP addresses). Same fields as /api/weather.
const OM_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OM_GEO = 'https://geocoding-api.open-meteo.com/v1/search';

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function forecastDirect(lat, lon) {
  const tz = (store.getUser() || {}).tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto';
  const q = new URLSearchParams({
    latitude: lat.toFixed(2), longitude: lon.toFixed(2), timezone: tz, forecast_days: '1',
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m',
    daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset',
  });
  const d = await getJson(`${OM_FORECAST}?${q}`);
  const cur = d.current || {};
  const first = (k) => ((d.daily || {})[k] || [])[0] ?? null;
  if (cur.temperature_2m === undefined) throw new Error('no data');
  return {
    temp: cur.temperature_2m, feels: cur.apparent_temperature, code: cur.weather_code, is_day: !!cur.is_day,
    wind: cur.wind_speed_10m, humidity: cur.relative_humidity_2m, max: first('temperature_2m_max'), min: first('temperature_2m_min'),
    sunrise: String(first('sunrise') || '').slice(-5) || null, sunset: String(first('sunset') || '').slice(-5) || null, time: cur.time,
  };
}

async function searchCityDirect(q) {
  const d = await getJson(`${OM_GEO}?${new URLSearchParams({ name: q, count: '8', language: getLang(), format: 'json' })}`);
  return (d.results || []).filter((r) => r.latitude != null && r.longitude != null).map((r) => ({
    name: String(r.name || '').slice(0, 80), region: String(r.admin1 || '').slice(0, 80), country: String(r.country || '').slice(0, 80),
    lat: Math.round(r.latitude * 1e4) / 1e4, lon: Math.round(r.longitude * 1e4) / 1e4,
  }));
}

/** Fresh weather if the cache is old; resolves to the data or null (never throws). */
export function loadWeather({ force = false } = {}) {
  if (appctl.config.weather && appctl.config.weather.enabled === false) return Promise.resolve(null);
  const p = place();
  const c = readCache();
  if (!force && c && c.key === placeKey(p) && Date.now() - c.at < FRESH_MS) return Promise.resolve(c.data);
  if (!navigator.onLine) return Promise.resolve(c && c.key === placeKey(p) ? c.data : null);
  if (inflight) return inflight;
  inflight = api.get(`/api/weather?lat=${p.lat}&lon=${p.lon}`, { timeout: 20000 })
    .catch(() => forecastDirect(p.lat, p.lon))
    .then((data) => {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key: placeKey(p), at: Date.now(), data })); } catch (_) { /* ignore */ }
      return data;
    })
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}

export const clearWeatherCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* ignore */ } };

// ------------------------------------------------------------------ city picker

async function savePlace(city, lat, lon) {
  const me = await api.patch('/api/auth/me', { city, lat, lon });
  store.setUser(me);
  clearWeatherCache();
  loadWeather({ force: true }).then(() => store.emit('weather'));
}

export function openCityPicker() {
  const m = openModal({
    title: t('w.pick'),
    className: 'modal-small',
    content: html`
      <div class="form">
        <div class="search"><span>${icon('search', 18)}</span><input class="input" type="search" data-city-q placeholder="${t('w.search')}" aria-label="${t('w.search')}" maxlength="80" autocomplete="off"></div>
        <button type="button" class="btn btn-soft" data-geo>${icon('mapPin', 18)}${t('w.myLocation')}</button>
        <ul class="city-list" data-results></ul>
        <p class="form-error" hidden></p>
      </div>`,
  });
  const box = $('[data-results]', m.body);
  const err = $('.form-error', m.body);
  const fail = (msg) => { err.textContent = msg; err.hidden = !msg; };
  let results = [];
  const search = debounce(async (q) => {
    if (q.trim().length < 2) { setHTML(box, ''); return; }
    try {
      const res = await api.get(`/api/geo?q=${encodeURIComponent(q.trim())}&lang=${getLang()}`)
        .catch(async () => ({ results: await searchCityDirect(q.trim()) }));
      results = res.results || [];
      fail('');
      setHTML(box, results.length
        ? html`${results.map((r, i) => html`<li><button type="button" class="city-item" data-pick="${i}">${icon('mapPin', 16)}<span><b>${r.name}</b><small class="muted">${[r.region, r.country].filter(Boolean).join(', ')}</small></span></button></li>`)}`
        : html`<li class="muted small pad">${t('common.nothingFound')}</li>`);
    } catch (e) { fail(errorText(e)); }
  }, 350);
  $('[data-city-q]', m.body).addEventListener('input', (e) => search(e.target.value));
  on(m.body, 'click', '[data-pick]', async (e, b) => {
    const r = results[Number(b.dataset.pick)];
    if (!r) return;
    try { await savePlace(r.name, r.lat, r.lon); m.close(); toast(t('common.saved'), { tone: 'success' }); } catch (ex) { fail(errorText(ex)); }
  });
  on(m.body, 'click', '[data-geo]', (e, b) => {
    if (!navigator.geolocation) { fail(t('w.locDenied')); return; }
    b.disabled = true;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await savePlace(t('w.myPlace'), Number(pos.coords.latitude.toFixed(4)), Number(pos.coords.longitude.toFixed(4)));
        m.close();
        toast(t('common.saved'), { tone: 'success' });
      } catch (ex) { fail(errorText(ex)); b.disabled = false; }
    }, () => { fail(t('w.locDenied')); b.disabled = false; }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  });
}
