# How the scroll video actually works

> **Decision (settled):** we scrub. Scroll drives the camera; the clip does not
> play on its own. The oxman research below still stands and the play model is
> kept switchable, but scroll-as-locomotion is the right metaphor for walking
> through a building — oxman's clips are abstract product films, where it isn't.
> Cost of the decision: the dense-GOP encode, ~20 MB instead of ~11 MB.
>
> The **aperture** is the part of the oxman research worth keeping. It's
> orthogonal to the playback model and works with either. Off by default.

Reference: **oxman.com**. Notes below are from pulling that site apart, not from
guesswork — worth reading before changing the engine, because the obvious
implementation is the wrong one.

## The mistake worth not repeating

The intuitive reading of "scrollable video" is: bind `video.currentTime` to
scroll position, so the footage rewinds when you scroll up. That is **not** what
oxman.com does, and it isn't what makes the effect work.

Measured directly: park the scroll, sample `currentTime` twice 1.5s apart, and it
advances by exactly 1.5s. The video plays on its own clock. Scroll position has
no influence on it whatsoever.

## What it actually does

```
header.section
 └ .bg-video-wrap          position: fixed        ← full viewport
    └ .video-aspect-box    overflow: hidden       ← THE APERTURE, scroll-animated
       └ video             position: fixed        ← never moves
                           object-fit: cover
```

Three independent layers, each on a different clock:

| Layer | Driven by | Behaviour |
|---|---|---|
| The footage | its own clock | plays, loops; scroll never touches it |
| The aperture | scroll (scrubbed) | an `overflow:hidden` window that opens |
| The copy | scroll (scrubbed) | word-by-word reveals over the top |

The illusion comes from the split: the video is **pinned to the viewport** while
the *window onto it* grows, shrinks, and rounds off. You're scrolling the frame,
not the footage. That's why it feels physical rather than like dragging a
scrubber — because you aren't.

Their stack is GSAP 3.13 + ScrollTrigger (`scrub: 0.5`, which is just damping)
+ SplitText for the word reveals, on Webflow. Plain document scroll — no
smooth-scroll library.

## How ours differs, deliberately

Oxman gets the clipping by putting a `position: fixed` video inside an ancestor
that GSAP has applied a transform to — which quietly promotes that ancestor to a
containing block, so the fixed child starts being clipped by it. It works, but
it breaks silently the moment the transform is removed.

We instead keep the aperture `position: absolute` inside a `position: sticky`
stage, and absolutely position a viewport-sized video inside it, centred. Same
visual result, no dependency on containing-block subtleties, and it scopes
cleanly to the section instead of leaking across the page.

## Why this halves the file size

Scrubbing needs a dense keyframe interval, because every scroll tick is a seek
and the decoder must start from a keyframe. Playback doesn't — it decodes
forward like any video.

Measured on our 16.5s walkthrough at 1600×900, CRF 22:

| GOP | Size | Needed for |
|---|---|---|
| 6 | 20.06 MB | scrubbing |
| 48 | **10.85 MB** | playback |

Same footage, same quality, half the bytes. Getting the model right paid for
itself immediately.

`process-video.mjs` emits both (`-play.mp4` and `-scrub.mp4`) so the demo can
switch between models, but **`-play.mp4` is the one that ships.**

## Frame sequences

The `frames/` output and the canvas engine only ever existed to work around
video-seek stutter while scrubbing. In the playback model they're dead weight —
30+ MB to solve a problem we no longer have. Kept for now only so the scrub
comparison stays honest; drop them once the model is settled.
