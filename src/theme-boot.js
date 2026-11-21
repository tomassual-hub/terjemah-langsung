/* Runs before first paint: applies the saved theme so the page never flashes the wrong colours, and marks iPhone/iPad and the
   Home Screen app. Keep in sync with applyTheme() in src/js/main.js (values are JSON under the "tl." prefix, src/js/core/store.js). */
(function () {
  try {
    var root = document.documentElement;
    var pref = null;
    try { pref = JSON.parse(localStorage.getItem('tl.theme')); } catch (e) {}
    var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0f1115' : '#f4f5f8');
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) root.setAttribute('data-platform', 'ios');
    if (navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) root.setAttribute('data-standalone', '');
  } catch (e) { /* storage blocked: the light theme */ }
})();
