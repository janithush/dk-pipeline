// scripts/check-paths.js
// Fail-closed relative-path + manifest-audit validator for the ACTIVE batch.
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
// MANIFEST AUDIT (§H.4 — zero-waiver contract): the ACTIVE batch manifest must
// be in 1:1 parity with the compositions actually on disk:
//   - every manifest post's html exists INSIDE this batch directory,
//   - every composition html on disk is LISTED in the manifest (a file that is
//     not listed would be rendered-never / gated-never — a silent orphan),
//   - slug numbers unique; output unique and contained under THIS batch's
//     render root (a foreign output path can never overwrite approved PNGs).
//
// Usage:
//   node scripts/check-paths.js                    # active batch of today
//   node scripts/check-paths.js --date 2026-10-21  # a specific date
//   node scripts/check-paths.js --batch batch-02   # an explicit batch
// Exit 0 = every path + manifest entry resolves. Exit 1 = diagnostics printed,
// nothing skipped.

const fs = require('fs');
const path = require('path');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError, listBatches } = require('./lib/batch-context');

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
  // Fail-open-fry guard: an empty batch folder is only benign when the manifest
  // is also empty/absent. A manifest that LISTS posts but has no files on disk
  // must still be audited below (each listed post fails "does not exist on disk")
  // — never early-exit GREEN over a populated manifest.
  let manifestEmpty = true;
  if (fs.existsSync(ctx.manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(ctx.manifestPath, 'utf8'));
      manifestEmpty = !Array.isArray(m.posts) || m.posts.length === 0;
    } catch { manifestEmpty = false; } // corrupt manifest → the audit below reports it
  }
  if (manifestEmpty) {
    console.log(`\u26a0 0 composition HTML files in ${rel(ctx.batchDir)}/ \u2014 nothing to validate (batch not yet populated).`);
    process.exit(0);
  }
  console.log(`\u26a0 0 composition HTML files in ${rel(ctx.batchDir)}/ but the manifest lists posts — auditing the manifest below (fail-closed).`);
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

