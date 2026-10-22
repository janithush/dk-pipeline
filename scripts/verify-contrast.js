// scripts/verify-contrast.js
// BROWSER-AUTHORITY WCAG AA GATE — the FINAL contrast verdict (§H.6).
//
// Why the per-post single-composition swap: under the multi-story router,
// `hyperframes check`'s contrast sampler measures REAL rendered pixels —
// but when several stories are routed at once the sampler saw N stacked
// compositions and produced ZERO contrast entries (the 2026-10-22 blind
// spot: a "green" preflight that checked nothing). This gate closes it:
//
//   for every post in the ACTIVE batch manifest:
//     1. swap index.html's router down to EXACTLY ONE routed post (bytes
//        backed up; every modified byte restored in `finally`),
//     2. run `npx hyperframes check --json` (real Chromium sampler),
//     3. HARD FAIL (vacuous-green) unless ≥1 text element was checked,
//     4. on AA failures → RECONCILE: escalate the declared engine rung
//          · copy bands fail  → copy--shield → copy--shield--deep
//          · brand band fails → bar-top--plate (ink-on-bone ≥ 12:1)
//        then re-check that post (bounded, no waivers, no prompts),
//     5. verdict per post = PASS / FAIL — aggregated to the gate exit code.
//
// Reconciliation applies class attributes ONLY via scripts/photo-fit.js's
// exported class machinery (single source of heal logic — no drift, and
// the pre-render model reproduces every declared layer). If a post still
// fails at the deepest rung, the printout demands a copy/variant/photo
// change BEFORE render — a human never has to type "y".

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError, listBatches } = require('./lib/batch-context');
const pf = require('./photo-fit');

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'index.html');
const DIGEST_DIR = path.join(ROOT, '.hyperframes', 'artifacts', 'verify-contrast');
const MAX_ATTEMPTS = 3;            // initial check + up to 2 reconcile escalations

const argv = process.argv.slice(2);
const { date, basis } = resolveBatchDate(argv);
logResolved({ date, basis }, 'Contrast verify (browser authority)');

const ctx = resolveBatchContext(date, undefined);

