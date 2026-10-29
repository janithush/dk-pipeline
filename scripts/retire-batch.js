// scripts/retire-batch.js
// Batch retirement for the HyperFrames daily production pipeline.
//
// Stale daily composition batches (compositions/YYYY-MM-DD/ for dates other
// than the target date) become permanent lint blockers the moment the asset
// pool changes, because their <img> paths reference photos that no longer
// exist. This script retires them deterministically:
//
//   1. Moves every compositions/<DATE>/ folder whose date !== target date to
//      a SHIPPED-AWARE archive destination (§H.3 — new-day rollover never
//      asks the operator anything):
//        · renders/<DATE>/ contains output  → archive/stale-drafts/<DATE>/
//          (that day WAS produced — immutability of approved work)
//        · renders/<DATE>/ absent or empty  → archive/unshipped/<DATE>/
//          (never rendered — work abandoned mid-session at rollover)
//      Parent directories are created first. Merging is non-destructive:
//      files that already exist in the archive are NEVER overwritten.
//   2. Appends every move to archive/retire-log.json (deterministic audit).
//   3. Strips now-stale <div ... data-composition-src="compositions/<DATE>/...">
//      lines for retired dates from index.html so lint stops tracing missing
//      files. The root element (class="hyperframes-root" data-width="1080"
//      data-height="1920") is never touched.
//
// NEVER touches: renders/ (any content), existing archive files, assets/,
// shared/, or any composition of the target date.
//
// Usage:
//   node scripts/retire-batch.js                    # target = LOCAL today (YYYY-MM-DD)
//   node scripts/retire-batch.js --date 2026-10-20  # explicit target date to KEEP

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const COMPOSITIONS_DIR = path.join(ROOT, 'compositions');
const ARCHIVE_DIR = path.join(ROOT, 'archive', 'stale-drafts');
const ARCHIVE_UNSHIPPED_DIR = path.join(ROOT, 'archive', 'unshipped');
// P7.0: the audit log is now the SHARED lib (also consumed by cleanup-render
// supersede archival + render-reels pre-render archival — one log, one format).
const { appendRetireLog } = require('./lib/retire-log');
const RETIRE_LOG = path.join(ROOT, 'archive', 'retire-log.json');
const INDEX_PATH = path.join(ROOT, 'index.html');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── TARGET DATE ─────────────────────────────────────────────────────────
// Local calendar day by default (see lib/batch-date.js). The --date flag is
// an OPTIONAL override for targeting a specific batch — never required.
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { date: target, basis } = resolveBatchDate(process.argv.slice(2));

logResolved({ date: target, basis }, 'Batch retirement');

// ── RETIRE AUDIT LOG ────────────────────────────────────────────────────
// Append-only audit moved to scripts/lib/retire-log.js (P7.0 shared helper;
// identical record shape + same corrupt-log set-aside semantics).

// A date counts as SHIPPED iff renders/<DATE>/ exists and holds at least one
// file of any kind (the renderer writes frame_*.png trees — any remnant of a
// produced run makes the day immutable history).
function hasAnyFile(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile()) return true;
    if (e.isDirectory() && hasAnyFile(p)) return true;
  }
  return false;
}
function dateShipped(date) {
  const rdir = path.join(ROOT, 'renders', date);
  return fs.existsSync(rdir) && hasAnyFile(rdir);
}

// ── 1. RETIRE STALE COMPOSITION FOLDERS ─────────────────────────────────
// Merge-aware move: never overwrites anything already in the archive.
function mergeMoveFolder(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true }); // atomic & safe: create target first
  let moved = 0;
  let skipped = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (fs.existsSync(dest)) {
      console.warn(`   ↷ skipped (already in archive): ${entry.name}`);
      skipped++;
      continue;
    }
    try {
      fs.renameSync(src, dest); // same volume → atomic
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      fs.cpSync(src, dest, { recursive: true }); // cross-volume fallback
      fs.rmSync(src, { recursive: true, force: true });
    }
    moved++;
  }
  if (fs.readdirSync(srcDir).length === 0) fs.rmdirSync(srcDir);
  else console.warn(`   ⚠ source folder not empty after move — left in place: ${srcDir}`);
  return { moved, skipped };
}

