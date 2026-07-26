#!/usr/bin/env node
/**
 * Builds a walkthrough clip directly from the source stills — no AI.
 *
 * Each photo gets a slow forward push (Ken Burns), and consecutive photos
 * cross-dissolve. Because the stills were shot walking a single forward path,
 * "push in, dissolve, push in" reads as continuous forward movement.
 *
 * Why bother when we already have an AI clip:
 *   - Source is 4032x3024; we can render 1080p or 1440p instead of 864x496
 *   - Zero interpolation warping — every pixel is a real photograph
 *   - Exactly linear motion, which is what scroll-scrubbing wants
 *   - Free and repeatable; re-render at any length or resolution
 *
 *   node scripts/build-walkthrough.mjs [--width 1920] [--seg 2.2] [--xfade 0.9]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const SHOTS = path.join(ROOT, 'shots', 'Baydar website');
const OUT = path.join(ROOT, 'assets', 'walkthrough.mp4');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? parseFloat(process.argv[i + 1]) : dflt;
};

const OUT_W = arg('width', 1920);
const OUT_H = Math.round(OUT_W * 9 / 16 / 2) * 2;
const FPS = 30;
const SEG = arg('seg', 2.2);      // seconds each photo is on screen
const XFADE = arg('xfade', 0.9);  // dissolve length
const ZOOM = arg('zoom', 0.10);   // push-in amount over the segment
const SUPERSAMPLE = 2;            // render the pan at 2x, downscale after —
                                  // zoompan rounds x/y to integers, and at 1x
                                  // that rounding shows up as visible jitter

const log = (...a) => console.log('  ', ...a);
const mb = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';

async function ff(args, label) {
  process.stdout.write(`   ${label}… `);
  const t = Date.now();
  try {
    await exec(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { maxBuffer: 1024 * 1024 * 64 });
    console.log(`done (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.log('FAILED');
    throw new Error(err.stderr || err.message);
  }
}

async function main() {
  if (!existsSync(FFMPEG)) { console.error('Run: npm i ffmpeg-static'); process.exit(1); }
  if (!existsSync(SHOTS)) { console.error(`Not found: ${SHOTS}`); process.exit(1); }

  const photos = (await readdir(SHOTS))
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort()                                  // filename order == walk order
    .map((f) => path.join(SHOTS, f));

  if (!photos.length) { console.error('No photos found.'); process.exit(1); }

  const total = photos.length * SEG - (photos.length - 1) * XFADE;
  console.log(`\n▸ Building walkthrough from ${photos.length} stills`);
  log(`output   ${OUT_W}x${OUT_H} @ ${FPS}fps`);
  log(`timing   ${SEG}s per photo, ${XFADE}s dissolve → ${total.toFixed(1)}s total`);

  const tmp = await mkdtemp(path.join(tmpdir(), 'albaydar-'));
  const segFrames = Math.round(SEG * FPS);
  const workW = OUT_W * SUPERSAMPLE;
  const workH = OUT_H * SUPERSAMPLE;

  try {
    // ---- pass 1: one push-in segment per photo -----------------------------
    const segs = [];
    for (let i = 0; i < photos.length; i++) {
      const out = path.join(tmp, `seg${String(i).padStart(2, '0')}.mp4`);

      // Crop 4:3 → 16:9 first so the push doesn't fight the aspect change,
      // then supersample, then animate. `on` is the output frame counter,
      // and d=1 keeps zoompan one-in-one-out (its default d>1 stutters).
      const vf = [
        `crop=iw:trunc(iw*${OUT_H}/${OUT_W}/2)*2`,
        `scale=${workW}:${workH}:flags=lanczos`,
        `zoompan=z='1+${ZOOM}*on/${segFrames - 1}'` +
          `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
          `:d=1:s=${workW}x${workH}:fps=${FPS}`,
        `scale=${OUT_W}:${OUT_H}:flags=lanczos`,
        `setsar=1`,
      ].join(',');

      await ff([
        '-loop', '1', '-framerate', String(FPS), '-t', String(SEG), '-i', photos[i],
        '-vf', vf,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
        '-pix_fmt', 'yuv420p',
        out,
      ], `segment ${i + 1}/${photos.length}  ${path.basename(photos[i])}`);

      segs.push(out);
    }

    // ---- pass 2: chain them with cross-dissolves ---------------------------
    // xfade offsets accumulate: each join starts XFADE before the running end.
    const inputs = segs.flatMap((s) => ['-i', s]);
    const parts = [];
    let prev = '0:v';
    let acc = SEG;
    for (let i = 1; i < segs.length; i++) {
      const label = i === segs.length - 1 ? 'out' : `x${i}`;
      parts.push(
        `[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}` +
        `:offset=${(acc - XFADE).toFixed(4)}[${label}]`
      );
      prev = label;
      acc += SEG - XFADE;
    }

    await ff([
      ...inputs,
      '-filter_complex', parts.join(';'),
      '-map', '[out]',
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '19',
      '-pix_fmt', 'yuv420p',
      '-g', '6', '-keyint_min', '6', '-sc_threshold', '0',  // scrub-ready GOP
      '-movflags', '+faststart',
      '-an',
      OUT,
    ], 'cross-dissolve + encode');

    log('→', path.relative(ROOT, OUT), mb((await stat(OUT)).size));
    console.log(`\n✓ Done. Now run:\n    node scripts/process-video.mjs assets/walkthrough.mp4\n`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
