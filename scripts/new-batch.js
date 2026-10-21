// scripts/new-batch.js
// Intraday MULTI-BATCH scaffolder + router automation (Model A, §F.9).
//
// Modes:
//   node scripts/new-batch.js                 # scaffold the NEXT batch for the
//                                             #   resolved date (creates folder +
//                                             #   Schema-v2 manifest, validates router)
//   node scripts/new-batch.js --sync-router   # append the ACTIVE batch's manifest
//                                             #   posts to index.html (idempotent)
//   node scripts/new-batch.js --date ...      # date override (batch-date.js rules)
//   node scripts/new-batch.js --batch batch-NN# target batch for --sync-router
//
// Scaffolding always targets detectNextBatch(dateDir) (gaps never refilled;
// a legacy flat batch-manifest.json occupies slot batch-01, so the first
// intraday folder is batch-02). Slugs are CONTINUOUS intraday (detectNextSlug):
// story-01..03 in batch 1 => batch 2 starts at story-04 — that continuity is
// what keeps router ids (post-NN / dk-story-NN) unique across same-day batches.
//
// Router sync is SURGICAL: it only inserts <div data-composition-src> lines
// immediately before the #root closing </div>. Root attributes, comments, and
// every other byte (plus the file's existing EOL style) are preserved. It
// refuses to write when a manifest post's HTML file does not exist yet or when
// a generated id would collide with a differently-sourced line (non-continuous
// slugs) — fail-closed, zero silent failures.

const fs = require('fs');
const path = require('path');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const {
  listBatches,
  detectNextBatch,
  detectNextSlug,
  resolveBatchContext,
  manifestSchemaError,
} = require('./lib/batch-context');

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const SYNC_ONLY = argv.includes('--sync-router');

const { date, basis } = resolveBatchDate(argv);
logResolved({ date, basis }, SYNC_ONLY ? 'Router sync' : 'New batch scaffold');

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const die = (msg) => { console.error(msg); process.exit(1); };

// ── ROUTER AUTOMATION (surgical, idempotent) ────────────────────────────
// Returns { appended, skipped }. Writes index.html ONLY when new lines exist.
function syncRouter(ctx, manifest) {
  const indexPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) die(`✗ index.html not found: ${rel(indexPath)}`);

  const src = fs.readFileSync(indexPath, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';           // preserve file EOL
  const lines = src.split(/\r?\n/);

  // 1) #root opening div (may span attribute lines).
  const openIdx = lines.findIndex((l) => /<div[^>]*\bid="root"/i.test(l));
  if (openIdx === -1) die('✗ index.html: #root div not found — refusing to modify the router.');
  // 2) End of the root opening tag = first line (from the opening) ending with '>'.
  const start = lines[openIdx].trimEnd().endsWith('>') ? openIdx : openIdx + 1;
  let tagEnd = -1;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trimEnd().endsWith('>')) { tagEnd = i; break; }
  }
  if (tagEnd === -1) die('✗ index.html: #root opening tag never closes — refusing to modify the router.');
  // 3) Root closing div = first STANDALONE </div> after the opening tag
  //    (composition lines are self-contained `<div ...></div>` and never match).
  let closeIdx = -1;
  for (let i = tagEnd + 1; i < lines.length; i++) {
    if (lines[i].trim() === '</div>') { closeIdx = i; break; }
  }
  if (closeIdx === -1) die('✗ index.html: #root closing </div> not found — refusing to modify the router.');

  // 4) Indent from an existing router line (fallback: 4 spaces).
  const indent = (lines.find((l) => l.includes('data-composition-src=')) || '    <div').match(/^\s*/)[0];

  const prefix = rel(ctx.batchDir) + '/';
  const newLines = [];
  let skipped = 0;

  for (const post of manifest.posts) {
    const srcPath = String(post.html || '').replace(/\\/g, '/');
    if (!srcPath.startsWith(prefix)) {
      die(`✗ router sync: post "${post.slug}" html "${post.html}" is outside ${prefix} — refusing to route a foreign file.`);
    }
    if (!fs.existsSync(path.join(ROOT, ...srcPath.split('/')))) {
      die(`✗ router sync: composition not found: ${srcPath}\n   create the file first, then re-run --sync-router (fail-closed: a router line to a missing file breaks preflight).`);
    }
    if (src.includes(`data-composition-src="${srcPath}"`)) { skipped++; continue; }

    const slug = String(post.slug || '');
    const num = /(\d+)$/.exec(slug);
    const domId = `post-${num ? num[1] : slug.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const holder = lines.find((l) => l.includes(`id="${domId}"`));
    if (holder) {
      // Whose line holds this id? Same date = intraday continuity violation;
      // ANOTHER date = stale router entries that must be retired first.
      const holderSrc = /data-composition-src="([^"]+)"/.exec(holder);
      const holderDate = holderSrc && (/compositions\/(\d{4}-\d{2}-\d{2})\//.exec(holderSrc[1]) || [])[1];
      if (holderDate && holderDate !== ctx.date) {
        die(`✗ router sync: id "${domId}" is still held by ${holderDate}'s router line — stale entries must be retired FIRST.\n   run \`npm run retire:batch\` (archives non-${ctx.date} batches and strips their lines, §F.3), then re-run --sync-router.`);
      }
      die(`✗ router sync: id "${domId}" already exists for a DIFFERENT composition — intraday slugs must be CONTINUOUS (§F.9).\n   next free slug is ${detectNextSlug(ctx.dateDir)}; fix the manifest slug instead of reusing post ids.`);
    }
    newLines.push(`${indent}<div id="${domId}" data-composition-id="dk-${slug}" data-composition-src="${srcPath}"></div>`);
  }

  if (newLines.length) {
    lines.splice(closeIdx, 0, ...newLines);
    fs.writeFileSync(indexPath, lines.join(eol));             // root/headers untouched
  }
  return { appended: newLines.length, skipped };
}

