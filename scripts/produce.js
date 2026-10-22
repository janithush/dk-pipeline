// scripts/produce.js
// ZERO-FRICTION OPERATOR ENTRYPOINT (§H) — the ONLY commands a production
// day needs. The operator's entire job: drop photos into assets/raw/, then
//   npm run produce            # prepare the day
//   npm run produce -- ship    # certify + render the active batch
// Nothing interactive, no waivers, no prompts. Every sub-step is one of the
// hardened gate scripts (single source per stage — no duplicated logic):
//
//   prepare  = retire stale dates (shipped-aware) → optimize assets
//              → (scaffold batch-01 only when the day has no batch yet)
//              → kick-off report (what to do: drop more photos / build posts / ship)
//   ship     = sync router → optimize (idempotent)
//              → preflight chain: lint · check-paths · photo-fit --fix (self-heal)
//                 · verify-contrast (browser authority, fail-closed)
//              → render the active batch (+ per-post frame verification report)
//   status   = pure report: dates, batches, posts, renders, heal markers.
//
// Date rules come from lib/batch-date.js (--date / positional / DK_BATCH_DATE /
// local today). Batch selection comes from lib/batch-context.js
// (--batch / DK_BATCH_ID / highest-numbered batch).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError, listBatches, detectNextSlug } = require('./lib/batch-context');

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const MODE = argv.find((a) => ['prepare', 'ship', 'status'].includes(a));
const RUN = MODE || 'prepare';                                                  // no args = prepare
const NO_GIT = argv.includes('--no-git');                                       // skip the ship commit

const die = (msg) => {
  console.error(`\n✗ produce: ${msg}`);
  process.exit(1);
};

// ── PHOTO LEDGER (consumption report — read-only) ───────────────────────
// The old intraday friction: the operator had to remember to delete already-
// consumed raw photos between batches. This ledger derives the answer from
// the manifests: photos referenced by TODAY's manifests = consumed; the rest
// of assets/raw/optimized/ = available for the next posts. No manual cleanup.
function photoLedger(dateDir) {
  const optimizedDir = path.join(ROOT, 'assets', 'raw', 'optimized');
  const files = fs.existsSync(optimizedDir)
    ? fs.readdirSync(optimizedDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()
    : [];
  const referenced = new Set();
  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (e.name.endsWith('.html')) {
        const h = fs.readFileSync(p, 'utf8');
        for (const m of h.matchAll(/assets\/raw\/optimized\/([A-Za-z0-9._-]+\.(?:jpe?g|png))/gi)) referenced.add(m[1]);
      }
    }
  };
  scan(dateDir); // today's manifests only — archived days are history
  return { files, consumed: files.filter((f) => referenced.has(f)), fresh: files.filter((f) => !referenced.has(f)) };
}

