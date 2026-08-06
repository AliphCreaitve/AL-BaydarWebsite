import { RoomTour } from './room-tour.js';

/**
 * Order matters — this is the path through the building.
 *
 * Room 1 is the AI clip, not the photo-built walkthrough. Both clips here come
 * from the same generation lineage, so they match each other far better than
 * the sharp 1600x900 photo build would: dissolving a crisp render into a
 * 640x480 re-compress draws attention straight to the seam.
 */
const ROOMS = [
  { id: 'demo', label: 'entrance → hall → kitchen' },
  { id: 'room-03', label: 'kitchen → corridor → classroom' },
];

const DEFAULTS = {
  transition: 'fade',
  transitionSpan: 0.07,

  mode: 'scrub',
  vhPerSecond: 1.2,
  damping: 0.88,

  apertureFromW: 100,
  apertureFromH: 100,
  apertureSpan: 0.4,
  apertureRadius: 4,
  apertureEasing: 'easeOut',

  textReveal: 'words',
  wordStagger: 0.5,
  overlayFade: 0.14,
  overlayDrift: 28,

  tint: 0.30,
  vignette: 0.40,

  restartOnEnter: false,
  pauseOnExit: true,
  showHud: true,
  showBar: true,
};

const STORAGE_KEY = 'albaydar.tour.cfg';
const cfg = { ...DEFAULTS, ...loadSaved() };

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));

const $ = (id) => document.getElementById(id);
const root = $('tour');
const tour = new RoomTour(root, ROOMS, cfg);

window.__tour = tour;
window.__cfg = cfg;

// ---------------------------------------------------------------- sliders

const SLIDERS = [
  'transitionSpan', 'vhPerSecond', 'damping',
  'apertureFromW', 'apertureFromH', 'apertureSpan', 'apertureRadius',
  'wordStagger', 'overlayFade', 'overlayDrift', 'tint', 'vignette',
];
const pct = (v) => `${Math.round(v * 100)}%`;
const FMT = {
  transitionSpan: (v) => (+v === 0 ? 'instant' : `${(v * 100).toFixed(1)}% of tour`),
  vhPerSecond: (v) => `${(+v).toFixed(2)} vh/s`,
  damping: (v) => (+v === 0 ? 'off' : (+v).toFixed(3)),
  apertureFromW: (v) => `${Math.round(v)}vw`,
  apertureFromH: (v) => `${Math.round(v)}vh`,
  apertureSpan: pct,
  apertureRadius: (v) => `${Math.round(v)}px`,
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
    tour.setConfig({ [key]: cfg[key] });
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
      await tour.setConfig({ [key]: cfg[key] });
      save();
      if (key === 'transition') $('transitionHint').innerHTML = TRANSITION_HINTS[cfg.transition];
      if (key === 'mode') $('modeHint').innerHTML = MODE_HINTS[cfg.mode];
    });
  }
}

// ---------------------------------------------------------------- checkboxes

for (const key of ['restartOnEnter', 'pauseOnExit', 'showHud', 'showBar']) {
  const el = $(key);
  el.checked = cfg[key];
  el.addEventListener('change', () => {
    cfg[key] = el.checked;
    applyVisual();
    tour.setConfig({ [key]: cfg[key] });
    save();
  });
}

function applyVisual() {
  const s = document.documentElement.style;
  s.setProperty('--tint', cfg.tint);
  s.setProperty('--vignette', cfg.vignette);
  $('hud').hidden = !cfg.showHud;
  root.querySelector('.tour__progress').hidden = !cfg.showBar;
}

// ---------------------------------------------------------------- hints

const TRANSITION_HINTS = {
  fade: 'Cross-dissolve. Both clips keep scrubbing through the overlap, so it ' +
        'reads as movement rather than two stills mixing. Most forgiving of a ' +
        'seam that doesn\'t line up exactly.',
  black: 'Dips through black between rooms. Cleaner separation, but it breaks ' +
         'the illusion of one continuous walk.',
  cut: 'Hard cut at the boundary. Only works if the last frame of one clip and ' +
       'the first of the next are near-identical.',
};

const MODE_HINTS = {
  scrub: 'Scroll drives the camera. Loads the dense-keyframe encodes.',
  play: 'Clips play on their own clock; scroll drives the aperture and copy.',
};

// ---------------------------------------------------------------- seam jump

$('jumpSeam').addEventListener('click', () => {
  const seam = tour.rooms[0].end;               // boundary in tour progress
  const top = root.offsetTop;
  window.scrollTo({ top: top + tour.scrollRange * seam, behavior: 'smooth' });
});

// ---------------------------------------------------------------- errors

tour.onLoadError = (roomId, why) => {
  $('loadErrorWhy').textContent = `${roomId}: ${why}`;
  $('loadError').hidden = false;
};

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
const seamMark = root.querySelector('[data-seammark]');

function hudLoop() {
  requestAnimationFrame(hudLoop);
  const p = tour.progress ?? 0;
  if (cfg.showBar) {
    bar.style.width = `${(p * 100).toFixed(2)}%`;
    if (tour.rooms[0].end) seamMark.style.left = `${(tour.rooms[0].end * 100).toFixed(2)}%`;
  }
  if (cfg.showHud) {
    const room = tour.activeRoom();
    $('hud_fps').textContent = tour.stats.fps;
    $('hud_p').textContent = p.toFixed(3);
    $('hud_room').textContent = room.id;
    $('hud_t').textContent = `${room.video.currentTime.toFixed(2)}s`;
    $('hud_state').textContent = tour.inTransition()
      ? 'transition'
      : (cfg.mode === 'scrub' ? 'scrubbed' : (room.video.paused ? 'paused' : 'playing'));
  }
}

// ---------------------------------------------------------------- go

applyVisual();
$('transitionHint').innerHTML = TRANSITION_HINTS[cfg.transition];
$('modeHint').innerHTML = MODE_HINTS[cfg.mode];
await tour.init();
hudLoop();
