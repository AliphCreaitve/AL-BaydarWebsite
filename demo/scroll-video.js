/**
 * RoomSection — a fixed, full-bleed clip revealed through a scroll-driven
 * aperture, in the manner of oxman.com.
 *
 * The core idea, and the thing that makes it read as "scrollable video":
 * the video does NOT move and its playback is NOT tied to scroll. It sits
 * locked to the viewport playing on its own clock. What scroll animates is the
 * *aperture* — an overflow:hidden window that grows, shrinks, and rounds off
 * in front of it. You are scrolling the frame, not the footage.
 *
 * Implementation note on the aperture: oxman gets the clipping by putting a
 * `position: fixed` video inside a transformed ancestor, which quietly turns
 * that ancestor into a containing block. That works but is fragile — it breaks
 * the moment the transform is removed. We instead keep the aperture fixed and
 * centred, and absolutely position a viewport-sized video inside it. Same
 * visual result, no dependency on containing-block subtleties.
 *
 * `mode` selects the behaviour under discussion:
 *   'play'  — the oxman model. Clip plays on entry, scroll drives the aperture.
 *   'scrub' — clip time bound to scroll position. Kept for comparison.
 */

export class RoomSection {
  constructor(root, config) {
    this.root = root;
    this.cfg = config;

    this.aperture = root.querySelector('[data-aperture]');
    this.video = root.querySelector('video');
    this.overlays = [...root.querySelectorAll('[data-overlay]')];

    this.target = 0;
    this.current = 0;
    this.duration = 0;
    this.isActive = false;

    this.stats = { fps: 0, _last: performance.now(), _frames: 0 };

    this._onResize = this._onResize.bind(this);
    this._tick = this._tick.bind(this);
  }

  async init() {
    this._prepareText();
    await this._loadVideo();
    this._applyLayout();

    window.addEventListener('resize', this._onResize, { passive: true });
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(document.documentElement);

    this._raf = requestAnimationFrame(this._tick);
  }

  _loadVideo() {
    return new Promise((resolve) => {
      const v = this.video;
      v.muted = true;          // required for autoplay to be permitted
      v.playsInline = true;
      v.preload = 'auto';
      v.loop = this.cfg.loop;

      // Catch-up seek, only relevant in scrub mode. See _renderVideo.
      v.addEventListener('seeked', () => {
        const want = this.desiredTime;
        if (this.cfg.mode === 'scrub' && want != null &&
            Math.abs(v.currentTime - want) > 0.001) {
          v.currentTime = want;
        }
      });

      const ready = () => {
        this.duration = v.duration || 0;
        resolve();
      };
      if (v.readyState >= 2) ready();
      else v.addEventListener('loadeddata', ready, { once: true });
    });
  }

  /**
   * The encode has to match the model. Scrubbing seeks on every frame, so it
   * needs the dense-GOP build; playback decodes forward and can use the normal
   * one at half the size. Loading the wrong pair looks like a stutter bug.
   */
  _variant() {
    return this.cfg.mode === 'scrub' ? 'scrub' : 'play';
  }

  async setSource(base = this.base) {
    this.base = base;
    const v = this.video;
    // Relative to this directory, never `../`: the host serves demo/ as the
    // web root, so a parent-relative path resolves above it and 404s.
    v.innerHTML =
      `<source src="assets/${base}-${this._variant()}.mp4" type="video/mp4">`;
    v.poster = `assets/${base}-poster.jpg`;
    this.duration = 0;
    this.desiredTime = null;
    v.load();
    await new Promise((res) => v.addEventListener('loadeddata', res, { once: true }));
    this.duration = v.duration;
    this._applyLayout();
  }

  /**
   * Split headline text into spans so it can be revealed progressively.
   * Word-level rather than character-level: at character level, long headings
   * generate hundreds of nodes and the reveal reads as noise rather than text.
   */
  _prepareText() {
    for (const el of this.overlays) {
      const h = el.querySelector('[data-split]');
      if (!h || h.dataset.ready) continue;
      const words = h.textContent.trim().split(/\s+/);
      h.textContent = '';
      for (const w of words) {
        const outer = document.createElement('span');
        outer.className = 'word';
        const inner = document.createElement('span');
        inner.className = 'word__i';
        inner.textContent = w;
        outer.append(inner, document.createTextNode(' '));
        h.append(outer);
      }
      h.dataset.ready = '1';
      el._words = [...h.querySelectorAll('.word__i')];
    }
  }

  _applyLayout() {
    const vh = window.innerHeight;
    if (!vh || !this.duration) { this.needsLayout = true; return; }
    // In play mode the clip runs on its own clock, so section length is a
    // pacing choice rather than a hard mapping — but tying it to duration
    // keeps the clip roughly finishing as the section exits.
    const scrollPx = this.duration * this.cfg.vhPerSecond * vh;
    this.root.style.height = `${scrollPx + vh}px`;
    this.scrollRange = scrollPx;
    this.needsLayout = false;
  }

