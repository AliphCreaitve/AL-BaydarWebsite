# Al Baydar — portfolio

A scroll-driven tour through the organisation's building. Each section is a room;
scrolling moves the camera through the space.

## Setup (first clone)

Video assets are generated, not committed — the repo holds only source material
(`shots/`, `assets/demo.mp4`). Build them once:

```bash
npm install
node scripts/build-walkthrough.mjs
node scripts/process-video.mjs assets/walkthrough.mp4
node scripts/process-video.mjs assets/demo.mp4
```

`npm install` pulls an ffmpeg binary (~80 MB), so the first run takes a few
minutes. Everything after that is local.

## Run the demo

```bash
npx serve -l 5177 .
```

Then open **http://localhost:5177/demo/**

Press <kbd>H</kbd> to toggle the tuning panel. Adjust anything, then hit
**Copy config JSON** — that output is the settings agreement for the full build.

## Build a clip from stills (no AI)

The stills in `shots/` are 4032×3024. This renders a walkthrough from them
directly — a slow push-in per photo, cross-dissolved. Sharp, no interpolation
warping, and any output resolution you like:

```bash
node scripts/build-walkthrough.mjs --width 1920 --seg 2.2 --xfade 0.9
```

| Flag | Default | Effect |
|---|---|---|
| `--width` | 1920 | Output width (16:9) |
| `--seg` | 2.2 | Seconds each photo holds |
| `--xfade` | 0.9 | Dissolve length |
| `--zoom` | 0.10 | Push-in amount per photo |

Longer `--seg` gives a slower, calmer walk. Shorter `--xfade` makes transitions
crisper but more obviously cuts.

## Process a new clip

Every raw clip must go through this before use. It fixes keyframe density,
faststart, and the stray audio track — none of which the AI exporter gets right:

```bash
node scripts/process-video.mjs assets/room-02.mp4
```

Outputs, per clip:

| File | Purpose |
|---|---|
| `*-scrub.mp4` | Dense-GOP H.264, faststart, no audio |
| `*-scrub.webm` | VP9 fallback |
| `frames/*.jpg` + `manifest.json` | Frame sequence for the canvas engine |
| `*-poster.jpg` | First-frame poster |
| `*-lastframe.png` | **Seed image for the next room's generation** |

## Layout

```
assets/     source clips + processed derivatives
demo/       the tuning demo — scroll-video.js is the portable engine
docs/       video-generation-spec.md — read before generating more clips
scripts/    process-video.mjs
```

## The model

**Scroll drives the camera.** Clip time is bound to scroll position — stop and
the camera stops, scroll back and you walk back out. The video never plays on
its own.

Both models are switchable in the panel, and the engine loads the matching
encode automatically:

| Mode | Encode | Size | Behaviour |
|---|---|---|---|
| **scroll drives** (default) | `-scrub.mp4`, dense GOP | 20.06 MB | clip time follows scroll |
| plays itself | `-play.mp4`, normal GOP | 10.85 MB | oxman model; scroll drives only the aperture and copy |

The **aperture** — the clip opening from a window to full-bleed as you scroll —
is borrowed from oxman.com and works with either model. Off by default; try
58 / 52 in the panel to see it.

See [docs/architecture.md](docs/architecture.md) for how oxman.com actually
works and why we diverged.

## Notes

- [docs/architecture.md](docs/architecture.md) — how the effect works and why.
- [docs/video-generation-spec.md](docs/video-generation-spec.md) — photo capture,
  prompts, and clip chaining. The chaining decision in §4 is hard to retrofit,
  so settle it before generating the remaining rooms.
