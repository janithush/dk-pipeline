// scripts/qa-vision.js
// ── DUAL-LENS AI VISION PREFLIGHT · LENS 1 (2026-10-24, Phase 1 · item #10) ─
// Lens 1 (THIS script): technical QA of every ACTIVE-batch post via
//   `hyperframes snapshot --describe` (Gemini frame analysis) against the
//   versioned prompt `scripts/qa-vision-prompt.txt` (v1 §header).
// Lens 2 (NOT automated here): the model-context creative audit of alt text
//   + manifest copy against the photo inspection log before client export —
//   documented as blueprint §H.10; it runs in the authoring session's own
//   reasoning, not in this process.
//
// ── ADVISORY SEMANTICS (fail-open, always exit 0) ──────────────────────────
// This hook NEVER gates the factory:
//   · no GEMINI_API_KEY  → SKIPPED digest + one warning line
//   · CLI error / no key / malformed envelope → recorded in the digest
//   · every exit path is 0 (the only hard exit is a THROW, which cannot
//     happen: all steps are individually try/caught)
// Placement: after a GREEN preflight, BEFORE render — see `qa:vision` in
// package.json and blueprint §H.2.
//
// Per-post isolation: the router (index.html) is temporarily rewritten to
// route ONLY the post under test (same approach as verify-contrast's
// setSoleRoute), snapshot runs scoped to that composition id, and the
// ORIGINAL BYTES are restored in a `finally` — self-verified swap, and a
// byte-exact restore guarantee.
//
// Artifacts land in `.hyperframes/artifacts/qa-vision/<date>/<batch>/`:
//   <slug>/        — snapshot stills + CLI JSON envelope per post
//   qa-vision.digest.json — the advisory rollup (status per post)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, listBatches } = require('./lib/batch-context');

const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'index.html');
const ARTIFACTS = path.join(ROOT, '.hyperframes', 'artifacts', 'qa-vision');
const PROMPT_FILE = path.join(ROOT, 'scripts', 'qa-vision-prompt.txt');
const PROMPT_VERSION = 'v1';
const COMP_ID = (slug) => `dk-${slug}`;          // new-batch syncRouter contract

// ── router isolation (byte-preserving swap; restore returns the original) ──
function setSoleRoute(postHtml) {
  const original = fs.readFileSync(INDEX);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.toString('utf8').split(/\r?\n/);
  const routeLines = lines.filter((l) => /data-composition-src=/.test(l));
  if (!routeLines.length) throw new Error('index.html has no routed composition divs (router stale?)');
  const holder = routeLines.find((l) => l.includes(`data-composition-src="${postHtml}"`));
  if (!holder) {
    throw new Error(`index.html does not route ${postHtml} — run "npm run batch:new -- --sync-router" first (fail-closed: refusing to invent a route).`);
  }
  const openIdx = lines.findIndex((l) => /<div[^>]*\bid="root"/i.test(l));
  if (openIdx === -1) throw new Error('index.html: #root div not found — refusing to modify the router.');
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '</div>') { closeIdx = i; break; }
  }
  if (closeIdx === -1) throw new Error('index.html: #root closing </div> not found — refusing to modify the router.');
  const out = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    if (/data-composition-src=/.test(lines[i])) continue;
    if (!inserted && i === closeIdx) { out.push(holder); inserted = true; }
    out.push(lines[i]);
  }
  if (!inserted) throw new Error('router insertion point not reached — refusing to modify.');
  fs.writeFileSync(INDEX, out.join(eol));
  // self-verify the swap (fail-closed INSIDE the advisory hook — a wrong-page
  // capture is worse than no capture)
  const after = fs.readFileSync(INDEX, 'utf8');
  const routed = [...after.matchAll(/data-composition-src="([^"]+)"/g)].map((m) => m[1]);
  if (routed.length !== 1 || routed[0] !== postHtml) {
    throw new Error(`router swap failed: routed=${JSON.stringify(routed)} — expected exactly ["${postHtml}"]`);
  }
  return () => fs.writeFileSync(INDEX, original);   // byte-exact restore
}

// ── CLI ────────────────────────────────────────────────────────────────────
const { date, basis } = resolveBatchDate(process.argv.slice(2));
logResolved({ date, basis }, 'QA vision (advisory)');
const ctx = resolveBatchContext(date, undefined);
let manifest = null;
if (fs.existsSync(ctx.manifestPath)) {
  manifest = JSON.parse(fs.readFileSync(ctx.manifestPath, 'utf8'));
}
console.log(`◆ Active batch: ${ctx.batch} (manifest: ${fs.existsSync(ctx.manifestPath) ? path.relative(ROOT, ctx.manifestPath) : 'not found'})`);

const outDir = path.join(ARTIFACTS, date, ctx.batch);
fs.mkdirSync(outDir, { recursive: true });
const digest = {
  gate: 'qa-vision',
  advisory: true,
  status: 'RUN',
  date,
  batch: ctx.batch,
  prompt_version: PROMPT_VERSION,
  lens: '1-of-2 (scripted technical lens; lens 2 = model-context audit, §H.10)',
  posts: [],
};
const writeDigest = () => fs.writeFileSync(
  path.join(outDir, 'qa-vision.digest.json'), JSON.stringify(digest, null, 2) + '\n'
);

