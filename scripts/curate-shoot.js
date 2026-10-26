#!/usr/bin/env node
// scripts/curate-shoot.js
// ── P3.0 MODEL-AGNOSTIC SHOOT CURATOR (2026-10-26, operator directive) ──────
// Standalone curation step: audits the ACTIVE assets/raw/optimized/ pool ONCE
// per shoot drop and writes assets/raw/optimized/vision-manifest.json (schema
// v1). Composition authoring + pairing decisions read that CACHE — no vision
// work happens per render or per layout switch.
//
// EXECUTION CONTRACT (model-agnostic, zero key lock-in):
//   · The DETERMINISTIC tier below runs here, always: 1:1 parity proof,
//     sha256 staleness keys, 64-bit grayscale aHash (ffmpeg scale=8:8 gray
//     rawvideo — the same decode path samplePixels proved), Laplacian
//     sharpness, EXIF harvest from assets/raw/ ORIGINALS (optimized copies
//     are ffmpeg re-encodes — EXIF stripped), and pane over-crop metrics
//     against the real family geometry.
//   · The VISUAL tier (density / focusZone / subject / tones) is answered by
//     whatever multimodal model the operator runs in their session (GLM-5.3
//     Flash, Nemotron-VL, proxy-routed — anything), against the versioned
//     prompt scripts/curate-shoot-prompt.txt. The model's JSON reaches this
//     script as an intake file — no SDK, no API key, no vendor code ever
//     enters this repo.
//   · FAIL-CLOSED ON QUALITY: with no valid intake this script writes NO
//     manifest — there is no deterministic-only fallback masquerading as
//     curation, and no degraded post with twin burst shots can ever ship:
//       [FATAL] Multimodal AI is offline or unresponsive. Cannot guarantee
//       editorial curation. Please connect your model.
//
// Usage:
//   node scripts/curate-shoot.js                    # deterministic tier + intake check
//                                                   # (idempotent exit 0 when the pool is unchanged)
//   node scripts/curate-shoot.js --intake <file>    # merge the model's vision JSON (validates, then writes)
//   node scripts/curate-shoot.js --intake -         # same, JSON on stdin
//
// Requires: ffmpeg + ffprobe on PATH. Writes ONLY into assets/raw/optimized/
// (vision-manifest.json — a mirror-exempt JSON ledger, exactly like
// slug-map.json: the strict 1:1 image mirror cannot touch it). NEVER writes
// into assets/raw/ (read-only, for the EXIF harvest only).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'assets', 'raw');
const OPT_DIR = path.join(RAW_DIR, 'optimized');
const MANIFEST_PATH = path.join(OPT_DIR, 'vision-manifest.json');
const INTAKE_PATH = path.join(OPT_DIR, 'vision-intake.json');   // conventional intake inbox
const PROMPT_PATH = path.join(__dirname, 'curate-shoot-prompt.txt');

// Tunables pinned by directive / engine contract (NOT magic numbers — cited):
const BURST_HAMMING = 12;              // Hamming < 12/64 → burst cluster (2026-10-26 mission §Task A)
const HERO_RECT = { w: 1080, h: 1037 }; // top pane (--duo-top-h × full width) — Rule A anchor
const DETAIL_RECT = { w: 539, h: 881 }; // bottom rail cell ((1080 − gutter)/2 × --duo-bottom-h)
const RULE_A_EPSILON = 0.05;           // crop-loss tie band: candidates within min+ε may host the hero

// Closed vocabularies — the ONLY strings the intake may use (fail-closed).
const DENSITIES = ['ACTIVE_COMPLEX', 'CALM_PLANAR'];
const FOCUS_ZONES = ['HARDWARE_PULL', 'SURFACE_TEXTURE', 'JOINERY_JUNCTION', 'APPLIANCE', 'NONE'];
const TONE_FAMILIES = ['sage', 'warm-timber', 'crisp-white', 'charcoal', 'brass', 'stone-greige', 'other'];
const VERDICTS = ['PASS', 'FAIL'];

const FATAL = '[FATAL] Multimodal AI is offline or unresponsive. Cannot guarantee editorial curation. Please connect your model.';
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// Slug derivation MUST match scripts/downscale-assets.js slugName(). If the
// two ever diverge, the parity refusal below fires loudly (fail-closed
// self-detection — stale inventory can never pass silently).
function slugName(name) {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, path.extname(name));
  const slug = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return `${slug}${ext}`;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// One 64×64 grayscale decode per file feeds THREE metrics: the 8×8 aHash
