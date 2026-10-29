// scripts/cleanup-render.js
// POST-RENDER ARTIFACT HYGIENE (P5.0, hardened P7.0) — the png-sequence
// mediatype leaves every frame on disk (400MB+ per reel), which is redundant
// once a delivery MP4 exists. This step is wired into render-batch.js AFTER
// the render loop, and is also runnable standalone:
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
//      directory — is deleted. P7.0 NON-DESTRUCTIVE SUPERSEDE: an older
//      MP4 in the same leaf is NEVER unlinked — it is MOVED to
//      renders/archive/<date>/<batch>/<leaf-rel-path>/<name>-superseded-<timestamp>.mp4
//      (merge-safe names) and the relocation is appended to
//      archive/retire-log.json. poster-settled.png is never deleted.
//   3. STORAGE BUDGET LAW (P7.0): ≤ 20.0 MB PER DELIVERABLE LEAF
//      (e.g. living-20s.mp4 + poster-settled.png). The parent batch folder
//      is explicitly EXEMPT — batch/scope totals are informational only.
//
// Fail-closed: never walks outside the scoped root, only ever prunes
// frame_*.png names, never deletes (only archives) MP4s, never deletes
// poster-settled.png, never walks into renders/archive/.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBatchDate } = require('./lib/batch-date');
const { resolveBatchContext } = require('./lib/batch-context');
const { archiveSupersededMp4 } = require('./lib/supersede-archive');

const ROOT = process.cwd();
const BUDGET_MB = 20; // Storage Budget Law: PER DELIVERABLE LEAF (P7.0). Parent batch exempt.

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

// ── P7.0 NON-DESTRUCTIVE SUPERSEDE ARCHIVAL ─────────────────────────────
// Implementation lives in scripts/lib/supersede-archive.js (shared with
// render-reels' pre-render archiving — one log, one naming scheme): the
// destination mirrors the leaf's renders/-relative path under renders/archive/,
// the file gains a -superseded-<timestamp> suffix, and the relocation is
// appended to archive/retire-log.json.
const archiveSuperseded = (leaf, fileName) =>
  archiveSupersededMp4(ROOT, leaf, fileName, {
    trigger: 'cleanup-render (non-destructive supersede archival — Storage Budget Law)',
  });

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
      // renders/archive/ holds retired MP4s — a separate leaf namespace that
      // must NEVER be re-cleaned, re-postered, or budget-checked.
      if (e.isDirectory() && e.name !== 'archive') visit(path.join(dir, e.name));
    }
  };
  visit(root);
  return leaves;
}

const leaves = leafDirs(scope);

let prunedFiles = 0, prunedBytes = 0;
const leafVerdicts = [];

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

  // P7.0: superseded MP4s are ARCHIVED, never deleted — only the newest
  // render survives in the leaf (mirrored under renders/archive/…).
  const olderMp4s = mp4s.slice(1);
  const archivedTo = [];
  for (const old of olderMp4s) {
    const sz = fs.statSync(path.join(leaf, old.f)).size;
    const dest = archiveSuperseded(leaf, old.f);
    if (dest) { archivedTo.push(dest); prunedBytes += sz; }
  }
  prunedFiles += archivedTo.length;

  // 2. Prune redundant frames; the newest MP4 and poster-settled.png always survive.
  const prune = (dir) => {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (FRAME_RE.test(n)) {
        const sz = fs.statSync(p).size;
        fs.unlinkSync(p);
        prunedBytes += sz; prunedFiles++;
      } else if (fs.statSync(p).isDirectory()) {
        prune(p);
        if (!fs.readdirSync(p).length) fs.rmdirSync(p);
      }
    }
  };
  for (const n of bareFrames) {
    const p = path.join(leaf, n);
    const sz = fs.statSync(p).size;
    fs.unlinkSync(p);
    prunedBytes += sz; prunedFiles++;
  }
  for (const fd of frameDirs) {
    prune(fd);
    if (fs.existsSync(fd) && !fs.readdirSync(fd).length) fs.rmdirSync(fd);
  }

  // 3. Storage Budget Law — verdict PER DELIVERABLE LEAF (parent exempt).
  const leafMb = dirSize(leaf) / 1048576;
  leafVerdicts.push({ leaf: rel(leaf), mb: leafMb, over: leafMb > BUDGET_MB });
  console.log(`✓ ${rel(leaf)} — mp4 kept: ${mp4s.length ? mp4s[0].f : '(none)'}${archivedTo.length ? ` · older mp4(s) ARCHIVED (${archivedTo.length})` : olderMp4s.length ? ' · older mp4(s) kept (cannot map to archive)' : ''}, poster=${posterSource || 'skipped'}, artifacts pruned: ${prunedFiles} total, leaf ${leafMb.toFixed(2)}/${BUDGET_MB} MB ${leafMb > BUDGET_MB ? '— ✗ OVER' : 'GREEN'}`);
}

// 4. Budget verdicts. Per-leaf is LAW (exit 1 on any over-budget leaf); the
//    batch/scope totals are informational only — parent folders are exempt
//    and renders/archive/ growth is the non-destructive archival cost.
const overLeaves = leafVerdicts.filter((v) => v.over);
if (leafVerdicts.length) {
  console.log(`\n◆ cleanup-render: leaf budget (≤ ${BUDGET_MB} MB per deliverable leaf): ${overLeaves.length ? 'OVER' : 'GREEN'}`);
  for (const v of leafVerdicts) console.log(`   ${v.over ? '✗' : '·'} ${v.leaf} — ${v.mb.toFixed(2)} MB`);
} else {
  console.log(`\n◆ cleanup-render: no deliverable leaves found (nothing to budget).`);
}
const total = dirSize(scope);
const mb = total / 1048576;
console.log(`◇ informational — ${rel(scope)} total footprint ${mb.toFixed(2)} MB (parent/scope totals exempt from the per-leaf law; renders/ ≈ steady-state under the archiving policy).`);
console.log(`◇ pruned ${prunedFiles} artifact(s), ${(prunedBytes / 1048576).toFixed(2)} MB reclaimed this run.`);
process.exit(overLeaves.length ? 1 : 0);
