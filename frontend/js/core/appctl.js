// Hooks the app shell registers so pages can trigger app-level actions without import cycles.
export const appctl = {
  rerender: () => {},
  logout: async () => {},
  applyTheme: () => {},
  config: { files: { enabled: false, max_mb: 50 }, telegram: { enabled: false, bot: null }, version: '' },
  installPrompt: null,
};

const PREFS_KEY = 'makon.prefs';

export function getPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { return {}; }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch (_) { /* ignore */ }
  return next;
}