function printLedger(dateDir) {
  const { consumed, fresh } = photoLedger(dateDir);
  console.log(`   photos:           ${fresh.length} available for the next posts${consumed.length ? ` · ${consumed.length} already consumed by today's batches` : ''}`);
  for (const f of fresh.slice(0, 15)) console.log(`     · ${f}`);
  if (fresh.length > 15) console.log(`     … and ${fresh.length - 15} more`);
  if (consumed.length) console.log(`     (consumed: ${consumed.join(', ')})`);
}

// ── GIT ARCHIVAL (deterministic ship commit — fail-open, never blocks) ──
function commitShip(date, batch, count) {
  if (NO_GIT) { console.log('  ⊘ git archival: skipped (--no-git)'); return; }
  const msg = `ship(batch): ${date} ${batch} — ${count} post(s) certified + rendered (zero-waiver preflight GREEN)`;
  try {
    const run = (args) => {
      const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
      return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
    };
    const add = run(['add', '-A']);
    if (add.code !== 0) { console.warn(`⚠ git archival skipped (add failed): ${add.out.split('\n')[0]}`); return; }
    const nothingStaged = run(['diff', '--cached', '--quiet']);
    if (nothingStaged.code === 0) { console.log('  ✓ git archival: workspace already clean — nothing to commit (idempotent ship).'); return; }
    const commit = run(['commit', '-m', msg]);
    if (commit.code !== 0) { console.warn(`⚠ git archival skipped (commit failed, rendered artifacts stand): ${commit.out.split('\n')[0]}`); return; }
    console.log(`  ✓ git archival: ${msg}`);
  } catch (err) {
    console.warn(`⚠ git archival skipped: ${err.message}`);
  }
}

function step(cmd, args, { title, failMsg } = {}) {
  console.log(`\n◈ ${title || `produce: ${cmd} ${args.join(' ')}`}`);
  const needsShell = cmd === 'npm' || cmd === 'npx';   // Windows .cmd shims need a shell
  const res = spawnSync(cmd, args, {
    cwd: ROOT, stdio: 'inherit',
    env: process.env,
    shell: needsShell,
  });
  if (res.status !== 0) die(failMsg || `step "${title || `${cmd} ${args.join(' ')}`}" failed (exit ${res.status}) — the day is gated, nothing has been shipped.`);
}

const { date, basis } = resolveBatchDate(argv);
logResolved({ date, basis }, `Produce · mode: ${RUN} (UTC ${new Date().toISOString()})`);

const relPath = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// ── shared context load ─────────────────────────────────────────────────
const ctx = resolveBatchContext(date, undefined);
function loadManifest() {
  if (!fs.existsSync(ctx.manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(ctx.manifestPath, 'utf8'));
  const schemaErr = manifestSchemaError(ctx, manifest);
  if (schemaErr) die(`active batch manifest is invalid —\n   ${schemaErr}`);
  return manifest;
}

// ── MODE: STATUS (pure report, writes nothing) ─────────────────────────
if (RUN === 'status') {
  const manifest = loadManifest();
  const batches = listBatches(ctx.dateDir);
  console.log('');
  console.log(`  date:            ${date}`);
  console.log(`  batches:         ${batches.length ? batches.join(', ') : '(none yet — npm run produce scaffolds batch-01)'}`);
  console.log(`  active:          ${ctx.batch} (layout: ${ctx.layout})`);
  if (manifest) {
    console.log(`  posts:           ${manifest.posts.length} (next free slug: ${detectNextSlug(ctx.dateDir)})`);
    for (const p of manifest.posts) {
      const absHtml = path.join(ROOT, ...String(p.html).split('/'));
      const outDir = path.join(ROOT, ...String(p.output).split('/'));
      const rendered = fs.existsSync(outDir) &&
        fs.readdirSync(outDir).some((f) => /^frame[-_]\d+\.png$/i.test(f));
      console.log(`    ${fs.existsSync(absHtml) && rendered ? '✓' : fs.existsSync(absHtml) ? '◌' : '✗'} ${p.slug.padEnd(10)} ${fs.existsSync(absHtml) ? 'composition ok' : 'composition MISSING'} · ${rendered ? 'rendered' : 'not rendered'}`);
    }
  } else {
    console.log('  posts:           (no manifest — scaffold first)');
  }
  const verifyDigest = path.join(ROOT, '.hyperframes', 'artifacts', 'verify-contrast', `${date}-${ctx.batch}.digest.json`);
  if (fs.existsSync(verifyDigest)) console.log(`  contrast:        ${relPath(verifyDigest)}`);
  const healNote = fs.existsSync(verifyDigest)
    ? JSON.parse(fs.readFileSync(verifyDigest, 'utf8')).ok ? 'digest green' : 'digest RED'
    : '(no certificate yet)';
  console.log(`  contrast verdict: ${healNote}`);
  const { dateDir: sDateDir } = ctx;
  console.log('');
  console.log('  photo ledger:');
  printLedger(sDateDir);
  process.exit(0);
}

// ── MODE: PREPARE ───────────────────────────────────────────────────────
if (RUN === 'prepare') {
  step('node', ['scripts/retire-batch.js', '--date', date], {
    title: '1/3 · retire stale dates (shipped → stale-drafts · unshipped → archive/unshipped)',
    failMsg: 'retirement failed — resolve manually, then re-run "npm run produce".',
  });
  step('node', ['scripts/downscale-assets.js'], {
    title: '2/3 · optimize assets: assets/raw/* → assets/raw/optimized/* (idempotent)',
    failMsg: 'asset optimization failed — check "npm run optimize:assets" output.',
  });
  // scaffold the day's first batch ONLY when the day has no batch yet —
  // mid-day prepares must never fork a second batch silently.
  if (listBatches(ctx.dateDir).length === 0) {
    step('node', ['scripts/new-batch.js', '--date', date], {
      title: '3/3 · scaffold batch-01 (no batch exists for today yet)',
      failMsg: 'scaffold failed — create the batch with "npm run batch:new".',
    });
  } else {
    console.log('\n◈ 3/3 · scaffold: SKIPPED — batches already exist for today (idempotent prepare).');
  }
  const manifest = loadManifest();
  const batches = listBatches(ctx.dateDir);
  const nextSlug = detectNextSlug(ctx.dateDir);
  console.log('\n◆ ─── PRODUCTION DAY READY ───────────────────────────────────────────────');
  console.log(`   date:            ${date}`);
  console.log(`   batches:         ${batches.length ? batches.join(', ') : 'batch-01 (scaffolded above)'}`);
  console.log(`   active:          ${ctx.batch} · next slug: ${nextSlug}`);
  console.log(`   manifest:        ${relPath(ctx.manifestPath)}${manifest ? ` (${manifest.posts.length} post(s))` : ' (empty — drop photos + build posts next)'}`);
  console.log('');
  console.log('   photo ledger:');
  printLedger(ctx.dateDir);
  console.log('');
  console.log('   Operator contract (zero-friction):');
  console.log(`   1. photos in:     assets/raw/  (+ optimized/ on this run — done)`);
  console.log(`   2. build posts:   compositions/${date}/${ctx.batch}/<slug>.html + manifest entry`);
  console.log(`   3. render/ship:   npm run produce -- ship   (certify + render + commit, unattended)`);
  console.log('   The gates self-heal styling; a TRUE-defect post is reported, never waived.');
  process.exit(0);
}

// ── MODE: SHIP ──────────────────────────────────────────────────────────
// gate → certify → render, for the ACTIVE batch (highest-numbered batch dir
// of the date, or the legacy flat batch).
const manifest = loadManifest();
if (!manifest) die(`no batch manifest for ${date}: ${relPath(ctx.manifestPath)} — run "npm run produce" first (it scaffolds the day).`);
if (manifest.posts.length === 0) die(`active batch ${ctx.batch} has 0 posts — build at least one post (or scaffold a new batch) before shipping.`);

console.log(`◆ shipping batch ${ctx.batch} (${manifest.posts.length} post(s)) of ${date}`);

step('node', ['scripts/downscale-assets.js'], {
  title: '1/4 · assets re-optimized (idempotent; fresh photos enter slug-map)',
  failMsg: 'asset optimization failed before ship.',
});
step('node', ['scripts/new-batch.js', '--sync-router', '--date', date], {
  title: '2/4 · router sync (index.html routes every manifest post; idempotent)',
  failMsg: 'router sync failed — fix manifest ids/paths, then re-ship.',
});
// 3/4 — the full hardened preflight chain (exactly what render would run below):
//   lint → check-paths (+ manifest audit) → photo-fit --fix (model self-heal)
//   → verify-contrast (browser authority; browser-ordered rung escalation, fail-closed)
step('npm', ['run', 'preflight'], {
  title: '3/4 · preflight: lint → check-paths → photo-fit --fix → verify-contrast',
  failMsg: 'preflight RED — self-heal exhausted or a TRUE defect was found (no render attempt was made).',
});
step('node', ['scripts/render-batch.js', '--no-preflight', '--date', date], {
  title: '4/4 · render batch (strict; static png-sequence per post)',
  failMsg: 'render step failed — see the per-post error above.',
});

// ── SHIP-CERT (zero-touch audit trail, idempotent) ───────────────────────
// Every shipped post gets ONE deterministic certificate line in its manifest
// notes (marker-keyed: re-ship replaces today's cert, prior history — waiver
// prose of pre-policy batches — is preserved verbatim). The operator never
// writes manifest notes again.
function frameInfo(post) {
  const outDir = path.join(ROOT, ...String(post.output).split('/'));
  if (!fs.existsSync(outDir)) return null;
  const frames = fs.readdirSync(outDir)
    .filter((f) => /^frame[-_]\d+\.png$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return frames[0] ? { file: frames[0].f, size: fs.statSync(path.join(outDir, frames[0].f)).size } : null;
}

try {
  const digestFile = path.join(ROOT, '.hyperframes', 'artifacts', 'verify-contrast', `${date}-${ctx.batch}.digest.json`);
  const digestObj = fs.existsSync(digestFile) ? JSON.parse(fs.readFileSync(digestFile, 'utf8')) : null;
  for (const post of manifest.posts) {
    const htmlReal = path.join(ROOT, ...String(post.html).split('/'));
    const h = fs.existsSync(htmlReal) ? fs.readFileSync(htmlReal, 'utf8') : '';
    const barCls = h.match(/<header class="(bar-top[^"\n]*)"/)?.[1] || '(bar-top?)';
    const copyCls = h.match(/<section class="(copy[^"\n]*)"/)?.[1] || '(copy?)';
    const pdigest = digestObj?.posts?.find((p) => p.slug === post.slug);
    const escalations = (pdigest?.attempts || [])
      .filter((a) => a.reconcile)
      .map((a) => (a.repairs || []).join('+'))
      .join(' → ') || 'none';
    const checked = pdigest?.checked ?? 0;
    const verdict = pdigest?.status ?? 'UNVERIFIED';
    const fi = frameInfo(post);
    const marker = `SHIP-CERT ${date}-${ctx.batch}`;
    const at = new Date().toISOString();
    const cert = `${marker} ${at}: zero-waiver auto-ship — preflight GREEN (lint · check-paths 1:1 parity · photo-fit p98 gate · browser AA verify ${checked} els ${verdict}${escalations !== 'none' ? `; browser-ordered escalations: ${escalations}` : ''}) · state: ${barCls} · ${copyCls}${fi ? ` · shipped frame ${fi.file} (${fi.size} bytes)` : ' · FRAME MISSING'}`;
    const base = typeof post.notes === 'string'
      ? post.notes.replace(new RegExp(`${marker}[\\s\\S]*$`), '').trimEnd()
      : '';
    post.notes = base ? `${base} · ${cert}` : cert;
  }
  fs.writeFileSync(ctx.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  ✓ ship-cert stamped per post (idempotent): ${relPath(ctx.manifestPath)}`);
} catch (err) {
  console.warn(`⚠ ship-cert stamping failed (non-fatal; rendered artifacts stand): ${err.message}`);
}

// ── SHIP RECEIPT ────────────────────────────────────────────────────────
console.log('\n◆ ─── SHIP RECEIPT ───────────────────────────────────────');
let okPosts = 0;
for (const p of manifest.posts) {
  const fi = frameInfo(p);
  const line = fi
    ? `  ✓ ${p.slug.padEnd(10)} → ${p.output}/${fi.file} (${fi.size} bytes)`
    : `  ✗ ${p.slug.padEnd(10)} → NOT RENDERED (${p.output}/)`;
  console.log(line);
  if (fi) okPosts++; else console.error(`     missing render output for ${p.slug}`);
}
const digestPath = path.join(ROOT, '.hyperframes', 'artifacts', 'verify-contrast', `${date}-${ctx.batch}.digest.json`);
if (fs.existsSync(digestPath)) {
  console.log(`  ✓ contrast certificate: ${relPath(digestPath)}`);
}
console.log('');
if (okPosts === manifest.posts.length) {
  commitShip(date, ctx.batch, okPosts);
  console.log('◇ produce ship: batch certified + rendered + archived — DONE (zero waivers, zero prompts).');
  process.exit(0);
}
console.error(`✗ produce ship: ${manifest.posts.length - okPosts} post(s) did not render.`);
process.exit(1);

