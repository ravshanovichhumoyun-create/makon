// Runs before first paint so dark mode never flashes light.
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem('makon.prefs') || '{}') || {};
    var pref = prefs.theme || 'auto';
    var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', pref);
    document.documentElement.setAttribute('data-resolved-theme', dark ? 'dark' : 'light');
    if (prefs.lang) document.documentElement.lang = prefs.lang;
  } catch (e) { /* storage blocked: defaults apply */ }
})();
