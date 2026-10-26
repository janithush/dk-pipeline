// scripts/downscale-assets.js
// Pre-flight asset downscaler for the HyperFrames production pipeline.
//
// Scans assets/raw/ for .jpg / .jpeg / .png photos and produces web-optimized
// copies in assets/raw/optimized/ using the system ffmpeg/ffprobe binaries.
//
//   - Ingestion limit: any source over 15MB, or wider/taller than 2048px, is
//     downscaled to fit within a 2048px box (never upscaled), re-encoded as
//     JPEG at ~85% quality, and stepped down until the output is under 2MB.
//   - Compliant sources (<=15MB and within 2048px) are symlinked (or copied,
//     where symlinks are unavailable) straight into assets/raw/optimized/.
//   - SAFETY: raw originals in assets/raw/ are NEVER written to or overwritten.
//     Every output path is resolved and asserted to live inside optimized/.
//   - STRICT 1:1 MIRROR (2026-10-26, operator directive): assets/raw/optimized/
//     must mirror assets/raw/ EXACTLY — after ingestion, any optimized copy
//     whose source slug is no longer present in assets/raw/ is DELETED
//     automatically (no flag, no retention). Consumed assets are resolved
//     post-rotation from git history / archive/ — never from stale inventory.
//
// Usage:
//   node scripts/downscale-assets.js           # process new/changed assets
//   node scripts/downscale-assets.js --force   # reprocess everything
//
// Requires: ffmpeg + ffprobe available on PATH.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'assets', 'raw');
const OUT_DIR = path.join(SRC_DIR, 'optimized');
const COMPOSITIONS_REF_DIR = path.join(ROOT, 'compositions');

const INGEST_MAX_BYTES = 15 * 1024 * 1024; // 15MB ingestion ceiling
const OPT_MAX_BYTES = 2 * 1024 * 1024;     // optimized copy target: <= 2MB
const MAX_DIM = 2048;                      // max width/height (px)
const FORCE = process.argv.includes('--force');

// JPEG quality ladder (ffmpeg mjpeg qscale: lower = better quality).
// Index 0 (~3) approximates libjpeg quality ~85%; we only step DOWN quality
// if the encode still exceeds the 2MB budget.
const JPEG_Q_LADDER = [3, 5, 8, 12, 18, 25];

// ── TOOLING GUARDS ──────────────────────────────────────────────────────
function assertTool(name) {
  try {
    execFileSync(name, ['-version'], { stdio: 'ignore' });
  } catch (err) {
    console.error(`✗ ${name} not found on PATH — install ffmpeg (which ships ffprobe) first.`);
    process.exit(1);
  }
}
assertTool('ffmpeg');
assertTool('ffprobe');

