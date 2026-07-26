# AI Video Generation Spec — Scroll-Driven Building Tour

How to shoot and generate room clips that scrub well.

Written after inspecting `assets/demo.mp4`. Note the workflow here is
**image-to-video**: real photographs of the building, with an AI generating the
camera movement between them. That's a very different problem from text-to-video,
and most generic "AI video prompt" advice doesn't apply.

---

## 0. What the demo clip told us

The existing clip travels: **exterior door → main hall → through the arch →
common room**. Three distinct spaces in 11 seconds, which is fast. Observations
that shape everything below:

- **The building is the asset.** Stone arches, vaulted ceilings, stained glass.
  The architecture is genuinely photogenic, which means the priority is showing
  it clearly, not adding camera flourish.
- **Warm, busy walls.** Textured stone in cream and sand tones fills most of the
  frame. Overlaid text needs help to stay legible — this is why the demo has a
  tint control, and why it defaults fairly high.
- **Visible warping.** Stone texture and doorway geometry morph where the AI is
  interpolating between two photos that were too far apart. Invisible at speed,
  obvious when a user stops mid-scroll.
- **Three rooms in one clip is too much.** One clip per section, one room per
  clip. Splitting is the single biggest structural improvement available.

---

### Audit of the existing source photos

`shots/Baydar website/` — 12 photos, `IMG_9761`–`IMG_9772`:

| Property | Value | Verdict |
|---|---|---|
| Resolution | 4032 × 3024 (12 MP) | Excellent |
| Aspect | 4:3 landscape | See note below |
| Coverage | facade → door → hall (×4) → arch → common room | Good, roughly one per metre |
| Exposure | Varies between interior and exterior shots | Fix on the next shoot |

Two things follow directly from this:

**You are losing 96% of your pixels.** 4032×3024 in, 864×496 out. The photos are
not the constraint — the tool's output tier is. Raising it is the single cheapest
improvement available, and it requires no reshooting.

**Your aspect ratios don't line up.** Photos are 4:3 (1.33:1); the video came out
1.74:1. Something is cropping roughly a quarter off the top and bottom, and you
have no control over what it discards. Worth checking whether the tool exposes a
framing or aspect setting before generating the rest.

**Photo density is about right.** Twelve photos over 11 seconds is roughly one
per second, so the AI is inventing ~24 frames between each real one. That gap is
exactly where the warping comes from. Shooting at half the current spacing —
say 20–24 photos over the same path — would cut the interpolation distance in
half and noticeably reduce the morphing.

---

## 1. Photo capture — the highest-leverage step

Interpolation quality is set by how far apart your source photos are. Warping
isn't the model being bad; it's the model guessing at geometry it was never shown.
The fix is more photos, not better prompts.

**Shoot a dense path, not a start and end.** Walk the route and shoot every
metre or so, camera held at a consistent height, pointing in a consistent
direction. Ten photos through a hallway interpolate far better than two.

**Lock your camera settings.** Manual exposure, manual white balance, fixed
focal length. Auto mode shifts exposure between shots and the AI turns that into
a brightness pulse mid-clip.

**Shoot the seams deliberately.** The last photo of one room and the first photo
of the next should be *the same photo*. That's what makes clips chain (§4).

**Shoot at maximum resolution.** The clip is 864×496, but your source photos are
almost certainly much larger. That resolution ceiling is the AI tool's output
tier, not your camera — see §2.

**Keep people out**, or keep them still. Scrolling up plays the clip backwards,
and people walking backwards is deeply uncanny.

---

## 2. Generation settings (tool UI, not prompt)

| Setting | Value | Why |
|---|---|---|
| Resolution | **1920×1080 min**, 2560×1440 preferred | Current 864×496 is soft fullscreen and visibly poor on a 1440p monitor. Usually just a paid output tier — likely the cheapest large win available. |
| Duration | Longest tier | More frames over the same camera move = smoother scrub. Frame density is the biggest quality lever after resolution. |
| FPS | 24 or 30, consistent across every clip | Mixed frame rates make section pacing inconsistent. |
| Audio | Off | Unused, and it bloats the file. |
| "Cinematic" presets | **Off** | They inject speed ramps, shake, and grade shifts. All three hurt scrubbing. |

Don't upscale afterwards. AI upscalers invent detail that shimmers frame to
frame — which is precisely what scrubbing puts under a microscope.

---

## 3. The prompt

