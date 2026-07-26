import { RoomSection } from './scroll-video.js';

const DEFAULTS = {
  // Scroll drives the camera. For a walk through a building this beats the
  // oxman play-on-enter model: scrolling *is* the locomotion.
  mode: 'scrub',
  source: 'walkthrough',

  // 100/100 = full-bleed, aperture off. Dial below 100 to open a window.
  apertureFromW: 100,
  apertureFromH: 100,
  apertureSpan: 0.55,
  apertureRadius: 4,
  apertureEasing: 'easeOut',

  vhPerSecond: 1.2,
  damping: 0.88,

  textReveal: 'words',
  wordStagger: 0.5,
  overlayFade: 0.10,
  overlayDrift: 28,

  tint: 0.30,
  vignette: 0.40,

  loop: true,
  restartOnEnter: false,
  pauseOnExit: true,
  showHud: true,
  showBar: true,
};

const STORAGE_KEY = 'albaydar.scrollvideo.cfg';
const cfg = { ...DEFAULTS, ...loadSaved() };

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));

const $ = (id) => document.getElementById(id);
const root = $('rs-1');
const section = new RoomSection(root, cfg);

window.__sv = section;
window.__cfg = cfg;

// ---------------------------------------------------------------- sliders

const SLIDERS = [
  'apertureFromW', 'apertureFromH', 'apertureSpan', 'apertureRadius',
  'vhPerSecond', 'damping', 'wordStagger', 'overlayFade', 'overlayDrift',
  'tint', 'vignette',
];
const pct = (v) => `${Math.round(v * 100)}%`;
const FMT = {
  apertureFromW: (v) => `${Math.round(v)}vw`,
  apertureFromH: (v) => `${Math.round(v)}vh`,
  apertureSpan: pct,
  apertureRadius: (v) => `${Math.round(v)}px`,
  vhPerSecond: (v) => `${(+v).toFixed(2)} vh/s`,
  damping: (v) => (+v === 0 ? 'off' : (+v).toFixed(3)),
  wordStagger: pct,
  overlayFade: pct,
  overlayDrift: (v) => `${Math.round(v)}px`,
  tint: pct,
  vignette: pct,
};

for (const key of SLIDERS) {
  const el = $(key);
  el.value = cfg[key];
  $(`${key}_v`).textContent = FMT[key](cfg[key]);
  el.addEventListener('input', () => {
    cfg[key] = parseFloat(el.value);
    $(`${key}_v`).textContent = FMT[key](cfg[key]);
    applyVisual();
    section.setConfig({ [key]: cfg[key] });
    save();
  });
}

// ---------------------------------------------------------------- segments

for (const seg of document.querySelectorAll('[data-seg]')) {
  const key = seg.dataset.seg;
  for (const btn of seg.children) {
    btn.classList.toggle('is-on', btn.dataset.val === cfg[key]);
    btn.addEventListener('click', async () => {
      cfg[key] = btn.dataset.val;
      for (const b of seg.children) b.classList.toggle('is-on', b === btn);
      applyVisual();
      // a mode change swaps the encode, so this can be async
      await section.setConfig({ [key]: cfg[key] });
      save();
      if (key === 'mode') $('modeHint').innerHTML = MODE_HINTS[cfg.mode];
      if (key === 'source') await onSourceChange();
    });
  }
}

// ---------------------------------------------------------------- checkboxes

const CHECKS = ['loop', 'restartOnEnter', 'pauseOnExit', 'showHud', 'showBar'];
for (const key of CHECKS) {
  const el = $(key);
  el.checked = cfg[key];
  el.addEventListener('change', () => {
    cfg[key] = el.checked;
    applyVisual();
    section.setConfig({ [key]: cfg[key] });
    save();
  });
}

function applyVisual() {
  const s = document.documentElement.style;
  s.setProperty('--tint', cfg.tint);
  s.setProperty('--vignette', cfg.vignette);
  $('hud').hidden = !cfg.showHud;
  root.querySelector('.rs__progress').hidden = !cfg.showBar;
}

// ---------------------------------------------------------------- hints

const MODE_HINTS = {
  scrub:
    'Scroll drives the camera — stop and it stops, scroll back and you walk ' +
    'back. Loads the dense-keyframe encode (20 MB).',
  play:
    'The oxman model: the clip plays on its own clock and scroll only drives ' +
    'the aperture and copy. Loads the lighter encode (11 MB).',
};

const SOURCE_HINTS = {
  walkthrough:
    'Built from the 12 stills — 1600&times;900, sharp, no warping. Motion is ' +
    'push + dissolve rather than true parallax.',
  demo:
    'The original AI clip — 864&times;496. Continuous camera motion, but soft ' +
    'and the stonework warps.',
};

async function onSourceChange() {
  $('sourceHint').innerHTML = SOURCE_HINTS[cfg.source];
  await section.setSource(cfg.source);
}

// ---------------------------------------------------------------- panel

$('panelToggle').addEventListener('click', hidePanel);
$('panelOpen').addEventListener('click', showPanel);
function hidePanel() { $('panel').hidden = true; $('panelOpen').hidden = false; }
function showPanel() { $('panel').hidden = false; $('panelOpen').hidden = true; }

addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') ($('panel').hidden ? showPanel() : hidePanel());
});

$('copyCfg').addEventListener('click', async () => {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = cfg[k];
  const json = JSON.stringify(out, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    $('copyMsg').textContent = 'Copied. Paste it back to me and we lock it in.';
  } catch { $('copyMsg').textContent = json; }
  setTimeout(() => ($('copyMsg').textContent = ''), 6000);
});

$('resetCfg').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

// ---------------------------------------------------------------- hud

const bar = root.querySelector('[data-progressbar]');
const video = root.querySelector('video');
function hudLoop() {
  requestAnimationFrame(hudLoop);
  const p = section.progress ?? 0;
  if (cfg.showBar) bar.style.width = `${(p * 100).toFixed(2)}%`;
  if (cfg.showHud) {
    $('hud_fps').textContent = section.stats.fps;
    $('hud_p').textContent = p.toFixed(3);
    $('hud_t').textContent = `${video.currentTime.toFixed(2)}s`;
    $('hud_state').textContent =
      cfg.mode === 'scrub' ? 'scrubbed' : (video.paused ? 'paused' : 'playing');
    $('hud_ap').textContent = section.aperture.style.width || '—';
  }
}

// ---------------------------------------------------------------- go

applyVisual();
$('modeHint').innerHTML = MODE_HINTS[cfg.mode];
$('sourceHint').innerHTML = SOURCE_HINTS[cfg.source];
// setSource first — it picks the encode matching the current mode, so init()
// finds the video already loaded and resolves straight through.
await section.setSource(cfg.source);
await section.init();
hudLoop();