// (block-mean downsample), Laplacian-variance sharpness (burst representative
// election), and the mean-luma sanity check. No image is ever re-decoded.
function grayDecode(file) {
  const buf = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file, '-vf', 'scale=64:64:flags=area',
    '-pix_fmt', 'gray', '-f', 'rawvideo', '-',
  ], { maxBuffer: 16 * 1024 * 1024 });
  if (buf.length !== 64 * 64) throw new Error(`gray decode expected 4096 bytes, got ${buf.length}`);
  return buf;
}

function aHash64(gray) {
  // 64×64 → 8×8 block means (box downsample), then mean-threshold → 64 bits.
  const block = new Array(64).fill(0);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      block[((y >> 3) << 3) + (x >> 3)] += gray[y * 64 + x];
    }
  }
  const cells = block.map((s) => s / 64);
  const mean = cells.reduce((a, b) => a + b, 0) / 64;
  let hex = '';
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) if (cells[row * 8 + col] > mean) byte |= 1 << (7 - col);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function laplacianVariance(gray) {
  // Sharpness proxy on the 64×64 plane (4-neighbour Laplacian, interior only).
  const l = [];
  for (let y = 1; y < 63; y++) {
    for (let x = 1; x < 63; x++) {
      const i = y * 64 + x;
      l.push(Math.abs(2 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - 64] - gray[i + 64]));
    }
  }
  const mean = l.reduce((a, b) => a + b, 0) / l.length;
  return l.reduce((a, b) => a + (b - mean) ** 2, 0) / l.length;
}

const hamming = (h1, h2) => {
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
};

// Cover-fit crop loss against a pane rect — the SAME cover math the browser
// and samplePixels perform (scale = max(rectW/iw, rectH/ih), visible fraction
// of the source survives). Deterministic Rule-A geometry.
function cropLoss(iw, ih, rect) {
  const scale = Math.max(rect.w / iw, rect.h / ih);
  const visW = rect.w / scale, visH = rect.h / scale;
  return 1 - (visW * visH) / (iw * ih);
}

function probeDims(file) {
  const out = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', file,
  ], { maxBuffer: 16 * 1024 * 1024 }));
  const s = out.streams?.[0];
  if (!s || !s.width || !s.height) throw new Error('ffprobe returned no dimensions');
  return { width: s.width, height: s.height };
}

// EXIF lives ONLY on the raw originals (ffmpeg re-encode strips it from the
// optimized copies; SharePoint sync strips/resets it anyway — doctrine #3:
// timestamps are NEVER load-bearing). Every tag is tolerated-absent.
function probeExif(rawFile) {
  try {
    const out = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', rawFile,
    ], { maxBuffer: 16 * 1024 * 1024 }));
    const tags = { ...(out.format?.tags || {}), ...(out.streams?.[0]?.tags || {}) };
    const pick = (re) => {
      const k = Object.keys(tags).find((t) => re.test(t));
      return k ? String(tags[k]) : null;
    };
    const focalRaw = pick(/focallength(35mm)?$/i) || pick(/focallength/i);
    const focal = focalRaw ? parseFloat(String(focalRaw).replace(/[^0-9.]/g, '')) : null;
    return {
      focalLength35: focal && Number.isFinite(focal) ? focal : null,
      dateTimeOriginal: pick(/datetimeoriginal/i),   // audit trail ONLY — never gating
    };
  } catch {
    return { focalLength35: null, dateTimeOriginal: null };
  }
}

// Single-linkage burst clustering over pairwise Hamming distance.
function cluster(pool) {
  const names = Object.keys(pool).sort();
  const parent = new Map(names.map((n) => [n, n]));
  const find = (n) => (parent.get(n) === n ? n : parent.set(n, find(parent.get(n))).get(n));
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (hamming(pool[names[i]].ahash, pool[names[j]].ahash) < BURST_HAMMING) {
        const a = find(names[i]), b = find(names[j]);
        if (a !== b) parent.set(a, b);
      }
    }
  }
  const groups = new Map();
  for (const n of names) {
    const root = find(n);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  }
  let id = 0;
  for (const members of groups.values()) {
    members.sort();
    const cid = members.length > 1 ? `bc-${String(++id).padStart(3, '0')}` : 'unique';
    // Representative = sharpest member (Laplacian variance — deterministic).
    const rep = [...members].sort((a, b) => pool[b].sharpness - pool[a].sharpness)[0];
    for (const m of members) {
      pool[m].burstCluster = cid;
      pool[m].burstRep = m === rep;
    }
  }
  return groups;
}

