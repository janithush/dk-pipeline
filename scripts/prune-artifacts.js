// scripts/prune-artifacts.js
// P7.0 ARTIFACT STORAGE PRUNING — sweeps the unbounded HyperFrames
// intermediate/scratch artifacts outside the renders/ tree so local disk
// growth stays finite. Empirical driver: .hyperframes/artifacts/snapshots/
// reached 52.5 MB across 52 UUID-named dirs with NO pruning owner.
//
//   node scripts/prune-artifacts.js             # sweep relative to the ACTIVE batch date
//   node scripts/prune-artifacts.js --date 2026-10-26
//   node scripts/prune-artifacts.js --dry-run   # report only, delete nothing
//
// Policy (deterministic, batch-date-anchored):
//   .hyperframes/artifacts/snapshots/*   → pruned when mtime < midnight of the
//                                          batch date (UUID dirs embed no
//                                          date — mtime is the only truth)
//   .hyperframes/artifacts/frame-check-* → ALWAYS pruned (one-shot probe
//                                          scratch; verified-only value lives
//                                          in the frame verification report)
//   .hyperframes/artifacts/checks/*      → pruned when mtime < batch midnight
//   remaining empty dirs                 → removed
// NEVER touched: verify-contrast/ digest + attempt artifacts (ship
// certificates) and loudness/ digests (P7.0 audio certificates) — the audit
// trail is part of what ships.
//
// Runs AFTER ship (produce:prune or npm run artifacts:prune); idempotent.

const fs = require('fs');
const path = require('path');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');

const { date, basis } = resolveBatchDate(argv);
logResolved({ date, basis }, `Artifact prune${DRY ? ' (dry-run)' : ''}`);

// Retention floor: local midnight of the batch date.
const [y, m, d] = date.split('-').map(Number);
const cutoff = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();

const ARTIFACTS = path.join(ROOT, '.hyperframes', 'artifacts');
const CERT_DIRS = new Set(['verify-contrast', 'loudness']); // certificate digests never pruned

let removedFiles = 0, removedDirs = 0, freedBytes = 0;
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function removeEntry(p) {
  if (DRY) return true;
  if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
  else fs.unlinkSync(p);
  return true;
}

const sizeOfTree = (p) => {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    total += e.isDirectory() ? sizeOfTree(f) : fs.statSync(f).size;
  }
  return total;
};

if (!fs.existsSync(ARTIFACTS)) {
  console.log(`◇ prune-artifacts: ${rel(ARTIFACTS)} does not exist — nothing to prune.`);
  process.exit(0);
}

console.log(`◆ prune cutoff: mtime < ${date} 00:00 local (${new Date(cutoff).toLocaleString()})`);

// 1. snapshots/ — date-anchored pruning of every entry (dir or file).
const snapshots = path.join(ARTIFACTS, 'snapshots');
if (fs.existsSync(snapshots)) {
  let removed = 0, kept = 0;
  for (const e of fs.readdirSync(snapshots, { withFileTypes: true })) {
    const p = path.join(snapshots, e.name);
    const at = fs.statSync(p).mtimeMs;
    if (at < cutoff) {
      freedBytes += e.isDirectory() ? sizeOfTree(p) : fs.statSync(p).size;
      if (!DRY) { fs.rmSync(p, { recursive: true, force: true }); }
      removedDirs += e.isDirectory() ? 1 : 0;
      removedFiles += e.isDirectory() ? 0 : 1;
      removed++;
    } else kept++;
  }
  console.log(`   snapshots/: ${removed} pruned (older than cutoff), ${kept} kept — ${removed ? (freedBytes / 1048576).toFixed(2) : '0.00'} MB${DRY ? ' would be ' : ' '}freed so far`);
  // prune dirs that became empty
  if (!DRY) for (const e of fs.readdirSync(snapshots, { withFileTypes: true })) {
    const p = path.join(snapshots, e.name);
    if (e.isDirectory() && fs.readdirSync(p).length === 0) { fs.rmdirSync(p); removedDirs++; }
  }
} else {
  console.log('   snapshots/: absent — nothing to prune.');
}

// 2. frame-check-* scratch dirs — always prunable probe artifacts.
for (const e of fs.readdirSync(ARTIFACTS, { withFileTypes: true })) {
  if (/^frame-check/i.test(e.name) && e.isDirectory()) {
    const p = path.join(ARTIFACTS, e.name);
    freedBytes += sizeOfTree(p);
    if (!DRY) fs.rmSync(p, { recursive: true, force: true });
    removedDirs++;
    console.log(`   ${rel(p)}/: pruned (probe scratch — always prunable)`);
  }
}

// 3. checks/ — date-anchored (older than the batch date).
const checksDir = path.join(ARTIFACTS, 'checks');
if (fs.existsSync(checksDir)) {
  let removed = 0;
  for (const e of fs.readdirSync(checksDir, { withFileTypes: true })) {
    const p = path.join(checksDir, e.name);
    if (fs.statSync(p).mtimeMs < cutoff) {
      freedBytes += e.isDirectory() ? sizeOfTree(p) : fs.statSync(p).size;
      removeEntry(p);
      removedDirs += e.isDirectory() ? 1 : 0;
      removedFiles += e.isDirectory() ? 0 : 1;
      removed++;
    }
  }
  if (removed) console.log(`   checks/: ${removed} entry(ies) pruned (older than cutoff)`);
  else console.log('   checks/: nothing older than cutoff.');
} else {
  console.log('   checks/: absent — nothing to prune.');
}

// 4. Empty leftover dirs directly under artifacts/ (certificates preserved).
if (!DRY) for (const e of fs.readdirSync(ARTIFACTS, { withFileTypes: true })) {
  if (e.isDirectory() && !CERT_DIRS.has(e.name) && fs.readdirSync(path.join(ARTIFACTS, e.name)).length === 0) {
    fs.rmdirSync(path.join(ARTIFACTS, e.name));
  }
}

console.log(`\n◆ prune-artifacts${DRY ? ' (dry-run)' : ''}: ${removedFiles} file(s) + ${removedDirs} dir(s), ${(freedBytes / 1048576).toFixed(2)} MB freed${DRY ? ' (would be freed on a real run)' : ''}.`);
console.log('   certificate dirs preserved: verify-contrast/, loudness/');