if (!fs.existsSync(INDEX_PATH)) {
  console.error(`✗ index.html not found: ${path.relative(ROOT, INDEX_PATH)}`);
  process.exit(1);
}
if (!fs.existsSync(ctx.manifestPath)) {
  console.error(`✗ batch manifest not found: ${ctx.manifestPath}`);
  const avail = listBatches(ctx.dateDir);
  if (avail.length) console.error(`   (available batches for ${date}: ${avail.join(', ')})`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(ctx.manifestPath, 'utf8'));
const schemaErr = manifestSchemaError(ctx, manifest);
if (schemaErr) { console.error(schemaErr); process.exit(1); }
const relIndex = path.relative(ROOT, INDEX_PATH).split(path.sep).join('/');
console.log(`◆ Gated manifest: ${path.relative(ROOT, ctx.manifestPath).split(path.sep).join('/')} (batch: ${ctx.batch}, posts: ${manifest.posts.length}) · router: ${relIndex}`);

if (manifest.posts.length === 0) {
  console.log('⚠ verify-contrast: manifest has 0 posts — nothing to verify (batch not yet populated).');
  process.exit(0);
}

const indexBackup = fs.readFileSync(INDEX_PATH);   // byte-exact restore in finally
const digest = {
  date, batch: ctx.batch, gate: 'verify-contrast', at: new Date().toISOString(),
  posts: [], ok: true,
};

function extractJson(stdout) {
  // stdout = [INFO/INFO] log lines… then the JSON object on its own line.
  const mIdx = stdout.indexOf('\n{');
  const start = stdout.startsWith('{') ? 0 : (mIdx !== -1 ? mIdx + 1 : -1);
  if (start === -1) throw new Error('no JSON object found in hyperframes check output');
  const end = stdout.lastIndexOf('}');
  return JSON.parse(stdout.slice(start, end + 1));
}

function runCheck() {
  // `hyperframes check` exits non-zero when any section fails — EXPECTED on
  // contrast failures; the JSON report itself is the data (fail-closed elsewhere).
  let out = '';
  try {
    out = execSync('npx hyperframes check --json', {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 26,
    }).toString();
  } catch (err) {
    out = (err.stdout || '').toString();
    if (err.stderr) out += (err.stderr || '').toString();
    if (!out.includes('{')) {
      throw new Error(`hyperframes check produced no parsable output (exit ${err.status}). tail: ${out.slice(-1200)}`);
    }
  }
  return extractJson(out);
}

/** Band zone from the sampler finding (selector chain first, bbox fallback). */
function zoneOf(f) {
  const sel = String(f.selector || '');
  const y = f.bbox ? (f.bbox.y + (f.bbox.height || 0) / 2) : null;
  if (/header\s*>\s*p\b/i.test(sel) || (y !== null && y < 400)) return 'brand';
  return 'copy';
}

/** Swap index.html routing down to exactly one data-composition-src div.
 *  Byte-preserving for everything else (root attrs, comments, script tags). */
function setSoleRoute(postHtml) {
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);

  // 1) every routed line today (fail when the target post isn't routed)
  const routeLines = lines.filter((l) => /data-composition-src=/.test(l));
  if (!routeLines.length) throw new Error('index.html has no routed composition divs (router stale?)');
  const holder = routeLines.find((l) => l.includes(`data-composition-src="${postHtml}"`));
  if (!holder) {
    throw new Error(`index.html does not route ${postHtml} — run "npm run batch:new -- --sync-router" first (fail-closed: refusing to invent a route).`);
  }
  // 2) #root opening + closing anchors (original line indices)
  const openIdx = lines.findIndex((l) => /<div[^>]*\bid="root"/i.test(l));
  if (openIdx === -1) throw new Error('index.html: #root div not found — refusing to modify the router.');
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '</div>') { closeIdx = i; break; }
  }
  if (closeIdx === -1) throw new Error('index.html: #root closing </div> not found — refusing to modify the router.');

  // 3) rebuild: drop ALL routed lines, insert exactly ONE before the root close.
  //    The INSERTED line is the ORIGINAL holder line verbatim (id +
  //    data-composition-id attributes) — the sampler/compiler contract
  //    requires them (a bare src-only div is rejected: 0 text elements
  //    measured = vacuous green, the exact blind spot this gate forbids).
  const indent = routeLines[0].match(/^\s*/)[0];
  const out = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    if (/data-composition-src=/.test(lines[i])) continue;     // strip routed line
    if (!inserted && i === closeIdx) {
      out.push(holder);
      inserted = true;
    }
    out.push(lines[i]);
  }
  if (!inserted) throw new Error('router insertion point not reached — refusing to modify.');
  fs.writeFileSync(INDEX_PATH, out.join(eol));

  // 4) self-verify the swap (fail-closed)
  const after = fs.readFileSync(INDEX_PATH, 'utf8');
  const routed = [...after.matchAll(/data-composition-src="([^"]+)"/g)].map((m) => m[1]);
  if (routed.length !== 1 || routed[0] !== postHtml) {
    throw new Error(`router swap failed: routed=${JSON.stringify(routed)} — expected exactly ["${postHtml}"]`);
  }
}

/** Escalate ONE declaration rung for the failed zones; returns repair labels [] (empty = nothing left). */
function reconcileClasses(htmlPath, failedZones) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const c = pf.parseComposition(htmlPath);          // throws when the composition is unparseable
  const wantCopy = failedZones.includes('copy');
  const wantBrand = failedZones.includes('brand');
  const copyState = wantCopy
    ? (c.shield === 'L1' ? 'shieldDeep' : c.shield === 'L2' ? null : 'shield')
    : 'author';
  const brandState = wantBrand && !c.plate ? 'plate' : 'author';
  if (copyState === null && brandState === 'author') {
    return { repairs: null, exhausted: true };
  }
  const next = pf.classStrings(html, c, copyState, brandState);
  if (!(next.copyChanged || next.barChanged)) {
    return { repairs: null, exhausted: true };
  }
  fs.writeFileSync(htmlPath, next.html);
  const repairs = [
    next.copyChanged ? `copy→${copyState}` : null,
    next.barChanged ? `brand→${brandState}` : null,
  ].filter(Boolean);
  return { repairs, exhausted: false };
}