// ── Intake validation (fail-closed, per-field violation ledger) ────────────
function validateIntake(intake, pool, heroCandidates) {
  const v = [];
  const names = Object.keys(pool);
  if (!intake || typeof intake !== 'object' || Array.isArray(intake)) return ['intake root must be an object'];
  if (!intake.vision || typeof intake.vision !== 'object') v.push('missing "vision" map');
  if (!intake.pairing || typeof intake.pairing !== 'object') v.push('missing "pairing" object');
  if (v.length) return v;

  for (const f of names) {
    const e = intake.vision[f];
    const at = `vision["${f}"]`;
    if (!e || typeof e !== 'object') { v.push(`${at}: missing entry`); continue; }
    if (!DENSITIES.includes(e.density)) v.push(`${at}.density: "${e.density}" not in ${DENSITIES.join('|')}`);
    if (!FOCUS_ZONES.includes(e.focusZone)) v.push(`${at}.focusZone: "${e.focusZone}" not in ${FOCUS_ZONES.join('|')}`);
    if (typeof e.subject !== 'string' || !e.subject.trim()) v.push(`${at}.subject: required non-empty string (abstract assembly description)`);
    if (typeof e.detailNote !== 'string') v.push(`${at}.detailNote: required string`);
    for (const r of ['primary', 'secondary']) {
      const t = e.tones?.[r];
      if (!t || typeof t.hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(t.hex)) v.push(`${at}.tones.${r}.hex: required #rrggbb`);
      if (!t || !TONE_FAMILIES.includes(t.family)) v.push(`${at}.tones.${r}.family: "${t?.family}" not in ${TONE_FAMILIES.join('|')}`);
    }
  }

  const p = intake.pairing;
  const inPool = (f, at) => { if (!pool[f]) v.push(`${at}: "${f}" is not in the active pool`); };
  inPool(p.hero, 'pairing.hero'); inPool(p.bl, 'pairing.bl'); inPool(p.br, 'pairing.br');
  if (pool[p.bl] && pool[p.br] && p.bl === p.br) v.push('pairing: bl and br must be distinct files');
  if (pool[p.hero] && (p.hero === p.bl || p.hero === p.br)) v.push('pairing: hero must not double as a detail pane');
  // Burst-twin guard (deterministic Rule B backstop): two frames of the SAME
  // burst cluster may never occupy both detail panes.
  if (pool[p.bl]?.burstCluster !== 'unique' && pool[p.bl]?.burstCluster === pool[p.br]?.burstCluster) {
    v.push(`pairing: bl/br are the same burst cluster (${pool[p.bl].burstCluster}) — twin-drawer defect class, refused`);
  }
  // Rule A is geometric law: the hero must sit in the deterministic candidate set.
  if (names.length && p.hero && !heroCandidates.includes(p.hero)) {
    v.push(`pairing.hero: "${p.hero}" is not a Rule-A candidate (crop-loss tie band ±${RULE_A_EPSILON}: ${heroCandidates.join(', ')})`);
  }
  // Rule C (density inversion) is enforceable from the declared classes.
  const db = intake.vision[p.bl]?.density, dr = intake.vision[p.br]?.density;
  if (db && dr && db === dr) v.push(`pairing: density inversion violated — both panes are ${db} (Rule C)`);
  // Rule D: the declared echo pane must actually share a tone family with the hero.
  const echo = p.echoPane === 'br' ? p.br : p.bl;
  if (p.echoPane && !['bl', 'br'].includes(p.echoPane)) v.push('pairing.echoPane: must be "bl" or "br"');
  const fam = (f) => [intake.vision[f]?.tones?.primary?.family, intake.vision[f]?.tones?.secondary?.family];
  if (intake.vision[p.hero] && intake.vision[echo]) {
    const heroFam = new Set(fam(p.hero));
    if (!fam(echo).some((x) => heroFam.has(x))) {
      v.push(`pairing: Rule D violated — echo pane ${p.echoPane} (${echo}) shares no tone family with hero (${[...heroFam].join(', ')})`);
    }
  }
  for (const r of ['B', 'C', 'D']) {
    if (!VERDICTS.includes(p.ruleVerdicts?.[r])) v.push(`pairing.ruleVerdicts.${r}: required PASS|FAIL`);
    else if (p.ruleVerdicts[r] === 'FAIL') v.push(`pairing.ruleVerdicts.${r}: FAIL — the model refused this pairing; fail-closed (propose a different pairing)`);
  }
  if (typeof p.rationale !== 'string' || !p.rationale.trim()) v.push('pairing.rationale: required string');
  return v;
}

