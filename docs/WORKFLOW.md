# WORKFLOW — dk-pipeline Unified Multi-Format Production Manual (P7.5)

The operator's manual for producing a full day of posts across all three
delivery formats. Architecture doctrine lives in
`PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md`; the reel-specific motion +
audio doctrine lives in `docs/LIVING-STORY-SPEC.md`; this file is the *step-by-step*.

---

## §1 Format Taxonomy

Every manifest `posts[]` entry carries an additive `kind` field (Schema v1/v2
stay valid — unknown additive fields are ignored by every gate). The P7.5
4-Format Production Canon defines four distinct kinds:

| `kind` | Composition file | Renderer | Deliverable leaf | Gates that bind |
|---|---|---|---|---|
| `static` | `<slug>.html` | `render:daily` (png-sequence) | `renders/<date>/<batch>/<slug>/` | preflight chain (lint · check-paths · photo-fit · verify-contrast) |
| `editorial-split` | `<slug>.html` (`layout-family="hero-split-editorial"`) | `render:daily` (png-sequence) | `renders/<date>/<batch>/<slug>/` | same as static (+ solid-tile native AAA, zero self-heal) |
| `pure-grid` | `<slug>.html` (`layout-family="hero-split-pure-grid"`) | `render:daily` (png-sequence) | `renders/<date>/<batch>/<slug>/` | same as static (zero copy bands; brand certified by photo-fit) |
| `reel` | `<slug>-living[-<variant>].html` | `render:reels` (mp4, `--quality delivery --strict`) | `renders/<date>/<batch>/<slug>/living-<variant>.mp4` | preflight chain **+** audio certification (§6) |

Rules:

1. An absent `kind` is read as `static` (legacy manifests render unchanged),
   except that a post whose composition filename contains `-living` is
   classified `reel` by fallback — this keeps pre-P7.0 batches renderable.
2. Reels MUST also declare `variant` (e.g. `"4.5s"`, `"18s"`, `"20s"`) —
   the deliverable filename derives from it.
3. `unknown` kinds fail `check-paths` closed (a typo must never route a post
   into the wrong lane).
4. Slugs stay `story-NN` and are CONTINUOUS intraday across ALL formats
   (`detectNextSlug` rule, §F.9) — a 4-post suite in one batch owns
   story-01..04.
5. **Asset Diversity Law (P7.5):** Posts within a batch MUST NOT clone
   multiple photo pairings. At most ONE photo may be shared between any two
   posts (typically the wide hero for batch continuity). Detail macro panes
   MUST be subject-diverse — no twin pullouts, no twin drawers, no twin
   appliance handles. Violations are caught at authoring; `check-paths`
   enforces manifest structure but the diversity rule is an operator
   discipline (§H.7 vision-grounding).

### Leaf namespaces (one deliverable per leaf — Storage Budget Law)

```
renders/<date>/<batch>/<slug>/                     static / compound-static leaf
  ├── poster-settled.png   (frame_*.png pruned post-render)
renders/<date>/<batch>/<slug>/living-<variant>.mp4 reel deliverable
renders/<date>/<batch>/<slug>/poster-settled.png   (auto-derived from the MP4's final frame)
```

* The manifest `output` for a reel is the MP4 path **minus `.mp4`**
  (`…/story-04/living-20s`), i.e. `output + ".mp4"` is the file.
* The reel's leaf is `dirname(output)` — always the slug-named directory
  directly under the render root. `check-paths` enforces this shape and
  uniqueness so two MP4s can never share a leaf (the P6.0 footgun: a shared
  parent + cleanup budget destroyed the sibling 18s reel).

---

## §2 Asset Ingestion (§D — the 4-step cycle, unchanged by P7.0)

1. Drop 6–7 raw photos into `assets/raw/` (never open or edit files there).
2. `npm run produce` — step 2/4 of **prepare** runs `downscale-assets.js`:
   >15 MB or >2048 px sources are stepped down to ≤ 2 MB JPEGs in
   `assets/raw/optimized/`; compliant sources are mirrored as-is.
   Raw originals are NEVER written. The optimized mirror + `slug-map.json`
   are the only tracked asset layer.
3. Curation (`curate-shoot.js`) caches `vision-manifest.json` — authoring
   reads the cache, never the render loop.
