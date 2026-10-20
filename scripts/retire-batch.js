// scripts/retire-batch.js
// Batch retirement for the HyperFrames daily production pipeline.
//
// Stale daily composition batches (compositions/YYYY-MM-DD/ for dates other
// than the target date) become permanent lint blockers the moment the asset
// pool changes, because their <img> paths reference photos that no longer
// exist. This script retires them deterministically:
//
//   1. Moves every compositions/<DATE>/ folder whose date !== target date to
//      archive/stale-drafts/<DATE>/. Parent directories are created first.
//      Merging is non-destructive: files that already exist in the archive
//      are NEVER overwritten (skipped with a warning).
//   2. Strips now-stale <div ... data-composition-src="compositions/<DATE>/...">
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
const INDEX_PATH = path.join(ROOT, 'index.html');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── TARGET DATE ─────────────────────────────────────────────────────────
// Local calendar day by default (see lib/batch-date.js). The --date flag is
// an OPTIONAL override for targeting a specific batch — never required.
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { date: target, basis } = resolveBatchDate(process.argv.slice(2));

logResolved({ date: target, basis }, 'Batch retirement');

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
let totalMoved = 0;
let totalSkipped = 0;

if (fs.existsSync(COMPOSITIONS_DIR)) {
  const batchDirs = fs.readdirSync(COMPOSITIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && DATE_RE.test(e.name) && e.name !== target)
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  for (const date of batchDirs) {
    const srcDir = path.join(COMPOSITIONS_DIR, date);
    const destDir = path.join(ARCHIVE_DIR, date);
    console.log(`→ retiring compositions/${date}/ → archive/stale-drafts/${date}/`);
    const { moved, skipped } = mergeMoveFolder(srcDir, destDir);
    totalMoved += moved;
    totalSkipped += skipped;
    retiredDates.push(date);
    console.log(`  ✓ ${moved} file(s) moved${skipped ? `, ${skipped} skipped` : ''}`);
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
console.log(`   files moved to archive/stale-drafts/: ${totalMoved}${totalSkipped ? ` (${totalSkipped} skipped, archive preserved)` : ''}`);
console.log(`   index.html stale router lines removed: ${indexLinesRemoved}`);
console.log('   renders/ and existing archive content: untouched');

if (retiredDates.length === 0 && indexLinesRemoved === 0) {
  console.log('◇ Nothing to retire — compositions/ is already clean for the target date.');
}
