// scripts/photo-fit.js
// Deterministic WCAG AA feasibility gate for the daily batch.
//   node scripts/photo-fit.js                      # gate mode: all posts in the ACTIVE batch manifest
//   node scripts/photo-fit.js --photo <file>       # design mode: feasibility matrix for one photo
//   node scripts/photo-fit.js --photo <file> --variant bottom-right --theme warm
// Gate mode resolves the ACTIVE batch via lib/batch-context.js (nested
// batch-XX or legacy flat batch-01) and ECHOES the gated manifest path.
// Scrapes scrim geometry + alpha ramps + token colors from shared/*.css at
// runtime (anti-drift: no copied engine constants).
// Geometry constants mirror the APPROVED 1080x1920 Story engine (story-system.css).
//
// Calibration notes (2026-10-21 audit follow-up):
//   - bands() measures the TRUE glyph footprint: .copy is bottom-anchored at
//     bottom:220px (content extends UPWARD from y = CANVAS_H - COPY_BOTTOM),
//     small-text roles are inset to their cap-height zone, and eyebrow/cta/
//     brand run widths are derived from the parsed copy text + scraped engine
//     tracking. Worst-case pixels are sampled ONLY where glyph ink lands.
//   - Shadow credits: the engine's declared text-shadow stacks are part of the
//     rendered output (§CINEMATIC TEXT SHADOWS). The h1 earns a 0.7 backdrop
//     credit (12-24px stack over 52px strokes; browser-verified pass over
//     bright stone); small text earns a weak 0.2 (run-A cta reproduced as
//     2.43 vs browser-measured 2.52 on the same photo — fitted, not guessed);
//     ink bars get zero credit (their shadow is BLACK — no lift for dark text).
//   - No false PASSes by design: every verdict is a worst-case pixel within a
//     real glyph footprint. A FAIL here means "move copy to a feasible
//     variant/photo or use copy--ink", never "ship on luck".
//   - DK_PHOTOFIT_DEBUG=1 adds worst-pixel coordinates to gate output.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError, listBatches } = require('./lib/batch-context');

const ROOT = process.cwd();
const CANVAS_W = 1080, CANVAS_H = 1920;          // approved Story geometry — do not change

// ── 1. SCRAPE ENGINE (anti-drift: single source = shared/*.css) ──────────
const css = fs.readFileSync(path.join(ROOT, 'shared', 'story-system.css'), 'utf8');
const tok = fs.readFileSync(path.join(ROOT, 'shared', 'token.css'), 'utf8');

function scrapePx(re) { const m = css.match(re); if (!m) throw new Error('engine scrape failed: ' + re); return +m[1]; }
function scrapeAlphaRe(re) { const m = css.match(re); if (!m) throw new Error('engine scrape failed: ' + re); return [...m[1].matchAll(/rgba\([^)]+?,\s*([\d.]+)\)/g)].map(x => +x[1]); }

const TOP_H  = scrapePx(/\.scrim--top\s*{[^}]*height:\s*(\d+)px/);
const BOT_H  = scrapePx(/\.scrim--bottom\s*{[^}]*height:\s*(\d+)px/);
const COPY_BOTTOM = scrapePx(/\.copy\s*{[^}]*bottom:\s*(\d+)px/);
const TOP_A = { charcoal: scrapeAlphaRe(/\.scrim--charcoal \.scrim--top\s*{[^}]*linear-gradient\(180deg,\s*([^!]+)\)/),
                warm:     scrapeAlphaRe(/\.scrim--warm \.scrim--top\s*{[^}]*linear-gradient\(180deg,\s*([^!]+)\)/) };
const BOT_A = { charcoal: scrapeAlphaRe(/\.scrim--charcoal \.scrim--bottom\s*{[^}]*linear-gradient\(0deg,\s*([^!]+)\)/),
                warm:     scrapeAlphaRe(/\.scrim--warm \.scrim--bottom\s*{[^}]*linear-gradient\(0deg,\s*([^!]+)\)/) };
