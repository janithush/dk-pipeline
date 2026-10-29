// scripts/verify-loudness.js
// P7.0 AUTOMATED AUDIO CERTIFICATION GATE — replaces the manual
// `ffmpeg ebur128` eyeball pass that certified every reel since P4.0.
//
//   node scripts/verify-loudness.js                    # every reel MP4 of the ACTIVE batch
//   node scripts/verify-loudness.js --date 2026-10-26 [--batch batch-01]
//   node scripts/verify-loudness.js --slug story-04    # one manifest reel
//   node scripts/verify-loudness.js path/to/living.mp4 # explicit MP4(s)
//
// Certified delivery thresholds (docs/LIVING-STORY-SPEC.md, P6.0 doctrine —
// identical numbers the manual pass enforced):
//   Integrated loudness  −14 LUFS ± 0.5 LU  (−14.5 … −13.5 LUFS window)
//   True peak            ≤ −3.0 dBTP (ebur128 peak=true, reported dBFS)
//   Clipping             0 clipped samples (astats "Number of clipped samples")
//
// The measurement is persisted to
//   .hyperframes/artifacts/loudness/<date>-<batch>.digest.json
// (mirroring the verify-contrast digest contract), and ANY tolerance failure —
// or a reel whose MP4 is missing / unmeasurable — exits 1 (fail-closed).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError } = require('./lib/batch-context');

const ROOT = process.cwd();
const TARGET_LUFS = -14;
const TOLERANCE_LU = 0.5;
const TRUE_PEAK_MAX_DBFS = -3.0;
const MAX_CLIPPED_SAMPLES = 0;

const argv = process.argv.slice(2);
const slugFilter = (() => {
  const i = argv.indexOf('--slug');
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
})();

const { date, basis } = resolveBatchDate(argv);
logResolved({ date, basis }, 'Verify loudness');

// ── target collection ───────────────────────────────────────────────────
// Priority: explicit .mp4 path arguments > manifest reel posts of the batch.
// Flag parsing walks the vector (skips each flag's own value) so `--slug X`
// never leaks X into the positional file list.
const explicitFiles = [];
const flagValued = new Set(['--slug', '--date']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (flagValued.has(a)) { i++; continue; }         // swallow the flag value
  if (a.startsWith('--')) continue;                 // boolean flags
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) continue;      // date positional
  if (/\.mp4$/i.test(a)) explicitFiles.push(a);
}

