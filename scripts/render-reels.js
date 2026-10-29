// scripts/render-reels.js
// P7.0 REEL LANE — batch mp4 delivery rendering + automated audio
// certification for every `kind: "reel"` post (fallback: `-living` filename
// on kind-less legacy manifests) of the ACTIVE batch. The static png-sequence
// lane stays in render-batch.js — the two lanes compose inside produce ship.
//
//   node scripts/render-reels.js                     # active batch of today
//   node scripts/render-reels.js --date 2026-10-26   # explicit date
//   node scripts/render-reels.js --batch batch-02    # explicit intraday batch
//   node scripts/render-reels.js --slug story-04     # re-render one reel
//   node scripts/render-reels.js --fps 24            # renderer fps override (default 30)
//
// Per reel post (fail-closed, sequential — one hyperframes render at a time):
//   1. PRE-RENDER SUPERSEDE ARCHIVAL: if the target MP4 already exists it is
//      moved to renders/archive/<date>/<batch>/<slug>/<name>-superseded-<ts>.mp4
//      + appended to archive/retire-log.json (scripts/lib/supersede-archive.js).
//      NEVER overwritten in place, NEVER unlinked.
//   2. npx hyperframes render --composition <html> --output <output>.mp4
//      --format mp4 --fps 30 --quality delivery --strict --no-best-effort
//      (`--strict` aborts on lint errors; `--no-best-effort` forbids the
//      renderer from silently degrading frames — same gate semantics as the
//      static lane: what ships must be exactly what was gated).
//   3. Post-render: cleanup-render.js (poster derivation + frame pruning +
//      per-leaf 20 MB Storage Budget Law) then verify-loudness.js
//      (−14 ±0.5 LUFS · TP ≤ −3.0 dBTP · 0 clipped samples — exit 1 on any
//      violation, digest at .hyperframes/artifacts/loudness/<date>-<batch>.digest.json).
//
// NO internal preflight: the orchestrator (produce ship) runs the full
// hardened chain (lint → check-paths → photo-fit → verify-contrast) BEFORE
// any render lane. Standalone use: run `npm run preflight` first — same
// contract render-batch.js documents for `--no-preflight`.

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError } = require('./lib/batch-context');
const { archiveSupersededMp4 } = require('./lib/supersede-archive');

const ROOT = process.cwd();
const argv = process.argv.slice(2);

const { date: batchDate, basis } = resolveBatchDate(argv);
logResolved({ date: batchDate, basis }, 'Render reels');

const ctx = resolveBatchContext(batchDate, undefined);
const manifestPath = ctx.manifestPath;
console.log(`◆ Active batch: ${ctx.batch} (layout: ${ctx.layout}) · render root: ${ctx.renderRoot}/`);

const fps = (() => { const i = argv.indexOf('--fps'); return i !== -1 && argv[i + 1] ? argv[i + 1] : '30'; })();
const slugArg = (() => { const i = argv.indexOf('--slug'); return i !== -1 && argv[i + 1] ? argv[i + 1] : null; })();