function finish(status, note) {
  digest.status = status;
  if (note) digest.note = note;
  writeDigest();
  console.log(`◆ qa-vision digest → ${path.relative(ROOT, path.join(outDir, 'qa-vision.digest.json'))}`);
}

// ── fail-open: prompt file integrity ──────────────────────────────────────
let prompt;
try {
  prompt = fs.readFileSync(PROMPT_FILE, 'utf8');
  if (!prompt.trim()) throw new Error('empty prompt file');
} catch (err) {
  console.error(`⚠ qa-vision SKIPPED — prompt file unreadable/empty (config bug, NEVER blocking): ${err.message}`);
  digest.posts.push({ prompt_status: `PROMPT-MISSING: ${err.message}` });
  finish('SKIPPED_PROMPT_ERROR');
  process.exit(0);
}

// ── fail-open: no GEMINI_API_KEY ───────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.error('⚠ qa-vision SKIPPED — GEMINI_API_KEY is not set (fail-open advisory semantics:');
  console.error('  dual-lens QA is an OPTIONAL preflight hook. Set GEMINI_API_KEY to enable lens 1;');
  console.error('  lens 2 (model-context creative audit, §H.10) remains the authoring session\'s duty.)');
  finish('SKIPPED_NO_KEY');
  process.exit(0);
}

// ── fail-open: no posts to audit ───────────────────────────────────────────
const posts = (manifest && manifest.posts) || [];
if (!posts.length) {
  console.log('⚠ qa-vision: manifest has 0 posts — nothing to audit.');
  finish('SKIPPED_EMPTY_BATCH');
  process.exit(0);
}

// Spawn the project's OWN pinned CLI (devDependency) via the current node —
// avoids the Windows `spawnSync('npx')` .cmd-shim failure (EINVAL/exit null
// without shell) AND avoids shell-quoting the multi-line --describe prompt.
// Fallback: `npx` spawn with shell when the package isn't installed (advisory
// hook degrades, never crashes).
function hyperframesCmd(subArgs) {
  try {
    const pkgDir = path.dirname(require.resolve('hyperframes/package.json'));
    const rel = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).bin.hyperframes;
    return { file: process.execPath, args: [path.join(pkgDir, rel), ...subArgs] };
  } catch {
    return { file: 'npx', args: ['hyperframes', ...subArgs], shell: true };
  }
}

// ── per-post snapshot + describe ───────────────────────────────────────────
for (const post of posts) {
  const htmlRel = String(post.html || '').replace(/\\/g, '/');
  const slug = post.slug || path.basename(htmlRel, '.html');
  const entry = { slug, html: htmlRel, status: 'RUN' };
  digest.posts.push(entry);
  const postDir = path.join(outDir, slug);
  fs.mkdirSync(postDir, { recursive: true });
  let restore = null;
  try {
    restore = setSoleRoute(htmlRel);
    const hf = hyperframesCmd([
      'snapshot', ROOT,
      '--composition', COMP_ID(slug),   // scoped interval — exclusive with --at (CLI contract)
      '--frames', '1',                  // one static frame (data-no-timeline posts)
      '--json',
      '--describe', prompt,
      '--output', postDir,
    ]);
    const res = spawnSync(hf.file, hf.args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 600000, shell: hf.shell === true });
    if (res.error) entry.error = String(res.error.message || res.error);
    fs.writeFileSync(path.join(postDir, 'snapshot-output.log'), (res.stdout || '') + (res.stderr || `\n[exit ${res.status}]`));
    let envelope = null;
    try { envelope = JSON.parse(res.stdout || 'null'); } catch { /* advisory */ }
    entry.status = res.status === 0 ? 'OK' : `CLI-ERR(exit ${res.status})`;
    entry.envelope = envelope;
    if (envelope && envelope.describe) entry.describe = envelope.describe;
    // make a Gemini-side describe failure visible at digest level (CLI
    // records it inside descriptions.md as '## (error)')
    if (envelope && envelope.descriptions) {
      try {
        const desc = fs.readFileSync(envelope.descriptions, 'utf8');
        if (/\(error\)/.test(desc)) {
          entry.describeStatus = 'GEMINI-ERROR (details in descriptions.md — advisory)';
        } else {
          entry.describeStatus = 'OK';
        }
      } catch { entry.describeStatus = 'DESCRIBES-UNREADABLE'; }
    }
    if (res.status !== 0) console.error(`⚠ qa-vision [${slug}] snapshot CLI error (advisory, recorded in digest)`);
    else console.log(`✓ qa-vision [${slug}] snapshot + describe captured → ${path.relative(ROOT, postDir)}/`);
  } catch (err) {
    entry.status = 'ERROR';
    entry.error = String(err.message || err);
    console.error(`⚠ qa-vision [${slug}] skipped (advisory, recorded in digest): ${err.message}`);
  } finally {
    if (restore) {
      try { restore(); } catch (e2) {
        entry.status = 'RESTORE-ERROR';
        entry.error = String(e2.message || e2);
        console.error(`✗ qa-vision [${slug}] ROUTER RESTORE FAILED — index.html is at the single-route state; re-ship's router sync will rebuild it.`);
      }
    }
  }
}

finish(digest.posts.every((p) => p.status === 'OK') ? 'OK' : 'PARTIAL');
console.log('◇ qa-vision advisory pass complete — findings are RECOMMENDATIONS for the authoring session, never gate verdicts.');
process.exit(0);
