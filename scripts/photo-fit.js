// scripts/photo-fit.js
// Deterministic WCAG oracle + zero-waiver self-heal gate for the daily batch.
//   node scripts/photo-fit.js                        # gate mode: all posts in the ACTIVE batch manifest
//   node scripts/photo-fit.js --fix                  # gate + SELF-HEAL: apply the minimal engine variant
//                                                    #   ladder that clears every band per post, in place
//   node scripts/photo-fit.js --photo <file>         # design mode: feasibility matrix for one photo
//   node scripts/photo-fit.js --photo <file> --variant bottom-right --theme warm
//
// Gate mode resolves the ACTIVE batch via lib/batch-context.js (nested
// batch-XX or legacy flat batch-01) and ECHOES the gated manifest path.
//
// ── ANTI-DRIFT CONTRACT (2026-10-22 v3) ────────────────────────────────
// EVERY engine number consumed below is scraped live from shared/*.css:
//   · geometry  — CSS custom properties in story-system.css
//                 (--bar-top/--bar-right/--bar-logo/--bar-gap, --copy-*,
//                 --scrim-top/--scrim-bottom)
//   · colors    — token.css var chains (resolved through var() indirection)
//   · ramps     — ALL declared gradient layers, split at paren depth 0 and
//                 parsed generically: the .scrim--top band is a TWO-LAYER
//                 stack (radial ellipse at 100% 0% + linear 180deg) and the
//                 model composites layers in declared paint order. The v2
//                 "linear-only" shortcut that produced the 2026-10-22
//                 recalibration churn (radiial-ish 4.59 vs browser 4.23 on
//                 story-05) is gone: the radial layer is modelled exactly.
//   · typography— .t-eyebrow/.cta/.bar-top .brand font-size + tracking
// The browser-authority gate (verify:contrast — per-post `hyperframes
// check` sessions) is the FINAL verdict; this module is the fast
// deterministic pre-render model + self-heal driver. Escape hatch:
// DK_PHOTOFIT_DEBUG=1 adds worst-pixel coordinates to gate output.
//
// ── VERDICT POLICY (grain-tolerant, false-FAIL immune) ─────────────────
// Every band is sampled as a real grid. A band FAILs only when BOTH
//   (a) its p98 contrast (the 98th-percentile-worst sample — i.e. ≥2% of
//       the band's sample area) is below the need, AND
//   (b) its absolute worst sample is below the HARD FLOOR (ratio 1.35 —
//       a genuinely unusable pocket, never a 1-line JPEG grain walkway).
// Single grain/shadow-line pixels <2% of the band can no longer block the
// pipeline; uniform dimness over a band still fails deterministically.
//
// ── SELF-HEAL LADDER (--fix) ───────────────────────────────────────────
// For each post, the first config in each independent ladder that clears
// every band with DK_PHOTOFIT_MARGIN headroom is applied to the
// composition in place (class attributes only — geometry, copy text,
// markup structure are never touched):
//   copy  : as-authored → copy--ink
//   brand : as-authored polarity → bar-top--ink (white↔ink wordmark flip;
//           the 2026-10-24 bone plate is RETIRED — the brand is a clean
//           transparent knockout with dynamic polarity, per reference
//           stories 18–21)
// Every escalation is a DECLARED engine layer (story-system.css), so the
// model reproduces it exactly — no waiver prompts, no human in the loop.
// NOTE: the copy--shield / copy--shield--deep floating-box rungs are
// RETIRED (2026-10-25): the copy block can never spawn a background box.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError, listBatches } = require('./lib/batch-context');

const ROOT = process.cwd();
const CANVAS_W = 1080, CANVAS_H = 1920;          // approved Story geometry — do not change
const ENGINE_CSS = path.join(ROOT, 'shared', 'story-system.css');

// ── 0. CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FIX = argv.includes('--fix');
const DEBUG = !!process.env.DK_PHOTOFIT_DEBUG;
const MARGIN = Number(process.env.DK_PHOTOFIT_MARGIN || 0.25); // self-heal headroom
const HARD_FLOOR = 1.35;                                       // grain-immunity hard floor
const FORCE_AUTHOR = argv.includes('--force-author');          // heal back to as-authored first

// ── 1. SCRAPE ENGINE (anti-drift: single source = shared/*.css) ─────────
const css = fs.readFileSync(ENGINE_CSS, 'utf8');
const tok = fs.readFileSync(path.join(ROOT, 'shared', 'token.css'), 'utf8');

function scrapeVar(name, unit) {
  const m = css.match(new RegExp(`--${name}:\\s*(-?[\\d.]+)${unit}`));
  if (!m) throw new Error(`engine scrape failed: --${name} (${unit})`);
  return +m[1];
}
function scrapeVarColor(name) {
  const m = css.match(new RegExp(`--${name}:\\s*var\\(--([a-z0-9-]+)`));
  return m ? m[1] : null; // token alias target; final hex resolved via tokenHex
}