  _onResize() {
    this._applyLayout();
  }

  _computeTarget() {
    if (!this.scrollRange) return 0;
    const p = -this.root.getBoundingClientRect().top / this.scrollRange;
    return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
  }

  _tick(now) {
    this._raf = requestAnimationFrame(this._tick);

    this.stats._frames++;
    if (now - this.stats._last >= 500) {
      this.stats.fps = Math.round((this.stats._frames * 1000) / (now - this.stats._last));
      this.stats._frames = 0;
      this.stats._last = now;
    }

    if (this.needsLayout) this._applyLayout();

    this.target = this._computeTarget();

    const dt = Math.min(100, now - (this._prevNow ?? now - 16.67));
    const d = this.cfg.damping;
    if (d <= 0.001) this.current = this.target;
    else {
      const alpha = 1 - Math.pow(d, dt / 16.67);
      this.current += (this.target - this.current) * Math.min(1, Math.max(0, alpha));
    }
    this._prevNow = now;

    const p = this.current;
    this.progress = p;

    this._renderAperture(p);
    this._renderVideo(p);
    this._renderOverlays(p);
  }

  /** The signature move: scroll opens the window, the footage stays put. */
  _renderAperture(p) {
    const c = this.cfg;
    const e = EASINGS[c.apertureEasing](Math.max(0, Math.min(1, p / c.apertureSpan)));
    const w = c.apertureFromW + (100 - c.apertureFromW) * e;
    const h = c.apertureFromH + (100 - c.apertureFromH) * e;
    const r = c.apertureRadius * (1 - e);

    const a = this.aperture;
    a.style.width = `${w}vw`;
    a.style.height = `${h}vh`;
    a.style.borderRadius = `${r}px`;
  }

  _renderVideo(p) {
    const v = this.video;
    if (this.cfg.mode === 'scrub') {
      if (!v.paused) v.pause();
      const t = p * this.duration;
      if (Number.isFinite(t)) {
        this.desiredTime = t;
        if (!v.seeking && Math.abs(v.currentTime - t) > 0.001) v.currentTime = t;
      }
      return;
    }

    // play mode: visibility drives transport, scroll never touches currentTime.
    const visible = p > 0 && p < 1;
    if (visible && !this.isActive) {
      this.isActive = true;
      if (this.cfg.restartOnEnter) v.currentTime = 0;
      v.play().catch(() => { /* autoplay blocked; poster remains */ });
    } else if (!visible && this.isActive) {
      this.isActive = false;
      if (this.cfg.pauseOnExit) v.pause();
    }
  }

  /**
   * Copy reveals are scrubbed to scroll even in play mode — that split is the
   * whole trick. Footage runs on its own clock; type answers to the scrollbar.
   */
  _renderOverlays(p) {
    const fade = this.cfg.overlayFade;
    for (const el of this.overlays) {
      const inP = parseFloat(el.dataset.in ?? '0');
      const outP = parseFloat(el.dataset.out ?? '1');

      let o = 0;
      if (p >= inP && p <= outP) {
        const fi = fade > 0 ? Math.min(1, (p - inP) / fade) : 1;
        const fo = fade > 0 ? Math.min(1, (outP - p) / fade) : 1;
        o = Math.min(fi, fo);
      }
      o = Math.max(0, Math.min(1, o));

      el.style.visibility = o < 0.002 ? 'hidden' : 'visible';

      const words = el._words;
      if (this.cfg.textReveal === 'words' && words?.length) {
        el.style.opacity = 1;
        // Each word gets its own slice of the reveal window, so the line
        // assembles left-to-right rather than fading as one block.
        const stagger = this.cfg.wordStagger;
        for (let i = 0; i < words.length; i++) {
          const s = (i / words.length) * stagger;
          const wp = Math.max(0, Math.min(1, (o - s) / Math.max(0.001, 1 - stagger)));
          words[i].style.transform = `translate3d(0, ${((1 - wp) * 100).toFixed(1)}%, 0)`;
          words[i].style.opacity = wp.toFixed(3);
        }
      } else {
        el.style.opacity = o.toFixed(3);
        if (words) for (const w of words) { w.style.transform = ''; w.style.opacity = ''; }
      }

      el.style.setProperty('--drift', `${((1 - o) * this.cfg.overlayDrift).toFixed(1)}px`);
    }
  }

  setConfig(patch) {
    const wasMode = this.cfg.mode;
    Object.assign(this.cfg, patch);
    if ('vhPerSecond' in patch) this._applyLayout();
    if ('loop' in patch) this.video.loop = this.cfg.loop;
    if ('mode' in patch && patch.mode !== wasMode) {
      this.isActive = false;
      this.video.pause();
      // swap to the encode that matches the new model
      return this.setSource();
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
  }
}

export const EASINGS = {
  linear: (t) => t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};
