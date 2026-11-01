// scripts/lib/render-teardown-seam.js
// P7.3 BROWSER TEARDOWN HARDENING (2026-11-01) — the render engine's capture
// session close race ships as a bundled constant:
//
//   var CAPTURE_SESSION_CLOSE_TIMEOUT_MS = 5e3;   // node_modules/hyperframes/dist/chunk-*.js
//
// and waitForCloseWithTimeout() races page.close() / browser.close() against
// it. On the 2026-10-31 600-frame delivery render of story-03 the graceful
// teardown of 6 live audio streams across multi-worker Chromium instances
// exceeded that 5s window, so the engine forced the browser process down
// ("[FrameCapture] Timed out closing browser; forcing browser process
// shutdown") — a hard-kill that skips audio device release and leaves the
// worker temp profile directories behind.
//
// Upstream v0.8.191 exposes NO CLI flag / env var for this constant, so this
// seam relaxes it ON THE PINNED VENDORED BUILD ONLY (5000 → 15000 ms):
//   - idempotent: re-running is a no-op (repeat renders never compound it),
//   - re-applies automatically after `npm ci` wipes node_modules,
//   - "where supported": if the constant is not found (a future engine
//     upgrade renamed/removed it) the seam SILENTLY NO-OPS and lets the
//     engine's own default govern — never a render blocker.
// The protocol timeout (PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS, default
// 300000ms) is explicitly NOT touched — it is a different knob and lowering
// it would tighten, not relax, teardown.

const fs = require('fs');
const path = require('path');

const TARGET_MS = 15000;           // relaxed browser/page close race — 3x headroom over the audio-heavy worst case
const MARKER = 'CAPTURE_SESSION_CLOSE_TIMEOUT_MS';

/**
 * Relax the vendored capture-session close timeout to TARGET_MS.
 * @returns {{applied: boolean, status: 'relaxed'|'already-relaxed'|'not-found'|'error',
 *            file?: string, fromMs?: number, detail?: string}}
 */
function applyTeardownSeam() {
  const distDir = path.join(process.cwd(), 'node_modules', 'hyperframes', 'dist');
  if (!fs.existsSync(distDir)) {
    return { applied: false, status: 'not-found', detail: 'hyperframes dist not installed' };
  }
  let candidates;
  try {
    candidates = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));
  } catch (err) {
    return { applied: false, status: 'error', detail: err.message };
  }
  for (const file of candidates) {
    const abs = path.join(distDir, file);
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!src.includes(MARKER)) continue;
    const m = new RegExp(MARKER + '\\s*=\\s*([\\d.]+)e3;').exec(src);
    const fromMs = m ? Math.round(parseFloat(m[1]) * 1000) : null;
    if (!m) {
      // constant present but in an unrecognized literal form — leave it alone
      return { applied: false, status: 'not-found', file: abs,
        detail: `${MARKER} present but literal not parseable — engine upgrade; default governs` };
    }
    if (fromMs === TARGET_MS || fromMs > TARGET_MS) {
      // already at (or bigger than) our target — idempotent no-op
      return { applied: false, status: 'already-relaxed', file: abs, fromMs };
    }
    const next = src.replace(
      new RegExp(MARKER + '\\s*=\\s*[\\d.]+e3;'),
      `${MARKER} = ${TARGET_MS / 1000}e3; /* P7.3 teardown seam: relaxed 5000 -> 15000 for audio-heavy page closes (scripts/lib/render-teardown-seam.js) */`
    );
    try {
      fs.writeFileSync(abs, next);
    } catch (err) {
      return { applied: false, status: 'error', file: abs, detail: err.message };
    }
    return { applied: true, status: 'relaxed', file: abs, fromMs };
  }
  return { applied: false, status: 'not-found', detail: `${MARKER} not present in any dist chunk — engine upgrade; default governs` };
}

module.exports = { applyTeardownSeam, TARGET_MS };