4. **Asset Law (P7.0): the pool is SHARED across formats.** Using the same
   hero photo in a static card and a reel cut on the same date is PERMITTED;
   no gate blocks multi-format reuse. What stays forbidden is reusing a photo
   twice *inside one composition* (ledger anti-reuse doctrine).

Deleting a consumed raw is the operator's signal to retire it — the strict
1:1 mirror drops its optimized copy (lint on archived batches would fail
closed; retirement keeps them archived).

---

## §3 Batch Scaffolding (§F.9 Model A)

```
npm run batch:new                      # scaffold NEXT batch for the resolved date
compositions/<date>/batch-<NN>/        # nested Model A layout
  batch-manifest.json                  # Schema v2 + additive {kind, variant}
renders/<date>/batch-<NN>/<slug>/      # render leaves mirror batch + slug
```

* Batches never refill gaps (`detectNextBatch` = max + 1); a date-level flat
  manifest counts as batch-01 (legacy tolerance).
* Slugs are continuous intraday (batch 1 ends at story-03 → batch 2 starts at
  story-04) — router ids (`post-NN` / `dk-story-NN`) stay unique across same-day
  batches.
* A mixed-format batch is the DEFAULT: static cards and reels in one
  `batch-manifest.json`, classified by `kind`, rendered by their own lanes.

---

## §4 The Daily Loop (§H — the operator's entire job)

```
# 1. drop photos            assets/raw/
# 2. prepare the day
npm run produce                       # retire stale → optimize → curate → scaffold → report
# 3. author the FULL 3-FORMAT SUITE (static, compound-static, 20s reel) per the P7.0 Master Prompt below
#    compositions/<date>/batch-<NN>/<slug-01>.html (static)
#    compositions/<date>/batch-<NN>/<slug-02>.html (compound-static)
#    compositions/<date>/batch-<NN>/<slug-03>-living-20s.html (reel)
npm run batch:new --sync-router       # or let ship's step 2/6 do it (idempotent)
# 4. gate + ship the batch
npm run ship                          # or: node scripts/produce.js ship
```

---

### §4.1 Unified Story & Reel Authoring Prompt (P7.3 — Copy-Pasteable, Zero-Questions)

> **This is the single authoritative authoring prompt for the daily run. It supersedes all prior static-only prompts (including the legacy prompt in `PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md` §D). Operators paste this block into a vision-capable session — it authors the full 3-format suite and finishes without questions. P7.3 (2026-11-01) carries the verified Head-Office 4-variant CTA suite and the deepened 680px bottom scrim.**