// ── MAIN ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const intakeFlag = args.indexOf('--intake');

// 1) PARITY PROOF — the strict 1:1 mirror is a precondition for curation.
const raws = fs.existsSync(RAW_DIR)
  ? fs.readdirSync(RAW_DIR, { withFileTypes: true }).filter((e) => e.isFile() && /\.(jpe?g|png)$/i.test(e.name)).map((e) => e.name)
  : [];
const opts = fs.existsSync(OPT_DIR)
  ? fs.readdirSync(OPT_DIR, { withFileTypes: true }).filter((e) => e.isFile() && /\.(jpe?g|png)$/i.test(e.name)).map((e) => e.name)
  : [];
const rawSlugs = raws.map((f) => slugName(f));
const parityOK = rawSlugs.length === opts.length && opts.every((f) => rawSlugs.includes(f)) && new Set(rawSlugs).size === rawSlugs.length;
console.log(`◆ parity: assets/raw ${raws.length} ⇄ assets/raw/optimized ${opts.length} (${parityOK ? '1:1 OK' : 'MISMATCH'})`);
if (!parityOK) {
  die(`[FATAL] asset parity broken — run "node scripts/downscale-assets.js" first (raw⇄optimized 1:1 mirror must hold before curation).\n`
    + `   raw slugs: ${rawSlugs.join(', ')}\n   optimized: ${opts.join(', ')}`);
}

// 2) STALENESS KEYS (sha256) — poll-on-read cache validation, no fs.watch.
const pool = {};
for (const f of opts) {
  pool[f] = {
    bytes: fs.statSync(path.join(OPT_DIR, f)).size,
    sha256: sha256(path.join(OPT_DIR, f)),
  };
}

// Idempotence: pool unchanged since the last successful curation → done.
if (intakeFlag === -1 && fs.existsSync(MANIFEST_PATH)) {
  try {
    const prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const prevHashes = Object.entries(prev.pool || {}).map(([f, e]) => `${f}:${e.sha256}`).sort().join(';');
    const curHashes = Object.entries(pool).map(([f, e]) => `${f}:${e.sha256}`).sort().join(';');
    if (prevHashes === curHashes && prev.parity?.mirror === '1:1-OK') {
      console.log(`◆ vision-manifest.json is FRESH (pool sha256 set unchanged) — cache hit, nothing to do.`);
      process.exit(0);
    }
    console.log('◆ vision-manifest.json is STALE (pool changed) — recomputing deterministic tier…');
  } catch { /* corrupt cache → full recompute below */ }
}

// 3) DETERMINISTIC METRICS per file (one gray decode + one ffprobe each).
for (const f of opts) {
  const file = path.join(OPT_DIR, f);
  const rawOriginal = path.join(RAW_DIR, raws[rawSlugs.indexOf(f)] || f);
  const gray = grayDecode(file);
  const dims = probeDims(file);
  pool[f] = {
    ...pool[f],
    ...dims,
    orientation: dims.width >= dims.height ? 'landscape' : 'portrait',
    exif: probeExif(rawOriginal),
    ahash: aHash64(gray),
    sharpness: Math.round(laplacianVariance(gray) * 10) / 10,
    spatialClass: dims.width >= dims.height ? 'WIDE_HERO' : 'DETAIL_MACRO',
    heroCropLoss: Math.round(cropLoss(dims.width, dims.height, HERO_RECT) * 1000) / 1000,
    detailCropLoss: Math.round(cropLoss(dims.width, dims.height, DETAIL_RECT) * 1000) / 1000,
  };
}

// 4) BURST CLUSTERS + Rule A nomination.
cluster(pool);
const minHeroLoss = Math.min(...Object.values(pool).map((e) => e.heroCropLoss));
const heroCandidates = Object.keys(pool).filter((f) => pool[f].heroCropLoss <= minHeroLoss + RULE_A_EPSILON)
  .sort((a, b) => pool[a].heroCropLoss - pool[b].heroCropLoss);