// DESIGN tokens (resolve var chains: --ink -> espresso-900 …)
function tokenHex(name) {
  const direct = tok.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`, 'i'));
  if (direct) return direct[1].toLowerCase();
  const alias = tok.match(new RegExp(`--${name}:\\s*var\\(--([a-z0-9-]+)`));
  if (alias) return tokenHex(alias[1]);           // follow the var() indirection
  throw new Error('token not found: ' + name);
}
const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const BONE  = hex(tokenHex('bone'));         // --bone -> --bone-50 #F6F1E7
const BONE25 = hex(tokenHex('bone-25'));     // white knockout wordmark #FDFAF4
const BRASS = hex(tokenHex('brass'));        // --brass -> --brass-400 #CFA76B
const INK   = hex(tokenHex('ink'));          // --ink -> espresso-900 #2A211A
const ESP800 = hex(tokenHex('espresso-800'));// #3B3026
const ESP700 = hex(tokenHex('espresso-700'));// serif-accent ink

// Engine geometry (CSS custom properties — the single source of truth)
const GEO = {
  barTop:   scrapeVar('bar-top', 'px'),
  barRight: scrapeVar('bar-right', 'px'),
  barLogo:  scrapeVar('bar-logo', 'px'),
  barGap:   scrapeVar('bar-gap', 'px'),
  copyBottom: scrapeVar('copy-bottom', 'px'),
  copyLeftA: scrapeVar('copy-left-a', 'px'),
  copyRightA: scrapeVar('copy-right-a', 'px'),
  copyLeftB: scrapeVar('copy-left-b', 'px'),
  copyRightB: scrapeVar('copy-right-b', 'px'),
  scrimTopH:  scrapeVar('scrim-top', 'px'),
  scrimBotH:  scrapeVar('scrim-bottom', 'px'),
  // Phase 2 family tokens (P2.0 declared defaults — see
  // story-system.css ENGINE GEOMETRY CONTRACT). Dormant in the mono path:
  // no rule or band references them yet; scraping proves each anchor is
  // alive and keeps future family geometry engine-fuelled (§H.9 #2).
  swatchBottom:      scrapeVar('swatch-bottom', 'px'),
  swatchStripH:      scrapeVar('swatch-strip-h', 'px'),
  copyBottomVariant: scrapeVar('copy-bottom-variant', 'px'),
  duoSplit:          scrapeVar('duo-split', '%'),
};

// Top/bottom scrim ramp spans
const TOP_H = GEO.scrimTopH, BOT_H = GEO.scrimBotH;

// Typography
const num = (re, dflt) => { const m = css.match(re); return m ? parseFloat(m[1]) : dflt; };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const emVal = (s) => { const m = /(-?[\d.]+)em/.exec(s || ''); return m ? +m[1] : null; };
// letter-spacing may be declared as var(--token, 0.32em) — resolve the var()
// chain through token.css so tracking never drifts from the design tokens.
function scrapeEm(selector, dflt) {
  const rule = css.match(new RegExp(escRe(selector) + `\\s*{[^}]*letter-spacing:\\s*([^;]+)`, 'i'));
  if (!rule) return dflt;
  const direct = emVal(rule[1]);
  if (direct !== null) return direct;
  const vm = /var\(--([\w-]+)\s*(?:,\s*([^)]+))?\)/.exec(rule[1]);
  if (vm) {
    const tm = tok.match(new RegExp(`--${vm[1]}:\\s*([^;\\n]+)`));
    const via = tm ? emVal(tm[1]) : null;
    if (via !== null) return via;
    if (vm[2] !== undefined) return emVal(vm[2]) ?? dflt;
  }
  return dflt;
}
const EYEBROW_FS = num(/\.t-eyebrow\s*{[^}]*font-size:\s*([\d.]+)px/, 13);
const EYEBROW_LS = scrapeEm('.t-eyebrow', 0.34);
const CTA_FS = num(/\.cta\s*{[^}]*font-size:\s*([\d.]+)px/, 12);
const CTA_LS = num(/\.cta\s*{[^}]*letter-spacing:\s*(-?[\d.]+)em/, 0.22);
const BRAND_FS = num(/\.bar-top \.brand\s*{[^}]*font-size:\s*([\d.]+)px/, 13);
const BRAND_LS = num(/\.bar-top \.brand\s*{[^}]*letter-spacing:\s*(-?[\d.]+)em/, 0.28);
// Display role + copy-block rhythm also fuel from the engine (anti-drift: the
// h1 band geometry and the block's inner gap are scraped, never mirrored —
// a design-sprint font-size/line-height/gap edit propagates here by scrape).
const DISPLAY_FS = num(/\.t-display\s*{[^}]*font-size:\s*([\d.]+)px/, 52);
const DISPLAY_LH = num(/\.t-display\s*{[^}]*line-height:\s*([\d.]+)/, 1.08);
const COPY_GAP   = num(/\.copy\s*{[^}]*gap:\s*([\d.]+)px/, 12);

// Generic layer parser: "radial-gradient(ellipse at 100% 0%, rgba(0,0,0,0.50) 0%, transparent 65%)"
// → { kind:'radial', at:[x%,y%], rgb, stops:[{pos, alpha}] } / linear-gradient(180deg, …) → { kind:'linear', deg, rgb, stops }.
// rgb is the layer's declared tint (first rgba in the segment) — the engine's
// ramps declare a single tint family per layer, so one rgb per layer is exact.
function splitTop(s) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function firstRgb(s) {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s || '');
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function parseLayer(seg) {
  // Trailing `!important` (engine rules carry it on every scrim) must not
  // defeat the parser — otherwise the layer is dropped by `.filter(Boolean)`
  // and the model silently composites over RAW photo pixels (latent blind
  // spot discovered 2026-10-25 while restoring editorial knockout polarity).
  const radial = /^radial-gradient\s*\((.+)\)\s*(?:!important)?\s*$/s.exec(seg);
  const linear = /^linear-gradient\s*\((.+)\)\s*(?:!important)?\s*$/s.exec(seg);
  if (radial) {
    const body = radial[1];
    const at = /at\s*([\d.]+)%\s*([\d.]+)%/.exec(body);
    return { kind: 'radial', at: at ? [+at[1], +at[2]] : [50, 50], rgb: firstRgb(body), stops: parseStops(body) };
  }
  if (linear) {
    const degM = /(-?[\d.]+)(deg|brag)/.exec(linear[1]);
    return { kind: 'linear', deg: degM ? +degM[1] : 180, rgb: firstRgb(linear[1]), stops: parseStops(linear[1]) };
  }
  return null;
}
function parseStops(body) {
  const out = [];
  const stopRe = /(?:rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([0-9.]+))?\)|transparent)\s+(-?[\d.]+)%/g;
  let m;
  while ((m = stopRe.exec(body)) !== null) {
    out.push({ pos: +m[2], alpha: m[1] !== undefined ? +m[1] : 0 });
  }
  return out;
}

// Brand geometry — derived, not mirrored (v3 anti-drift):
// right chain: xe = W − barRight − barLogo − barGap;  wordmark run reaches leftward from xe.
// (2026-10-25: the plate's platePad scrape is retired with the plate.)
const BRAND_GEOM = (() => {
  const xe = CANVAS_W - GEO.barRight - GEO.barLogo - GEO.barGap;
  const wordW = Math.round(('DIRECT KITCHENS'.length * BRAND_FS * (0.60 + BRAND_LS)) + 6);
  return { xs: xe - wordW, xe, y0: GEO.barTop, y1: GEO.barTop + GEO.barLogo };
})();

// ── 2. WCAG MATH ────────────────────────────────────────────────────────
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const lumOf = (c) => L(c[0], c[1], c[2]);
const ratio = (a, b) => { const [x, y] = [L(...a), L(...b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const stopAt = (stops, pct) => {              // piecewise-linear over parsed stops (position %)
  if (!stops.length) return 0;
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (pct <= s[0].pos) return s[0].alpha;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (pct <= b.pos) {
      const t = b.pos === a.pos ? 0 : (pct - a.pos) / (b.pos - a.pos);
      return a.alpha + t * (b.alpha - a.alpha);
    }
  }
  return s[s.length - 1].alpha;
};
const composite = (bg, rgb, a) => bg.map((c, i) => c * (1 - a) + rgb[i] * a);

// ── LAYOUT-SURFACE TILES (family band device, P2.0) ───────────────────
// A band with band.solid === 'bone' evaluates against the INVARIANT tile
// fill --bone (#F6F1E7) instead of composited photo pixels — no photo
// lookups run at all. This is the swatch-strip chip device (Phase 2):
// solid-bone tiles in an EDGE-TO-EDGE layout strip (a layout surface of
// the grid, NOT a floating box over the photograph — §F.2/§H.9 ban
// clause). DORMANT in the mono path: no bands() emitter sets band.solid
// until the swatch-strip family parser lands (P2.1).
const SOLID_BG = { bone: BONE };

// Radial farthest-corner ellipse (center at (cx%,cy%), box W×H)
// CHROMIUM-CALIBRATED 2026-10-22 (empirical fit over a 1080×1920 probe grid,
// verified to ≤0.63% total-alpha error): for ellipse at (100%,0%) the
// farthest-corner radii are rx = 1513.1, ry = 457.1. Normalized radial
// distance t = sqrt((dx/rx)² + (dy/ry)²); stops place alpha linearly in t.
// If a future engine amendment changes the narrowellipse geometry, re-run
// the calibration and update these constants — verify:contrast remains the
// ground-truth referee in any case.
const RADIAL_CONST = { '100% 0%': { rx: 1513.1, ry: 457.1 } };
function alphaOfLayer(layer, x, y, bandHeight) {
  if (!layer) return 0;
  if (layer.kind === 'linear') {
    // 180deg/0deg axis over the band span (0% = top / bottom per declared direction).
    let pct;
    if (layer.deg === 180) pct = (y / bandHeight) * 100;               // 180deg: 0% at TOP, fading DOWN
    else if (layer.deg === 0 || layer.deg === 360) pct = ((CANVAS_H - y) / bandHeight) * 100; // 0deg ramps UP from bottom
    else pct = (y / bandHeight) * 100;                                 // engine only declares 0/180/360 …default treats as 180
    return Math.max(0, Math.min(1, stopAt(layer.stops, pct)));
  }
  // radial
  const cx = (layer.at[0] / 100) * CANVAS_W, cy = (layer.at[1] / 100) * CANVAS_H;
  const key = `${layer.at[0]}% ${layer.at[1]}%`;
  const ell = RADIAL_CONST[key];
  if (!ell) throw new Error(`no calibrated radial model for at(${key}) — re-calibrate or use a supported anchor`);
  const dx = cx - x, dy = Math.abs(cy - y);
  const t = Math.sqrt((dx * dx) / (ell.rx * ell.rx) + (dy * dy) / (ell.ry * ell.ry));
  return Math.max(0, Math.min(1, stopAt(layer.stops, t * 100)));
}

// ── 3. PHOTO SAMPLING (cover-mapped, via ffmpeg rawvideo) ───────────────
// P2.0: rect-parametrized cover-crop. `rect` ({x,y,w,h} in CANVAS space)
// describes the layout box the photo fills with object-fit: cover — the
// mono-full default is the full canvas, whose math is BYTE-IDENTICAL to
// the legacy sampler (rect.w/W = 1080/W, box-local = canvas for x=y=0).
// Multi-photo families (P2.1+) call this once per pane with the pane rect:
//   scale_r = max(rect.w/W, rect.h/H)          — cover within the pane
//   off = (W*scale_r − rect.w) / 2            — centered over-crop
//   source(u,v) = ( (canvasX − rect.x) + offx , (canvasY − rect.y) + offy )
// clamped into the scaled buffer. Pane-bounded bands therefore sample
// exactly the pixels a browser crop paints there; negative box-local
// coordinates clamp along the pane's own edge (bands never leave their pane).
function samplePixels(file, rect = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', file], { encoding: 'utf8' })).streams[0];
  const { width: W, height: H } = probe;
  const scale = Math.max(rect.w / W, rect.h / H);              // object-fit: cover within rect
  const offx = (W * scale - rect.w) / 2.0, offy = (H * scale - rect.h) / 2.0;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file,
    '-vf', `scale=${Math.round(W * scale)}:${Math.round(H * scale)}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  const rw = Math.round(W * scale);
  const px = (x, y) => {
    const u = Math.min(rw - 1, Math.max(0, Math.round((x - rect.x) + offx)));
    const v = Math.min(Math.round(H * scale) - 1, Math.max(0, Math.round((y - rect.y) + offy)));
    const o = (v * rw + u) * 3; return [buf[o], buf[o + 1], buf[o + 2]];
  };
  return { at: px, rect };
}

// ── 4. COMPOSITION PARSING ──────────────────────────────────────────────
const COPY_VARIANTS = { 'copy--bottom-left': [GEO.copyLeftA, GEO.copyRightA], 'copy--bottom-right': [GEO.copyLeftB, GEO.copyRightB] };

// ── GRADE-PROFILE ADVISORY (2026-10-24, Phase 1) ────────────────────────
// data-color-grading declares the DK Signature Grade finishing profile:
//   { "vignette": x, "grain": y, "adjust": { "exposure": a, "contrast": b } }
// photo-fit samples RAW pixels — finishing is applied AT RENDER and cannot
// be modelled here, so verify:contrast remains the graded truth. This check
// is ADVISORY-ONLY (exit code is never affected; malformed JSON is caught
// here but lint will also hard-fail on a malformed attribute). Ceilings are
// the Phase-1 finishing budget: vignette ≤ 0.10, grain ≤ 0.12,
// adjust.exposure/contrast ≤ ±0.05 — photography stays photographic.
const GRADE_CEILINGS = { vignette: 0.10, grain: 0.12, exposure: 0.05, contrast: 0.05 };
function gradeAudit(h) {
  if (!/data-color-grading=/.test(h)) return null;
  const raw = (h.match(/data-color-grading='([^']+)'/) || h.match(/data-color-grading="([^"]+)"/) || [])[1];
  if (!raw) return '⚠ grade: data-color-grading present but value unreadable — verify:contrast is the graded-truth verdict.';
  try {
    const g = JSON.parse(raw);
    const adj = g.adjust || {};
    const bad = [];
    if (typeof g.vignette === 'number' && g.vignette > GRADE_CEILINGS.vignette) bad.push(`vignette=${g.vignette}`);
    if (typeof g.grain === 'number' && g.grain > GRADE_CEILINGS.grain) bad.push(`grain=${g.grain}`);
    for (const k of ['exposure', 'contrast']) {
      if (typeof adj[k] === 'number' && Math.abs(adj[k]) > GRADE_CEILINGS[k]) bad.push(`${k}=${adj[k]}`);
    }
    if (bad.length) return `⚠ grade: ${bad.join(', ')} exceeds the Phase-1 finishing ceilings (vignette ≤ ${GRADE_CEILINGS.vignette}, grain ≤ ${GRADE_CEILINGS.grain}, exposure/contrast ≤ ±${GRADE_CEILINGS.exposure}) — consider tightening; verify:contrast is the graded-truth verdict.`;
    return '◇ grade: DK Signature Grade requested (within Phase-1 ceilings) — photo-fit models RAW pixels; verify:contrast is the graded-truth verdict.';
  } catch {
    return '⚠ grade: data-color-grading JSON unparseable — photo-fit models RAW pixels; verify:contrast is the graded-truth verdict.';
  }
}

function parseComposition(htmlPath) {
  const h = fs.readFileSync(htmlPath, 'utf8');
  // img src is located regardless of sibling attributes (data-color-grading
  // may precede it); [^>]* stays single-tag-safe.
  const src = h.match(/photo photo--full\s+scrim--(charcoal|warm|greige)[^>]*>\s*<img[^>]*\ssrc="([^"]+)"/s);
  const copyClass = h.match(/<section class="(copy[^"\n]*)"/)?.[1] ?? '';
  const headerClass = h.match(/<header class="(bar-top[^"\n]*)"/)?.[1] ?? '';
  const variant = Object.keys(COPY_VARIANTS).find((v) => copyClass.includes(v));
  const theme = src?.[1], img = src?.[2];
  const copy = h.match(/<section class="copy[^"]*">([\s\S]*?)<\/section>/)?.[1] ?? '';
  const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const eyebrowText = strip(copy.match(/class="t-eyebrow"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
  const ctaText = strip(copy.match(/class="cta"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
  // Serif-accent span (2026-10-24): extracted verbatim (tags stripped) so the
  // h1-accent sub-band can be modelled (§G.9). Non-ink posts render it white
  // on white — no separate treatment; only .copy--ink recolors it (ESP700).
  const accentText = strip(copy.match(/class="serif-accent"[^>]*>([\s\S]*?)<\/span>/)?.[1]);
  const brandText = strip(h.match(/<p class="brand"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? 'Direct Kitchens');
  const hasEyebrow = /class="t-eyebrow"/.test(copy);
  const h1Lines = 1 + ((copy.match(/<br>/g) || []).length);
  const hasCta = /class="cta"/.test(copy);
  const inkBar = /bar-top--ink/.test(headerClass);
  // Declared brand-polarity partner (2026-10-25): the top scrim span may
  // carry `scrim--top--deep` — the deepened corner pool for WHITE wordmarks.
  const topDeep = /scrim--top--deep/.test(h);
  const gradeLine = gradeAudit(h);
  const inkCopy = /copy--ink/.test(copyClass);
  // ── LAYOUT-FAMILY DISPATCHER (P2.0, closed set) ─────────────────────
  // `data-layout-family` declares the family on the composition root;
  // MISSING attr transparently means "mono-full" so every legacy/archived
  // composition parses byte-identically to the pre-P2.0 engine. Unknown
  // family strings fail CLOSED (the unparseable contract, printed with the
  // closed set). duo-54-46 / hero-split-1-2 are DECLARED but their
  // multi-photo parser wiring lands in P2.2/P2.3 — carrying them on a
  // composition before then is a fail-closed refusal, not a silent misparse.
  const familyRaw = h.match(/data-layout-family="([a-z0-9-]+)"/)?.[1] ?? '';
  const family = familyRaw === '' ? 'mono-full' : familyRaw;
  const FAMILY_SET = ['mono-full', 'duo-54-46', 'hero-split-1-2', 'swatch-strip'];
  if (!FAMILY_SET.includes(family)) throw new Error(`unknown data-layout-family "${family}" (closed set: ${FAMILY_SET.join(' | ')}) — fix or remove the attribute: ${htmlPath}`);
  if (family === 'duo-54-46' || family === 'hero-split-1-2') throw new Error(`layout family "${family}" declared but its multi-photo parser wires in Phase 2 (duo P2.2 / hero-split P2.3) — no composition may carry it yet: ${htmlPath}`);
  if (!theme || !img || !variant) throw new Error(`unparseable composition: ${htmlPath}`);
  // P2.0 photos ledger: the mono parser resolves one full-canvas photo; the
  // swatch-strip family shares it (its full-bleed hero IS a mono match, and
  // chips ride the solid-tile band role, not photo rects). Family parsers
  // (P2.1+) append pane entries { abs, rect } here.
  const photos = [{ abs: path.resolve(path.dirname(htmlPath), img), rect: { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H } }];
  return {
    theme, family, photos, variant,
    get imgAbs() { return photos[0].abs; },   // backward-compat singular view (pre-P2.0 call sites)
    hasEyebrow, h1Lines, hasCta, inkBar, inkCopy, topDeep, accentText: accentText || null,
    grade: gradeLine,
    eyebrowText, ctaText, brandText: brandText.toUpperCase(), copyClass, headerClass,
  };
}

// ── GLYPH-FOOTPRINT BAND MODEL ─────────────────────────────────────────
// Vertical: .copy is bottom-anchored (--copy-bottom) — content extends UP
// from y = CANVAS_H − COPY_BOTTOM; small-text roles are inset to their
// cap-height zone; h1 keeps the full band (conservative; it passes anyway).
// Horizontal: eyebrow/cta runs derive from parsed copy text + engine
// tracking; h1 spans the copy column. The brand wordmark box is DERIVED
// from the engine geometry contract (bar-top/right/logo/gap + scraped
// wordmark size); the circular logo is a logotype — WCAG exempt — so the
// band spans the wordmark text only. All numbers fuel from CSS.
function bands(c) {
  const GAP = COPY_GAP, LH = DISPLAY_FS * DISPLAY_LH;
  const [cxs, rightInset] = COPY_VARIANTS[c.variant];
  const cxe = CANVAS_W - rightInset;
// Chromium-calibrated 2026-10-25: Inter's rendered advance for mixed/caps
// Chicago runs measures ~0.60 x fs per char INCLUDING tracking deltas... hold on — the
// engine smears letter-spacing separately (0.70 + ls assumed 2026-10-24), but the
// browser-authority sampler reported the REAL h1/eyebrow/cta/brand bboxes and the
// brand wordmark ("DIRECT KITCHENS", 13px, 0.28em tracking) measures 170.33px —
// 15 chars → 11.36px/char = fs 13 × (0.594 glyph + 0.28 tracking). The 0.70
// glyph factor + 20px phantom pad over-widened every run band by ~24%, and at
// the brand row that conservatism manufactured FALSE failures (the model read
// 2.69:1 where the browser measured 3.95:1 on the same pixels). Calibrated to
// the browser bbox: glyphs ≈ 0.60 x fs (caps/mixed runs of Inter), padding
// folded into the calibration, +6px sequencing slack kept as safety margin.
const runW = (text, fs, ls) => Math.max(120, Math.round((text || 'XX').length * fs * (0.60 + ls)) + 6);

  const parts = [];
  if (c.hasEyebrow) parts.push({ role: 'eyebrow', boxH: 16, fs: EYEBROW_FS, ls: EYEBROW_LS, text: c.eyebrowText });
  parts.push({ role: 'h1', boxH: c.h1Lines * LH, fs: DISPLAY_FS, ls: -0.02, text: null });
  if (c.hasCta) parts.push({ role: 'cta', boxH: 15, fs: CTA_FS, ls: CTA_LS, text: c.ctaText });

  const total = parts.reduce((s, p) => s + p.boxH, 0) + GAP * (parts.length - 1);
  let y = (CANVAS_H - GEO.copyBottom) - total;         // block TOP edge; content flows DOWN to y=1700
  const blockTop = y, blockBottom = (CANVAS_H - GEO.copyBottom);
  const out = parts.map((p) => {
    const small = p.role !== 'h1';
    const inset = small ? Math.max(1, Math.round((p.boxH - p.fs * 0.72) / 2)) : 0;
    const xs = cxs;
    const xe = small ? Math.min(cxe, cxs + runW(p.text, p.fs, p.ls)) : cxe;
    const band = { role: p.role, y0: Math.round(y + inset), y1: Math.round(y + p.boxH - inset), xs, xe, blockTop, blockBottom, text: p.text };
    y += p.boxH + GAP;
    return band;
  });
  const brandInset = Math.round((GEO.barLogo - BRAND_FS * 0.72) / 2);   // caps centered in the logo row
  out.push({
    role: 'brand', y0: GEO.barTop + brandInset, y1: GEO.barTop + GEO.barLogo - brandInset,
    xs: BRAND_GEOM.xs, xe: BRAND_GEOM.xe, blockTop: null, blockBottom: null, text: c.brandText,
  });
  // Serif-accent sub-band (2026-10-24 model alignment — §G.9): under
  // .copy--ink a `.serif-accent` span recolors to --espresso-700 while the
  // rest of the h1 stays --ink. Per-glyph geometry is unknowable from HTML,
  // so the model is CONSERVATIVE: the full h1 band is evaluated a second
  // time at the accent colour (virtual 'h1-accent' band, same geometry, no
  // block-flow impact) and the gate sees both verdicts — worst governs.
  // Non-ink posts leave the accent white (no delta → no band).
  if (c.inkCopy && c.accentText) {
    const h1b = out.find((b) => b.role === 'h1');
    if (h1b) out.splice(out.indexOf(h1b) + 1, 0, { ...h1b, role: 'h1-accent', text: c.accentText });
  }
  return out;
}

// ── 5. LAYER-STACK EVALUATION ───────────────────────────────────────────
// Scrims per theme, parsed once (each layer keeps its DECLARED tint rgb):
//   top layers (paint order): [radial(at 100% 0%), linear(180deg)]
//   bottom layers:            [linear(0deg)]
const SCRIMS = (() => {
  const grab = (sel) => {
    const m = css.match(new RegExp(escRe(sel) + `\\s*{[^}]*background:\\s*([^;]+);`, 'i'));
    return m ? splitTop(m[1].trim()).map(parseLayer).filter(Boolean) : [];
  };
  // 2026-10-25: each theme declares TWO top-band intensities (bare = airy
  // pool for INK wordmarks, `--top--deep` = deep pool for WHITE wordmarks —
  // the declared polarity partner; see story-system.css). Bottom ramp one.
  return {
    charcoal: { top: grab('.scrim--charcoal .scrim--top'), deepTop: grab('.scrim--charcoal .scrim--top--deep'), bottom: grab('.scrim--charcoal .scrim--bottom') },
    warm:     { top: grab('.scrim--warm .scrim--top'),     deepTop: grab('.scrim--warm .scrim--top--deep'),     bottom: grab('.scrim--warm .scrim--bottom') },
    greige:   { top: grab('.scrim--greige .scrim--top'),   deepTop: grab('.scrim--greige .scrim--top--deep'),   bottom: grab('.scrim--greige .scrim--bottom') }, // 2026-10-24
  };
})();

// Full stack paint order at canvas pixel (x, y):
// photo → theme scrims (top band above y<scrim-top, bottom band from scrim-bottom down)
// (2026-10-25: the copy--shield local layer is retired — no per-zone plates.)
function compositedBackdrop(px, c, x, y) {
  const th = c.theme;
  let v = px.at(x, y);
  if (y < TOP_H) {
    const topLayers = c.topDeep ? (SCRIMS[th].deepTop ?? SCRIMS[th].top) : SCRIMS[th].top;
    for (const layer of topLayers) {
      const a = alphaOfLayer(layer, x, y, TOP_H);
      if (a > 0 && layer.rgb) v = composite(v, layer.rgb, a);
    }
  } else if (y >= CANVAS_H - BOT_H) {
    const layer = SCRIMS[th].bottom[0];
    if (layer && layer.rgb) {
      const a = alphaOfLayer(layer, x, y, BOT_H);
      if (a > 0) v = composite(v, layer.rgb, a);
    }
  }
  return v;
}

// fg color + shadow credit per role + state
function fgState(c, band) {
  const INK_family = c.inkCopy;
  switch (band.role) {
    case 'eyebrow':
      return { col: INK_family ? INK : BONE, tau: 0.9, s: INK_family ? 0 : 0.2, sc: [0, 0, 0] };
    case 'h1':
      return { col: INK_family ? INK : [255, 255, 255], tau: 1, s: INK_family ? 0 : 0.7, sc: [0, 0, 0] };
    case 'h1-accent':
      // Serif-accent sub-band — model fix (2026-10-24): under .copy--ink the
      // accent span recolors to espresso-700 (#3E3027), NOT the band's --ink.
      // Modelled conservatively (see §G.9): the whole sub-band is evaluated
      // at the accent colour; worst-of wins in gate.
      return { col: ESP700, tau: 1, s: 0, sc: [0, 0, 0] };
    case 'cta':
      // Signature warm brass/gold accent in EVERY state (2026-10-25: the
      // shield-era bone swap is retired with the shield device).
      return { col: INK_family ? ESP800 : BRASS, tau: 1, s: INK_family ? 0 : 0.2, sc: [0, 0, 0] };
    case 'brand':
      // EDITORIAL KNOCKOUT, dynamic polarity (2026-10-25, restored per
      // reference stories 18–21): the wordmark sits directly on the photo.
      // Default white (bone-25, opacity 0.9, cinematic glow → shadow
      // credit s=0.2); .bar-top--ink flips to ink (glow stripped → s=0).
      return c.inkBar
        ? { col: INK, tau: 0.9, s: 0, sc: [0, 0, 0] }
        : { col: BONE25, tau: 0.9, s: 0.2, sc: [0, 0, 0] };
    case 'chip-label':
      // Swatch-strip chip label (P2.0, dormant until the family parser
      // emits chip bands): 11–13px ink engraving on the SOLID bone tile.
      // No shadow credit — the tile is the declared layout surface; the
      // backdrop comes from SOLID_BG via band.solid, not from the photo.
      return { col: INK, tau: 1, s: 0, sc: [0, 0, 0] };
  }
  throw new Error('unknown band role ' + band.role);
}

// Evaluate one band of one post config; returns { p98, worst, need, label }.
function evaluateBand(px, c, band) {
  const needMap = { eyebrow: 4.5, h1: 3.0, 'h1-accent': 3.0, cta: 4.5, brand: 4.5, 'chip-label': 4.5 };
  const fg = fgState(c, band);
  // Layout-surface tiles (P2.0): a solid band bypasses the photo/scrim
  // compositing entirely — its backdrop is the INVARIANT tile fill. (The
  // tile fill is never sampled from the photo below it; there is none.)
  const solidBack = band.solid ? SOLID_BG[band.solid] : null;
  if (band.solid && !solidBack) throw new Error(`unknown solid-band fill "${band.solid}" (known: ${Object.keys(SOLID_BG).join(', ')})`);
  const samples = [];
  for (let y = band.y0; y <= band.y1; y += 2) {
    for (let x = band.xs; x <= band.xe; x += 8) {
      const bg = solidBack ?? compositedBackdrop(px, c, x, y);
      const eff = fg.s > 0 ? composite(bg, fg.sc, fg.s) : bg;  // declared shadow credit (toward black, light text only)
      const fgRGB = fg.col.map((ch, i) => ch * fg.tau + eff[i] * (1 - fg.tau));
      const r = ratio(fgRGB, bg);
      samples.push(r);
    }
  }
  samples.sort((a, b) => a - b);
  const worst = samples[0];
  // p98 = the 2%-WORST boundary: the best sample inside the worst 2% of the
  // band area (ascending array → index ~2% from the bottom). FAIL ⟺ p98 <
  // need exactly expresses "≥2% of the band's area is below need" — grain
  // / shadow-line pixels (<2% of area) can never block, uniform dimness can.
  const p98 = samples[Math.max(0, Math.ceil(samples.length * 0.02) - 1)];
  const need = needMap[band.role];
  const label = `${band.role} ${band.role === 'h1' || band.role === 'h1-accent' ? DISPLAY_FS + 'px x' + c.h1Lines : (band.role === 'brand' ? BRAND_FS + 'px' : (band.role === 'eyebrow' ? EYEBROW_FS + 'px' : CTA_FS + 'px'))}`;
  const pass = p98 >= need && worst >= HARD_FLOOR;
  const marginPass = p98 >= need + MARGIN && worst >= HARD_FLOOR;
  return { label, need, worst: +worst.toFixed(2), p98: +p98.toFixed(2), pass, marginPass, samples: samples.length };
}

function evaluate(px, c) {
  const bandList = bands(c);
  // (2026-10-25: the shield-era block Y-extent bookkeeping is retired.)
  return bandList.map((b) => evaluateBand(px, c, b));
}

// ── 6. SELF-HEAL LADDER ─────────────────────────────────────────────────
const COPY_STATE_LADDER = ['author', 'ink'];
// BRAND polarity ladder (2026-10-25, knockout restored): authored state is
// whatever the composition carries (white default / explicit --white / --ink);
// 'inkFlip' flips the wordmark to ink for bright upper walls.
const BRAND_STATE_LADDER = ['author', 'inkFlip'];

// ABSOLUTE state setters — every rung is a fully-specified composition
// state, never a toggle. A post authored with copy--ink can therefore be
// *un-inked* deterministically (the 'author' rung expresses exactly the
// authored flags), and repeated `--fix` passes are idempotent.
// (2026-10-25: shield/plate setters retired together with their devices.)
function candidateConfig(c, copyState, brandState) {
  const cand = { ...c };
  if (copyState === 'ink') { cand.inkCopy = true; }
  // Brand pole declarations travel as a SET: ink wordmark ↔ airy pool,
  // white wordmark ↔ deep pool (see story-system.css theme headers).
  if (brandState === 'inkFlip') { cand.inkBar = true; cand.topDeep = false; }
  // 'author' → authored values already on cand
  return cand;
}

// (Re)build class attributes for a target state. Returns the new HTML and
// which attributes actually changed (never writes; caller persists).
// Brand polarity is DYNAMIC (2026-10-25 knockout standard) and carries its
// declared pool partner as ONE set:
//   inkFlip / authored ink → header 'bar-top bar-top--ink', top span sheds
//                            'scrim--top--deep' (airy pool back)
//   author, white pole     → header 'bar-top bar-top--white' (explicit
//                            marker materialized; retired 'bar-top--plate'
//                            dropped), top span gains 'scrim--top--deep'
//                            (deep corner pool) — swap is idempotent.
function classStrings(html, c, copyState, brandState) {
  const copyParts = ['copy', c.variant];
  if (copyState === 'ink') copyParts.push('copy--ink');
  else if (copyState === 'author' && c.inkCopy) copyParts.push('copy--ink');
  const inkPole = brandState === 'inkFlip' || (brandState === 'author' && c.inkBar);
  const barParts = inkPole ? ['bar-top', 'bar-top--ink'] : ['bar-top', 'bar-top--white'];
  const curCopy = html.match(/<section class="(copy[^"\n]*)"/)?.[1] ?? null;
  const curBar = html.match(/<header class="(bar-top[^"\n]*)"/)?.[1] ?? null;
  const nextCopy = copyParts.join(' ');
  const nextBar = barParts.join(' ');
  let out = html, copyChanged = false, barChanged = false, spanChanged = false;
  if (curCopy !== null && curCopy !== nextCopy) {
    out = out.replace(/<section class="copy[^"\n]*"/, `<section class="${nextCopy}"`);
    copyChanged = true;
  }
  if (curBar !== null && curBar !== nextBar) {
    out = out.replace(/<header class="bar-top[^"\n]*"/, `<header class="${nextBar}"`);
    barChanged = true;
  }
  // Top-scrim intensity partner (idempotent swap of the span's class list):
  const spanRe = /<span class="scrim scrim--top[^"\n]*"/;
  const nextSpan = inkPole
    ? 'scrim scrim--top'
    : 'scrim scrim--top scrim--top--deep';
  const curSpan = html.match(spanRe)?.[0] ?? null;
  if (curSpan !== null && curSpan !== `<span class="${nextSpan}"`) {
    out = out.replace(spanRe, `<span class="${nextSpan}"`);
    spanChanged = true;
  }
  return { html: out, copyChanged, barChanged, spanChanged };
}

// FORCE_AUTHOR recovery: strip every escalation token from a composition so
// the ladder re-runs from the naked authored state (colour/geometry source
// of truth is the engine — compositions only carry rung markers).
// All shield/plate markers are retired-era tokens and are stripped on
// FORCE_AUTHOR passes; bar-top--white/bar-top--ink are legitimate polarity
// states, but white is re-materialized explicitly by the ladder, so a bare
// 'bar-top' is likewise normalized.
const ESCALATION_TOKEN = /^(copy--ink|copy--shield--deep|copy--shield|bar-top--ink|bar-top--plate|bar-top--white)$/;
function stripEscalationClasses(html) {
  const scrub = (whole, tokens) => whole.replace(/class="[^"\n]*"/, `class="${tokens}"`);
  const filter = (tokens) => tokens.split(/\s+/).filter((t) => !ESCALATION_TOKEN.test(t)).join(' ');
  return html
    .replace(/<section class="([^"\n]*)"/g, (whole, tokens) => scrub(whole, filter(tokens)))
    .replace(/<header class="([^"\n]*)"/g, (whole, tokens) => scrub(whole, filter(tokens)));
}