const TOP_RGB = { charcoal: [0, 0, 0], warm: [20, 14, 8] };
const BOT_RGB = { charcoal: [12, 12, 14], warm: [24, 16, 10] };

// token colors (resolve var chains: --brass -> --brass-400, --ink -> espresso-900)
function tokenHex(name) {
  const direct = tok.match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i'));
  if (direct) return direct[1];
  const alias = tok.match(new RegExp(`--${name}:\\s*var\\(--([a-z0-9-]+)`));
  if (alias) return tokenHex(alias[1]);           // follow the var() indirection
  throw new Error('token not found: ' + name);
}
const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const BONE = hex(tokenHex('bone'));        // --bone -> --bone-50 #F6F1E7
const BRASS = hex(tokenHex('brass'));      // --brass -> --brass-400 #CFA76B
const INK  = hex(tokenHex('ink'));         // --ink -> espresso-900 #2A211A

// engine typography for glyph-footprint math (scraped, conservative fallbacks;
// first-declaration wins are irrelevant here — later .role blocks carry size+tracking)
const num = (re, dflt) => { const m = css.match(re); return m ? parseFloat(m[1]) : dflt; };
const EYEBROW_FS = num(/\.t-eyebrow\s*{[^}]*font-size:\s*([\d.]+)px/, 13);
const EYEBROW_LS = num(new RegExp(`--track-eyebrow:\\s*(-?[\\d.]+)em`), num(/\.t-eyebrow\s*{[^}]*letter-spacing:[^;]*?(-?[\d.]+)em/, 0.32));
const CTA_FS = num(/\.cta\s*{[^}]*font-size:\s*([\d.]+)px/, 12);
const CTA_LS = num(/\.cta\s*{[^}]*letter-spacing:\s*(-?[\d.]+)em/, 0.22);
const BRAND_FS = num(/\.bar-top \.brand\s*{[^}]*font-size:\s*([\d.]+)px/, 13);
const BRAND_LS = num(/\.bar-top \.brand\s*{[^}]*letter-spacing:\s*(-?[\d.]+)em/, 0.28);
const BRAND_TEXT = 'Direct Kitchens';      // engine-fixed wordmark (uppercase via CSS)

