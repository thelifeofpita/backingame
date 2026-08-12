/* ============================================================================
   BACK IN SMOOTHLY — boot
   #studio opens the export tool; anything else is the playable itself.
   ========================================================================== */
(function (NS) {
  'use strict';
  function start() {
    const studio = location.hash.replace('#', '').split('?')[0] === 'studio';
    if (studio && NS.startStudio) { NS.startStudio(); return; }
    const root = document.getElementById('app');
    if (!root) return;
    const g = new NS.Game(root);
    NS.game = g;
    g.boot().catch((err) => {
      console.error('[bis] boot failed', err);
      const b = document.getElementById('boot');
      if (b) b.innerHTML = '<p class="osd-note">No signal. Reload to retry.</p>';
    });
  }
  addEventListener('hashchange', () => location.reload());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.PM = window.PM || {});
