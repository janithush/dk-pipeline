// scripts/check-paths.js
// Fail-closed relative-path validator for the ACTIVE batch.
//
// Why this exists: HyperFrames lint SILENTLY SKIPS an unresolvable
// `<link rel="stylesheet">` (collectLocalStylesheets `continue`s when the file
// is not found) and only surfaces depth drift through <img> missing_local_asset.
// A composition whose stylesheet href is one `../` short therefore renders
// unstyled while lint stays green — the one silent failure this pipeline
// forbids. This gate closes that hole:
//
//   - every composition declares EXACTLY ONE stylesheet, and it must resolve to
//     shared/story-system.css (engine contract, §G.8),
//   - every <img>/<source>/<video> src must resolve to an existing file UNDER
//     assets/,
//   - root-absolute (`/shared/...`) and remote/scheme URLs are rejected outright
//     (headless file:// cannot resolve them),
//   - nothing may resolve outside the project root.
//
// Usage:
//   node scripts/check-paths.js                    # active batch of today
//   node scripts/check-paths.js --date 2026-10-21  # a specific date
//   node scripts/check-paths.js --batch batch-02   # an explicit batch
// Exit 0 = every path resolves. Exit 1 = diagnostics printed, nothing skipped.

const fs = require('fs');
const path = require('path');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, listBatches } = require('./lib/batch-context');

const ROOT = process.cwd();
const ENGINE_CSS = path.join(ROOT, 'shared', 'story-system.css');
const ASSETS_DIR = path.join(ROOT, 'assets');

const { date, basis } = resolveBatchDate(process.argv.slice(2));
const ctx = resolveBatchContext(date, undefined);
logResolved({ date, basis }, 'Path check');
console.log(`◆ Active batch: ${ctx.batch} (layout: ${ctx.layout})`);

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const relFrom = (fromDir, target) => path.relative(fromDir, target).split(path.sep).join('/');

// ── Locate the active batch directory (fail-closed) ─────────────────────
if (!fs.existsSync(ctx.batchDir)) {
  console.error(`\u2717 batch directory not found: ${rel(ctx.batchDir)}/`);
  const avail = listBatches(ctx.dateDir);
  if (avail.length) console.error(`   (available batches for ${date}: ${avail.join(', ')})`);
  console.error('   scaffold a new intraday batch with: npm run batch:new');
  process.exit(1);
}

const files = fs.readdirSync(ctx.batchDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.html') && !e.name.startsWith('._'))
  .map((e) => e.name)
  .sort();

if (files.length === 0) {
  console.log(`\u26a0 0 composition HTML files in ${rel(ctx.batchDir)}/ \u2014 nothing to validate (batch not yet populated).`);
  process.exit(0);
}

// ── Tag/attribute extraction ────────────────────────────────────────────
const TAG_RE = /<(?:link|img|source|video)\b[^>]*>/gi;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attrsOf(tag) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tag)) !== null) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  return out;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i; // http:, https:, data:, file:, mailto:, C:\ ...

const problems = [];
let stylesheetCount = 0;
let assetCount = 0;

function fail(file, message, detail, fix) {
  problems.push({ file, message, detail, fix });
}

