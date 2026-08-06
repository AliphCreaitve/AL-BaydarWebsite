/**
 * RoomTour — a sequence of rooms sharing one pinned stage.
 *
 * Each room owns a slice of the scroll range. Within its slice its clip is
 * scrubbed; at the boundary between two rooms the outgoing and incoming clips
 * overlap and transition.
 *
 * Why one shared stage rather than one sticky section per room: to cross-fade,
 * both clips have to occupy the same screen space at the same moment. Separate
 * sticky sections hand off by pushing one out as the next arrives, which can
 * only ever produce a cut or a slide — never a dissolve.
 *
 * The seam between clips is the point of the whole exercise. Two clips shot
 * from almost-but-not-quite the same spot cut badly and dissolve well, which
 * is why the transition style and its length are both live controls.
 */

const FALLBACK_DURATION = 10;

export class RoomTour {
  constructor(root, rooms, config) {
    this.root = root;
    this.cfg = config;
    this.stage = root.querySelector('[data-stage]');
    this.aperture = root.querySelector('[data-aperture]');

    this.rooms = rooms.map((r) => ({
      ...r,
      el: root.querySelector(`[data-room="${r.id}"]`),
      video: root.querySelector(`[data-room="${r.id}"] video`),
      overlays: [...root.querySelectorAll(`[data-overlay-room="${r.id}"]`)],
      duration: 0,
      desiredTime: null,
      loadError: null,
    }));

    this.progress = 0;
    this.target = 0;
    this.current = 0;
    this.stats = { fps: 0, _last: performance.now(), _frames: 0 };

    this._onResize = this._onResize.bind(this);
    this._tick = this._tick.bind(this);
  }

  async init() {
    this._prepareText();
    await Promise.all(this.rooms.map((r) => this._loadRoom(r)));
    this._applyLayout();

    window.addEventListener('resize', this._onResize, { passive: true });
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(document.documentElement);

    this._raf = requestAnimationFrame(this._tick);
  }

  _variant() {
    return this.cfg.mode === 'scrub' ? 'scrub' : 'play';
  }