if (!fs.existsSync(SRC_DIR)) {
  console.error(`✗ source directory not found: ${SRC_DIR}`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── HELPERS ─────────────────────────────────────────────────────────────
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)}MB`;

// Rotation-aware dimension probe (EXIF-rotated photos report transposed axes).
function probeDimensions(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-show_entries', 'stream_side_data=rotation',
    '-of', 'json',
    file,
  ], { encoding: 'utf8' });
  const stream = (JSON.parse(out).streams || [])[0];
  if (!stream || !stream.width || !stream.height) return null;
  let { width, height } = stream;
  const rot = Number(
    (stream.side_data_list || []).find((sd) => sd.rotation != null)?.rotation || 0
  );
  if (Math.abs(rot) % 180 === 90) [width, height] = [height, width]; // portrait EXIF
  return { width, height };
}

// Fit (w,h) inside a MAX_DIM box without ever upscaling.
function fitWithin(w, h) {
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

// Every write MUST land inside OUT_DIR and must never be the raw original.
function assertSafeOutput(dest, src) {
  const outRoot = path.resolve(OUT_DIR) + path.sep;
  const resolved = path.resolve(dest);
  if (!resolved.startsWith(outRoot)) {
    throw new Error(`refusing to write outside ${OUT_DIR}: ${dest}`);
  }
  if (resolved === path.resolve(src)) {
    throw new Error(`refusing to overwrite raw original: ${src}`);
  }
}

// ── FILENAME SANITIZATION ───────────────────────────────────────────────
// Optimized output names MUST satisfy ^[A-Za-z0-9._-]+\.(jpg|jpeg|png)$ —
// spaces and other URL-unsafe characters break <img src> resolution in
// headless rendering and lint asset tracing. Raw originals are never renamed;
// only the OPTIMIZED COPY name is slugged, and the mapping is logged so
// compositions reference the slugged name.
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+\.(jpe?g|png)$/i;

function slugName(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const slug = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')  // unsafe chars → single dash
    .replace(/-{2,}/g, '-')              // collapse runs
    .replace(/^-+|-+$/g, '');            // trim edge dashes
  return `${slug}${ext}`;
}

function runFfmpeg(args, label) {
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    const detail = (err.stderr || Buffer.from('')).toString().trim();
    throw new Error(`ffmpeg failed (${label})${detail ? `: ${detail}` : ''}`);
  }
}

// JPEG encode with the quality ladder — first rung ~85%, only degrade if the
// output still breaks the 2MB budget.
function encodeJpeg(inPath, outPath, w, h, label) {
  for (const q of JPEG_Q_LADDER) {
    runFfmpeg(
      ['-i', inPath, '-vf', `scale=${w}:${h}:flags=lanczos`, '-q:v', String(q), outPath],
      `${label} q=${q}`
    );
    if (fs.statSync(outPath).size <= OPT_MAX_BYTES) return q;
  }
  return JPEG_Q_LADDER[JPEG_Q_LADDER.length - 1]; // best effort under budget
}

function optimizeImage(src, dest, width, height) {
  const { w, h } = fitWithin(width, height);
  const isPng = /\.png$/i.test(src);
  const label = `${path.basename(src)} -> ${path.basename(dest)}`;

  if (!isPng) {
    // JPEG (or other raster) source -> optimized JPEG.
    const outPath = dest.replace(/\.[^.]+$/, '.jpg');
    assertSafeOutput(outPath, src);
    const q = encodeJpeg(src, outPath, w, h, label);
    return { outPath, note: `${w}x${h}, jpeg q=${q}` };
  }

  // PNG source: keep lossless PNG (preserves alpha) if it fits the budget...
  assertSafeOutput(dest, src);
  runFfmpeg(
    ['-i', src, '-vf', `scale=${w}:${h}:flags=lanczos`, '-compression_level', '9', dest],
    `${label} png`
  );
  if (fs.statSync(dest).size <= OPT_MAX_BYTES) {
    return { outPath: dest, note: `${w}x${h}, png` };
  }
  // ...otherwise flatten onto white and JPEG-compress (transparency lost).
  fs.unlinkSync(dest);
  const outPath = dest.replace(/\.[^.]+$/, '.jpg');
  assertSafeOutput(outPath, src);
  const q = encodeJpegFlatten(src, outPath, w, h, label);
  return { outPath, note: `${w}x${h}, flattened jpeg q=${q} (png exceeded 2MB)` };
}

// Flatten RGBA onto a white canvas, then run the JPEG quality ladder.
function encodeJpegFlatten(inPath, outPath, w, h, label) {
  for (const q of JPEG_Q_LADDER) {
    const filter =
      `[0:v]scale=${w}:${h}:flags=lanczos,format=rgba[fg];` +
      `color=white:s=${w}x${h}:r=1[bg];` +
      `[bg][fg]overlay=0:0:shortest=1:format=auto[out]`;
    runFfmpeg(
      ['-i', inPath, '-filter_complex', filter, '-map', '[out]',
       '-frames:v', '1', '-q:v', String(q), outPath],
      `${label} flatten q=${q}`
    );
    if (fs.statSync(outPath).size <= OPT_MAX_BYTES) return q;
  }
  return JPEG_Q_LADDER[JPEG_Q_LADDER.length - 1];
}

// Already-compliant source -> symlink (no duplication) or copy fallback.
// Windows without Developer Mode/admin cannot create symlinks, so we degrade
// gracefully to a byte-for-byte copy.
function linkOrCopy(src, dest) {
  assertSafeOutput(dest, src);
  try {
    const existing = fs.lstatSync(dest);
    if (existing.isSymbolicLink()) {
      if (fs.realpathSync(dest) === fs.realpathSync(src)) return 'symlink (up to date)';
      fs.unlinkSync(dest);
    } else if (existing.isFile()) {
      const srcStat = fs.statSync(src);
      if (existing.size === srcStat.size && existing.mtimeMs >= srcStat.mtimeMs) {
        return 'copy (up to date)';
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  try {
    fs.symlinkSync(path.resolve(src), dest, 'file');
    return 'symlink';
  } catch {
    fs.copyFileSync(src, dest);
    return 'copy';
  }
}

// ── MAIN ────────────────────────────────────────────────────────────────
const sources = fs.readdirSync(SRC_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && /\.(jpe?g|png)$/i.test(e.name))
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (sources.length === 0) {
  console.log(`◆ No .jpg/.jpeg/.png assets found in ${SRC_DIR} — nothing to do.`);
  process.exit(0);
}

console.log(`◆ Pre-flight asset downscaler: ${SRC_DIR}`);
console.log(`   sources: ${sources.length} | output: ${OUT_DIR}`);
console.log(`   limits: <=${mb(INGEST_MAX_BYTES)} ingestion, <=${MAX_DIM}px, optimized <=${mb(OPT_MAX_BYTES)}\n`);

let linked = 0;
let optimized = 0;
let unchanged = 0;
const failures = [];
const seenSlugs = new Map(); // safeName -> first source name (collision guard)

for (const name of sources) {
  const src = path.join(SRC_DIR, name);
  try {
    // Slug the OUTPUT name (never the raw original). Log the mapping so
    // compositions reference the safe, regex-compliant name.
    const safeName = slugName(name);
    if (safeName !== name) {
      if (seenSlugs.has(safeName)) {
        throw new Error(`slug collision: "${name}" and "${seenSlugs.get(safeName)}" both map to "${safeName}"`);
      }
      console.log(`↷ [${name}] name contains unsafe characters — optimized copy will be written as: ${safeName}`);
      // Deterministic supersede: drop the previous unslugged optimized copy
      // (lives inside optimized/ only; raw original untouched).
      const legacyDest = path.join(OUT_DIR, name);
      if (SAFE_NAME_RE.test(name) === false && fs.existsSync(legacyDest)) {
        fs.unlinkSync(legacyDest);
        console.log(`  ↷ removed superseded unslugged optimized copy: ${name}`);
      }
    }
    seenSlugs.set(safeName, name);

    const { size } = fs.statSync(src);
    const dims = probeDimensions(src);
    if (!dims) {
      console.warn(`⚠ [${name}] unreadable via ffprobe — skipped (not copied)`);
      failures.push(name);
      continue;
    }

    const exceeds = size > INGEST_MAX_BYTES || dims.width > MAX_DIM || dims.height > MAX_DIM;
    const dest = path.join(OUT_DIR, safeName);

    // Skip reprocessing when a compliant, current optimized copy already exists.
    if (!FORCE && !exceeds && fs.existsSync(dest)) {
      console.log(`= [${safeName}] already optimized — up to date`);
      unchanged++;
      continue;
    }

    if (exceeds) {
      const { outPath, note } = optimizeImage(src, dest, dims.width, dims.height);
      console.log(`✓ [${name}] downscaled ${mb(size)} ${dims.width}x${dims.height} -> ${mb(fs.statSync(outPath).size)} ${note}`);
      optimized++;
    } else {
      const how = linkOrCopy(src, dest);
      console.log(`✓ [${name}] within limits (${mb(size)} ${dims.width}x${dims.height}) -> ${how}`);
      linked++;
    }
  } catch (err) {
    console.error(`✗ [${name}] ${err.message}`);
    failures.push(name);
  }
}

// P6 (2026-10-21 audit): persist the slug map so later steps (manifest build,
// runbook review, incident forensics) can resolve safeName -> original name
// without re-running the optimizer. MERGE-aware (2026-10-23 hardening): raws
// are routinely deleted after a batch consumes them (intraday Scenario B),
// so the map below carries BOTH the current sources' mapping AND the history
// of already-consumed sources — a destructive rewrite would erase the audit
// trail this file exists to provide.
const mapPath = path.join(OUT_DIR, 'slug-map.json');
if (seenSlugs.size > 0 || fs.existsSync(mapPath)) {
  let existingMap = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existingMap = parsed;
    else if (fs.existsSync(mapPath)) throw new Error('slug-map.json is not an object');
  } catch (err) {
    console.warn(`⚠ slug-map.json unreadable (${err.message}) — starting a fresh mapping (history lost).`);
  }
  const merged = { ...existingMap, ...Object.fromEntries(seenSlugs) };
  fs.writeFileSync(mapPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\n◆ slug map persisted: ${path.relative(ROOT, mapPath)} (${Object.keys(merged).length} entr${Object.keys(merged).length === 1 ? 'y' : 'ies'} — ${seenSlugs.size} current, ${Object.keys(merged).length - seenSlugs.size} historical)`);
}