const retiredDates = [];
const retiredShipped = [];
const retiredUnshipped = [];
let totalMoved = 0;
let totalSkipped = 0;

if (fs.existsSync(COMPOSITIONS_DIR)) {
  const batchDirs = fs.readdirSync(COMPOSITIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && DATE_RE.test(e.name) && e.name !== target)
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  for (const date of batchDirs) {
    const shipped = dateShipped(date);
    const kind = shipped ? 'stale-drafts' : 'unshipped';
    const archiveRoot = shipped ? ARCHIVE_DIR : ARCHIVE_UNSHIPPED_DIR;
    const srcDir = path.join(COMPOSITIONS_DIR, date);
    const destDir = path.join(archiveRoot, date);
    console.log(`→ retiring compositions/${date}/ → archive/${kind}/${date}/  (${shipped ? 'SHIPPED — renders exist' : 'UNSHIPPED — never rendered'})`);
    const { moved, skipped } = mergeMoveFolder(srcDir, destDir);
    totalMoved += moved;
    totalSkipped += skipped;
    retiredDates.push(date);
    (shipped ? retiredShipped : retiredUnshipped).push(date);
    console.log(`  ✓ ${moved} file(s) moved${skipped ? `, ${skipped} skipped` : ''}`);
    appendRetireLog({
      at: new Date().toISOString(),
      date, kind,
      from: `compositions/${date}/`,
      to: `archive/${kind}/${date}/`,
      moved, skipped,
      trigger: 'retire-batch (target date ' + target + ')',
    });
  }
}

// ── 2. CLEAN STALE ROUTER ENTRIES IN index.html ─────────────────────────
let indexLinesRemoved = 0;
if (fs.existsSync(INDEX_PATH)) {
  const before = fs.readFileSync(INDEX_PATH, 'utf8');
  const lines = before.split(/\r?\n/);
  const after = lines.filter((line) => {
    const m = line.match(/data-composition-src="compositions\/([^/"]+)\//);
    if (!m || !DATE_RE.test(m[1])) return true; // keep: not a dated entry
    if (m[1] === target) return true;           // keep: today's entry
    indexLinesRemoved++;
    return false;                               // drop: retired/stale date
  }).join('\n');
  if (indexLinesRemoved > 0) {
    fs.writeFileSync(INDEX_PATH, after);
    console.log(`→ index.html: removed ${indexLinesRemoved} stale data-composition-src line(s) for retired date(s)`);
  }
}

// ── 3. SUMMARY ──────────────────────────────────────────────────────────
console.log('\n◆ Retirement summary');
console.log(`   target (kept): compositions/${target}/ (if present)`);
console.log(`   retired batch folders: ${retiredDates.length ? retiredDates.join(', ') : 'none'}`);
if (retiredShipped.length) console.log(`     shipped → archive/stale-drafts/: ${retiredShipped.join(', ')} (renders preserved in place)`);
if (retiredUnshipped.length) console.log(`     unshipped → archive/unshipped/: ${retiredUnshipped.join(', ')} (never rendered at rollover)`);
console.log(`   files moved: ${totalMoved}${totalSkipped ? ` (${totalSkipped} skipped, archive preserved)` : ''}`);
console.log(`   index.html stale router lines removed: ${indexLinesRemoved}`);
console.log(`   audit: ${totalMoved > 0 ? 'archive/retire-log.json updated' : 'archive/retire-log.json untouched (nothing moved)'}`);
console.log('   renders/ and existing archive content: untouched');

if (retiredDates.length === 0 && indexLinesRemoved === 0) {
  console.log('◇ Nothing to retire — compositions/ is already clean for the target date.');
}