try {
  for (const post of manifest.posts) {
    const htmlRel = String(post.html).replace(/\\/g, '/');
    const htmlPath = path.join(ROOT, ...htmlRel.split('/'));
    if (!fs.existsSync(htmlPath)) {
      console.error(`✗ [${post.slug}] composition not found: ${htmlRel} — manifest drift; failing closed.`);
      digest.posts.push({ slug: post.slug, status: 'MISSING_COMPOSITION', ok: false });
      digest.ok = false;
      continue;
    }
    console.log(`\n◆ [${post.slug}] browser verify: ${htmlRel}`);
    const prePost = fs.readFileSync(INDEX_PATH);   // restore the canonical router after EVERY post

    let status = 'FAIL';
    let lastFindings = [];
    let checkedCount = 0;
    const attempts = [];

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        setSoleRoute(htmlRel);
        const report = runCheck();
        const contrast = report.contrast || null;
        if (!contrast) {
          throw new Error('check report contains no contrast section — sampler contract changed in hyperframes; fail-closed.');
        }
        checkedCount = contrast.checked ?? 0;
        if (checkedCount === 0) {
          // THE 2026-10-22 BLIND SPOT: 0 sampled text elements = vacuous "green".
          throw new Error(`[vacuous-green] contrast sampler checked 0 text elements for ${post.slug} — the single-composition router session did not measure anything (index.html routed: ${routedAfterDiagnostic()}), refusing to certify.`);
        }
        const findings = (contrast.findings || []).filter((f) => f.severity === 'error');
        lastFindings = findings;
        const aaFails = findings.filter((f) => f.ratio < f.requiredRatio);
        if (aaFails.length === 0) {
          status = attempt === 1 ? 'PASS' : 'PASS (after reconcile)';
          attempts.push({ final: true, aaFails: 0, checked: checkedCount });
          break;
        }
        const zones = [...new Set(aaFails.map(zoneOf))];
        const detail = aaFails.map((f) => `${zoneOf(f)}:${(f.ratio ?? 0).toFixed(2)}<${f.requiredRatio}`).join(' ');
        console.log(`  ✗ browser AA fail: ${aaFails.length} element(s) — ${detail}`);
        if (attempt === MAX_ATTEMPTS) {
          attempts.push({ final: true, aaFails: aaFails.length, zones, detail });
          digest.ok = false;
          break;
        }
        const rec = reconcileClasses(htmlPath, zones);
        if (!rec.repairs) {
          attempts.push({ final: true, aaFails: aaFails.length, zones, exhausted: true });
          console.log('  ↳ escalation ladder exhausted at this rung — TRUE defect: change copy, variant, or photo before render.');
          digest.ok = false;
          break;
        }
        console.log(`  ⟲ browser-ordered repair: ${rec.repairs.join(', ')} — re-checking…`);
        attempts.push({ reconcile: true, repairs: rec.repairs, aaFails: aaFails.length, detail });
        // continue loop; next check re-measures the healed composition
      }
    } finally {
      // canonical router restored after EVERY post — the next post's swap needs the full routed list
      fs.writeFileSync(INDEX_PATH, prePost);
    }

    const findingSummary = lastFindings.map((f) => ({
      zone: zoneOf(f), text: String(f.text || '').slice(0, 40),
      fg: f.fg, bg: f.bg, ratio: f.ratio, requiredRatio: f.requiredRatio, bbox: f.bbox,
    }));
    const icon = status.startsWith('PASS') ? '✓' : '✗';
    console.log(`${icon} [${post.slug}] verify-contrast verdict: ${status} (${checkedCount} text element(s) sampled)`);
    if (findingSummary.length) {
      for (const f of findingSummary) console.log(`      ${f.zone.padEnd(5)} ${f.ratio?.toFixed(2)}/${f.requiredRatio} “${f.text}”`);
    }
    digest.posts.push({
      slug: post.slug, html: htmlRel, status, checked: checkedCount,
      aaFailures: findingSummary, attempts,
      ok: status.startsWith('PASS'),
    });
    if (!status.startsWith('PASS')) digest.ok = false;
  }
} finally {
  // BYTE-EXACT RESTORE — router mutation must never leak past this gate.
  fs.writeFileSync(INDEX_PATH, indexBackup);
}

fs.mkdirSync(DIGEST_DIR, { recursive: true });
const digestPath = path.join(DIGEST_DIR, `${date}-${ctx.batch}.digest.json`);
fs.writeFileSync(digestPath, JSON.stringify(digest, null, 2) + '\n');
const digestRel = path.relative(ROOT, digestPath).split(path.sep).join('/');

console.log('');
console.log(`◆ verify-contrast digest: ${digestRel}`);
if (digest.ok) {
  console.log(`◇ verify-contrast: ${digest.posts.length} post(s) certified WCAG AA by the real browser sampler (${relIndex} router restored byte-exact).`);
  process.exit(0);
}
console.error(`✗ verify-contrast: ${digest.posts.filter((p) => !p.ok).length} post(s) still below WCAG AA after the reconcile ladder — change copy/variant/photo BEFORE rendering (zero-waiver).`);
process.exit(1);

function routedAfterDiagnostic() {
  try {
    const src = fs.readFileSync(INDEX_PATH, 'utf8');
    return [...src.matchAll(/data-composition-src="([^"]+)"/g)].map((m) => m[1]).join(', ');
  } catch { return '(unreadable)'; }
}