if (!fs.existsSync(manifestPath)) {
  console.error(`✗ reel lane: batch manifest not found: ${manifestPath} — nothing to render.`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const schemaErr = manifestSchemaError(ctx, manifest);
if (schemaErr) {
  console.error(schemaErr);
  process.exit(1);
}

// ── reel post selection (kind === "reel", `-living` filename fallback) ──
const isReelPost = (p) =>
  String(p.kind) === 'reel' ||
  (!('kind' in p) && /-living/i.test(path.basename(String(p.html), '.html')));
const reelPosts = manifest.posts.filter(isReelPost)
  .filter((p) => !slugArg || p.slug === slugArg);

if (!reelPosts.length) {
  console.log(`◇ reel lane: no reel posts to render for ${batchDate} ${ctx.batch}${slugArg ? ` (slug ${slugArg})` : ''} — nothing to do.`);
  process.exit(0);
}
console.log(`◆ Reel lane: ${reelPosts.length} reel(s): ${reelPosts.map((p) => p.slug).join(', ')}`);

// ── BATCH OUTPUT CONTAINMENT (fail-closed — same gate as render-batch) ──
for (const post of reelPosts) {
  const out = String(post.output || '').replace(/\\/g, '/');
  const inside = out === ctx.renderRoot || out.startsWith(ctx.renderRoot + '/');
  const intoNestedFromFlat = ctx.layout === 'flat' && out.startsWith(`${ctx.renderRoot}/batch-`);
  if (!inside || out.split('/').includes('..') || intoNestedFromFlat || !out) {
    console.error(`✗ [${post.slug}] output "${out}" escapes render root "${ctx.renderRoot}/" — refusing to render.`);
    process.exit(1);
  }
}

let passed = 0;
let failed = 0;

for (const post of reelPosts) {
  const htmlPath = path.join(ROOT, ...String(post.html).split('/'));
  const leafRel = String(post.output).replace(/\\/g, '/');
  const mp4Rel = `${leafRel}.mp4`; // manifest output is extension-less; the MP4 file = output + '.mp4'
  const outAbs = path.join(ROOT, ...leafRel.split('/'));
  const mp4Abs = outAbs + '.mp4';
  const mp4LeafAbs = path.dirname(outAbs);        // the MP4's leaf = slug dir (P7.0 leaf law)
  const mp4FileName = path.basename(mp4Abs);

  if (!fs.existsSync(htmlPath)) {
    console.error(`✗ [${post.slug}] composition not found: ${post.html}`);
    failed++;
    continue;
  }

  fs.mkdirSync(path.dirname(mp4Abs), { recursive: true });

  // 1. Pre-render supersede archival — an existing target MP4 is archived
  //    (never overwritten in place, never unlinked).
  if (fs.existsSync(mp4Abs)) {
    console.log(`◆ [${post.slug}] target MP4 already exists — archiving before re-render (non-destructive supersede):`);
    archiveSupersededMp4(ROOT, mp4LeafAbs, mp4FileName, {
      trigger: 'render-reels pre-render supersede (re-render of a certified leaf)',
    });
  }

  // 2. Delivery render (sequential, strict, best-effort forbidden).
  const cmd = `npx hyperframes render --composition "${post.html}" ` +
              `--output "${mp4Rel}" --format mp4 --fps ${fps} ` +
              `--quality delivery --strict --no-best-effort`;
  try {
    console.log(`◆ [${post.slug}] rendering ${post.html} → ${mp4Rel} (fps ${fps}, delivery quality, strict)`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    const size = fs.statSync(mp4Abs).size;
    console.log(`✓ [${post.slug}] rendered → ${mp4Rel} (${(size / 1048576).toFixed(2)} MB)`);
    passed++;
  } catch (err) {
    console.error(`✗ [${post.slug}] reel render failed`);
    failed++;
  }
}

console.log(`\n◆ Reel lane complete: ${passed} passed, ${failed} failed`);

// ── 3. Post-render hygiene + audio certification (per reel post) ────────
const childArgs = ['--date', batchDate];
if (slugArg) childArgs.push('--slug', slugArg);

if (passed > 0) {
  console.log('\n◆ post-render hygiene (cleanup-render: poster + frame pruning + per-leaf 20 MB budget):');
  const cleanup = spawnSync('node', ['scripts/cleanup-render.js', batchDate], { cwd: ROOT, stdio: 'inherit' });
  if (cleanup.status !== 0) console.error('⚠ post-render cleanup reported an issue (see above).');
}

console.log('\n◆ audio certification (verify-loudness: ebur128 + astats, fail-closed):');
const verify = spawnSync('node', ['scripts/verify-loudness.js', ...childArgs], { cwd: ROOT, stdio: 'inherit' });
if (verify.status !== 0) {
  console.error('✗ audio certification RED — reels are NOT certifiable; nothing ships.');
  process.exit(1);
}

process.exit(failed > 0 ? 1 : 0);
