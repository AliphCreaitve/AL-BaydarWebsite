#!/usr/bin/env node
/**
 * Turns a raw AI-generated clip into web assets that actually scrub.
 *
 * Fixes the three things every AI video exporter gets wrong for this use case:
 *   1. Sparse keyframes  → re-encode with a dense GOP so seeking is cheap
 *   2. moov after mdat   → +faststart so playback starts before full download
 *   3. Dead audio track  → dropped
 *
 * Also emits a frame sequence for the canvas engine, which sidesteps video
 * seeking entirely.
 *
 *   node scripts/process-video.mjs [input.mp4]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? parseFloat(args[i + 1]) : dflt;
};
const positional = args.find((a) => !a.startsWith('--') &&
  !args[args.indexOf(a) - 1]?.startsWith('--'));

const INPUT = path.resolve(ROOT, positional ?? 'assets/demo.mp4');
const NAME = path.basename(INPUT, path.extname(INPUT));
const ASSETS = path.join(ROOT, 'assets');
// Per-clip frame directory, so multiple rooms can coexist.
const FRAME_DIR = path.join(ASSETS, 'frames', NAME);

// Keyframe every N frames. 1 = all-intra (largest, perfect seeking);
// 6 is the sweet spot — seeks land within a quarter-second of decode.
const GOP = 6;
// Ceiling on the encoded width. Dense keyframes are expensive, so this is the
// main size lever; the video sits behind a tint with text over it, and 1600
// holds up fullscreen without the 1080p bitrate.
const MAX_WIDTH = flag('width', 1600);
const CRF = flag('crf', 22);
// Frame-sequence downscale. Frames are cheap to decode but heavy to download,
// so they get a smaller ceiling than the video.
const FRAME_WIDTH = flag('frame-width', 1280);
const FRAME_QUALITY = 82;

// `-2` keeps height even and preserves aspect; `min()` never upscales.
const SCALE = `scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos`;

const log = (...a) => console.log('  ', ...a);
const mb = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';

async function ff(args, label) {
  process.stdout.write(`   ${label}… `);
  const t = Date.now();
  try {
    await exec(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      maxBuffer: 1024 * 1024 * 64,
    });
    console.log(`done (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.log('FAILED');
    throw new Error(err.stderr || err.message);
  }
}

async function main() {
  if (!existsSync(FFMPEG)) {
    console.error('ffmpeg-static not installed. Run: npm i ffmpeg-static');
    process.exit(1);
  }
  if (!existsSync(INPUT)) {
    console.error(`Input not found: ${INPUT}`);
    process.exit(1);
  }

  console.log(`\n▸ Processing ${path.relative(ROOT, INPUT)}`);
  log('source:', mb((await stat(INPUT)).size));

  // ---- 0. playback build (the default) -----------------------------------
  // For the aperture model the clip plays on its own clock, so we only need a
  // normal GOP. That halves the file versus the scrub build — the dense
  // keyframes below exist purely to make seeking cheap, and we aren't seeking.
  const playOut = path.join(ASSETS, `${NAME}-play.mp4`);
  await ff([
    '-i', INPUT,
    '-an',
    '-vf', SCALE,
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-preset', 'slow', '-crf', String(CRF),
    '-g', '48', '-keyint_min', '48',
    '-movflags', '+faststart',
    playOut,
  ], 'playback mp4 (normal GOP)');
  log('→', path.relative(ROOT, playOut), mb((await stat(playOut)).size));

  // ---- 1. scrub-optimised MP4 -------------------------------------------
  const scrubOut = path.join(ASSETS, `${NAME}-scrub.mp4`);
  await ff([
    '-i', INPUT,
    '-an',                              // drop audio
    '-vf', SCALE,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-preset', 'slow',
    '-crf', String(CRF),
    '-g', String(GOP),
    '-keyint_min', String(GOP),
    '-sc_threshold', '0',               // no scene-cut keyframe placement:
                                        // we want a strictly regular GOP
    '-movflags', '+faststart',
    scrubOut,
  ], 'scrub-optimised mp4');
  log('→', path.relative(ROOT, scrubOut), mb((await stat(scrubOut)).size));

  // ---- 2. WebM/VP9 alternative -------------------------------------------
  // Only worth shipping if it actually beats H.264. At the dense GOP we need
  // for scrubbing, VP9 often loses — all-intra-ish content is exactly where
  // its inter-frame advantages don't apply. Keep it only if it wins.
  const scrubSize = (await stat(scrubOut)).size;
  const webmOut = path.join(ASSETS, `${NAME}-scrub.webm`);
  await ff([
    '-i', INPUT,
    '-an',
    '-vf', SCALE,
    '-c:v', 'libvpx-vp9',
    '-crf', String(CRF + 10), '-b:v', '0',
    '-g', String(GOP),
    '-deadline', 'good', '-cpu-used', '2',
    '-row-mt', '1',
    webmOut,
  ], 'vp9 webm alternative');

  const webmSize = (await stat(webmOut)).size;
  if (webmSize >= scrubSize) {
    await rm(webmOut, { force: true });
    log('✕ webm dropped —', mb(webmSize), 'vs mp4', mb(scrubSize) + '; H.264 wins');
  } else {
    log('→', path.relative(ROOT, webmOut), mb(webmSize));
  }

  // ---- 3. frame sequence -------------------------------------------------
  await rm(FRAME_DIR, { recursive: true, force: true });
  await mkdir(FRAME_DIR, { recursive: true });

  await ff([
    '-i', INPUT,
    '-vf', `scale='min(${FRAME_WIDTH},iw)':-2:flags=lanczos`,
    '-q:v', String(Math.round((100 - FRAME_QUALITY) / 2)),
    path.join(FRAME_DIR, '%04d.jpg'),
  ], 'frame sequence');

  const files = (await readdir(FRAME_DIR)).filter((f) => f.endsWith('.jpg')).sort();
  let total = 0;
  for (const f of files) total += (await stat(path.join(FRAME_DIR, f))).size;

  await writeFile(
    path.join(FRAME_DIR, 'manifest.json'),
    JSON.stringify(
      { dir: `../assets/frames/${NAME}`, ext: 'jpg', count: files.length },
      null, 2)
  );

  log('→', `${files.length} frames`, mb(total), `(avg ${mb(total / files.length)})`);

  // ---- 4. poster ---------------------------------------------------------
  const poster = path.join(ASSETS, `${NAME}-poster.jpg`);
  await ff(['-i', INPUT, '-frames:v', '1', '-q:v', '3', poster], 'poster frame');

  // ---- 5. last frame, for chaining the next clip -------------------------
  const lastFrame = path.join(ASSETS, `${NAME}-lastframe.png`);
  await ff([
    '-sseof', '-0.1', '-i', INPUT,
    '-frames:v', '1', '-q:v', '1',
    '-update', '1',
    lastFrame,
  ], 'last frame (seed for next clip)');
  log('→', path.relative(ROOT, lastFrame), '— feed this to the AI as the init image for the next room');

  console.log('\n✓ Done.\n');
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
