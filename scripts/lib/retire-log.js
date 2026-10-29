// scripts/lib/retire-log.js
// Shared append-only retire audit log — archive/retire-log.json.
// EVERY non-destructive relocation in the pipeline appends one record here:
//   retire-batch.js      (date archival, kind: stale-drafts | unshipped)
//   cleanup-render.js    (supersede archival, kind: superseded-reel)
//   render-reels.js      (pre-render supersede archival, kind: superseded-reel)
//
// Record shape (additive per kind, all fields deterministic):
//   { at, date, kind, from, to, moved, skipped, trigger }
const fs = require('fs');
const path = require('path');

const RETIRE_LOG = path.join(process.cwd(), 'archive', 'retire-log.json');

/** Append one record to archive/retire-log.json (merge-safe, fail-closed on
 *  corrupt history: a broken log is set aside as *.corrupt-<ts>.json and a
 *  fresh log starts — prior audit prose is preserved on disk, never silent). */
function appendRetireLog(record) {
  fs.mkdirSync(path.dirname(RETIRE_LOG), { recursive: true });
  let log = [];
  if (fs.existsSync(RETIRE_LOG)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(RETIRE_LOG, 'utf8'));
      if (Array.isArray(parsed)) log = parsed;
      else throw new Error('not an array');
    } catch (err) {
      const aside = RETIRE_LOG.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
      fs.renameSync(RETIRE_LOG, aside);
      console.warn(`   ⚠ retire-log.json unreadable (${err.message}) — set aside as ${path.basename(aside)}, starting a fresh log.`);
      log = [];
    }
  }
  log.push(record);
  fs.writeFileSync(RETIRE_LOG, JSON.stringify(log, null, 2) + '\n');
  return log.length;
}

/** Filename-safe ISO timestamp for superseded-archive names:
 *  2026-10-29T14-05-03-123Z (segment-safe on Windows, sorts chronologically). */
function archiveTimestamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

module.exports = { RETIRE_LOG, appendRetireLog, archiveTimestamp };
