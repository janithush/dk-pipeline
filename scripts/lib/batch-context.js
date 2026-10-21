// scripts/lib/batch-context.js
// Intraday MULTI-BATCH (Model A) resolver for the dk-pipeline daily loop.
//
// Consumes scripts/lib/batch-date.js — date truth (local calendar day,
// --date > positional > DK_BATCH_DATE > today) stays single-purpose here;
// this module only answers "WHICH batch of that date".
//
// Layouts:
//   nested — compositions/<DATE>/batch-XX/batch-manifest.json
//            renders/<DATE>/<batch-XX>/<slug>/   (intrday batches, Model A)
//   flat   — compositions/<DATE>/batch-manifest.json
//            renders/<DATE>/<slug>/              (legacy immutable batch-01,
//                                                 e.g. the approved 2026-10-21)
//
// Batch identity rules (fail-closed, deterministic):
//   listBatches(dateDir)    — sorted batch-XX dirs; a date-level
//                             batch-manifest.json counts as slot `batch-01`
//                             (legacy flat tolerance), always folded in.
//   detectNextBatch(dateDir)— max(existing slots) + 1 (gaps never refilled);
//                             empty day -> batch-01; legacy flat only -> batch-02.
//   detectNextSlug(dateDir) — continuous INTRADAY numbering: scans
//                             story-(\d+).html at the date root AND inside every
//                             batch-XX/ subdir, returns max + 1 (story-01..03 in
//                             batch 1 => batch 2 starts at story-04).
//   resolveBatchContext()    — the full path context every gate/renderer uses.
//
// Active batch override order: explicit argument > --batch <id> flag >
// DK_BATCH_ID env > (default) highest-numbered batch dir, else legacy flat,
// else batch-01 of a fresh day.

const fs = require('fs');
const path = require('path');

const BATCH_RE = /^batch-(\d{2,})$/;
const FLAT_MANIFEST = 'batch-manifest.json';
const SLUG_RE = /^story-(\d+)\.html$/;

const batchNo = (name) => parseInt(BATCH_RE.exec(name)[1], 10);
const dateDirOf = (date, root = process.cwd()) => path.join(root, 'compositions', date);

// Raw batch-XX directory names (NO legacy fold-in), ascending.
function rawBatchDirs(dateDir) {
  if (!fs.existsSync(dateDir)) return [];
  return fs.readdirSync(dateDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && BATCH_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => batchNo(a) - batchNo(b));
}

function hasFlatManifest(dateDir) {
  return fs.existsSync(path.join(dateDir, FLAT_MANIFEST));
}

/** Sorted batch ids present for a date dir. A date-level batch-manifest.json
 *  is the legacy flat batch-01 slot and is folded in so slot 01 is never lost
 *  when nested batch-XX dirs already coexist with it. */
function listBatches(dateDir) {
  const dirs = rawBatchDirs(dateDir);
  if (hasFlatManifest(dateDir) && !dirs.includes('batch-01')) return ['batch-01', ...dirs];
  return dirs;
}

/** Next free batch id for this date dir (pure computation — creates nothing):
 *  - legacy flat manifest, no batch-XX subdirs  -> batch-02 (flat holds slot 01)
 *  - no batches at all                          -> batch-01
 *  - otherwise                                  -> batch-<max+1> (padStart 2) */
function detectNextBatch(dateDir) {
  const max = listBatches(dateDir).reduce((m, b) => Math.max(m, batchNo(b)), 0);
  return `batch-${String(max + 1).padStart(2, '0')}`;
}

/** Next continuous intraday slug across the date root AND every batch-XX
 *  subdir (e.g. story-01..03 exist => `story-04`). */
function detectNextSlug(dateDir) {
  let max = 0;
  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (BATCH_RE.test(entry.name)) scan(path.join(dir, entry.name));
      } else {
        const m = SLUG_RE.exec(entry.name);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
  };
  scan(dateDir);
  return `story-${String(max + 1).padStart(2, '0')}`;
}

/** Resolve the full context of the batch this run operates on.
 *  Returns { date, batch, layout, dateDir, batchDir, manifestPath, renderRoot }.
 *  (renderRoot is a forward-slash RELATIVE path — manifest `output` fields must
 *  live underneath it; render-batch.js enforces that as a hard containment gate.) */