console.log('◆ deterministic tier:');
{
  const groups = {};
  for (const [f, e] of Object.entries(pool)) (groups[e.burstCluster] ||= []).push(f);
  for (const [cid, members] of Object.entries(groups).sort()) {
    const reps = members.filter((m) => pool[m].burstRep);
    console.log(`   ${cid === 'unique' ? '· unique' : `✂ ${cid} (burst, Hamming < ${BURST_HAMMING})`}: ${members.join(' | ')}${members.length > 1 ? ` → rep: ${reps.join(',')}` : ''}`);
  }
}
console.log(`   Rule A hero candidates (crop loss ≤ ${(minHeroLoss + RULE_A_EPSILON).toFixed(3)}): ${heroCandidates.join(', ')}`);
for (const f of opts) {
  const e = pool[f];
  console.log(`   · ${f} ${e.width}×${e.height} ${e.orientation} aHash ${e.ahash} heroLoss ${e.heroCropLoss} detailLoss ${e.detailCropLoss}${e.exif.focalLength35 != null ? ` focal ${e.exif.focalLength35}mm` : ' (EXIF stripped — crop-scale proxy only)'}`);
}

// 5) INTAKE RESOLUTION — fail-closed; the visual tier is NOT optional.
const readIntake = () => {
  if (intakeFlag !== -1) {
    const src = args[intakeFlag + 1];
    if (!src) die('[FATAL] --intake requires a file path or "-" for stdin.');
    const json = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(src), 'utf8');
    return { json, from: src === '-' ? 'stdin' : rel(path.resolve(src)) };
  }
  if (fs.existsSync(INTAKE_PATH)) return { json: fs.readFileSync(INTAKE_PATH, 'utf8'), from: rel(INTAKE_PATH) };
  return null;
};
const found = readIntake();
if (!found) {
  die(`${FATAL}\n`
    + `   → the session model answers ${rel(PROMPT_PATH)} (v1) for the ${opts.length}-file pool above and re-runs:\n`
    + `     node scripts/curate-shoot.js --intake assets/raw/optimized/vision-intake.json`);
}

let intake;
try { intake = JSON.parse(found.json); } catch (e) { die(`${FATAL}\n   → intake JSON unparseable (${found.from}): ${e.message}`); }

const violations = validateIntake(intake, pool, heroCandidates);
if (violations.length) {
  die(`${FATAL}\n   → intake FAILED validation (${found.from}) — no manifest written:\n${violations.map((x) => `     ✗ ${x}`).join('\n')}`);
}

// 6) WRITE the manifest (schema v1) + retire the transient intake.
const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  generator: 'curate-shoot.js v1 (P3.0)',
  model: intake.model || 'session-agent',
  parity: { raw: raws.length, optimized: opts.length, mirror: '1:1-OK' },
  pool,
  vision: Object.fromEntries(opts.map((f) => [{
    [f]: {
      density: intake.vision[f].density,
      focusZone: intake.vision[f].focusZone,
      subject: intake.vision[f].subject,
      tones: intake.vision[f].tones,
      detailNote: intake.vision[f].detailNote,
      provenance: `model:${intake.model || 'session-agent'}`,
    },
  }[f]])),
  pairing: {
    recommended: {
      hero: intake.pairing.hero,
      bl: intake.pairing.bl,
      br: intake.pairing.br,
      echoPane: intake.pairing.echoPane,
      rationale: intake.pairing.rationale,
      scores: {
        spatial: Math.round((1 - pool[intake.pairing.hero].heroCropLoss) * 1000) / 1000,
        densityInversion: intake.vision[intake.pairing.bl].density !== intake.vision[intake.pairing.br].density,
        focalContrast: pool[intake.pairing.bl].exif.focalLength35 != null && pool[intake.pairing.br].exif.focalLength35 != null
          ? Math.round((1 - Math.abs(pool[intake.pairing.bl].exif.focalLength35 - pool[intake.pairing.br].exif.focalLength35)
            / Math.max(pool[intake.pairing.bl].exif.focalLength35, pool[intake.pairing.br].exif.focalLength35)) * 1000) / 1000
          : null,   // EXIF stripped → crop-scale proxy era; never fabricated
        colorResonance: true,
      },
      ruleVerdicts: intake.pairing.ruleVerdicts,
    },
    alternates: [],
  },
};
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
if (intakeFlag === -1 && fs.existsSync(INTAKE_PATH)) fs.unlinkSync(INTAKE_PATH);  // consumed

console.log(`\n◆ vision-manifest.json WRITTEN (${rel(MANIFEST_PATH)}) · model: ${manifest.model}`);
console.log(`◆ pairing: hero ${manifest.pairing.recommended.hero} | bl ${manifest.pairing.recommended.bl} | br ${manifest.pairing.recommended.br} (echo: ${manifest.pairing.recommended.echoPane})`);
console.log(`   rationale: ${intake.pairing.rationale}`);