For image-to-video, the prompt's job is to **constrain camera behaviour**, not to
describe the scene — the photos already do that. Keep scene description minimal
and spend the prompt on motion.

```
Slow, smooth forward dolly through the space, following the reference images.

Camera: locked-off dolly on rails, moving forward at a perfectly constant speed.
No handheld movement, no camera shake, no zoom, no pans, no rotation. Fixed focal
length. Camera height stays constant at eye level throughout.

Motion: perfectly linear constant velocity from first frame to last. No
acceleration, no deceleration, no ease-in, no ease-out, no speed ramping.

Lighting: even and constant. No exposure changes, no flickering, no lens flare.

Preserve the original architecture exactly: keep stone walls, arches, and
doorways geometrically stable and straight. Do not reinterpret or redesign any
part of the structure.

The scene is empty and still. No people, no moving objects.

Style: photorealistic architectural walkthrough, sharp focus throughout, minimal
motion blur, stable geometry.
```

### Negative prompt

```
camera shake, handheld, shaky footage, zoom, dolly zoom, speed ramp, slow motion,
acceleration, easing, motion blur, rack focus, depth of field changes, cuts, jump
cuts, transitions, fade in, fade out, people, crowds, walking figures, moving
objects, flickering lights, lens flare, warping walls, morphing geometry, bending
architecture, distorted arches, text, captions, watermark, logo, letterboxing
```

The "preserve the architecture" clause and the warping terms in the negative
prompt matter most here — geometry drift is this footage's main visible flaw.

---

## 4. THE IMPORTANT ONE: chaining clips seamlessly

This decides whether the site reads as one continuous building or as nine
unrelated clips. Settle it before generating anything else.

> **The last frame of clip N becomes the first frame of clip N+1.**

That gives a pixel-exact seam. The hall clip ends framed on the arch; the next
clip starts from that exact arch and carries the viewer through it. No dissolve,
no visible cut.

The processing script already extracts this for you:

```bash
node scripts/process-video.mjs assets/room-02.mp4
```

It writes `assets/room-02-lastframe.png` — feed that straight back into the AI
tool as the init image for room 03.

If your tool supports **both** a start and end frame ("keyframe" / "last frame"
conditioning), use it: previous clip's last frame as the start, your next room
photo as the end. Highest consistency, least drift.

### Add hold frames

Ask for roughly half a second of stillness at each end:

```
The camera holds completely still for the first 12 frames, then begins its
constant forward movement, then comes to rest and holds completely still for the
final 12 frames.
```

Two payoffs. It creates a rest state at each section boundary where the room is
fully composed and the headline can be read without the background sliding. And
it makes seams forgiving — two static frames stitch invisibly, two moving frames
rarely do.

---

## 5. Composition for text

Every section puts a headline and body copy over the video. Against textured
stone, that needs planning rather than post-hoc opacity.

**Reserve a quiet region.** Frame so one side holds a plain wall, a doorway
interior, or floor — somewhere type can sit. The demo has copy bottom-left and
bottom-right; check both against every clip.

**The tint is a real trade-off.** Higher tint means readable text and a muted
building. Lower tint shows the stone properly and strains the copy. This is worth
arguing about per room, and it's why it's a live slider rather than a constant.

**Watch the stained glass.** Bright saturated windows behind light text is the
worst case in this building. Either frame away from them or plan for dark text
treatment there.

---

## 6. Aspect ratio and mobile

The clip is 864×496 (≈1.74:1). A phone is ~0.46:1 portrait — centre-cropping a
landscape clip throws away roughly two-thirds of the width.

Decide before bulk generation:

- **Portrait variant per room** (9:16). Double cost, best result, standard for
  this kind of site. Vertical framing suits the arches and vaulted ceilings well.
- **Landscape with a wide safe centre** — keep everything important in the middle
  ~50%. Cheaper, noticeably compromised.

Given the architecture is tall and arched, portrait variants would genuinely
flatter this building rather than merely accommodate phones.

---

## 7. Checklist before generating all rooms

- [ ] Locked resolution, fps, duration tier
- [ ] Locked exposure / white balance for photo capture
- [ ] Decided landscape-only vs. portrait variants
- [ ] Decided room order and the path through the building
- [ ] **One room per clip** — no more three-spaces-in-one-take
- [ ] Generated ONE clip to this spec and confirmed it scrubs well in the demo
- [ ] Confirmed last-frame → next-clip chaining works in your tool

Test the chain on two clips before committing to the full set.