function resolveBatchContext(date, batchOverride) {
  const dateDir = dateDirOf(date);

  // Override: explicit arg > --batch flag > DK_BATCH_ID env.
  let override = batchOverride;
  if (override === undefined || override === null) {
    const flagIdx = process.argv.indexOf('--batch');
    if (flagIdx !== -1) {
      override = process.argv[flagIdx + 1];
      if (!override) {
        console.error('✗ --batch requires a value (e.g. --batch batch-02)');
        process.exit(1);
      }
    } else {
      override = process.env.DK_BATCH_ID || null;
    }
  }

  const dirs = rawBatchDirs(dateDir);
  const flat = hasFlatManifest(dateDir);

  let batch;
  let layout;
  if (override) {
    if (!BATCH_RE.test(String(override))) {
      console.error(`✗ invalid batch id "${override}" — expected batch-NN (e.g. batch-02)`);
      process.exit(1);
    }
    batch = String(override);
    layout = dirs.includes(batch) ? 'nested'
      : (batch === 'batch-01' && flat && !dirs.includes('batch-01')) ? 'flat'
      : 'nested'; // manifest existence is enforced fail-closed by the consumers
  } else if (dirs.length) {
    batch = dirs[dirs.length - 1];   // default: highest-numbered batch dir
    layout = 'nested';
  } else if (flat) {
    batch = 'batch-01';              // legacy flat slot
    layout = 'flat';
  } else {
    batch = 'batch-01';              // fresh day — nothing exists yet
    layout = 'nested';
  }

  const batchDir = layout === 'flat' ? dateDir : path.join(dateDir, batch);
  const manifestPath = path.join(batchDir, FLAT_MANIFEST);
  const renderRoot = layout === 'flat' ? `renders/${date}` : `renders/${date}/${batch}`;

  return { date, batch, layout, dateDir, batchDir, manifestPath, renderRoot };
}

/** Manifest schema validation shared by render/photo-fit/router-sync.
 *  Returns null when valid, otherwise a ready-to-print error line.
 *    nested (Schema v2): { date, batch, posts } — date + batch must match ctx.
 *    flat   (Schema v1): { batch: <DATE>, posts } — batch must hold the date. */
function manifestSchemaError(ctx, manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return '✗ manifest must be a JSON object';
  }
  if (!Array.isArray(manifest.posts)) {
    return '✗ manifest.posts must be an array (batch-manifest contract)';
  }
  if (ctx.layout === 'nested') {
    if (manifest.date !== ctx.date || manifest.batch !== ctx.batch) {
      return `✗ manifest Schema v2 mismatch: manifest {date:"${manifest.date}", batch:"${manifest.batch}"} `
        + `≠ resolved context {date:"${ctx.date}", batch:"${ctx.batch}"} — refusing to act on a foreign manifest`;
    }
  } else if (manifest.batch !== ctx.date) {
    return `✗ manifest.batch "${manifest.batch}" ≠ resolved batch date "${ctx.date}" — refusing to act on a foreign manifest`;
  }
  return null;
}

module.exports = {
  listBatches,
  detectNextBatch,
  detectNextSlug,
  resolveBatchContext,
  manifestSchemaError,
  dateDirOf,
  BATCH_RE,
  FLAT_MANIFEST,
};

// ── DRY-RUN CLI ─────────────────────────────────────────────────────────
//   node scripts/lib/batch-context.js [--date YYYY-MM-DD] [--batch batch-NN]
// Read-only report: never creates or modifies anything.
if (require.main === module) {
  const { resolveBatchDate, logResolved } = require('./batch-date');
  const { date, basis } = resolveBatchDate(process.argv.slice(2));
  logResolved({ date, basis }, 'Batch context dry-run');

  const ctx = resolveBatchContext(date, undefined);
  const nextBatch = detectNextBatch(ctx.dateDir);
  const nextSlug = detectNextSlug(ctx.dateDir);
  const present = listBatches(ctx.dateDir);
  const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join('/');
  const maxSlug = (() => {
    const next = detectNextSlug(ctx.dateDir);
    const m = /^story-(\d+)$/.exec(next);
    return m ? String(Math.max(0, parseInt(m[1], 10) - 1)).padStart(2, '0') : '00';
  })();

  console.log('');
  console.log(`  date:            ${date}`);
  console.log(`  batches present: ${present.length ? present.join(', ') : '(none)'}${ctx.layout === 'flat' ? '  [flat manifest = legacy batch-01, immutable]' : ''}`);
  console.log(`  active batch:    ${ctx.batch}  (layout: ${ctx.layout}${ctx.layout === 'flat' ? ', legacy flat' : ''})`);
  console.log(`  manifestPath:    ${rel(ctx.manifestPath)}${require('fs').existsSync(ctx.manifestPath) ? '' : '  (does not exist)'}`);
  console.log(`  renderRoot:      ${ctx.renderRoot}/`);
  console.log(`  detectNextBatch → ${nextBatch}`);
  console.log(`  detectNextSlug  → ${nextSlug}  (highest slug today: story-${maxSlug})`);
}