// ── STRICT 1:1 MIRROR SYNC (2026-10-26, operator directive) ─────────────
// assets/raw/optimized/ must match assets/raw/ exactly — zero stale orphans,
// zero missing copies, same count, same identities. Bi-directional parity:
//   · raw present, optimized missing  → generated by the ingestion loop above;
//   · optimized present, raw GONE     → DELETED here, on EVERY invocation.
// The retired "report-only / referenced-aware" posture is superseded: a
// consumed asset is resolved post-rotation from git history / archive/,
// never from stale inventory. slug-map.json is untouched by pruning (its
// history IS the audit trail); a pruned file still referenced by an active
// composition is warned loudly (check-paths will fail that composition —
// the expected rotation signal).
const currentSafe = new Set(seenSlugs.keys());
const scanRef = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scanRef(p);
    else if (e.name.endsWith('.html')) {
      const h = fs.readFileSync(p, 'utf8');
      for (const m of h.matchAll(/assets\/raw\/optimized\/([A-Za-z0-9._-]+\.(?:jpe?g|png))/gi)) referenced.add(m[1]);
    }
  }
};
const referenced = new Set();
scanRef(COMPOSITIONS_REF_DIR);
const surplus = fs.existsSync(OUT_DIR)
  ? fs.readdirSync(OUT_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f) && !currentSafe.has(f))
  : [];