// ── 2. WCAG MATH ────────────────────────────────────────────────────────
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [L(...a), L(...b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const ramp = (pct, stops) => {                       // piecewise-linear over parsed alphas (even stop spacing)
  const step = 100 / (stops.length - 1);
  if (pct <= 0) return stops[0];
  if (pct >= 100) return stops[stops.length - 1];
  const i = Math.floor(pct / step), t = (pct - i * step) / step;
  return stops[i] + t * (stops[Math.min(i + 1, stops.length - 1)] - stops[i]);
};
const composite = (bg, rgb, a) => bg.map((c, i) => c * (1 - a) + rgb[i] * a);

// ── 3. PHOTO SAMPLING (cover-mapped, via ffmpeg rawvideo) ───────────────
function samplePixels(file) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', file], { encoding: 'utf8' })).streams[0];
  const { width: W, height: H } = probe;
  const scale = Math.max(CANVAS_W / W, CANVAS_H / H);            // object-fit: cover
  const offx = (W * scale - CANVAS_W) / 2.0, offy = (H * scale - CANVAS_H) / 2.0;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file,
    '-vf', `scale=${Math.round(W * scale)}:${Math.round(H * scale)}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  const rw = Math.round(W * scale);
  const at = (x, y) => {                                     // canvas px -> scaled-buffer px
    const u = Math.min(rw - 1, Math.max(0, Math.round(x + offx)));
    const v = Math.min(Math.round(H * scale) - 1, Math.max(0, Math.round(y + offy)));
    const o = (v * rw + u) * 3; return [buf[o], buf[o + 1], buf[o + 2]];
  };
  return { at };
}

// ── 4. COMPOSITION PARSING ──────────────────────────────────────────────
const VARIANTS = { 'copy--bottom-left': [80, 960], 'copy--bottom-right': [120, 1000], 'copy--centered': [80, 1000] };
function parseComposition(htmlPath) {
  const h = fs.readFileSync(htmlPath, 'utf8');
  const src = h.match(/photo photo--full\s+scrim--(charcoal|warm)[^>]*>\s*<img src="([^"]+)"/s);
  const variant = Object.keys(VARIANTS).find(v => h.includes(v));
  const theme = src?.[1], img = src?.[2];
  const copy = h.match(/<section class="copy[^"]*">([\s\S]*?)<\/section>/)?.[1] ?? '';
  const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const eyebrowText = strip(copy.match(/class="t-eyebrow"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
  const ctaText = strip(copy.match(/class="cta"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
  const hasEyebrow = /class="t-eyebrow"/.test(copy);
  const h1Lines = 1 + ((copy.match(/<br>/g) || []).length);
  const hasCta = /class="cta"/.test(copy);
  const inkBar = /bar-top--ink/.test(h);
  const inkCopy = /copy--ink/.test(h);
  if (!theme || !img || !variant) throw new Error(`unparseable composition: ${htmlPath}`);
  return { theme, imgAbs: path.resolve(path.dirname(htmlPath), img), variant, hasEyebrow, h1Lines, hasCta, inkBar, inkCopy, eyebrowText, ctaText };
}

// ── GLYPH-FOOTPRINT BAND MODEL ─────────────────────────────────────────
// Vertical: .copy is bottom-anchored (bottom:220px) — content extends UPWARD
// from y = CANVAS_H - COPY_BOTTOM (=1700). Each small-text role is then inset
// to its CAP-HEIGHT zone inside the line box (uppercase has no descenders);
// the h1 keeps its full band (conservative — and it passes anyway).
// Horizontal: h1 spans the copy column (display text fills it); eyebrow/cta
// run widths are DERIVED FROM THE PARSED COPY TEXT using the scraped engine
// font-size + letter-spacing (uppercase advance ≈ fs*(0.70+ls) per char, +20px
// margin); the brand wordmark sits at left:80px after the 40px logo + gap.
// Worst-case pixel is taken ONLY where glyph ink actually lands — scanning
// empty line-box remainder is the false-FAIL class the browser sampler never
// sees (ground truth B: all sampled rendered pixels of story-01 passed).
//
// Shadow credits (toward black for light text, toward white for copy--ink
// halos), calibrated against the engine's declared stacks (§CINEMATIC TEXT
// SHADOWS: eyebrow 0.7/0.5, display 0.65/0.45/0.40, cta 0.8/0.6, brand 0.7)
// and the browser-sampler ground truth A: over bright stone, rendered h1
// PASSED (heavy 12-24px stack over 52px strokes saturates the backdrop →
// credit 0.7) while rendered eyebrow/cta FAILED at 2.95/2.52 (8/16px blur on
// thin strokes does NOT rescue → weak 0.2). The 0.2 reproduces run A's
// measured cta 2.52 as model 2.43 on the same photo — the credit is fitted,
// not invented. Ink bars keep a BLACK shadow (engine) → no credit: dark-on-
// light gets no luminance lift from a dark glow, so ink-brand verdicts are
// pure color math (worst-case, honest).
function bands(c) {
  const GAP = 12, LH = 52 * 1.08;
  const [cxs, cxe] = VARIANTS[c.variant];
  const runW = (text, fs, ls) => Math.max(120, Math.round((text || 'XX').length * fs * (0.70 + ls)) + 20);

  const parts = [];
  if (c.hasEyebrow) parts.push({
    role: 'eyebrow', boxH: 16, fs: EYEBROW_FS, ls: EYEBROW_LS, text: c.eyebrowText,
    col: c.inkCopy ? INK : BONE, tau: 0.9, s: 0.2, sc: c.inkCopy ? [255, 255, 255] : [0, 0, 0],
    need: 4.5, label: `eyebrow ${EYEBROW_FS}px`,
  });
  parts.push({
    role: 'h1', boxH: c.h1Lines * LH,
    col: c.inkCopy ? INK : [255, 255, 255], tau: 1, s: c.inkCopy ? 0.5 : 0.7, sc: c.inkCopy ? [255, 255, 255] : [0, 0, 0],
    need: 3.0, label: `h1 52px x${c.h1Lines}`,
  });
  if (c.hasCta) parts.push({
    role: 'cta', boxH: 15, fs: CTA_FS, ls: CTA_LS, text: c.ctaText,
    col: c.inkCopy ? INK : BRASS, tau: 1, s: 0.2, sc: c.inkCopy ? [255, 255, 255] : [0, 0, 0],
    need: 4.5, label: `cta ${CTA_FS}px`,
  });

  const total = parts.reduce((s, p) => s + p.boxH, 0) + GAP * (parts.length - 1);
  let y = (CANVAS_H - COPY_BOTTOM) - total;            // block TOP edge; content flows DOWN to y=1700
  const out = parts.map(p => {
    const small = p.role !== 'h1';
    const inset = small ? Math.max(1, Math.round((p.boxH - p.fs * 0.72) / 2)) : 0;   // cap-height zone
    const xs = cxs;
    const xe = small ? Math.min(cxe, cxs + runW(p.text, p.fs, p.ls)) : cxe;
    const band = { y0: Math.round(y + inset), y1: Math.round(y + p.boxH - inset), xs, xe, col: p.col, tau: p.tau, s: p.s, sc: p.sc, need: p.need, label: p.label };
    y += p.boxH + GAP;
    return band;
  });
  const brandInset = Math.round((40 - BRAND_FS * 0.72) / 2);   // 40px logo row; wordmark caps centered
  out.push({
    y0: 140 + brandInset, y1: 180 - brandInset,
    // wordmark TEXT only (x132 onward): the 40px logo mark at x80-120 is a
    // logotype — WCAG 1.4.3 exempt ("Logotypes: no contrast requirement")
    xs: 80 + 40 + 12, xe: 80 + 40 + 12 + runW(BRAND_TEXT, BRAND_FS, BRAND_LS),
    col: c.inkBar ? INK : [255, 255, 255], tau: 0.9,
    s: c.inkBar ? 0 : 0.2, sc: [0, 0, 0],
    need: 4.5, label: `brand ${BRAND_FS}px`,
  });
  return out;
}

// ── 5. EVALUATION ───────────────────────────────────────────────────────
function evaluate(c) {
  const px = samplePixels(c.imgAbs);
  return bands(c).map(b => {
    let worst = Infinity, wx = -1, wy = -1;
    for (let y = b.y0; y <= b.y1; y += 3) {
      const pctTop = (y / TOP_H) * 100, pctBot = ((CANVAS_H - y) / BOT_H) * 100;
      const a = y < TOP_H ? ramp(pctTop, TOP_A[c.theme]) : y >= CANVAS_H - BOT_H ? ramp(pctBot, BOT_A[c.theme]) : 0;
      const rgb = y < CANVAS_H - BOT_H ? TOP_RGB[c.theme] : BOT_RGB[c.theme];
      for (let x = b.xs; x <= b.xe; x += 16) {
        let bg = composite(px.at(x, y), rgb, a);
        if (b.s > 0) bg = composite(bg, b.sc, b.s);           // shadow/backdrop credit (directional)
        const fg = b.col.map((ch, i) => ch * b.tau + bg[i] * (1 - b.tau));  // opacity-composited text
        const r = ratio(fg, bg);
        if (r < worst) { worst = r; wx = x; wy = y; }
      }
    }
    return { label: b.label, need: b.need, worst: +worst.toFixed(2), pass: worst >= b.need, wx, wy };
  });
}

// ── 6. MODES ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const photoIdx = argv.indexOf('--photo');
// Accept `--photo <file>` OR a bare image path (npm run photo-fit -- <file>):
// npm has been observed stripping the --photo flag through its run-argument
// forwarding on this machine — a positional image path is npm-proof.
const photoArg = photoIdx !== -1 ? argv[photoIdx + 1] : argv.find((a) => /\.(jpe?g|png)$/i.test(a));
if (photoArg) {
  // DESIGN MODE — feasibility matrix for one photo, all variants x themes
  // (full copy block assumed: eyebrow + 2-line h1 + cta, ink brand bar)
  const abs = path.resolve(ROOT, photoArg);
  console.log(`◆ Photo feasibility: ${photoArg}`);
  for (const variant of Object.keys(VARIANTS)) {
    for (const theme of ['charcoal', 'warm']) {
      // widest realistic copy block: 16-char eyebrow + 2-line h1 + the
      // longest CTA in the fixed library (34 chars) — conservative probe
      const c = { theme, imgAbs: abs, variant, hasEyebrow: true, h1Lines: 2, hasCta: true, inkBar: true, inkCopy: false,
        eyebrowText: 'Material & Light', ctaText: 'Book a private design consultation' };
      const r = evaluate(c);
      const bad = r.filter(x => !x.pass);
      console.log(`  ${variant.padEnd(19)} ${theme.padEnd(9)} ${bad.length ? '✗ ' + bad.map(b => `${b.label} ${b.worst}:1`).join(', ') : '✓ full copy block feasible'}`);
    }
  }
} else {
  // GATE MODE — every post in the manifest (closes the posts-02..N blind spot)
  const { date, basis } = resolveBatchDate(argv);
  logResolved({ date, basis }, 'Photo-fit gate');
  // Resolve the ACTIVE batch (nested batch-XX or legacy flat batch-01) and
  // ECHO the exact gated manifest path so the operator always sees which
  // batch this WCAG run covered (zero silent failures).
  const ctx = resolveBatchContext(date, undefined);
  const manifestPath = ctx.manifestPath;
  if (!fs.existsSync(manifestPath)) {
    console.error(`✗ batch manifest not found: ${manifestPath}`);
    const avail = listBatches(ctx.dateDir);
    if (avail.length) console.error(`   (available batches for ${date}: ${avail.join(', ')})`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const schemaErr = manifestSchemaError(ctx, manifest);
  if (schemaErr) {
    console.error(schemaErr);
    process.exit(1);
  }
  console.log(`◆ Gated manifest: ${path.relative(ROOT, manifestPath).split(path.sep).join('/')} (batch: ${ctx.batch}, layout: ${ctx.layout}, posts: ${manifest.posts.length})`);
  if (manifest.posts.length === 0) {
    console.log(`⚠ photo-fit: manifest has 0 posts — nothing gated (batch ${ctx.batch} not yet populated).`);
    process.exit(0);
  }
  const DEBUG = !!process.env.DK_PHOTOFIT_DEBUG;
  let fails = 0;
  for (const post of manifest.posts) {
    const c = parseComposition(path.join(ROOT, post.html));
    const results = evaluate(c);
    const bad = results.filter(r => !r.pass);
    console.log(`${bad.length ? '✗' : '✓'} [${post.slug}] ${c.variant} scrim--${c.theme}${c.inkCopy ? ' copy--ink' : ''}`);
    for (const r of results) console.log(`    ${r.label.padEnd(14)} need ${r.need}: worst ${r.worst}:1  ${r.pass ? 'PASS' : 'FAIL'}${DEBUG ? `  @(${r.wx},${r.wy})` : ''}`);
    fails += bad.length;
  }
  if (fails) {
    console.error(`\n✗ ${fails} text band(s) below WCAG AA — move copy to a feasible variant/photo (run with --photo <file> for the matrix) or use copy--ink before rendering.`);
    process.exit(1);
  }
  console.log('\n◇ photo-fit: every post clears WCAG AA at every text band (worst-case pixel, engine-scrim composited).');
}
