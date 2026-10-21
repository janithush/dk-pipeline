// scripts/render-batch.js
// Daily static-render loop for HyperFrames production pipeline.
// Resolves the ACTIVE batch manifest via lib/batch-context.js:
//   nested  compositions/YYYY-MM-DD/batch-XX/batch-manifest.json  (Model A, §F.9)
//   flat    compositions/YYYY-MM-DD/batch-manifest.json           (legacy batch-01)
// and renders each post as a strict static PNG sequence into
// renders/YYYY-MM-DD/[batch-XX/]<slug>/ — every post.output is contained
// under this batch's render root (cross-batch overwrites hard-fail).
//
// Usage:
//   node scripts/render-batch.js                  # renders the active batch of today
//   node scripts/render-batch.js 2026-10-19       # renders a specific batch date
//   node scripts/render-batch.js --batch batch-02 # targets an explicit intraday batch
//   (DK_BATCH / DK_BATCH_ID env: same override — see lib/batch-context.js)
//
// Requires: every composition must pass `npx hyperframes lint` first.
// Renders with --strict so any lint error aborts that post.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError, listBatches } = require('./lib/batch-context');

const ROOT = process.cwd();
// Local calendar day by default; --date flag, positional arg, or DK_BATCH_DATE
// env override it (see lib/batch-date.js). The ACTIVE BATCH within that date
// resolves via lib/batch-context.js (--batch flag / DK_BATCH_ID env; default =
// highest-numbered batch dir, else the legacy flat batch = batch-01).
const { date: batchDate, basis } = resolveBatchDate(process.argv.slice(2));
logResolved({ date: batchDate, basis }, 'Render batch');

const ctx = resolveBatchContext(batchDate, undefined);
const manifestPath = ctx.manifestPath;
const renderDir = path.join(ROOT, ...ctx.renderRoot.split('/'));
console.log(`◆ Active batch: ${ctx.batch} (layout: ${ctx.layout}) · render root: ${ctx.renderRoot}/`);

if (!fs.existsSync(manifestPath)) {
  const others = fs.existsSync(path.join(ROOT, 'compositions'))
    ? fs.readdirSync(path.join(ROOT, 'compositions')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  console.error(`✗ batch manifest not found: ${manifestPath}`);
  const avail = listBatches(ctx.dateDir);
  if (avail.length) console.error(`   (available batches for ${batchDate}: ${avail.join(', ')})`);
  if (others.length) console.error(`   (available batch folders: ${others.join(', ')})`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
// Manifest Schema v2 (nested: {date, batch, posts}) vs Schema v1 (legacy flat:
// {batch: <DATE>, posts}) — a manifest that does not match the resolved batch
// context is foreign → hard refusal (zero silent failures).
const schemaErr = manifestSchemaError(ctx, manifest);
if (schemaErr) {
  console.error(schemaErr);
  process.exit(1);
}

// ── BATCH OUTPUT CONTAINMENT (fail-closed) ──────────────────────────────
// Every post.output must stay under THIS batch's render root so a stale or
// hand-edited manifest can never overwrite another batch's approved PNGs.
for (const post of manifest.posts) {
  const out = String(post.output || '').replace(/\\/g, '/');
  const inside = out === ctx.renderRoot || out.startsWith(ctx.renderRoot + '/');
  const intoNestedFromFlat = ctx.layout === 'flat' && out.startsWith(`${ctx.renderRoot}/batch-`);
  if (!inside || out.split('/').includes('..') || intoNestedFromFlat) {
    console.error(`✗ [${post.slug}] output "${post.output}" escapes render root "${ctx.renderRoot}/" — refusing to render.`);
    process.exit(1);
  }
}

if (manifest.posts.length === 0) {
  console.log(`⚠ manifest has 0 posts — nothing to render (batch ${ctx.batch} scaffolded but not yet populated).`);
  process.exit(0);
}
fs.mkdirSync(renderDir, { recursive: true });

// ── BATCH-LEVEL PRE-FLIGHT GATE ─────────────────────────────────────────
// Run lint + check before rendering any composition. Abort immediately
// if the gate is not green (exit code !== 0).
console.log(`◆ Running pre-flight gate for batch: ${batchDate}`);
try {
  execSync('npm run preflight', { cwd: ROOT, stdio: 'inherit' });
  console.log('   Pre-flight gate: GREEN (0 errors, 0 warnings)\n');
} catch (err) {
  console.error('✗ Pre-flight gate FAILED — aborting render batch.');
  console.error('   Fix lint/check errors before rendering.');
  process.exit(1);
}

let passed = 0;
let failed = 0;

console.log(`◆ Rendering daily batch: ${batchDate}`);
console.log(`   posts: ${manifest.posts.length}\n`);

for (const post of manifest.posts) {
  const htmlPath = path.join(ROOT, post.html);
  const outputPath = path.join(ROOT, post.output);

  if (!fs.existsSync(htmlPath)) {
    console.error(`✗ [${post.slug}] composition not found: ${post.html}`);
    failed++;
    continue;
  }

  fs.mkdirSync(outputPath, { recursive: true });

  // Static composition (single frame, data-no-timeline) → png-sequence.
  // --strict aborts on lint errors so bad posts never ship silently.
  const cmd = `npx hyperframes render --composition "${post.html}" ` +
              `--format png-sequence --output "${post.output}" --strict`;

  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    // Renderer writes frame_000001.png (single static frame); report the
    // newest frame actually on disk rather than a hardcoded name.
    const frames = fs.readdirSync(outputPath)
      .filter(f => /^frame[-_]\d+\.png$/i.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(outputPath, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    const frame = frames[0] ? frames[0].f : null;
    const size = frame ? fs.statSync(path.join(outputPath, frame)).size : 0;
    console.log(`✓ [${post.slug}] rendered → ${post.output}/${frame || 'frame*.png'} (${size} bytes)`);
    passed++;
  } catch (err) {
    console.error(`✗ [${post.slug}] render failed`);
    failed++;
  }
}

console.log(`\n◆ Batch ${batchDate} complete: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