const targets = [];
if (explicitFiles.length) {
  for (const f of explicitFiles) targets.push({ slug: path.basename(f, '.mp4'), file: path.isAbsolute(f) ? f : path.join(ROOT, f), source: 'argument' });
} else {
  const ctx = resolveBatchContext(date, undefined);
  if (!fs.existsSync(ctx.manifestPath)) {
    console.error(`✗ verify-loudness: manifest not found: ${ctx.manifestPath} — nothing to certify.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(ctx.manifestPath, 'utf8'));
  const schemaErr = manifestSchemaError(ctx, manifest);
  if (schemaErr) {
    console.error(`✗ verify-loudness: manifest invalid —\n   ${schemaErr}`);
    process.exit(1);
  }
  const isReelPost = (p) =>
    String(p.kind) === 'reel' ||
    (!('kind' in p) && /-living/i.test(path.basename(String(p.html), '.html')));
  for (const post of manifest.posts.filter(isReelPost)) {
    if (slugFilter && post.slug !== slugFilter) continue;
    const mp4 = path.join(ROOT, ...(String(post.output).split('/'))) + '.mp4';
    targets.push({ slug: post.slug, file: mp4, source: 'manifest', outputPath: String(post.output) });
  }
  if (!targets.length) {
    console.log(`◇ verify-loudness: no reel posts to certify for ${date} ${ctx.batch}${slugFilter ? ` (slug ${slugFilter})` : ''} — nothing to do.`);
    process.exit(0);
  }
}

// ── measurement helpers (parse ffmpeg/ffprobe stderr — no temp files) ───
function run(bin, args) {
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: 10 * 60 * 1000 });
  return { code: r.status, stderr: `${r.stderr || ''}`, stdout: `${r.stdout || ''}` };
}
const num = (v) => (v === null || v === undefined ? null : Number(v));

function measureEbur128(file) {
  const r = run('ffmpeg', ['-nostats', '-hide_banner', '-i', file,
    '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  if (r.code !== 0) return { error: `ffmpeg ebur128 failed (exit ${r.code})` };
  // Final summary block:  "I:  -14.3 LUFS" · "True peak:\n Peak:  -3.3 dBFS"
  const i = r.stderr.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
  const integrated = I(i);
  const peaks = [...r.stderr.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)];
  const truePeak = peaks.length ? num(peaks[peaks.length - 1][1]) : null;
  const lra = (() => { const m = r.stderr.match(/LRA:\s*(-?\d+(?:\.\d+)?)\s*LU\b/); return m ? num(m[1]) : null; })();
  return { integrated, truePeak, lra };
  function I(list) { return list && list.length ? num(/I:\s*(-?\d+(?:\.\d+)?)/.exec(list[list.length - 1])[1]) : null; }
}

function countClipped(file) {
  const r = run('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-af', 'astats', '-f', 'null', '-']);
  if (r.code !== 0) return { error: `ffmpeg astats failed (exit ${r.code})` };
  const counts = [...r.stderr.matchAll(/Number of clipped samples:\s*(\d+)/g)]
    .map((m) => num(m[1]));
  return { clipped: counts.length ? Math.max(...counts) : 0 };
}

function countFrames(file) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const n = r.code === 0 ? parseInt(r.stdout.trim(), 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

const mp4Size = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);

// ── certify every target (fail-closed) ──────────────────────────────────
const posts = [];
let violations = 0;

for (const t of targets) {
  const relFile = path.relative(ROOT, t.file).split(path.sep).join('/');
  console.log(`\n◆ [${t.slug}] measuring ${relFile}`);
  if (!fs.existsSync(t.file)) {
    console.error(`   ✗ MP4 missing — ${relFile} (reel output not rendered?)`);
    posts.push({ slug: t.slug, file: relFile, sizeBytes: 0, ok: false, error: 'MP4 missing' });
    violations++;
    continue;
  }
  const loud = measureEbur128(t.file);
  const clips = countClipped(t.file);
  const frames = countFrames(t.file);
  const sizeBytes = mp4Size(t.file);

  const checks = {
    integrated: loud.integrated !== null &&
      loud.integrated >= TARGET_LUFS - TOLERANCE_LU && loud.integrated <= TARGET_LUFS + TOLERANCE_LU,
    truePeak: loud.truePeak !== null && loud.truePeak <= TRUE_PEAK_MAX_DBFS,
    clipped: clips.error ? false : clips.clipped <= MAX_CLIPPED_SAMPLES,
  };
  const errs = [];
  if (loud.error) errs.push(loud.error);
  if (!checks.integrated) errs.push(loud.integrated === null ? 'integrated loudness unmeasurable' : `I ${loud.integrated} LUFS outside ${TARGET_LUFS - TOLERANCE_LU}…${TARGET_LUFS + TOLERANCE_LU}`);
  if (!checks.truePeak) errs.push(loud.truePeak === null ? 'true peak unmeasurable' : `TP ${loud.truePeak} dBFS above ${TRUE_PEAK_MAX_DBFS}`);
  if (!checks.clipped) errs.push(clips.error || `clipped samples ${clips.clipped ?? '?'} > ${MAX_CLIPPED_SAMPLES}`);
  const ok = !errs.length;

  if (ok) {
    console.log(`   ✓ pass — I ${loud.integrated} LUFS (target ${TARGET_LUFS} ±${TOLERANCE_LU}) · TP ${loud.truePeak} dBFS (≤ ${TRUE_PEAK_MAX_DBFS}) · clipped ${clips.clipped ?? 0} · ${frames ?? '?'} frames · ${(sizeBytes / 1048576).toFixed(2)} MB`);
  } else {
    console.error(`   ✗ FAIL — ${errs.join(' | ')}`);
    violations++;
  }
  posts.push({
    slug: t.slug, file: relFile, sizeBytes,
    integratedLUFS: loud.integrated, truePeakDbfs: loud.truePeak, lraLU: loud.lra ?? null,
    clippedSamples: clips.error ? null : (clips.clipped ?? null),
    frames, ok, errors: errs.length ? errs : undefined,
  });
}

// ── digest (same contract family as verify-contrast) ────────────────────
const ctx = resolveBatchContext(date, undefined);
const digestDir = path.join(ROOT, '.hyperframes', 'artifacts', 'loudness');
fs.mkdirSync(digestDir, { recursive: true });
const digestFile = path.join(digestDir, `${date}-${ctx.batch}.digest.json`);
const digest = {
  date, batch: ctx.batch, at: new Date().toISOString(),
  targets: { integratedTargetLUFS: TARGET_LUFS, integratedToleranceLU: TOLERANCE_LU, truePeakMaxDbfs: TRUE_PEAK_MAX_DBFS, maxClippedSamples: MAX_CLIPPED_SAMPLES },
  posts,
  ok: violations === 0,
};
fs.writeFileSync(digestFile, JSON.stringify(digest, null, 2) + '\n');

console.log(`\n◆ verify-loudness: ${posts.length - violations}/${posts.length} reel(s) certified — ${violations === 0 ? 'GREEN' : 'RED'}`);
console.log(`   digest: ${path.relative(ROOT, digestFile).split(path.sep).join('/')}`);
process.exit(violations === 0 ? 0 : 1);
