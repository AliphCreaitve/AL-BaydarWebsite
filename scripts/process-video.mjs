#!/usr/bin/env node
/**
 * Turns a raw clip into web-ready assets.
 *
 * Fixes the three things video exporters get wrong for this use case:
 *   1. Sparse keyframes  → re-encode with a dense GOP so seeking is cheap
 *   2. moov after mdat   → +faststart so playback starts before full download
 *   3. Dead audio track  → dropped
 *
 * Output goes to demo/assets/, NOT assets/. That directory is the deployable
 * site root — it has to be self-contained, because the host serves demo/ as
 * the web root and anything referenced as ../assets/ resolves above it and
 * 404s. assets/ stays for source material and intermediates.
 *
 *   node scripts/process-video.mjs [input.mp4] [--width 1600] [--crf 22]
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat } from 'node:fs/promises';
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
const ASSETS = path.join(ROOT, 'assets');          // source + intermediates
const WEB = path.join(ROOT, 'demo', 'assets');     // deployed, committed

// Keyframe every N frames, for scrub mode. Seeks land within a quarter-second
// of decode; the source clip shipped with 2 keyframes in 11 seconds, which
// made every scroll tick decode from frame 1.
const GOP_SCRUB = 6;
// Playback mode decodes forward and needs no such thing — half the size.
const GOP_PLAY = 48;

const MAX_WIDTH = flag('width', 1600);
const CRF = flag('crf', 22);

// `-2` keeps height even and preserves aspect; `min()` never upscales.
const SCALE = `scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos`;

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

const encode = (out, gop) => ([
  '-i', INPUT,
  '-an',
  '-vf', SCALE,
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-preset', 'slow', '-crf', String(CRF),
  '-g', String(gop), '-keyint_min', String(gop),
  ...(gop === GOP_SCRUB ? ['-sc_threshold', '0'] : []),
  '-movflags', '+faststart',
  out,
]);

async function main() {
  if (!existsSync(FFMPEG)) { console.error('Run: npm install'); process.exit(1); }
  if (!existsSync(INPUT)) { console.error(`Input not found: ${INPUT}`); process.exit(1); }

  await mkdir(WEB, { recursive: true });

  console.log(`\n▸ Processing ${path.relative(ROOT, INPUT)}`);
  log('source:', mb((await stat(INPUT)).size));

  // ---- playback build: the light one -------------------------------------
  const playOut = path.join(WEB, `${NAME}-play.mp4`);
  await ff(encode(playOut, GOP_PLAY), 'playback mp4 (normal GOP)');
  log('→', path.relative(ROOT, playOut), mb((await stat(playOut)).size));

  // ---- scrub build: dense keyframes, roughly double ------------------------
  const scrubOut = path.join(WEB, `${NAME}-scrub.mp4`);
  await ff(encode(scrubOut, GOP_SCRUB), 'scrub mp4 (dense GOP)');
  log('→', path.relative(ROOT, scrubOut), mb((await stat(scrubOut)).size));

  // ---- poster -------------------------------------------------------------
  const poster = path.join(WEB, `${NAME}-poster.jpg`);
  await ff(['-i', INPUT, '-frames:v', '1', '-q:v', '4', '-vf', SCALE, poster],
    'poster frame');

  // ---- last frame: production tool, not web-served -------------------------
  const lastFrame = path.join(ASSETS, `${NAME}-lastframe.png`);
  await ff(['-sseof', '-0.1', '-i', INPUT, '-frames:v', '1', '-q:v', '1',
            '-update', '1', lastFrame], 'last frame (seed for next clip)');
  log('→', path.relative(ROOT, lastFrame), '— init image for the next room');

  // Clean up output from earlier versions of this script, so stale 40 MB
  // frame directories don't linger and get deployed.
  await rm(path.join(ASSETS, 'frames'), { recursive: true, force: true });
  for (const old of [`${NAME}-play.mp4`, `${NAME}-scrub.mp4`, `${NAME}-scrub.webm`,
                     `${NAME}-poster.jpg`]) {
    await rm(path.join(ASSETS, old), { force: true });
  }

  console.log('\n✓ Done.\n');
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1); });