// ── MODE 1: ROUTER SYNC ONLY ────────────────────────────────────────────
if (SYNC_ONLY) {
  const ctx = resolveBatchContext(date, undefined);
  if (!fs.existsSync(ctx.manifestPath)) die(`✗ manifest not found: ${rel(ctx.manifestPath)}`);
  const manifest = JSON.parse(fs.readFileSync(ctx.manifestPath, 'utf8'));
  const schemaErr = manifestSchemaError(ctx, manifest);
  if (schemaErr) die(schemaErr);

  const { appended, skipped } = syncRouter(ctx, manifest);
  console.log(`◆ router: ${appended} line(s) appended, ${skipped} already present (idempotent) — index.html root attributes and comments untouched.`);
  if (appended === 0 && manifest.posts.length === 0) {
    console.log('   (manifest has no posts yet — nothing to route)');
  } else if (appended === 0 && manifest.posts.length > 0) {
    console.log('   (every manifest post is already routed)');
  } else {
    for (const p of manifest.posts) console.log(`   + ${p.html}`);
  }
  process.exit(0);
}

// ── MODE 2: SCAFFOLD THE NEXT BATCH ─────────────────────────────────────
const dateDir = path.join(ROOT, 'compositions', date);
const nextBatch = detectNextBatch(dateDir);
const nextSlug = detectNextSlug(dateDir);
const batchDir = path.join(dateDir, nextBatch);
const manifestPath = path.join(batchDir, 'batch-manifest.json');
const renderRoot = `renders/${date}/${nextBatch}`;

if (fs.existsSync(manifestPath)) {
  die(`✗ ${rel(manifestPath)} already exists — refusing to overwrite an existing batch.\n`
    + `   (present batches: ${listBatches(dateDir).join(', ') || 'none'})\n`
    + `   use --sync-router to refresh router lines, or --batch <id> to target an existing batch.`);
}

// Validate router structure FIRST (posts: [] => no writes, pure validation),
// so a malformed index.html can never leave a half-created batch behind.
const scaffoldManifest = { date, batch: nextBatch, posts: [] };
const ctxPreview = {
  date, batch: nextBatch, layout: 'nested', dateDir,
  batchDir, manifestPath, renderRoot,
};
const { appended, skipped } = syncRouter(ctxPreview, scaffoldManifest);

fs.mkdirSync(batchDir, { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(scaffoldManifest, null, 2) + '\n');

const previous = listBatches(dateDir).filter((b) => b !== nextBatch);
const overrideNoted = (argv.includes('--batch') || process.env.DK_BATCH_ID)
  ? '\n  note:            --batch / DK_BATCH_ID targets gates+render only — scaffolding always creates the NEXT free batch id.'
  : '';

console.log('');
console.log(`  batch:           ${nextBatch}   (previous slots: ${previous.length ? previous.join(', ') : 'none'})`);
console.log(`  folder:          compositions/${date}/${nextBatch}/`);
console.log(`  manifest:        compositions/${date}/${nextBatch}/batch-manifest.json   (Schema v2: {date, batch, posts})`);
console.log(`  first slug:      ${nextSlug}   (CONTINUOUS intraday numbering — highest existing story slug + 1)`);
console.log(`  render root:     ${renderRoot}/   (manifest outputs must stay under it)`);
console.log(`  router:          index.html validated — ${appended} line(s) appended, ${skipped} skipped (posts are routed after you add them)`);
console.log(overrideNoted);
console.log('');
console.log(`  Relative imports INSIDE compositions/${date}/${nextBatch}/ — DEPTH 3 ("../../" is one level short here):`);
console.log('    <link rel="stylesheet" href="../../../shared/story-system.css">');
console.log('    <img src="../../../assets/logos/logo.svg" alt="Direct Kitchens" class="dk-brand-logo">');
console.log('    <img src="../../../assets/raw/optimized/<file>.jpg" alt="...">');
console.log('    root-absolute "/shared/..." is FORBIDDEN (headless file:// cannot resolve it) — §F.9.');
console.log('');
console.log('  Next: 1) create compositions/' + date + '/' + nextBatch + '/' + nextSlug + '.html (depth-3 imports above)');
console.log('        2) append its {slug, html, output} entry to the batch-manifest.json');
console.log('        3) node scripts/new-batch.js --sync-router     # appends the router line(s)');
console.log('        4) npm run preflight                            # lint → check:paths → photo-fit → check');