// Shared URL classification. Returns { kind: 'ok'|'reject', abs? } and pushes
// a problem on rejection.
function resolveRef(file, url, dir, what) {
  const label = `${what} "${url}"`;
  if (!url || !url.trim()) {
    fail(file, `${what} is empty`, null, 'every composition must reference its engine stylesheet and local assets explicitly');
    return null;
  }
  if (url.startsWith('/')) {
    fail(file, `${label} is root-absolute`, 'headless file:// contexts cannot resolve "/..." URLs',
      `use a depth-correct relative path instead: "${relFrom(dir, path.join(ROOT, url.slice(1)))}"`);
    return null;
  }
  if (SCHEME_RE.test(url)) {
    fail(file, `${label} uses a non-relative URL`, 'this pipeline is local-only (zero-CDN headless rendering)',
      'reference a file inside assets/ with a relative path');
    return null;
  }
  const abs = path.resolve(dir, url);
  const inside = !path.relative(ROOT, abs).startsWith('..');
  if (!inside) {
    fail(file, `${label} escapes the project root`, `resolved: ${abs}`, 'keep every reference inside the project tree');
    return null;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    const resolvedRel = rel(abs);
    const tail = /assets\/.*$/.exec(resolvedRel);
    fail(file, `${label} does not resolve (depth drift?)`, `resolved: ${resolvedRel} (missing)`,
      tail ? `from this folder use "${relFrom(dir, path.join(ROOT, tail[0]))}"`
           : `expected target: "${relFrom(dir, ENGINE_CSS)}" (shared/story-system.css)`);
    return null;
  }
  return abs;
}

// ── Validate every file of the active batch ─────────────────────────────
for (const name of files) {
  const htmlPath = path.join(ctx.batchDir, name);
  const dir = path.dirname(htmlPath);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const tags = html.match(TAG_RE) || [];
  const engineLinks = [];

  for (const tag of tags) {
    const a = attrsOf(tag);
    if (/^<link/i.test(tag)) {
      const relAttr = (a.rel || '').toLowerCase().split(/\s+/);
      if (!relAttr.includes('stylesheet')) continue;
      engineLinks.push(a.href);
      stylesheetCount++;
      const abs = resolveRef(name, a.href, dir, 'stylesheet href');
      if (!abs) continue;
      if (abs !== ENGINE_CSS) {
        fail(name, `stylesheet "${a.href}" resolves to ${rel(abs)} (not the engine)`,
          'engine contract (§G.8): exactly ONE stylesheet link \u2014 shared/story-system.css',
          `use "${relFrom(dir, ENGINE_CSS)}"`);
        continue;
      }
      continue;
    }
    // img / source / video
    assetCount++;
    const abs = resolveRef(name, a.src, dir, `<${/^<(img|source|video)/i.exec(tag)[1].toLowerCase()}> src`);
    if (!abs) continue;
    const fromAssets = path.relative(ASSETS_DIR, abs);
    if (fromAssets.startsWith('..')) {
      fail(name, `asset "${a.src}" resolves to ${rel(abs)} \u2014 OUTSIDE assets/`,
        'engine contract: photos/logos only from assets/',
        `reference a file under assets/ (e.g. assets/raw/optimized/<file>.jpg)`);
    }
  }

  // Engine stylesheet presence/quantity (per-file engine contract, §G.8).
  if (engineLinks.length === 0) {
    fail(name, 'no <link rel="stylesheet"> found', 'composition would render UNSTYLED (silent failure)',
      `add <link rel="stylesheet" href="${relFrom(dir, ENGINE_CSS)}">`);
  } else if (engineLinks.length > 1) {
    fail(name, `${engineLinks.length} stylesheet links declared`, 'engine contract (§G.8): exactly ONE stylesheet per composition',
      `keep only <link rel="stylesheet" href="${relFrom(dir, ENGINE_CSS)}">`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────
if (problems.length) {
  console.log('');
  for (const p of problems) {
    console.log(`\u2717 [${p.file}] ${p.message}`);
    if (p.detail) console.log(`      ${p.detail}`);
    if (p.fix) console.log(`      fix: ${p.fix}`);
  }
  console.error(`\n\u2717 check-paths: ${problems.length} path error(s) across ${files.length} file(s) \u2014 depth drift or broken relative links. Fail-closed: fix before preflight.`);
  process.exit(1);
}

console.log(`\u25c7 check-paths: ${files.length} file(s) \u00b7 ${stylesheetCount} stylesheet link(s) \u00b7 ${assetCount} asset reference(s) \u2014 all resolve to real files inside the project (layout: ${ctx.layout}, batch: ${ctx.batch}).`);