let pruned = 0;
if (surplus.length) {
  console.log(`\n◆ strict mirror: ${surplus.length} optimized copy(ies) with no raw source — auto-pruning (STRICT 1:1, 2026-10-26):`);
  const stillReferenced = surplus.filter((f) => referenced.has(f));
  if (stillReferenced.length) console.warn(`   ⚠ still referenced by active compositions (check-paths will fail them — expected after rotation): ${stillReferenced.join(', ')}`);
  for (const f of surplus) {
    try { fs.unlinkSync(path.join(OUT_DIR, f)); pruned++; console.log(`   ✂ pruned: assets/raw/optimized/${f}`); }
    catch (err) { console.warn(`   ⚠ prune failed (${f}): ${err.message}`); }
  }
}
// Parity proof: identities AND counts must agree after the sync.
const rawFiles = fs.readdirSync(SRC_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && /\.(jpe?g|png)$/i.test(e.name)).map((e) => e.name);
const optFiles = fs.existsSync(OUT_DIR)
  ? fs.readdirSync(OUT_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(jpe?g|png)$/i.test(e.name)).map((e) => e.name)
  : [];
const rawSet = new Set(rawFiles.map((f) => slugName(f)));
const optSet = new Set(optFiles);
const identityParity = rawSet.size === optSet.size && [...rawSet].every((s) => optSet.has(s));
console.log(`\n◆ active pool: ${rawFiles.length} raw ⇄ ${optFiles.length} optimized (1:1 ${identityParity ? 'OK' : 'MISMATCH — investigate before composition work'})`);
if (!identityParity) process.exitCode = 1;

console.log(`\n◆ Complete: ${optimized} downscaled, ${linked} linked/copied, ${unchanged} unchanged, ${failures.length} failed`);
console.log('  All composition work must now source photos from assets/raw/optimized/.');

if (failures.length > 0) {
  console.error(`✗ Failed assets: ${failures.join(', ')}`);
  process.exit(1);
}