```text
# DAILY HYPERFRAMES STORY & REEL AUTHORING — ZERO-QUESTIONS P7.3 RUN
# Project: dk-pipeline | Canvas: 1080x1920 (9:16) | Engine: shared/story-system.css

You are the Creative Technologist for Direct Kitchens today. Author the full 3-format suite for the ACTIVE batch with ZERO questions to the operator. Downstream gates (npm run ship) enforce visual contrast, geometry, and loudness compliance.

== STEP 1: LEDGER DISCOVERY ==
1. Run: npm run produce -- status
2. Identify: The active batch folder `compositions/<DATE>/<batch-XX>/`, the next free slug (`story-NN`), and available photos from the photo ledger.
3. Inspect the candidate photos sequentially. Ground every headline and alt text strictly in visible room architecture, materials, and hardware.

== STEP 1.5: COPY LAW (P7.1 — KITCHEN-CENTRIC JOINERY & ARCHITECTURE CANON) ==
1. CABINERTY & JOINERY PRIMACY: every `.t-display` headline and `.t-eyebrow` must celebrate the BUILT kitchen itself. Approved topics:
   * Shaker profile doors · integrated pantries · stone waterfall benchtops · fluted timber joinery · quiet-close hardware · architectural splashbacks · bespoke island architecture · hand-crafted joinery precision.
2. STRICT BAN ON SECONDARY PROPS: lighting fixtures (pendant lights), chairs, barstools, fruit bowls, plants, or background windows must NEVER drive the headline or eyebrow. A vision model fixating on incidental props is a defect, not an angle — re-inspect and re-author around the cabinetry, stone, and joinery. Example shift: NOT "Light, hung low" / "Amber glass accent" — INSTEAD "Hand-crafted Shaker joinery, quiet precision" / "Bespoke island architecture, crafted in Melbourne".
3. VERIFIED 4-VARIANT CTA SUITE (P7.3 Head-Office standard — the ONLY approved CTA texts; rotate by post index within the batch, A → B → C → D, cyclic; never freelance a phrase):
   * cta-A (Tri-Showroom Network): `Visit our showrooms: Blackburn · Moonee Ponds · Bayswater`
   * cta-B (Head-Office Direct & Consultation): `Book a design consultation at Blackburn Head Office · Call 1300 449 799`
   * cta-C (Digital URL & Clear Call Lockup): `Explore custom kitchens at directkitchens.com.au · Call 1300 449 799`
   * cta-D (Melbourne Craftsmanship & Head-Office Authority): `Melbourne custom kitchens designed & built · Call Blackburn 1300 449 799`
   These are the verified credentials of record: web `directkitchens.com.au` · toll-free bookings `1300 449 799` · showrooms Blackburn (Head Office, 184 Whitehorse Rd) · Moonee Ponds (42 Maribyrnong Rd) · Bayswater (Factory, 1 Power Rd).
   P7.3 DOCTRINE: customers book design consultations with HEAD OFFICE, never the manufacturing plant — isolated factory-contact CTAs are REMOVED (the factory survives only as proof-of-manufacture inside cta-D, with the call routed to Blackburn `Call Blackburn 1300 449 799`). cta-C's phone entry carries the explicit `Call ` prefix — it eliminates the visual ambiguity between the `.com.au` TLD and the bare 1300 number in a tracked caps run.
4. CTA RENDERING: the engine styles `.cta` at the elevated 20px / 600 / 0.14em / 1.5 lockup (brass on dark scrims / espresso-800 under `.copy--ink`). NEVER add per-post CTA styling, pills, plates, or background boxes — long lockups wrap to a balanced 1–3 line stack inside the column on their own, and the scrims alone carry contrast. In narrow columns prefer an authored `<br>` at the suite separator `·` so the phone lockup can never split mid-number (e.g. cta-B in the 539px hero-split pane: `Book a design consultation<br>at Blackburn Head Office<br>Call 1300 449 799`; cta-C full-bleed: `Explore custom kitchens at directkitchens.com.au<br>Call 1300 449 799`).
5. P7.3 SCRIM GEOMETRY: the bottom ramp is deepened to **680px** (`--scrim-bottom: 680px`, was 620px) so the 0.60–0.80 alpha wheel envelops the elevated 20px CTA stack in every pane — the mono + duo/hero-split ramp is canvas-coincident at y1240 over the 881px bottom panes. photo-fit scrapes the token; no per-post scrim CSS is ever authored.

== STEP 2: COMPOSE THE FOUR CERTIFIED FORMATS (P7.5 4-FORMAT PRODUCTION CANON) ==
Using available photos, author the following 4 compositions inside the active batch folder using DEPTH-3 stylesheet imports (../../../shared/story-system.css):

1. POST 1 - FULL-BLEED STATIC HERO (kind: "static" - Format 1):
   - Slug: <slug-01>.html (e.g., story-01.html)
   - Contract: data-composition-id="dk-<slug-01>" data-duration="0.033" data-no-timeline data-width="1080" data-height="1920".
   - Layout: Full-bleed single hero architecture, top-right knockout .bar-top, .copy.copy--bottom-left or copy--bottom-right pinned at 220px.

2. POST 2 - EDITORIAL SPLIT TILE (kind: "editorial-split" - Format 2):
   - Slug: <slug-02>.html (e.g., story-02.html)
   - Contract: data-composition-id="dk-<slug-02>" data-duration="0.033" data-no-timeline data-width="1080" data-height="1920" data-layout-family="hero-split-editorial".
   - Layout:
     * Top Pane (54% height): Wide architectural room hero with top-right knockout brand bar.
     * Bottom-Left Cell (46% height): **SOLID BONE EDITORIAL TILE** - <div class="pane pane--solid-bone"> (zero photo, zero scrim, zero eyebrow). Copy platform floats over tile: authored .copy--ink (dark ink headline + espresso CTA = native AAA), kitchen-centric headline (celebrating built cabinetry/joinery), verified-suite CTA.
     * Bottom-Right Cell (46% height): Pure detail macro - uninterrupted craftsmanship texture (no copy, no scrim).

3. POST 3 - PURE-VISUAL 3-PHOTO GRID (kind: "pure-grid" - Format 3):
   - Slug: <slug-04>.html (e.g., story-04.html) - note: story-03 is the reel, story-04 is the pure-grid.
   - Contract: data-composition-id="dk-<slug-04>" data-duration="0.033" data-no-timeline data-width="1080" data-height="1920" data-layout-family="hero-split-pure-grid".
   - Layout:
     * Top Pane (54% height): Wide architectural room hero with top-right knockout brand bar.
     * Bottom-Left Cell (46% height): Pure detail macro 1 - **NO copy, NO scrim**.
     * Bottom-Right Cell (46% height): Pure detail macro 2 - **NO copy, NO scrim**.
   - **Asset Diversity Law (STRICT):** The two detail macros MUST depict subject-diverse assemblies (e.g., hardware pull macro + joinery corner macro - NO twin pullouts, NO twin drawers). The top hero may be shared with ONE other post in the batch for continuity; the detail macro pair must be fresh assets from the active pool.

4. POST 4 - 20.0s LIVING STORY REEL (kind: "reel", ariant: "20s" - Format 4):
   - Slug: <slug-03>-living-20s.html (e.g., story-03-living-20s.html)
   - Contract: data-composition-id="dk-<slug-03>" data-duration="20.0" data-width="1080" data-height="1920" (GSAP timeline driven, 30fps / 600 frames).
   - Motion Choreography:
     * S1 (0.0-4.5s): Hero wide with motorized lateral pan (scale >= 1.15).
     * S2 (4.5-8.5s): Macro focus with beat-synced arrival punch-zoom.
     * S3 (8.5-12.5s): 54/46 duo-stack split (settle drift top + push-slide bottom).
     * S4 (12.5-16.5s): Functional detail via masked lateral push-wipe.
     * S5 (16.5-20.0s): Pure white #ffffff end-card with centered dk emblem and an approved CTA line from the P7.3 verified Head-Office suite (see STEP 1.5 above - cta-B "Book a design consultation at Blackburn Head Office · Call 1300 449 799" is the end-card default; the reel's own end-card styling governs its colour/size).
   - Stationary Scrim Law: Translate and scale apply exclusively to inner <img> tags; scrims and brand marks remain fixed siblings.
   - Master Audio Staging & Ducking:
     * Bed: ssets/audio/beds/dk-bed-acoustic-claps-01.mp3 (P7.2 CERTIFIED BASELINE: +1.0 dB body / linear 1.1220 -
        the -9 dB transition notches remove ~0.5 dB of integrated bed energy, so the body carries BOTH that
        compensation AND the +0.5 dB delivery headroom. NEVER author a reel at +0.5 dB (1.0593): the 2026-10-31
        ship measured I -14.7 LUFS (0.2 LU below the -14.5 floor, audio cert RED) from exactly that regression.
        Notch dips 0.3758 ABSOLUTE (-9.0 dB RELATIVE to the 1.1220 body, ratio ≈ 0.335) · end-card pocket
        0.5625 absolute (-6 dB relative). P6.0 measured this lane at I -14.3 LUFS.
     * Whoosh cues: t=4.5s and t=8.5s (whoosh-soft-01.mp3 at -5.0 dB under -9.0 dB notches).
     * Lateral wipe cue: t=12.5s (ccent-page-turn-01.mp3 at -5.0 dB under -9.0 dB notch).
     * Logo snap cue: t=16.5s (click-tactile-01.mp3 at -6.5 dB under -6.0 dB bed hold).
     * CTA settle cue: t=17.2s (ccent-pop-01.mp3 at -7.5 dB).
     * Outro decay: Exponential decay from -6.0 dB to -60.0 dB (17.5s - 20.0s). Root limiter ceiling pinned at -3.6 dBTP.n, 30fps / 600 frames).
   - Motion Choreography:
     * S1 (0.0-4.5s): Hero wide with motorized lateral pan (scale >= 1.15).
     * S2 (4.5-8.5s): Macro focus with beat-synced arrival punch-zoom.
     * S3 (8.5-12.5s): 54/46 duo-stack split (settle drift top + push-slide bottom).
     * S4 (12.5-16.5s): Functional detail via masked lateral push-wipe.
     * S5 (16.5-20.0s): Pure white `#ffffff` end-card with centered `dk` emblem and an approved CTA line from the P7.3 verified Head-Office suite (see STEP 1.5 above — `cta-B "Book a design consultation at Blackburn Head Office · Call 1300 449 799"` is the end-card default; the reel's own end-card styling governs its colour/size).
   - Stationary Scrim Law: Translate and scale apply exclusively to inner `<img>` tags; scrims and brand marks remain fixed siblings.
   - Master Audio Staging & Ducking:
     * Bed: `assets/audio/beds/dk-bed-acoustic-claps-01.mp3` (P7.2 CERTIFIED BASELINE: +1.0 dB body / linear 1.1220 —
        the −9 dB transition notches remove ~0.5 dB of integrated bed energy, so the body carries BOTH that
        compensation AND the +0.5 dB delivery headroom. NEVER author a reel at +0.5 dB (1.0593): the 2026-10-31
        ship measured I −14.7 LUFS (0.2 LU below the −14.5 floor, audio cert RED) from exactly that regression.
        Notch dips 0.3758 ABSOLUTE (−9.0 dB RELATIVE to the 1.1220 body, ratio ≈ 0.335) · end-card pocket
        0.5625 absolute (−6 dB relative). P6.0 measured this lane at I −14.3 LUFS.
     * Whoosh cues: t=4.5s and t=8.5s (`whoosh-soft-01.mp3` at -5.0 dB under -9.0 dB notches).
     * Lateral wipe cue: t=12.5s (`accent-page-turn-01.mp3` at -5.0 dB under -9.0 dB notch).
     * Logo snap cue: t=16.5s (`click-tactile-01.mp3` at -6.5 dB under -6.0 dB bed hold).
     * CTA settle cue: t=17.2s (`accent-pop-01.mp3` at -7.5 dB).
     * Outro decay: Exponential decay from -6.0 dB to -60.0 dB (17.5s - 20.0s). Root limiter ceiling pinned at -3.6 dBTP.

## STEP 3: UPDATE BATCH MANIFEST ==
Append all 4 posts to the active `batch-manifest.json` using Schema v2 with explicit `kind` typing and dedicated leaf paths. Static-lane posts (`static`, `editorial-split`, `pure-grid`) carry an additive `cta` field for copy-bearing posts only; `pure-grid` posts carry NO CTA (zero-copy contract). The manifest's `ctaLibrary` block (P7.3 Head-Office suite — the source of truth to embed VERBATIM in every new manifest):
{
  "date": "<YYYY-MM-DD>",
  "batch": "<batch-XX>",
  "ctaLibrary": {
    "policy": "P7.3 verified Head-Office conversion suite — the ONLY approved CTA inputs. Rotate by manifest post index (A → B → C → D, cyclic). Isolated factory-contact CTAs REMOVED (P7.3): bookings go to Head Office. P7.4/5: pure-grid posts carry NO CTA — the rotation continues unbroken across copy-bearing posts only.",
    "variants": [
      { "id": "cta-A", "label": "Tri-Showroom Network", "text": "Visit our showrooms: Blackburn · Moonee Ponds · Bayswater" },
      { "id": "cta-B", "label": "Head-Office Direct & Consultation", "text": "Book a design consultation at Blackburn Head Office · Call 1300 449 799" },
      { "id": "cta-C", "label": "Digital URL & Clear Call Lockup", "text": "Explore custom kitchens at directkitchens.com.au · Call 1300 449 799" },
      { "id": "cta-D", "label": "Melbourne Craftsmanship & Head-Office Authority", "text": "Melbourne custom kitchens designed & built · Call Blackburn 1300 449 799" }
    ]
  },
  "posts": [
    {
      "slug": "<slug-01>",
      "kind": "static",
      "html": "compositions/<DATE>/<batch-XX>/<slug-01>.html",
      "output": "renders/<DATE>/<batch-XX>/<slug-01>",
      "notes": "Full-bleed static hero (Format 1)",
      "cta": "<cta-A|cta-B|cta-C|cta-D>"
    },
    {
      "slug": "<slug-02>",
      "kind": "editorial-split",
      "html": "compositions/<DATE>/<batch-XX>/<slug-02>.html",
      "output": "renders/<DATE>/<batch-XX>/<slug-02>",
      "notes": "Editorial Split Tile — solid bone editorial tile + pure detail macro (Format 2)",
      "cta": "<cta-next in rotation>"
    },
    {
      "slug": "<slug-03>",
      "kind": "reel",
      "variant": "20s",
      "html": "compositions/<DATE>/<batch-XX>/<slug-03>-living-20s.html",
      "output": "renders/<DATE>/<batch-XX>/<slug-03>/living-20s",
      "notes": "20s Living Story Reel (P7.0 certified, P7.2 audio baseline)"
    },
    {
      "slug": "<slug-04>",
      "kind": "pure-grid",
      "html": "compositions/<DATE>/<batch-XX>/<slug-04>.html",
      "output": "renders/<DATE>/<batch-XX>/<slug-04>",
      "notes": "Pure-Visual 3-Photo Grid — wide hero + 2 subject-diverse detail macros (Format 3)"
    }
  ]
}

== STEP 4: ROUTER SYNC & VERIFY ==
1. Run: `node scripts/new-batch.js --sync-router`
2. Run: `npm run check:paths`
3. Finish cleanly without interactive prompts. Print summary of authored posts.
```

`ship` runs the full chain, each step one hardened gate script:

```
1/6  assets re-optimized (idempotent)
2/6  router sync (index.html routes every manifest post)
3/6  preflight: lint → check-paths → photo-fit --fix → verify-contrast
4/6  static lane — render:daily (png-sequence, kind static | compound-static)
5/6  reel lane — render:reels (mp4 delivery · supersede archival ·
     per-leaf ≤20 MB budget · then verify-loudness INSIDE the lane)
6/6  audio certification — verify:loudness (independent green line)
```

then stamps per-post certificates into the manifest notes:

* statics → `SHIP-CERT … shipped frame poster-settled.png (N bytes)`
* reels → `SHIP-CERT … audio cert: I −14.3 LUFS · TP −3.3 dBTP · 0 clipped ·
  600 frames · digest .hyperframes/artifacts/loudness/<date>-<batch>.digest.json`

Lanes can also be driven independently:

```
node scripts/render-batch.js --date <date> [--no-preflight]   # static lane only
node scripts/render-reels.js   --date <date> [--slug story-04 --fps 30]
node scripts/verify-loudness.js --date <date> [--slug story-04 | file.mp4]
node scripts/cleanup-render.js  <date> | --all
```

P7.3 lifecycle hardening (2026-11-01): every `render:reels` invocation applies the
teardown seam (`scripts/lib/render-teardown-seam.js`) — the engine's bundled 5s
capture-session close race is relaxed to 15s on the pinned vendored build so
audio-heavy pages (~6 live streams across multi-worker Chromium) tear down
gracefully instead of being force-killed at "[FrameCapture] Timed out closing
browser". Idempotent and re-applied per invocation; the CDP protocol timeout stays
at its 300000ms default. `cleanup-render.js` (run by both render lanes
post-render) additionally sweeps orphaned Chromium automation temp profiles
(`puppeteer_dev_chrome_profile-*` · `playwright_chromiumdev_profile-*` ·
`hyperframes-extract-cache-*`) under `%TEMP%` and `.hyperframes/` with a 60-min
idle guard — zero disk accumulation across repeated daily runs.

NOTE (Windows): `npm run ship -- --no-git` may drop everything after `--`
depending on the shell (observed with pwsh + npm 10). To pass flags
reliably call the script directly:
`node scripts/produce.js ship --no-git`.

`status` is a pure report and now classifies per kind:

```
✓ story-04   (reel)  composition ok · rendered
npm run produce -- status
```

### Iterating on one reel (the P6.0 loop, automated around the edges)

```
# edit the composition
node scripts/render-reels.js --slug story-04
# → the previous certified MP4 is ARCHIVED (never deleted) to
#   renders/archive/<date>/<batch>/<slug>/living-<variant>-superseded-<ts>.mp4
# → re-render → cleanup (fresh poster) → loudness gate → digest refresh
```

---

## §5 Archival Recovery (§H.3 + P7.0 supersede policy)

Nothing is ever deleted silently. Two archive layers:

| Layer | Written by | Contains |
|---|---|---|
| `renders/archive/<date>/<batch>/<slug>/` | `cleanup-render.js` (old MP4s in a leaf) and `render-reels.js` (pre-render supersede) | superseded MP4 deliveries, renamed `living-<variant>-superseded-<timestamp>.mp4` |
| `archive/stale-drafts/<date>` / `archive/unshipped/<date>` | `retire-batch.js` (whole-date retirement at day rollover) | entire composition folders (shipped-aware destination) |

* Every relocation appends one record to `archive/retire-log.json`
  (`{at, date, kind, from, to, moved, skipped, trigger}`) — read `from` → `to`
  to trace any deliverable's history. `kind: "superseded-reel"` records are
  the P7.0 layer.
* To recover a superseded cut: copy the archived MP4 back out of
  `renders/archive/…` manually (never leave edits inside `archive/`).
* Batch dates ignore `renders/archive/` completely: leaf cleaning,
  poster derivation, and budget verdicts never walk into it.
* Asset-undead recovery: if an archived batch's composition no longer finds
  its optimized photo (1:1 mirror pruned it), restore the file from git
  history — `git log --oneline -- assets/raw/optimized/<file>.jpg`.

---

## §6 Release Quality SLAs (§6 gospel — failure of any line blocks ship)

| SLA | Threshold | Enforced by |
|---|---|---|
| Integrated loudness (reels) | −14 LUFS ± 0.5 (−14.5 … −13.5) | `verify:loudness` (ffmpeg `ebur128`, fail-closed, digest persisted) |
| True peak (reels) | ≤ −3.0 dBTP | `verify:loudness` (ebur128 `peak=true`) |
| Clipping (reels) | 0 clipped samples | `verify:loudness` (ffmpeg `astats`) |
| Frame completeness (reels) | informational in digest + certificate (e.g. 600/600 @ 30 fps for 20s) | `ffprobe` count, stamped after ship |
| Contrast (all formats) | WCAG AA against the sampled p98 | `photo-fit` (self-heal ladder) → `verify:contrast` (browser authority, final verdict) |
| Static lane parity | manifest ⇄ compositions 1:1, leaf shape + uniqueness per §1 | `check-paths` (fail-closed; unknown `kind` P1-banned) |
| Storage budget | ≤ 20.0 MB per DELIVERABLE leaf (`living-20s.mp4` + `poster-settled.png`); parent batch folders are EXEMPT | `cleanup-render.js` verdict; renders/archive growth is the archival cost and reports informationally |
| Stationary Scrim Law | scale/x live only on inner visual elements; scrims never move | authoring review (see LIVING-STORY-SPEC §scrims) |

### Artifact hygiene

```
npm run artifacts:prune        # or: node scripts/prune-artifacts.js [--date D] [--dry-run]
```

* `.hyperframes/artifacts/snapshots/*` — pruned when mtime < midnight of the
  batch date (52 UUID dirs ≈ 52.5 MB was the empirical trigger for this policy).
* `.hyperframes/artifacts/frame-check-*` — always pruned (probe scratch).
* `.hyperframes/artifacts/checks/*` — pruned when older than the batch date.
* NEVER pruned: `verify-contrast/` and `loudness/` (the certificate digests
  are part of the audit trail).

---

## Troubleshooting quick table

| Symptom | Cause | Fix |
|---|---|---|
| `npm run ship -- <flag>` loses the flag | pwsh/npm `--` forwarding quirk | call `node scripts/produce.js …` directly |
| `verify-loudness` RED on I out of window | bed/VO gains off after an edit | rescale gains proportionally (P6.0 lanes: bed 1.1220 body · notches 0.3758 · pocket 0.5625) and re-run the lane |
| Two reels share a leaf | hand-edited `output` | `check-paths` refuses; restore the `…/<slug>/living-<variant>` shape |
| Reel MP4 missing at certify | render failed mid-lane | re-run `node scripts/render-reels.js --slug <slug>` (the missing MP4 fails the gate closed) |
| "[FrameCapture] Timed out closing browser; forcing browser process shutdown" after a 600-frame audio-heavy render | the engine's bundled 5s capture-session close race (pre-P7.3) | P7.3 seam relaxes it to 15s — verify the `[teardown seam]` line at the head of the render log; if absent, `applyTeardownSeam()` no-opped an engine upgrade (default governs) |
| Temp disk bloat from repeated daily renders | orphaned Chromium automation profiles in `%TEMP%` | `node scripts/cleanup-render.js --all` — the P7.3 profile GC sweeps `puppeteer_dev_chrome_profile-*` / `playwright_chromiumdev_profile-*` / `hyperframes-extract-cache-*` older than the 60-min idle guard |
| `hyperframes lint` fails on an OLD date's batch | its optimized photos were retired | recover files from git history (§5) or `npm run retire:batch` |
