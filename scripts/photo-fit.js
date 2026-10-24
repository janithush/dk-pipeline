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
//                 --scrim-top/--scrim-bottom, --shield-pad-x/-top/-bottom)
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
//   copy  : as-authored → copy--ink → copy--shield → copy--shield--deep
//   brand : plate is INVARIANT (2026-10-24 plate standard) — ink-on-bone
//           ≥ 12:1 over any photo, so the brand ladder no longer runs; the
//           ladder keeps a single 'author' rung for machinery compatibility.
// Every escalation is a DECLARED engine layer (story-system.css), so the
// model reproduces it exactly — no waiver prompts, no human in the loop.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBatchDate, logResolved } = require('./lib/batch-date');
const { resolveBatchContext, manifestSchemaError, listBatches } = require('./lib/batch-context');

const ROOT = process.cwd();
const CANVAS_W = 1080, CANVAS_H = 1920;          // approved Story geometry — do not change
const SHIELD_CSS = path.join(ROOT, 'shared', 'story-system.css');

// ── 0. CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FIX = argv.includes('--fix');
const DEBUG = !!process.env.DK_PHOTOFIT_DEBUG;
const MARGIN = Number(process.env.DK_PHOTOFIT_MARGIN || 0.25); // self-heal headroom
const HARD_FLOOR = 1.35;                                       // grain-immunity hard floor
const FORCE_AUTHOR = argv.includes('--force-author');          // heal back to as-authored first

// ── 1. SCRAPE ENGINE (anti-drift: single source = shared/*.css) ─────────
const css = fs.readFileSync(SHIELD_CSS, 'utf8');
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
const BONE25 = hex(tokenHex('bone-25'));     // shield CTA ink-safe swap #FDFAF4
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
  shieldPadX: scrapeVar('shield-pad-x', 'px'),
  shieldPadTop: scrapeVar('shield-pad-top', 'px'),
  shieldPadBottom: scrapeVar('shield-pad-bottom', 'px'),
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
  const radial = /^radial-gradient\s*\((.+)\)$/s.exec(seg);
  const linear = /^linear-gradient\s*\((.+)\)$/s.exec(seg);
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
const BRAND_GEOM = (() => {
  const xe = CANVAS_W - GEO.barRight - GEO.barLogo - GEO.barGap;
  const wordW = Math.round(('DIRECT KITCHENS'.length * BRAND_FS * (0.70 + BRAND_LS)) + 20);
  return { xs: xe - wordW, xe, y0: GEO.barTop, y1: GEO.barTop + GEO.barLogo, platePad: platePad() };
  function platePad() {
    const re = /\.bar-top--plate \.brand\s*{[^}]*padding:\s*([\d.]+)px\s+([\d.]+)px/;
    const m = css.match(re);
    return m ? { y: +m[1], x: +m[2] } : { y: 10, x: 16 };
  }
})();
const BRAND_PLATE = (() => {
  const re = /\.bar-top--plate \.brand\s*{[^}]*background:\s*([^;]+);/i;
  const m = css.match(re);
  const segs = m ? splitTop(m[1].trim()) : [];
  const layer = segs.length ? parseLayer(segs[0]) : null;
  const minAlpha = layer ? Math.min(...layer.stops.map((s) => s.alpha)) : 0.92;
  const rgb = (layer && layer.rgb) ? layer.rgb : BONE;  // declared bone plate → tint scraped, not assumed
  return { rgb, minAlpha };                             // minAlpha = conservative floor of the ramp
})();