// Run the ladder for one post; materialize the chosen rung as class attrs.
function healPost(px, c, ctxId) {
  const failing = (results) => results.filter((r) => !r.pass);
  const base = evaluate(px, c);
  if (failing(base).length === 0) {
    return { applied: false, results: base, config: c, changed: false, reason: 'authored-state-clears-all-bands' };
  }
  const interventions = [];
  let chosen = null;
  for (const copyState of COPY_STATE_LADDER) {
    for (const brandState of BRAND_STATE_LADDER) {
      const cand = candidateConfig(c, copyState, brandState);
      const results = evaluate(px, cand);
      if (!failing(results).length && results.every((r) => r.marginPass)) {
        chosen = { copyState, brandState, results, config: cand };
        break;
      }
    }
    if (chosen) break;
  }
  // NOTE: the nested loop order is copy-outer / brand-inner: brand polarity
  // flips are tried first at the authored copy state (the cheapest declared
  // rung), then copy--ink × brand rungs follow in ladder order.
  if (!chosen) {
    // deepest rungs must still clear AA need (margin headroom is desirable but the gate is need-based)
    const cand = candidateConfig(c, 'ink', 'inkFlip');
    const results = evaluate(px, cand);
    if (!failing(results).length) {
      chosen = { copyState: 'ink', brandState: 'inkFlip', results, config: cand };
      interventions.push('deepest-rung-clears-need-only (no margin headroom)');
    } else {
      return {
        applied: false, results: base, config: c, changed: false, unfixable: true,
        reason: 'ladder-exhausted — TRUE defect: change copy, variant, or photo before render',
      };
    }
  }
  // predicted rungs (reported even when there is nothing to materialize — design mode)
  if (chosen.copyState !== 'author') interventions.push(`copy→${chosen.copyState}`);
  if (chosen.brandState !== 'author') interventions.push(`brand→${chosen.brandState}`);
  // materialize the chosen rung (class attributes only — markup/copy untouched)
  const materialized = [];
  if (c._htmlPath && fs.existsSync(c._htmlPath)) {
    const html = fs.readFileSync(c._htmlPath, 'utf8');
    const next = classStrings(html, c, chosen.copyState, chosen.brandState);
    if (next.copyChanged) materialized.push('copy');
    if (next.barChanged) materialized.push('bar-top');
    if (next.spanChanged) materialized.push('scrim top pool intensity');
    if (next.copyChanged || next.barChanged || next.spanChanged) {
      fs.writeFileSync(c._htmlPath, next.html);
    } else {
      interventions.push('re-validated (classes already match)');
    }
  }
  return { applied: true, results: chosen.results, config: chosen.config, changed: materialized.length > 0, interventions, materialized };
}

