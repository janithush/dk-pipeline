// scripts/cleanup-render.js
// POST-RENDER ARTIFACT HYGIENE (P5.0) — the png-sequence mediatype leaves
// every frame on disk (400MB+ per reel), which is redundant once a
// delivery MP4 exists. This step is wired into render-batch.js AFTER the
// render loop, and is also runnable standalone:
//
//   node scripts/cleanup-render.js [YYYY-MM-DD | --all | <render dir>]
//     default      → the ACTIVE batch's render root (batch-context rules)
//     --all        → every dated directory under renders/
//
// Per leaf render directory (a directory containing frame_*.png or MP4s):
//   1. poster-settled.png is (re)derived — preferred source is the NEWEST
//      MP4's final settled frame (ffmpeg single-frame extract); a
//      static-only directory (png-sequence with no MP4) copies its
//      newest frame_000000N.png instead. An existing poster-settled.png
//      is always refreshed from the newest available source.
//   2. every other frame_*.png — and any emptied nested frame-sequence
//      directory — is deleted. Only the NEWEST MP4 per leaf survives
//      (the final render); superseded older MP4s in the same leaf are
//      deleted. poster-settled.png is never deleted.
//   3. prints a per-dir line and a total footprint verdict against the
//      15MB budget.
//
// Fail-closed: never walks outside the scoped root, only ever deletes
// frame_*.png names and non-newest MP4s, never deletes poster-settled.png.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBatchDate } = require('./lib/batch-date');
const { resolveBatchContext } = require('./lib/batch-context');

const ROOT = process.cwd();
const BUDGET_MB = 15;

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');

// ── scope resolution ────────────────────────────────────────────────────
let scope;
const arg = argv.find((a) => a !== '--all');
if (arg) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    scope = path.join(ROOT, 'renders', arg);
  } else {
    scope = path.isAbsolute(arg) ? arg : path.join(ROOT, arg);
    if (!fs.existsSync(scope)) { console.error(`✗ cleanup-render: scope not found: ${arg}`); process.exit(1); }
  }
} else if (ALL) {
  scope = path.join(ROOT, 'renders');
} else {
  // Active batch via batch-context (same date rules as render-batch).
  const { date } = resolveBatchDate(argv);
  const ctx = resolveBatchContext(date, undefined);
  scope = path.join(ROOT, ...ctx.renderRoot.split('/'));
}

if (!fs.existsSync(scope)) {
  console.log(`◇ cleanup-render: scope does not exist yet (${path.relative(ROOT, scope)}) — nothing to clean.`);
  process.exit(0);
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// ── helpers ─────────────────────────────────────────────────────────────
const FRAME_RE = /^frame[-_]\d+\.png$/i;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const dirSize = (d) => (fs.existsSync(d) ? walk(d).reduce((n, p) => n + fs.statSync(p).size, 0) : 0);

// Leaf directories: any directory that directly contains frame files,
// frame-sequence subdirectories, or MP4s.
function leafDirs(root) {
  const leaves = [];
  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const hasFrames = files.some((f) => FRAME_RE.test(f));
    const hasMp4 = files.some((f) => /\.mp4$/i.test(f));
    if (hasFrames || hasMp4) { leaves.push(dir); return; }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'archive') visit(path.join(dir, e.name));
    }
  };
  visit(root);
  return leaves;
}

const leaves = leafDirs(scope);

let prunedFiles = 0, prunedBytes = 0;

for (const leaf of leaves) {
  const entries = fs.readdirSync(leaf, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const mp4s = files.filter((f) => /\.mp4$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(leaf, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const frameDirs = entries.filter((e) => e.isDirectory() &&
    fs.readdirSync(path.join(leaf, e.name)).some((n) => FRAME_RE.test(n)))
    .map((e) => path.join(leaf, e.name));
  const bareFrames = files.filter((f) => FRAME_RE.test(f));

  if (!mp4s.length && !frameDirs.length && !bareFrames.length) continue;

  // 1. poster-settled.png — newest MP4's final frame, else newest frame.
  const posterPath = path.join(leaf, 'poster-settled.png');
  let posterSource = null;
  if (mp4s.length) {
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.5',
        '-i', path.join(leaf, mp4s[0].f), '-update', '1', '-frames:v', '1', posterPath],
        { stdio: 'pipe' });
      posterSource = 'mp4-final-frame';
    } catch (err) {
      console.warn(`⚠ ffmpeg poster extract failed for ${rel(leaf)} (${err.message}) — falling back to newest frame file.`);
    }
  }
  if (!posterSource) {
    const candidates = [];
    for (const fd of frameDirs) {
      for (const n of fs.readdirSync(fd)) {
        if (FRAME_RE.test(n)) candidates.push({ dir: fd, n, t: fs.statSync(path.join(fd, n)).mtimeMs });
      }
    }
    for (const n of bareFrames) candidates.push({ dir: leaf, n, t: fs.statSync(path.join(leaf, n)).mtimeMs });
    candidates.sort((a, b) => b.t - a.t);
    if (candidates.length) {
      fs.copyFileSync(path.join(candidates[0].dir, candidates[0].n), posterPath);
      posterSource = 'newest-frame-file';
    }
  }

  // Superseded MP4s in this leaf: only the newest render survives.
  const olderMp4s = mp4s.slice(1);
  for (const old of olderMp4s) {
    const p = path.join(leaf, old.f);
    prunedBytes += fs.statSync(p).size; prunedFiles++;
    fs.unlinkSync(p);
  }

  // 2. Prune redundant frames; the newest MP4 and poster-settled.png always survive.
  const prune = (dir) => {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (FRAME_RE.test(n)) {
        prunedBytes += fs.statSync(p).size; prunedFiles++;
        fs.unlinkSync(p);
      } else if (fs.statSync(p).isDirectory()) {
        prune(p);
        if (!fs.readdirSync(p).length) fs.rmdirSync(p);
      }
    }
  };
  // Bare frames in the leaf itself (skip kept mp4/poster names).
  for (const n of bareFrames) {
    const p = path.join(leaf, n);
    prunedBytes += fs.statSync(p).size; prunedFiles++;
    fs.unlinkSync(p);
  }
  for (const fd of frameDirs) {
    prune(fd);
    if (fs.existsSync(fd) && !fs.readdirSync(fd).length) fs.rmdirSync(fd);
  }

  console.log(`✓ ${rel(leaf)} — mp4 kept: ${mp4s.length ? mp4s[0].f : '(none)'}${olderMp4s.length ? ` · older mp4s deleted: ${olderMp4s.length} (${olderMp4s.map((m) => m.f).join(', ')})` : ''}, poster=${posterSource || 'skipped'}, artifacts pruned: ${prunedFiles} total`);
}

// 3. Footprint verdict.
const total = dirSize(scope);
const mb = total / 1048576;
const verdict = mb <= BUDGET_MB ? 'GREEN' : 'OVER BUDGET';
console.log(`\n◆ cleanup-render: renders footprint ${mb.toFixed(2)} / ${BUDGET_MB} MB — ${verdict}`);
process.exit(verdict === 'GREEN' ? 0 : 1);
