// ── ACCESSIBILITY / DISPLAY SETTINGS PANEL ───────────────────────────────
// Shared between index and admin pages.
// Saves all preferences to localStorage under 'vaad_a11y'.

(function () {
  const STORE_KEY = 'vaad_a11y';
  const BASE_FONT = 18; // px — matches :root html font-size
  const MIN_FONT  = 14;
  const MAX_FONT  = 26;

  // Load saved prefs
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch { return {}; }
  }
  function savePrefs(prefs) {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  }

  // Apply prefs to DOM
  function applyPrefs(prefs) {
    const size = prefs.fontSize || BASE_FONT;
    document.documentElement.style.fontSize = size + 'px';
    document.body.classList.toggle('a11y-spacing',       !!prefs.spacing);
    document.body.classList.toggle('a11y-wide-letters',  !!prefs.wideLetters);
    document.body.classList.toggle('a11y-high-contrast', !!prefs.highContrast);
  }

  // Build panel HTML and inject into body
  function buildPanel() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <button class="a11y-btn" id="a11y-toggle-btn" title="הגדרות תצוגה">♿</button>
      <div class="a11y-panel" id="a11y-panel">
        <div class="a11y-header">
          ♿ הגדרות תצוגה
          <button class="a11y-close" id="a11y-close">✕</button>
        </div>

        <div class="a11y-section">
          <div class="a11y-label">גודל טקסט</div>
          <div class="a11y-font-row">
            <button class="f-btn" id="a11y-font-down">A−</button>
            <span class="f-size-display" id="a11y-font-display">18px</span>
            <button class="f-btn" id="a11y-font-up">A+</button>
          </div>
          <div class="a11y-presets">
            <button class="a11y-preset" data-size="14">קטן</button>
            <button class="a11y-preset" data-size="16">בינוני</button>
            <button class="a11y-preset" data-size="18">רגיל</button>
            <button class="a11y-preset" data-size="21">גדול</button>
            <button class="a11y-preset" data-size="24">XL</button>
          </div>
        </div>

        <div class="a11y-section">
          <div class="a11y-label">תצוגה</div>
          <div class="a11y-toggle-row">
            <span class="a11y-toggle-lbl">ריווח שורות מורחב</span>
            <label class="ios-toggle" style="width:44px;height:26px;flex-shrink:0;">
              <input type="checkbox" id="a11y-spacing">
              <span class="slider"></span>
            </label>
          </div>
          <div class="a11y-toggle-row">
            <span class="a11y-toggle-lbl">ריווח אותיות</span>
            <label class="ios-toggle" style="width:44px;height:26px;flex-shrink:0;">
              <input type="checkbox" id="a11y-wide-letters">
              <span class="slider"></span>
            </label>
          </div>
          <div class="a11y-toggle-row">
            <span class="a11y-toggle-lbl">ניגודיות גבוהה</span>
            <label class="ios-toggle" style="width:44px;height:26px;flex-shrink:0;">
              <input type="checkbox" id="a11y-high-contrast">
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="a11y-section">
          <button class="a11y-reset" id="a11y-reset">↺ איפוס לברירת מחדל</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
  }

  // Wire up events
  function wireEvents() {
    const panel   = document.getElementById('a11y-panel');
    const togBtn  = document.getElementById('a11y-toggle-btn');
    const closeBtn= document.getElementById('a11y-close');
    const fontUp  = document.getElementById('a11y-font-up');
    const fontDown= document.getElementById('a11y-font-down');
    const fontDisp= document.getElementById('a11y-font-display');
    const chkSpace= document.getElementById('a11y-spacing');
    const chkWide = document.getElementById('a11y-wide-letters');
    const chkHC   = document.getElementById('a11y-high-contrast');
    const resetBtn= document.getElementById('a11y-reset');

    let prefs = loadPrefs();

    // init UI from prefs
    function syncUI() {
      const size = prefs.fontSize || BASE_FONT;
      fontDisp.textContent = size + 'px';
      chkSpace.checked = !!prefs.spacing;
      chkWide.checked  = !!prefs.wideLetters;
      chkHC.checked    = !!prefs.highContrast;
      // active preset
      document.querySelectorAll('.a11y-preset').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.size) === size);
      });
    }

    function update() {
      applyPrefs(prefs);
      savePrefs(prefs);
      syncUI();
    }

    togBtn.addEventListener('click', () => panel.classList.toggle('open'));
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));

    // Close on outside click
    document.addEventListener('click', e => {
      if (!panel.contains(e.target) && e.target !== togBtn)
        panel.classList.remove('open');
    });

    fontUp.addEventListener('click', () => {
      prefs.fontSize = Math.min((prefs.fontSize || BASE_FONT) + 1, MAX_FONT);
      update();
    });
    fontDown.addEventListener('click', () => {
      prefs.fontSize = Math.max((prefs.fontSize || BASE_FONT) - 1, MIN_FONT);
      update();
    });

    document.querySelectorAll('.a11y-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        prefs.fontSize = parseInt(btn.dataset.size);
        update();
      });
    });

    chkSpace.addEventListener('change', () => { prefs.spacing      = chkSpace.checked; update(); });
    chkWide.addEventListener('change',  () => { prefs.wideLetters  = chkWide.checked;  update(); });
    chkHC.addEventListener('change',    () => { prefs.highContrast = chkHC.checked;    update(); });

    resetBtn.addEventListener('click', () => {
      prefs = {};
      update();
    });

    syncUI();
  }

  // Init on DOM ready
  function init() {
    const prefs = loadPrefs();
    applyPrefs(prefs); // apply before paint
    buildPanel();
    wireEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
