// scripts/lib/supersede-archive.js
// P7.0 NON-DESTRUCTIVE SUPERSEDE ARCHIVAL — the one implementation both MP4
// lanes consume. A superseded reel deliverable is NEVER unlinked:
//   renders/<date>/<batch>/<slug>/<name>.mp4
//     → renders/archive/<date>/<batch>/<slug>/<name>-superseded-<timestamp>.mp4
// and the relocation is appended to archive/retire-log.json (kind:
// "superseded-reel"). Merge-safe: existing archive names are never
// overwritten — a numeric -2/-3 disambiguator is appended instead.
const fs = require('fs');
const path = require('path');
const { appendRetireLog, archiveTimestamp } = require('./retire-log');

const relFromRoot = (ROOT, p) => path.relative(ROOT, p).split(path.sep).join('/');

/**
 * Archive one superseded MP4 (rename, never unlink).
 * @param {string} ROOT    project root (absolute)
 * @param {string} leaf    absolute dir that currently holds the MP4
 * @param {string} fileName mp4 filename inside leaf
 * @param {{trigger?: string, log?: (message: string) => void}} [opts]
 * @returns {string|null} archive destination (project-relative), or null when
 *   the leaf cannot be mapped into the renders/<date>/ archive namespace —
 *   in that case the MP4 is intentionally KEPT in place (never silently lost).
 */
function archiveSupersededMp4(ROOT, leaf, fileName, opts = {}) {
  const fromAbs = path.join(leaf, fileName);
  const leafRelSegs = relFromRoot(ROOT, leaf).split('/');
  if (leafRelSegs[0] !== 'renders' || leafRelSegs.length < 3) {
    (opts.log || console.warn)(`   ⚠ cannot map ${relFromRoot(ROOT, leaf)} into renders/archive/ — superseded MP4 "${fileName}" KEPT in place.`);
    return null;
  }
  const dateSeg = leafRelSegs.find((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)) || 'unknown-date';
  const destDir = path.join(ROOT, 'renders', 'archive', ...leafRelSegs.slice(1));
  fs.mkdirSync(destDir, { recursive: true });
  const base = fileName.replace(/\.mp4$/i, '').replace(/-superseded-.*$/i, '');
  const stem = `${base}-superseded-${archiveTimestamp()}`;
  let toAbs = path.join(destDir, `${stem}.mp4`);
  for (let n = 2; fs.existsSync(toAbs); n++) toAbs = path.join(destDir, `${stem}-${n}.mp4`);
  fs.renameSync(fromAbs, toAbs);
  appendRetireLog({
    at: new Date().toISOString(),
    date: dateSeg,
    kind: 'superseded-reel',
    from: relFromRoot(ROOT, fromAbs),
    to: relFromRoot(ROOT, toAbs),
    moved: 1,
    skipped: 0,
    trigger: opts.trigger || 'supersede archival (non-destructive — Storage Budget Law)',
  });
  (opts.log || console.log)(`   ↳ archived supersede: ${relFromRoot(ROOT, fromAbs)} → ${relFromRoot(ROOT, toAbs)}`);
  return relFromRoot(ROOT, toAbs);
}

module.exports = { archiveSupersededMp4 };