// ── MANIFEST AUDIT (fail-closed parity: disk ⇄ manifest) ────────────────
if (fs.existsSync(ctx.manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(ctx.manifestPath, 'utf8'));
  const schemaErr = manifestSchemaError(ctx, manifest);
  if (schemaErr) {
    fail('(manifest)', 'manifest fails schema validation', schemaErr, 'correct manifest date/batch/posts fields before preflight');
  } else {
    const manifestTitled = `<manifest ${path.basename(ctx.manifestPath)}>`;
    const diskHtml = new Set(files.map((f) => path.join(ctx.batchDir, f).toLowerCase()));
    const listedHtml = new Set();
    const slugNums = new Map();       // slug number → slug (duplicate detector)
    const outputs = new Map();        // output → slug (collision detector)
    const deliverableLeaves = new Map(); // P7.0: deliverable leaf dir → slug (one MP4/leaf)
    // P7.0 additive manifest typing (kind: static | compound-static | reel).
    // Unknown `kind` values fail-closed (P1) — a typo like "reel " must never
    // silently classify a post into the wrong render lane.
    const KINDS = new Set(['static', 'compound-static', 'reel']);
    const isReelPost = (post) =>
      (typeof post.kind === 'string' && post.kind === 'reel') ||
      (!('kind' in post) && /-living/i.test(path.basename(String(post.html || ''), '.html')));

    for (const post of manifest.posts) {
      const slug = String(post.slug || '');
      const absHtmlClean = path.resolve(ROOT, String(post.html || ''));
      const batchDirResolved = path.resolve(ctx.batchDir);

      // P7.0: additive kind field — absent = static (Schema v1/v2 backward
      // compat), present = must be one of the three permitted values.
      if ('kind' in post && !KINDS.has(String(post.kind))) {
        fail(manifestTitled, `[${slug}] kind "${post.kind}" is not a permitted value (static | compound-static | reel)`,
          'P7.0 additive manifest typing — unknown kinds fail closed so a typo never lands a post in the wrong render lane',
          'set kind to "static", "compound-static", or "reel" (or omit the field for a legacy static post)');
      }

      // html references this batch dir + exists on disk + no duplicates
      if (path.relative(batchDirResolved, absHtmlClean).startsWith('..')) {
        fail(manifestTitled, `[${slug}] html "${post.html}" lives outside ${rel(ctx.batchDir)}/`,
          `resolved: ${rel(absHtmlClean)}`, 'manifest posts must point into the active batch folder');
      } else if (!fs.existsSync(absHtmlClean) || !fs.statSync(absHtmlClean).isFile()) {
        fail(manifestTitled, `[${slug}] html "${post.html}" does not exist on disk`,
          null, 'create the composition (or fix the manifest path) before rendering');
      } else if (!listedHtml.has(absHtmlClean.toLowerCase())) {
        listedHtml.add(absHtmlClean.toLowerCase());
        if (!diskHtml.has(absHtmlClean.toLowerCase())) {
          // inside batch dir & exists but the dir listing disagrees → nested path mismatch
          fail(manifestTitled, `[${slug}] html resolves into the batch dir but was not found by the disk scan`, null, null);
        }
      } else {
        fail(manifestTitled, `[${slug}] html "${post.html}" is listed TWICE in the manifest`, null, 'one manifest entry per composition');
      }

      // slug number uniqueness (router ids derive from slug numbers)
      const m = /story-(\d+)$/.exec(slug);
      if (!m) {
        fail(manifestTitled, `[${slug}] slug does not match story-NN — router ids (post-NN/dk-story-NN) derive from it`, null, 'rename the slug to story-NN');
      } else if (slugNums.has(m[1])) {
        fail(manifestTitled, `slug number ${m[1]} is used by both "${slugNums.get(m[1])}" and "${slug}" — intraday ids collide`, null, 'renumber (detectNextSlug rule: max+1, continuous)');
      } else {
        slugNums.set(m[1], slug);
      }

      // output uniqueness + containment under THIS batch's render root
      const out = String(post.output || '').replace(/\\/g, '/');
      if (!out) {
        fail(manifestTitled, `[${slug}] output is empty`, null, `set output under ${ctx.renderRoot}/`);
      } else {
        if (outputs.has(out)) {
          fail(manifestTitled, `output "${out}" is claimed by both "${outputs.get(out)}" and "${slug}" — renders would overwrite each other`, null, 'one distinct output dir per post');
        } else {
          outputs.set(out, slug);
        }
        const inside = out === ctx.renderRoot || out.startsWith(ctx.renderRoot + '/');
        const intoNestedFromFlat = ctx.layout === 'flat' && out.startsWith(`${ctx.renderRoot}/batch-`);
        if (!inside || out.split('/').includes('..') || intoNestedFromFlat) {
          fail(manifestTitled, `[${slug}] output "${out}" escapes render root "${ctx.renderRoot}/" — approved PNG overwrite risk`,
            null, `keep output under ${ctx.renderRoot}/<slug>/`);
        }

        // ── P7.0 DEDICATED LEAF NAMESPACE (one deliverable per leaf dir) ──
        // static / compound-static: output IS the leaf      → <renderRoot>/<slug>
        // reel: output = leaf/<name> and leaf dir = slug dir → <renderRoot>/<slug>/<variant>
        //   i.e. the MP4 file is <output>.mp4 inside a slug-named directory
        //   directly under the render root (cleanup's per-leaf budget +
        //   non-destructive supersede archival key off exactly this shape).
        const isReel = isReelPost(post);
        const leafOfOutput = isReel
          ? out.split('/').slice(0, -1).join('/')   // slug dir (dirname of output)
          : out;                                    // static output IS its leaf
        if (inside && !out.includes('..')) {
          const expectedLeaf = `${ctx.renderRoot}/${slug}`;
          if (leafOfOutput !== expectedLeaf) {
            fail(manifestTitled, `[${slug}] ${isReel ? 'reel leaf' : 'output leaf'} "${leafOfOutput}" must be the slug-named dir "${expectedLeaf}" directly under the render root`,
              'P7.0 Storage Budget Law keys per-leaf budgets and supersede archival on slug-named leaves',
              isReel
                ? `set output to ${expectedLeaf}/<variant-name> (MP4 lands as ${expectedLeaf}/<variant-name>.mp4)`
                : `set output to ${expectedLeaf}/`);
          }
          if (isReel && !out.split('/').at(-1)) {
            fail(manifestTitled, `[${slug}] reel output "${out}" must name the MP4 (the leaf/<variant> path, rendered as <output>.mp4)`,
              null, `e.g. output = ${expectedLeaf}/living-${typeof post.variant === 'string' ? post.variant : '20s'}`);
          }
          if (deliverableLeaves.has(leafOfOutput) && deliverableLeaves.get(leafOfOutput) !== slug) {
            fail(manifestTitled, `deliverable leaf "${leafOfOutput}" is claimed by both "${deliverableLeaves.get(leafOfOutput)}" and "${slug}" — two MP4s/posters would share one leaf (the P6.0 footgun: a cleanup budget on the shared parent destroyed a sibling reel)`,
              null, 'one slug-named leaf directory per deliverable');
          } else {
            deliverableLeaves.set(leafOfOutput, slug);
          }
        }
      }
    }

    // disk parity: every composition html on the disk must be in the manifest
    for (const f of files) {
      const abs = path.join(ctx.batchDir, f).toLowerCase();
      if (!listedHtml.has(abs)) {
        fail(manifestTitled, `composition "${f}" exists on disk but is NOT listed in the manifest — it would never be gated or rendered (silent orphan)`,
          null, `add { slug, html: "${rel(path.join(ctx.batchDir, f))}", output: "${ctx.renderRoot}/<slug>" } to the manifest`);
      }
    }

    if (manifest.posts.length === 0 && files.length === 0) {
      console.log('◇ manifest audit: manifest + batch dir are both empty (fresh scaffold) — consistent.');
    } else if (!problems.length) {
      console.log(`◇ manifest audit: ${manifest.posts.length} post(s) ⇄ ${files.length} composition file(s) in 1:1 parity; outputs contained under ${ctx.renderRoot}/.`);
    }
  }
} else if (files.length > 0) {
  fail('(manifest)', `compositions exist in ${rel(ctx.batchDir)}/ but ${rel(ctx.manifestPath)} is missing — no post would ever be routed, gated, or rendered`,
    null, `create the manifest (npm run batch:new scaffolds it) with an entry per composition`);
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