  _loadRoom(room) {
    return new Promise((resolve) => {
      const v = room.video;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.loop = false;

      v.innerHTML =
        `<source src="assets/${room.id}-${this._variant()}.mp4" type="video/mp4">`;
      v.poster = `assets/${room.id}-poster.jpg`;

      let settled = false;
      const ok = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        room.duration = v.duration || FALLBACK_DURATION;
        room.loadError = null;
        resolve();
      };
      // A missing clip must not zero out the layout and make the whole tour
      // un-scrollable — fall back to a nominal length and report it.
      const bad = (why) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        room.duration = FALLBACK_DURATION;
        room.loadError = why;
        console.error(`[RoomTour] ${room.id}: ${why}`);
        this.onLoadError?.(room.id, why);
        resolve();
      };

      const timer = setTimeout(() => bad('load timed out (404?)'), 8000);
      v.addEventListener('loadeddata', ok, { once: true });
      v.addEventListener('error', () => bad('failed to load'), { once: true });

      v.addEventListener('seeked', () => {
        if (this.cfg.mode !== 'scrub') return;
        const want = room.desiredTime;
        if (want != null && Math.abs(v.currentTime - want) > 0.001) {
          v.currentTime = want;
        }
      });

      v.load();
    });
  }

  async reloadSources() {
    await Promise.all(this.rooms.map((r) => this._loadRoom(r)));
    this._applyLayout();
  }

  _prepareText() {
    for (const el of this.root.querySelectorAll('[data-overlay-room]')) {
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

  /**
   * Lay the rooms end to end along the scroll range.
   *
   * Each room's share is proportional to its clip length, so a short clip
   * doesn't get the same amount of scrolling as a long one — otherwise the
   * camera speed would visibly change from room to room.
   */
  _applyLayout() {
    const vh = window.innerHeight;
    const totalDur = this.rooms.reduce((s, r) => s + r.duration, 0);
    if (!vh || !totalDur) { this.needsLayout = true; return; }

    const scrollPx = totalDur * this.cfg.vhPerSecond * vh;
    this.root.style.height = `${scrollPx + vh}px`;
    this.scrollRange = scrollPx;

    // Normalised [start, end) for each room across the whole tour.
    let acc = 0;
    for (const r of this.rooms) {
      r.start = acc / totalDur;
      acc += r.duration;
      r.end = acc / totalDur;
      r.span = r.end - r.start;
    }
    this.totalDuration = totalDur;
    this.needsLayout = false;
  }

  _onResize() { this._applyLayout(); }

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
    this._renderRooms(p);
    this._renderOverlays(p);
  }

  _renderAperture(p) {
    const c = this.cfg;
    const e = EASINGS[c.apertureEasing](Math.max(0, Math.min(1, p / c.apertureSpan)));
    const a = this.aperture;
    a.style.width = `${c.apertureFromW + (100 - c.apertureFromW) * e}vw`;
    a.style.height = `${c.apertureFromH + (100 - c.apertureFromH) * e}vh`;
    a.style.borderRadius = `${(c.apertureRadius * (1 - e)).toFixed(2)}px`;
  }

  /**
   * Opacity for each room at tour progress `p`.
   *
   * `transitionSpan` is expressed in tour-progress units and straddles the
   * boundary, so half of it eats into the outgoing room and half into the
   * incoming one. Each room's clip keeps scrubbing throughout its own overlap
   * half, which is what stops the dissolve looking like two frozen stills
   * fading into each other.
   */
  _renderRooms(p) {
    const span = this.cfg.transitionSpan;
    const style = this.cfg.transition;
    const half = span / 2;

    for (let i = 0; i < this.rooms.length; i++) {
      const r = this.rooms[i];
      let o;

      if (style === 'cut') {
        o = (p >= r.start && p < r.end) || (i === this.rooms.length - 1 && p >= r.end) ? 1 : 0;
      } else {
        // Ramp in across the boundary before this room, out across the one after.
        const inEdge = i === 0 ? -1 : r.start;
        const outEdge = i === this.rooms.length - 1 ? 2 : r.end;
        const fadeIn = span <= 0 ? (p >= inEdge ? 1 : 0)
                                 : clamp01((p - (inEdge - half)) / span);
        const fadeOut = span <= 0 ? (p < outEdge ? 1 : 0)
                                  : clamp01(((outEdge + half) - p) / span);
        o = Math.min(fadeIn, fadeOut);

        if (style === 'black') {
          // Through black: drive both to zero at the seam rather than
          // letting them sum to one, so the stage darkens between rooms.
          o = Math.pow(o, 2.2);
        }
      }

      r.el.style.opacity = o.toFixed(3);
      r.el.style.visibility = o < 0.002 ? 'hidden' : 'visible';
      r.active = o > 0.002;

      this._renderRoomVideo(r, p, o);
    }
  }

  _renderRoomVideo(room, p, opacity) {
    const v = room.video;

    /**
     * Map scroll to clip time across the room's slice *plus its half of each
     * overlap*, not just the slice itself.
     *
     * Clamping to the bare slice looks wrong: the incoming clip sits frozen on
     * frame 0 for the first half of the dissolve, and the outgoing one freezes
     * on its last frame for the second half — so a "cross-dissolve" is really a
     * moving image mixed with a still. Stretching the mapping over the overlap
     * keeps both clips running for the whole transition, which is the only way
     * it reads as continuous movement through the building.
     */
    const half = this.cfg.transition === 'cut' ? 0 : this.cfg.transitionSpan / 2;
    const first = room === this.rooms[0];
    const last = room === this.rooms[this.rooms.length - 1];
    const tStart = first ? room.start : room.start - half;
    const tEnd = last ? room.end : room.end + half;
    const local = clamp01((p - tStart) / Math.max(0.0001, tEnd - tStart));

    if (this.cfg.mode === 'scrub') {
      if (!v.paused) v.pause();
      if (opacity <= 0.002) return;
      const t = local * room.duration;
      if (Number.isFinite(t)) {
        room.desiredTime = t;
        if (!v.seeking && Math.abs(v.currentTime - t) > 0.001) v.currentTime = t;
      }
      return;
    }

    // play mode: transport follows visibility
    if (opacity > 0.002 && v.paused) {
      if (this.cfg.restartOnEnter && local < 0.02) v.currentTime = 0;
      v.play().catch(() => {});
    } else if (opacity <= 0.002 && !v.paused) {
      if (this.cfg.pauseOnExit) v.pause();
    }
  }

  _renderOverlays(p) {
    const fade = this.cfg.overlayFade;
    for (const r of this.rooms) {
      for (const el of r.overlays) {
        // data-in / data-out are per-room progress, mapped into tour space.
        const inP = r.start + parseFloat(el.dataset.in ?? '0') * r.span;
        const outP = r.start + parseFloat(el.dataset.out ?? '1') * r.span;

        let o = 0;
        if (p >= inP && p <= outP) {
          const fi = fade > 0 ? Math.min(1, (p - inP) / (fade * r.span)) : 1;
          const fo = fade > 0 ? Math.min(1, (outP - p) / (fade * r.span)) : 1;
          o = Math.min(fi, fo);
        }
        o = clamp01(o);

        el.style.visibility = o < 0.002 ? 'hidden' : 'visible';

        const words = el._words;
        if (this.cfg.textReveal === 'words' && words?.length) {
          el.style.opacity = 1;
          const stagger = this.cfg.wordStagger;
          for (let i = 0; i < words.length; i++) {
            const s = (i / words.length) * stagger;
            const wp = clamp01((o - s) / Math.max(0.001, 1 - stagger));
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
  }

  /** Which room is dominant right now, for the HUD. */
  activeRoom() {
    let best = this.rooms[0], bestO = -1;
    for (const r of this.rooms) {
      const o = parseFloat(r.el.style.opacity || '0');
      if (o > bestO) { bestO = o; best = r; }
    }
    return best;
  }

  inTransition() {
    let visible = 0;
    for (const r of this.rooms) if (parseFloat(r.el.style.opacity || '0') > 0.02) visible++;
    return visible > 1;
  }

  setConfig(patch) {
    const wasMode = this.cfg.mode;
    Object.assign(this.cfg, patch);
    if ('vhPerSecond' in patch) this._applyLayout();
    if ('mode' in patch && patch.mode !== wasMode) {
      for (const r of this.rooms) r.video.pause();
      return this.reloadSources();
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const EASINGS = {
  linear: (t) => t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};