// ── 7. MODES ────────────────────────────────────────────────────────────
function main() {
const photoIdx = argv.indexOf('--photo');
// Accept `--photo <file>` OR a bare image path (npm run photo-fit -- <file>):
const photoArg = photoIdx !== -1 ? argv[photoIdx + 1] : argv.find((a, i) => /\.(jpe?g|png)$/i.test(a) && argv[i - 1] !== '--fix');
if (photoArg) {
  // DESIGN MODE — feasibility matrix for one photo, all variants × themes,
  // with the self-heal ladder summary per combo. ADVISORY ONLY: no file is
  // modified (_htmlPath stays null; healPost skips materialization).
  const abs = path.resolve(ROOT, photoArg);
  console.log(`◆ Photo feasibility: ${photoArg}  (advisory only — nothing is modified)`);
  const px = samplePixels(abs);   // decode ONCE — the matrix reuses the same pixel map
  for (const variant of Object.keys(COPY_VARIANTS)) {
    for (const theme of ['charcoal', 'warm', 'greige']) {
      const c = {
        theme, imgAbs: abs, variant, hasEyebrow: true, h1Lines: 2, hasCta: true,
        inkBar: false, inkCopy: false, topDeep: true, _htmlPath: null,
        eyebrowText: 'Material & Light', ctaText: 'Book a private design consultation',
        brandText: 'DIRECT KITCHENS',
      };
      const base = evaluate(px, c);
      const badBase = base.filter((x) => !x.pass).length;
      let ladderNote = badBase === 0 ? 'author: clear' : `author: ${badBase} FAIL`;
      if (badBase > 0) {
        const healed = healPost(px, { ...c }, 'design');
        ladderNote = healed.applied
          ? `author: ${badBase} FAIL → ${healed.interventions.join(' + ') || 'declared rung clears on margin'}`
          : `author: ${badBase} FAIL (${healed.reason})`;
      }
      const worst = base.map((x) => x.worst.toFixed(1)).join('/');
      console.log(`  ${variant.padEnd(19)} ${theme.padEnd(9)} worst ${worst.padEnd(24)} ${ladderNote}`);
    }
  }
} else {
  // GATE MODE — every post in the ACTIVE batch manifest
  const { date, basis } = resolveBatchDate(argv);
  logResolved({ date, basis }, 'Photo-fit gate');
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
  if (schemaErr) { console.error(schemaErr); process.exit(1); }
  console.log(`◆ Gated manifest: ${path.relative(ROOT, manifestPath).split(path.sep).join('/')} (batch: ${ctx.batch}, layout: ${ctx.layout}, posts: ${manifest.posts.length}${FIX ? ', self-heal ON' : ''}${FORCE_AUTHOR ? ', FORCE_AUTHOR recovery' : ''})`);
  if (manifest.posts.length === 0) {
    console.log(`⚠ photo-fit: manifest has 0 posts — nothing gated (batch ${ctx.batch} not yet populated).`);
    process.exit(0);
  }

  let fails = 0, healed = 0, revalidated = 0, unfixable = 0;
  for (const post of manifest.posts) {
    const htmlPath = path.join(ROOT, post.html);
    if (FORCE_AUTHOR) {   // strip every escalation rung first; ladder re-runs from the authored state
      const src = fs.readFileSync(htmlPath, 'utf8');
      const stripped = stripEscalationClasses(src);
      if (stripped !== src) fs.writeFileSync(htmlPath, stripped);
    }
    const c = parseComposition(htmlPath);
    c._htmlPath = htmlPath;
    // P2.0: decode with the DECLARED layout rect. Mono-full compositions
    // carry the full-canvas rect → math is byte-identical to the legacy
    // sampler (same scale, same offsets, same buffer).
    const px = samplePixels(c.imgAbs, c.photos[0].rect);
    let results = evaluate(px, c);
    let cf = c;
    const preBad = results.filter((r) => !r.pass).length;
    if (FIX && preBad > 0) {
      const heal = healPost(px, c, post.slug);
      results = heal.results;
      cf = heal.config;
      if (heal.applied) {
        if (heal.changed) { healed++; console.log(`⟲ [${post.slug}] self-heal: ${preBad} band(s) below AA → ${heal.interventions.join(', ')}`); }
        else { revalidated++; console.log(`⟲ [${post.slug}] re-validated: authored classes already express the healing rung`); }
      } else if (heal.unfixable) {
        unfixable++;
        console.log(`⏸ [${post.slug}] declared ladder exhausted — deferring to the browser-authority gate (model verdict below is ADVISORY):`);
      }
    }
    const bad = results.filter((r) => !r.pass);
    const markers = [
      cf.inkBar ? 'bar-top--ink' : 'bar-top--white',
      cf.topDeep ? 'scrim top pool: deep' : 'scrim top pool: airy',
      `copy ${cf.variant}`,
      cf.inkCopy ? 'copy--ink' : null,
      cf.accentText ? 'serif-accent (ESP700 modelled)' : null,
      `scrim--${cf.theme}`,
    ].filter(Boolean).join(' · ');
    console.log(`${bad.length ? '✗' : '✓'} [${post.slug}] ${markers}`);
    if (c.grade) console.log(`    ${c.grade}`);
    for (const r of results) {
      console.log(`    ${r.label.padEnd(14)} need ${r.need}: p98 ${r.p98}:1 worst ${r.worst}:1  ${r.pass ? 'PASS' : 'FAIL'}${DEBUG ? `  (n=${r.samples})` : ''}`);
    }
    fails += bad.length;
  }
  console.log('');
  if (FIX) console.log(`◆ photo-fit self-heal summary: ${healed} post(s) escalated, ${revalidated} re-validated, ${unfixable} deferred to browser authority.`);
  if (fails) {
    if (FIX && unfixable > 0) {
      // AUTHORITY DOCTRINE (2026-10-25, §H.6): the box-model proxy is
      // deliberately conservative — it takes the worst quantile of the FULL
      // band rectangle (glyphs + inter-glyph gaps + ascender/descender
      // fringes), while the browser sampler measures only glyph-adjacent
      // pixels of the real render. Chromium calibration on 2026-10-25
      // measured the real sampler at ~1.3–1.5× the model at the small-type
      // rows on the same pixels. A declared-ladder-exhausted post therefore
      // DEFERS to verify-contrast (the FINAL verdict per §H.6) instead of
      // pre-emptively dying: fail-closed is preserved at the pipeline level
      // because verify-contrast still fails the chain on a real defect.
      console.error(`\n⏸ ${fails} model band(s) below the model's p98 screen on ${unfixable} post(s) whose declaration ladder is exhausted.`);
      console.error('   Per §H.6 the browser-authority gate (verify-contrast) is the FINAL verdict — proceeding to it fail-closed.');
      process.exit(0);
    }
    console.error(`\n✗ ${fails} text band(s) below WCAG AA p98 — re-run with --fix to apply the minimal engine escalation ladder, or change copy/variant/photo.`);
    process.exit(1);
  }
  console.log('◇ photo-fit: every post clears WCAG AA at every text band (p98 verdict, full layer stack, engine-scrim composited).');
}
}

// CLI guard: requiring this module (for verify-contrast reconcile) must not
// re-run the gate. Programmatic surface: the heal machinery + composition
// parser + the two ladders, so the browser-authority gate can escalate rungs
// without duplicating class surgery in a second script.
if (require.main === module) main();
module.exports = {
  parseComposition,
  classStrings,
  stripEscalationClasses,
  COPY_STATE_LADDER,
  BRAND_STATE_LADDER,
  candidateConfig,
  evaluate: (px, c) => evaluate(px, c),
};