// SHIELD ramps — parse both levels (stops + tint scraped, not hardcoded)
const SHIELD_L = {};
for (const [key, sel] of [['L1', '.copy--shield::before'], ['L2', '.copy--shield--deep::before']]) {
  const m = css.match(new RegExp(escRe(sel) + `\\s*{[^}]*linear-gradient\\(\\s*([^;]+)\\)`, 'i'));
  if (!m) throw new Error(`engine scrape failed: shield ${key}`);
  SHIELD_L[key] = parseStops(m[1]);
}
const SHIELD_RGB = (() => {
  const m = css.match(/\.copy--shield::before\s*{[^}]*linear-gradient\(\s*([^;]+)\)/i);
  return m ? (firstRgb(m[1]) || [8, 6, 4]) : [8, 6, 4];
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
  const px = (x, y) => {
    const u = Math.min(rw - 1, Math.max(0, Math.round(x + offx)));
    const v = Math.min(Math.round(H * scale) - 1, Math.max(0, Math.round(y + offy)));
    const o = (v * rw + u) * 3; return [buf[o], buf[o + 1], buf[o + 2]];
  };
  return { at: px };
}

// ── 4. COMPOSITION PARSING ──────────────────────────────────────────────
const COPY_VARIANTS = { 'copy--bottom-left': [GEO.copyLeftA, GEO.copyRightA], 'copy--bottom-right': [GEO.copyLeftB, GEO.copyRightB] };
function parseComposition(htmlPath) {
  const h = fs.readFileSync(htmlPath, 'utf8');
  const src = h.match(/photo photo--full\s+scrim--(charcoal|warm|greige)[^>]*>\s*<img src="([^"]+)"/s);
  const copyClass = h.match(/<section class="(copy[^"\n]*)"/)?.[1] ?? '';
  const headerClass = h.match(/<header class="(bar-top[^"\n]*)"/)?.[1] ?? '';
  const variant = Object.keys(COPY_VARIANTS).find((v) => copyClass.includes(v));
  const theme = src?.[1], img = src?.[2];
  const copy = h.match(/<section class="copy[^"]*">([\s\S]*?)<\/section>/)?.[1] ?? '';
  const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const eyebrowText = strip(copy.match(/class="t-eyebrow"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
  const ctaText = strip(copy.match(/class="cta"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
  const brandText = strip(h.match(/<p class="brand"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? 'Direct Kitchens');
  const hasEyebrow = /class="t-eyebrow"/.test(copy);
  const h1Lines = 1 + ((copy.match(/<br>/g) || []).length);
  const hasCta = /class="cta"/.test(copy);
  const inkBar = /bar-top--ink/.test(headerClass);
  const plate = /bar-top--plate/.test(headerClass);
  const inkCopy = /copy--ink/.test(copyClass);
  const shield = /copy--shield--deep/.test(copyClass) ? 'L2' : (/copy--shield/.test(copyClass) ? 'L1' : null);
  if (!theme || !img || !variant) throw new Error(`unparseable composition: ${htmlPath}`);
  return {
    theme, imgAbs: path.resolve(path.dirname(htmlPath), img), variant,
    hasEyebrow, h1Lines, hasCta, inkBar, inkCopy, shield, plate,
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
  const runW = (text, fs, ls) => Math.max(120, Math.round((text || 'XX').length * fs * (0.70 + ls)) + 20);

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
  return {
    charcoal: { top: grab('.scrim--charcoal .scrim--top'), bottom: grab('.scrim--charcoal .scrim--bottom') },
    warm:     { top: grab('.scrim--warm .scrim--top'),     bottom: grab('.scrim--warm .scrim--bottom') },
    greige:   { top: grab('.scrim--greige .scrim--top'),   bottom: grab('.scrim--greige .scrim--bottom') }, // 2026-10-24
  };
})();

// Full stack paint order at canvas pixel (x, y):
// photo → theme scrims (top band above y<scrim-top, bottom band from scrim-bottom down)
// → copy shield (pseudo under the copy text but above the page scrims)
function compositedBackdrop(px, c, x, y) {
  const th = c.theme;
  let v = px.at(x, y);
  if (y < TOP_H) {
    for (const layer of SCRIMS[th].top) {
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
  if (c.shield && y >= c._shieldY1 && y <= c._shieldY2) {
    const pct = ((y - c._shieldY1) / (c._shieldY2 - c._shieldY1)) * 100;
    const a = stopAt(SHIELD_L[c.shield], pct);
    if (a > 0) v = composite(v, SHIELD_RGB, a);
  }
  return v;
}

// fg color + shadow credit per role + state
function fgState(c, band) {
  const INK_family = c.inkCopy;
  const shield = c.shield;
  switch (band.role) {
    case 'eyebrow':
      return { col: INK_family ? INK : BONE, tau: 0.9, s: INK_family ? 0 : 0.2, sc: [0, 0, 0] };
    case 'h1':
      return { col: INK_family ? INK : [255, 255, 255], tau: 1, s: INK_family ? 0 : 0.7, sc: [0, 0, 0] };
    case 'h1-accent':
      // Serif-accent sub-band — PLATE-STANDARD-ERA model fix (2026-10-24):
      // under .copy--ink the accent span recolors to espresso-700 (#3E3027),
      // NOT the band's --ink. Modelled conservatively (see §G.9): the whole
      // sub-band is evaluated at the accent colour; worst-of wins in gate.
      return { col: ESP700, tau: 1, s: 0, sc: [0, 0, 0] };
    case 'cta':
      return { col: shield ? BONE25 : (INK_family ? ESP800 : BRASS), tau: 1, s: INK_family ? 0 : 0.2, sc: [0, 0, 0] };
    case 'brand':
      // PLATE STANDARD (2026-10-24): .bar-top .brand carries the bone plate
      // by default — ink-on-bone ≥ 12:1 over ANY photo. Brand polarity
      // (authored-white / bar-top--ink) is retired at the model level.
      return { col: INK, tau: 1, s: 0, sc: [0, 0, 0] };
  }
  throw new Error('unknown band role ' + band.role);
}

// Evaluate one band of one post config; returns { p98, worst, need, label }.
function evaluateBand(px, c, band) {
  const needMap = { eyebrow: 4.5, h1: 3.0, 'h1-accent': 3.0, cta: 4.5, brand: 4.5 };
  const fg = fgState(c, band);
  // Plate is an INVARIANT for the brand band (2026-10-24 plate standard):
  // the bone plate ramp is composited over the backdrop before every brand
  // sample — independent of any marker class state.
  const plateAAA = band.role === 'brand';
  const samples = [];
  for (let y = band.y0; y <= band.y1; y += 2) {
    for (let x = band.xs; x <= band.xe; x += 8) {
      let bg = compositedBackdrop(px, c, x, y);
      if (plateAAA) {
        bg = composite(bg, BRAND_PLATE.rgb, BRAND_PLATE.minAlpha);
      }
      if (fg.s > 0) bg = composite(bg, fg.sc, fg.s);  // declared shadow credit (toward black, light text only)
      const fgRGB = fg.col.map((ch, i) => ch * fg.tau + bg[i] * (1 - fg.tau));
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
  // shield pseudo Y-extent is uniform for the whole copy block (block ± declared pads)
  const block = bandList.find((b) => b.blockTop !== null);
  c._shieldY1 = block ? block.blockTop - GEO.shieldPadTop : null;
  c._shieldY2 = block ? block.blockBottom + GEO.shieldPadBottom : null;
  return bandList.map((b) => evaluateBand(px, c, b));
}

// ── 6. SELF-HEAL LADDER ─────────────────────────────────────────────────
const COPY_STATE_LADDER = ['author', 'ink', 'shield', 'shieldDeep'];
// PLATE STANDARD (2026-10-24): the brand band is invariant (ink-on-bone ≥
// 12:1 — see evaluateBand plateAAA), so the ladder collapses to a single
// 'author' rung. candidateConfig's inkFlip/plate setters are retained as a
// compatibility surface for verify-contrast reconcile (their flags no
// longer affect the model — plate compositing is unconditional).
const BRAND_STATE_LADDER = ['author'];
const litter = (c) => ({ ...c, _shieldY1: undefined, _shieldY2: undefined });

// ABSOLUTE state setters — every rung is a fully-specified composition
// state, never a toggle. A post authored with copy--ink can therefore be
// *un-inked* deterministically (shield rung sets inkCopy=false), and
// repeated `--fix` passes are idempotent.
function candidateConfig(c, copyState, brandState) {
  const cand = litter(c);
  if (copyState === 'ink') { cand.inkCopy = true; cand.shield = null; }
  if (copyState === 'shield') { cand.inkCopy = false; cand.shield = 'L1'; }
  if (copyState === 'shieldDeep') { cand.inkCopy = false; cand.shield = 'L2'; }
  // copyState 'author' → authored values already on cand
  if (brandState === 'inkFlip') { cand.inkBar = true; cand.plate = false; }
  if (brandState === 'plate') { cand.inkBar = true; cand.plate = true; }
  // brandState 'author' → authored values already on cand
  return cand;
}

// (Re)build both class attributes for a target state. Returns the new HTML
// and which attributes actually changed (never writes; caller persists).
function classStrings(html, c, copyState, brandState) {
  const copyParts = ['copy', c.variant];
  if (copyState === 'ink') copyParts.push('copy--ink');
  else if (copyState === 'shield') copyParts.push('copy--shield');
  else if (copyState === 'shieldDeep') copyParts.push('copy--shield--deep');
  else if (copyState === 'author') {
    if (c.inkCopy) copyParts.push('copy--ink');
    if (c.shield) copyParts.push(c.shield === 'L2' ? 'copy--shield--deep' : 'copy--shield');
  }
  const barParts = ['bar-top', 'bar-top--plate'];   // plate = invariant default; marker always materialized (byte-normalized by heal)
  const curCopy = html.match(/<section class="(copy[^"\n]*)"/)?.[1] ?? null;
  const curBar = html.match(/<header class="(bar-top[^"\n]*)"/)?.[1] ?? null;
  const nextCopy = copyParts.join(' ');
  const nextBar = barParts.join(' ');
  let out = html, copyChanged = false, barChanged = false;
  if (curCopy !== null && curCopy !== nextCopy) {
    out = out.replace(/<section class="copy[^"\n]*"/, `<section class="${nextCopy}"`);
    copyChanged = true;
  }
  if (curBar !== null && curBar !== nextBar) {
    out = out.replace(/<header class="bar-top[^"\n]*"/, `<header class="${nextBar}"`);
    barChanged = true;
  }
  return { html: out, copyChanged, barChanged };
}

// FORCE_AUTHOR recovery: strip every escalation token from a composition so
// the ladder re-runs from the naked authored state (colour/geometry source
// of truth is the engine — compositions only carry rung markers).
// bar-top--plate is NEVER stripped: it is the permanent standard marker
// (2026-10-24), not an escalation rung. bar-top--ink is a deprecated
// polarity kept on the strip list so FORCE_AUTHOR normalizes legacy posts.
const ESCALATION_TOKEN = /^(copy--ink|copy--shield--deep|copy--shield|bar-top--ink)$/;
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
  if (!chosen) {
    // deepest rung must still clear AA need (margin headroom is desirable but the gate is need-based)
    const cand = candidateConfig(c, 'shieldDeep', 'plate');
    const results = evaluate(px, cand);
    if (!failing(results).length) {
      chosen = { copyState: 'shieldDeep', brandState: 'plate', results, config: cand };
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
    if (next.copyChanged || next.barChanged) {
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
        inkBar: false, inkCopy: false, shield: null, plate: false, _htmlPath: null,
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
    const px = samplePixels(c.imgAbs);
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
        console.log(`✗ [${post.slug}] self-heal ladder exhausted — TRUE defect (copy/variant/photo change required):`);
      }
    }
    const bad = results.filter((r) => !r.pass);
    const markers = [
      cf.plate ? 'bar-top--plate·invariant' : 'bar-top--plate·invariant (marker pending heal)',
      `copy ${cf.variant}`,
      cf.inkCopy ? 'copy--ink' : null,
      cf.shield ? (cf.shield === 'L2' ? 'copy--shield--deep' : 'copy--shield') : null,
      `scrim--${cf.theme}`,
    ].filter(Boolean).join(' · ');
    console.log(`${bad.length ? '✗' : '✓'} [${post.slug}] ${markers}`);
    for (const r of results) {
      console.log(`    ${r.label.padEnd(14)} need ${r.need}: p98 ${r.p98}:1 worst ${r.worst}:1  ${r.pass ? 'PASS' : 'FAIL'}${DEBUG ? `  (n=${r.samples})` : ''}`);
    }
    fails += bad.length;
  }
  console.log('');
  if (FIX) console.log(`◆ photo-fit self-heal summary: ${healed} post(s) escalated, ${revalidated} re-validated, ${unfixable} unfixable; the browser-authority gate (verify:contrast) remains the final verdict.`);
  if (fails) {
    console.error(`\n✗ ${fails} text band(s) below WCAG AA p98 — ${FIX
      ? 'heal ladder exhausted: change copy/variant/photo or re-scrape the engine before rendering.'
      : 're-run with --fix to apply the minimal engine escalation ladder, or change copy/variant/photo.'}`);
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
