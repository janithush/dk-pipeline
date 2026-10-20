# HyperFrames Production Pipeline Audit & Daily Automation Blueprint

**Project:** `dk-pipeline` (`D:\Projects\dk-pipeline`)
**Engine:** HyperFrames `v0.8.163` (devDependency)
**Target:** 10–15 high-fidelity static marketing creatives per day, zero-friction, repeatable daily engine.
**Audited:** 2026-10-19

---

## A. Architecture Audit & Production Readiness Score

### A.1 Current file tree

```
dk-now/
├── index.html                      # placeholder scratchpad (1080×1080, "KITES")
├── package.json                    # hyperframes ^0.8.163; scripts: "test" only
├── package-lock.json
├── hyperframes.json                # paths: blocks=compositions, components=compositions/components, assets=assets; media.autoProxy=true
├── .hyperframes/                   # HyperFrames internal state (render-outputs.json, video-state.json, history-id, locks)
├── node_modules/                   # installed hyperframes + deps
├── assets/                         # FLAT BUCKET — raw photos + logo mixed together
│   ├── dk-raw-01-exploring.jpg
│   ├── dk-raw-02-u-shape.jpg
│   └── logo.png
├── compositions/                   # one standalone HTML+CSS per post
│   ├── dk-01-timber-touch.html / .css
│   └── dk-02-slow-mornings.html / .css
├── shared/
│   ├── token.css                   # design tokens; @imports fonts.css
│   ├── shared.css                  # base layer, primitives, utilities, .brand-logo
│   ├── fonts.css                   # local @font-face (Archivo var, Cormorant Garamond italic)
│   └── fonts/
│       ├── Archivo-Variable.woff2
│       ├── archivo-var-full.woff2
│       └── ormorantGaramond-Italic.woff2
└── renders/
    ├── dk-01-timber-touch.png
    └── dk-02-slow-mornings.png
```

### A.2 Execution flow (today)

1. Each composition is a self-contained HTML document (`<html><head><body>`) that imports `../shared/token.css`, `../shared/shared.css`, and its own `{slug}.css`.
2. Logos are hardcoded in each HTML: `<img src="../assets/logo.png" class="brand-logo rise">`; sizing is centralized in `shared.css` `.brand-logo { height: 36px; }`.
3. Fonts are self-hosted via `shared/fonts.css` → `shared/fonts/*.woff2` (no CDN — headless-safe).
4. Rendering: `npx hyperframes render --composition compositions/<slug>.html -o renders/<slug> --format png-sequence` (MP4/WebM/png-sequence supported).
5. Linting: `npx hyperframes lint` validates the project.
6. `index.html` is an isolated placeholder (1080×1080 canvas, "KITES") — not connected to any composition, not a router.

### A.3 What works well right now

| Area | Observation |
|------|-------------|
| **Fonts** | Local `@font-face` in `shared/fonts.css`; no external CDN at render time. Headless-safe by design. |
| **Design tokens** | `token.css` is a clean single source of truth (semantic colors, type scale, spacing, shadow, motion). `shared.css` imports it. |
| **Component primitives** | `.photo`, `.photo--inset`, `.scrim`, `.chip`, `.brand`, `.rule-h/v`, `.plus`, `.diamond`, `.ghost`, `.rise` give a reusable vocabulary. |
| **Logo sizing** | Centralized `.brand-logo` rule (height: 36px, object-fit: contain) — no per-post CSS duplication for logo scale. |
| **CLI works** | `hyperframes lint`, `render`, `snapshot`, `validate` all present and functional at v0.8.163. |
| **Output dir wired** | `hyperframes.json` `"paths": { "assets": "assets" }` and `.hyperframes/render-outputs.json` `["renders"]`. |
| **Per-post isolation** | Each composition is its own document → no cross-post CSS bleed at render time today. |

### A.4 Readiness score: **42 / 100**

Verdict: **NOT production-ready** for 10–15 static posts/day. The engine and font/token foundations are solid, but the operational shell (batch manifest, daily segregation, lint gate, asset taxonomy, package.json scripts) is missing. At 30–45 posts (3 days) the workspace will become unmaintainable without restructuring.

**Score breakdown (points earned / possible):**

| Criterion | Score | Justification |
|-----------|-------|---------------|
| Local font pipeline (headless-safe) | 10/10 | `assets/fonts`-equivalent exists in `shared/fonts/`; `@font-face` local; no CDN. |
| Design token system | 10/10 | `token.css` centralized; semantic tokens used by compositions. |
| Lint tooling functional | 10/10 | `npx hyperframes lint` runs and surfaces real, actionable errors. |
| Render CLI for statics | 10/10 | `--format png-sequence` + `--composition <file>` + `--strict` available. |
| Logo modularity | 4/10 | Centralized `.brand-logo` CSS exists, but logo is a hardcoded PNG in every HTML; no SVG; no injection. |
| index.html hygiene | 2/10 | Disconnected placeholder; no router/manifest; would bloat into a monolith if used as batch entry. |
| Asset taxonomy | 2/10 | `assets/` is a flat bucket; no `references/`, `raw/`, `fonts/`, `logos/` segregation. |
| Composition lifecycle | 1/10 | No daily batch folder, no archive, no overwrite-vs-preserve rule. |
| package.json hygiene | 1/10 | Only `"test"` script; no `lint`/`render` scripts; zero-friction daily loop not scripted. |
| Lint gate status | 0/10 | Gate is **red today** (2 errors — see §B.5). |
| **Total** | **42/100** | |

**Concrete technical justifications for the score:**
- Lint is currently failing (`root_missing_composition_id` on both compositions) → any `--strict` render fails immediately.
- `index.html` canvas is 1080×1080 while compositions use `token.css` `--canvas-h: 1350px` (portrait) — canvas mismatch between scratchpad and real output.
- Compositions lack root `data-duration` / `data-fps`, which affects deterministic static-frame capture.
- No `assets/fonts/` directory exists (mission spec) — fonts live in `shared/fonts/`, breaking the stated intake contract ("user drops `.woff2` into `assets/fonts/`").
- No `references/` inbox exists for client reference posts.

---

## B. Failure Points & Scaling Bottlenecks (The "Day 3 Breakdown")

### B.1 Asset clutter — flat `assets/` bucket
`assets/` mixes raw client photos (`dk-raw-01*.jpg`, `dk-raw-02*.jpg`) and `logo.png` with no subfolders. There is **no `references/` inbox** for client-supplied reference graphics. By Day 3 (30–45 posts), raw images, references, and logos collide in one folder:
- Raw photos overwritten or confused with references.
- Logo versions multiply (`logo.png`, `logo-final.png`, `logo_new.svg`) with no canonical source.
- Font intake has no designated drop zone (`assets/fonts/` does not exist).

### B.2 Font pipeline — no `.woff2` intake contract
- Fonts live in `shared/fonts/`, referenced from `shared/fonts.css` via `url("./fonts/...")`. The mission requires `assets/fonts/` as the single `.woff2` drop zone with local `@font-face` declarations.
- No naming convention (`<Family>-<Style>.woff2`), no variable-font `font-stretch` documentation, no fallback-stack rule.
- `font-display: block` is used; for headless static capture this can briefly hide text if a font binary is missing or misnamed — a silent render risk.

### B.3 `index.html` bloat & composition accumulation
- `index.html` is an isolated placeholder (1080×1080, `data-composition-id="main"`). It imports nothing from `compositions/`.
- There is **no composition router/manifest** (`data-composition-src`) and no batch list. If daily posts are added to `index.html` as sections, it becomes a multi-thousand-line monolith within days and breaks the "clean entry point" constraint.
- Each post is a full HTML document — fine for isolation, but 30–45 posts = 90 files in `compositions/` with no daily segregation.

### B.4 Shared CSS bleeding
- `shared.css` sets global `body` (background gradients, `place-items: center`) and `.frame`/`.photo` primitives. Because each composition is its own document, bleed doesn't happen today — but there is **no CSS-scoping strategy** if compositions are ever previewed together or loaded through a router. Post-specific overrides live in per-post `.css` files, which is correct, but there is no naming/scoping convention (e.g., `.dk-post-01`) to guarantee collisions can't happen.

### B.5 Lint gate is red (blocker)
`npx hyperframes lint` output:

```
◆  Linting dk-pipeline/3 files

✗ [compositions\dk-01-timber-touch.html:14:1] root_missing_composition_id: Root composition is missing `data-composition-id`.
   Fix: Add a stable `data-composition-id` to the entry composition wrapper.
✗ [compositions\dk-02-slow-mornings.html:13:1] root_missing_composition_id: Root composition is missing `data-composition-id`.
   Fix: Add a stable `data-composition-id` to the entry composition wrapper.

◇  2 error(s), 0 warning(s)
```

Consequences:
- Every batch must pass lint before capture (§1 constraint). Today the gate fails, so **no batch can ship** until fixed.
- `hyperframes render --strict` would fail on these compositions.
- Missing `data-composition-id` also means `snapshot --composition <id>` cannot target these posts by ID.

---

## C. The Master Architecture Blueprint

### C.1 Optimized directory schema

```
dk-now/
├── index.html                      # LIGHTWEIGHT ROUTER/MANIFEST ONLY (no creative markup)
├── package.json                    # hyperframes ^0.8.163 + scripts: lint, render:daily, render:batch
├── package-lock.json
├── hyperframes.json                # unchanged (paths + autoProxy)
├── .hyperframes/                   # HF internal state (gitignored)
├── node_modules/                   # (gitignored)
├── scripts/
│   └── render-batch.js             # daily batch loop (see §C.5)
├── compositions/                   # WORKING DIRECTORY — regenerated daily
│   ├── YYYY-MM-DD/                 # one daily batch; overwritten each run
│   │   ├── post-01.html / post-01.css
│   │   ├── post-02.html / post-02.css
│   │   └── batch-manifest.json     # ordered list of posts for the day
│   └── archive/                    # HISTORICAL — read-only after client sign-off
│       └── YYYY-MM-DD/
├── assets/                         # INPUTS ONLY — never written by the pipeline
│   ├── references/                 # client reference posts (dropped daily; never rendered)
│   ├── raw/                        # client raw photos (by shoot or YYYY-MM-DD)
│   ├── logos/                      # canonical brand marks: logo.svg (master), logo.png (fallback)
│   └── fonts/                      # .woff2 drop zone per typography pipeline
│       ├── Archivo-Variable.woff2
│       └── ...
├── shared/
│   ├── story-system.css            # ⚙ MASTER STORY ENGINE — single immutable layout engine (see §F)
│   ├── token.css                   # brand design tokens (single source of truth)
│   ├── fonts.css                   # @font-face → assets/fonts/*.woff2 (see §C.2)
│   ├── brand.css                   # .dk-brand-logo + brand marks (scoped, single place)
│   └── shared.css                  # LEGACY primitives — not imported by story compositions
├── renders/                        # OUTPUTS
│   ├── YYYY-MM-DD/                 # daily static exports (PNG)
│   └── archive/                    # signed-off historical exports
└── PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md
```

**Lifecycle rules:**
- **Overwritten daily:** `compositions/YYYY-MM-DD/` (working batch) and `renders/YYYY-MM-DD/` (fresh exports). Regenerated from scratch each production day.
- **Archived (read-only):** after client sign-off, move the batch to `compositions/archive/YYYY-MM-DD/` and `renders/archive/YYYY-MM-DD/`. Never edit archived posts.
- **Never touched by pipeline:** `assets/` (inputs only) and `shared/` (brand system — edited only in design-sprint sessions).
- `index.html` stays a router/manifest: it lists the day's compositions via `data-composition-src` placeholders and never accumulates creative HTML.

### C.2 Local font loading strategy (headless-safe)

**Drop zone:** `assets/fonts/*.woff2` — the designer drops each new `.woff2` here.

**`shared/fonts.css`** (standard template, one block per family):

```css
/* ==========================================================================
   DIRECT KITCHENS · fonts.css — self-hosted font faces
   Binaries live in assets/fonts/. Paths resolve relative to THIS file.
   Headless-render safe: no CDN, font-display: swap so text never blocks.
   ========================================================================== */

/* Archivo — variable (wght 100–900 · wdth 62–125), normal style only. */
@font-face {
  font-family: "Archivo";
  src: url("../../assets/fonts/Archivo-Variable.woff2") format("woff2");
  font-weight: 100 900;
  font-stretch: 62% 125%;     /* REQUIRED — wdth axis usage no-ops without this range */
  font-style: normal;
  font-display: swap;         /* headless-safe: visible text immediately */
}

/* Cormorant Garamond — italic accents only. */
@font-face {
  font-family: "Cormorant Garamond";
  src: url("../../assets/fonts/CormorantGaramond-Italic.woff2") format("woff2");
  font-weight: 300 700;
  font-style: italic;
  font-display: swap;
}

/* Intake rule: add a block here ONLY when the matching .woff2 exists in assets/fonts/.
   Declare weight/stretch ranges matching the file; omit unused styles (e.g. upright). */
```

**Intake contract (operator):**
1. Reference post analyzed → font category identified → closest Google Font suggested.
2. Operator obtains the `.woff2`, places it in `assets/fonts/` using `<Family>-<Style>.woff2` naming.
3. Operator adds the matching `@font-face` block to `shared/fonts.css` and updates `token.css` `--sans`/`--serif` if a new family enters the system.
4. Run `npx hyperframes lint` → if font path is broken, HyperFrames flags the missing asset (validate step catches it at render).
5. Never reference `fonts.googleapis.com` or any CDN in composition HTML/CSS.

**Migration for existing fonts:** move/copy the three `shared/fonts/*.woff2` binaries into `assets/fonts/`, then repoint `shared/fonts.css` `url("./fonts/...")` → `url("../../assets/fonts/...")` and switch `font-display: block` → `swap`.

### C.3 Composition & lifecycle strategy

**Per-post composition (contract):**
- Root element: `data-composition-id="dk-post-01"` (stable, unique), `data-duration="0.033"`, `data-no-timeline`, `data-width="1080"`, `data-height="1350"`.
- **Imports ONLY `../../shared/story-system.css`.** Token, brand, font and layout rules all resolve from that single engine file.
- **FORBIDDEN: per-post CSS.** No `compositions/YYYY-MM-DD/<slug>.css` may be created. Layout, scrim and type behaviour come exclusively from the engine's variants (see §F).
- Logo: `<img src="../../assets/logos/logo.svg" alt="Direct Kitchens" class="dk-brand-logo">` — sizing handled by the engine's brand bar (40px clamp, circular mask); no per-post logo CSS. Logo anchored inside the top safe zone.
- Copy roles: engine classes only — `.t-eyebrow`, `.t-display` (+ `.serif-accent`), `.cta`, inside a `.copy` block.
- **Hairline budget: strictly 0.** `.rule-v`, `.rule-h`, `.plus`, `.diamond`, `.tick` elements must not appear in any composition. (Full engine contract: §F.)

**Daily batch flow:**
1. Morning: new `compositions/YYYY-MM-DD/` folder created; `batch-manifest.json` lists ordered posts.
2. Build each post: HTML only — all CSS comes from `shared/story-system.css`.
3. Lint the whole project → must be 0 errors before any render.
4. Render batch: one static PNG per post into `renders/YYYY-MM-DD/`.
5. Operator confirms outputs → batch moves to `archive/` (or stays in working dir for same-day revision).

### C.4 `index.html` stays clean — router/manifest pattern

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1080, height=1350">
  <title>DK — Daily Compositions Router</title>
  <link rel="stylesheet" href="shared/token.css">
  <link rel="stylesheet" href="shared/shared.css">
</head>
<body>
  <!-- Day's compositions render here via data-composition-src; never accumulate markup -->
  <div id="root" data-composition-id="router" data-no-timeline data-width="1080" data-height="1350">
    <div data-composition-src="compositions/2026-10-19/post-01.html"></div>
    <div data-composition-src="compositions/2026-10-19/post-02.html"></div>
    <!-- one entry per post today; cleared and rewritten each production day -->
  </div>
</body>
</html>
```

Rule: `index.html` may only grow by adding/removing `data-composition-src` lines for the current day. All creative markup lives in `compositions/YYYY-MM-DD/`.

### C.5 Lint & render guardrail (the command loop)

**package.json scripts (keep dependency list clean — only scripts added):**

```json
{
  "name": "dk-now",
  "version": "1.0.0",
  "scripts": {
    "lint": "hyperframes lint",
    "lint:verbose": "hyperframes lint --lint-verbose",
    "validate": "hyperframes validate",
    "render:daily": "node scripts/render-batch.js",
    "render:post": "hyperframes render --composition",
    "snapshot": "hyperframes snapshot",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "devDependencies": {
    "hyperframes": "^0.8.163"
  }
}
```

**Daily CLI loop (operator copy-paste):**

```bash
# 1. Lint — gate must be green before any render
npx hyperframes lint
#   (fix any errors; re-run until: "0 error(s), 0 warning(s)")

# 2. Validate runtime (missing assets, headless font load, contrast) — optional but recommended
npx hyperframes validate

# 3. Render one post strictly (fails on lint errors):
npx hyperframes render --composition compositions/2026-10-19/post-01.html \
  --format png-sequence --output renders/2026-10-19/post-01 --strict

# 4. Render the whole daily batch (see scripts/render-batch.js):
npm run render:daily

# 5. Spot-check a static frame via snapshot:
npx hyperframes snapshot --composition dk-post-01 --at 0.0 --no-end \
  --output renders/2026-10-19/post-01-preview

# 6. Operator confirms outputs → move batch to archive/
```

**Failure-handling loop:**
1. `npx hyperframes lint` → parse `[file:line:col] rule_id: message`.
2. Auto-correct in code (e.g., add missing `data-composition-id`, fix broken `src` asset path, add `@font-face` for missing font).
3. Re-run `npx hyperframes lint` → verify `0 error(s)`.
4. Only then `npx hyperframes render ... --strict`.
5. If render fails, inspect `.hyperframes/` + render diagnostics, fix, re-lint, re-render.

**Static output note:** compositions are static (`data-no-timeline`, single frame), so `--format png-sequence` writes a single-frame directory; the creative is `frame_000001.png` (underscore, 6-digit), or use `snapshot --at 0.0 --no-end` for a single PNG. Recommend `--resolution portrait-4k` only if the client needs 4K; the default composition resolution is Story 1080×1920 (§F.2).

---

## D. THE DAILY OPERATOR PROMPT TEMPLATE (Crucial Deliverable)

Copy and paste this entire block into OpenCode at the start of each production day. It drives the full pipeline end-to-end.

```
# DAILY HYPERFRAMES PRODUCTION OPERATOR PROMPT
# Project: dk-pipeline (D:\Projects\dk-pipeline) | Engine: HyperFrames v0.8.163
# Target: 10–15 static marketing creatives today | Gate: every batch passes `npx hyperframes lint`

You are acting as my Creative Technologist / Frontend Architect for today's daily production run.

## CONTEXT (read-only references — do not modify)
- Assets live under assets/: raw photos in assets/raw/ (use the web-optimized working copies in assets/raw/optimized/ for ALL composition work — regenerate them any time with `npm run optimize:assets`; the optimizer auto-slugs unsafe filenames and logs the mapping), client references in assets/references/, brand marks in assets/logos/, fonts in assets/fonts/.
- Brand system lives in shared/ (token.css, shared.css, brand.css, fonts.css) — edit only if a new brand token/font is genuinely required. Engine/token edits (story-system.css, token.css) are DESIGN-SPRINT actions documented in §F/§G — never performed during a daily run.
- Compositions for today go in compositions/YYYY-MM-DD/; exports go in renders/YYYY-MM-DD/.
- index.html is a lightweight router/manifest only — never add creative markup to it.

## STEP 0 — RETIRE STALE BATCHES (automated, run FIRST)
1. Run `npm run retire:batch` (scripts/retire-batch.js). It moves every `compositions/YYYY-MM-DD/` folder that is not today's date to `archive/stale-drafts/YYYY-MM-DD/` (merge-safe: existing archive files are never overwritten) and strips stale `data-composition-src` lines for retired dates from index.html. The root element (class="hyperframes-root" data-width="1080" data-height="1920") is never touched. Renders/ and existing archive content are never touched.
2. This MUST run before lint — stale batches referencing swapped-out assets are the #1 cause of an un-passable preflight gate (see §F.3).

## STEP 1 — INGEST INPUTS (INSPECT-FIRST — MANDATORY)
1. FIRST, before reading, planning, or writing ANY copy: run `npm run optimize:assets`.
   - This scans `assets/raw/` and produces web-optimized copies in `assets/raw/optimized/` (max dimension 2048px, JPEG quality ~85%, target under 2MB) using the local `ffmpeg` binary. Filenames containing spaces or URL-unsafe characters are auto-slugged to `^[A-Za-z0-9._-]+\.(jpg|jpeg|png)$` and the mapping is logged — reference the SLUGGED name in compositions. Files already under the limits are symlinked/copied through unchanged. Raw originals are NEVER modified.
   - This eliminates the 20MB ingestion limit — all downstream steps MUST reference `assets/raw/optimized/`, never the raw originals.
2. List the contents of `assets/raw/optimized/`, `assets/references/`, `assets/logos/`, `assets/fonts/`.
3. **HARD RULE: NEVER generate copy, themes, or layouts blindly from filenames.** A filename (`1.jpg`, `2.jpg`) is not evidence of content. Every design decision must be grounded in an actual pixel inspection performed by you — no guessing, no assumptions, no inferring from file size or aspect ratio.
4. You MUST explicitly inspect EACH image in `assets/raw/optimized/` using your own vision capabilities before proceeding. For every photo, extract and log ONLY what you can actually SEE — the field list below is FORMAT guidance, not an inventory of assets; never assume a room, material, or appliance that is not visibly in the frame:
   - **Room/space type** (describe the space YOU see in ⟨photo N⟩)
   - **Hero materials** (visible surfaces/finishes only, named exactly as observed)
   - **Specific appliances/fittings** (only if visibly badged or unmistakable)
   - **Color accents and lighting conditions** (undertone, light direction, accent colors as seen)
   - Log this as a per-image table in your response. This table is the single source of truth for all downstream copy and layout.
5. Ask me to confirm which optimized photo(s) and which reference post(s) to use for today's first batch of posts, presenting your inspection table as the basis for that choice.
6. Do not render or write any composition until I confirm the inputs.

## STEP 2 — TYPOGRAPHY PIPELINE (font detection -> local .woff2)
1. Look at the reference post I point to. Identify the typography style/category (e.g., geometric sans, humanist sans, serif, display) and the mood it conveys.
   FIRST check `assets/fonts/` + `shared/fonts.css`: if an existing WIRED family already matches that category (today: Archivo variable 100–900 → `--sans`; Cormorant Garamond Italic → `--serif`), USE IT, output "no drop required", and skip steps 3–4 (full decision tree: §F.5).
2. Suggest the closest Google Font for that style and explain why it matches the reference. You MUST explicitly output:
   a. The exact Google Font family name and weights needed.
   b. The exact target filename I should save it as inside assets/fonts/ (e.g., Save as: assets/fonts/PlayfairDisplay-Bold.woff2).
3. Ask me to place the corresponding .woff2 file(s) into assets/fonts/ using the naming convention <Family>-<Style>.woff2 (e.g., Archivo-Variable.woff2).
4. As soon as I confirm the file is dropped into assets/fonts/, you MUST autonomously:
   - Append the matching @font-face block into shared/fonts.css mapping to assets/fonts/*.woff2 (font-display: swap; declare weight/stretch ranges matching the file),
   - Map the font variables in shared/token.css (--sans/--serif) if a new family enters the system.
   Do not require manual CSS edits from me — the font is wired automatically once I confirm the drop.
5. Constraint: no external CDN font references anywhere — headless rendering must load fonts locally only.

## STEP 3 — DESIGN DISCUSSION (interactive) + GROUNDING VERIFICATION
Before writing code, discuss with me:
- Visual elements from the reference: photo treatment, masking, background/scrim, keylines, ornaments.
- Layout: photo placement, copy block position, brand bar position, safe areas.
- Copy placement and actual headline/eyebrow/body text for each post.
- Brand logo: which mark (SVG preferred). Check whether assets/logos/logo.svg exists; if it does not, cleanly fall back to assets/logos/logo.png. Logo sizing is centralized in shared/brand.css — never discuss per-post logo sizing.
- Format/ratio: **DEFAULT = Story (9:16 - 1080×1920).** The engine (`shared/story-system.css`) hard-codes `.frame`/`.photo--full` to 1080×1920, so Story is the ONLY ratio that renders without a design-sprint engine change (§F.2). Only ask me **"What format/ratio are we creating today for this post/batch?"** if I previously requested another ratio; options are:
  - `Story (9:16 - 1080×1920)` [DEFAULT — engine-supported]
  - `Portrait (4:5 - 1080×1350)` [requires an approved engine change first]
  - `Square (1:1 - 1080×1080)` [requires an approved engine change first]
- **Dynamic Router Sync (mandatory):** Immediately after the ratio is confirmed, set the root canvas attributes of `index.html` to match the exact dimensions:
  - Portrait (4:5): `data-width="1080" data-height="1350"`
  - Story (9:16): `data-width="1080" data-height="1920"`
  - Square (1:1): `data-width="1080" data-height="1080"`
  - Add `class="hyperframes-root"` to the root `<div>`. Compositions generated for that batch must strictly inherit these exact root dimensions so router canvas overflow is resolved deterministically at the source. Do not use `data-layout-allow-overflow` as a workaround.
- Luxury composition constraints (Direct Kitchens $50K+ showroom strategy):
  - Full-Bleed Material Primacy: 85–90% of canvas dedicated to raw architectural photography (stone veining, fluted timber, integrated joinery, ambient lighting). No heavy UI containers, floating cards, or opaque backgrounds obscuring craft details.
  - Hairline Callout Guardrail: Strictly 0, 1, or maximum 2 architectural hairline pointers per creative (e.g., "Calacatta marble waterfall edge", "Hand-milled fluted oak"). Never clutter or turn the asset into a technical schematic.
  - Restrained Editorial Typography: Minimalist copy — zero discounts, zero price tags. Subtle showroom invitations only ("Visit our showroom" / "Book a private design consultation"). Monochrome foundation (clean white, deep slate/black, subtle neutral scrims) harmonizing with the photo's undertones.
  - Additional high-end editorial details: non-destructive dual-axis scrim gradients (preserve central material detail); micro-tracking for uppercase labels (wide `--track-eyebrow` for breathy labels, tight `--track-tight` for headlines); negative space as a design element — anchor copy to one corner, leave 60–70% of canvas as uninterrupted photography.
- **Grounding Verification (MANDATORY, before ANY HTML/CSS is written):** Build a Design Mapping table for each post that explicitly cites the verified visual elements logged in Step 1. Every claim in the copy must trace back to something you actually SAW:

  | Copy / design element | Verified source (Step 1 inspection log) | Photo |
  | --- | --- | --- |
  | Headline: "⟨observed feature⟩, ⟨observed relationship⟩" | Verified element: ⟨exact phrase from the Step 1 log for this photo⟩ | ⟨photo N⟩ |
  | Eyebrow: "⟨OBSERVED ROOM/ZONE⟩" | Room/space type: ⟨as logged for this photo⟩ | ⟨photo N⟩ |
  | Scrim tint: ⟨charcoal or warm⟩ | Lighting undertone: ⟨as logged⟩ | ⟨photo N⟩ |
  | CTA: "Visit our showroom" | Brand policy — fixed CTA library (§F.6) | — |

  - No headline, callout, eyebrow, or theme may reference a material, appliance, room, or fitting that is NOT in the Step 1 inspection log for the photo being used.
  - If the copy needs a detail you have not verified, GO BACK and re-inspect the image — do not invent it.
  - Show this table to me and get my sign-off alongside the design discussion. **No HTML/CSS composition may be written until this grounding table is confirmed.**
Confirm each post's design with me before composing.

## STEP 4 — GENERATE MODULAR COMPOSITIONS
For each confirmed post, create compositions/YYYY-MM-DD/<slug>.html ONLY (per-post .css files are FORBIDDEN — see §F):
- Root: data-composition-id="dk-<slug>", data-duration="0.033", data-no-timeline, data-width="1080" data-height="1920" (Story 9:16 — the default and only engine-supported ratio; see §F.2). **Composition root dimensions must exactly match the index.html root canvas.**
- Imports: ../../shared/story-system.css ONLY (it @imports token.css + brand.css internally). Do NOT link shared.css, token.css, or any per-post stylesheet.
- Logo: <img src="../../assets/logos/logo.svg" alt="Direct Kitchens" class="dk-brand-logo"> inside <header class="bar-top">, always paired with <p class="brand">Direct Kitchens</p>. The engine clamps it to a 40×40px circle anchored at top 140px / left 80px. **No per-post logo CSS.**
- **Brand contrast rule:** if the photo's top-left region is bright (white/cream ceilings, pale cabinetry), the header MUST be `<header class="bar-top bar-top--ink">` (dark ink wordmark — WCAG AA ≥4.5:1). White brand text is only for dark-topped photos. The logo + `<p class="brand">` pairing is unchanged (§F.2).
- **Hairline Constraint — Strictly Zero:** `.rule-v`, `.rule-h`, `.plus`, `.diamond`, and `.tick` elements must not appear in any composition. Total hairline budget = 0.
- Copy roles: engine classes only — `.t-eyebrow`, `.t-display` (with `.serif-accent` for the italic accent word), and `.cta`, inside a `.copy` block using one of the three variants (`copy--bottom-left`, `copy--bottom-right`, `copy--centered`). The `.copy` block is pinned at `bottom: 220px` by the engine and is never clipped.
- Scrims: `<span class="scrim scrim--top">` + `<span class="scrim scrim--bottom">` inside `<figure class="photo photo--full scrim--{charcoal|warm}">`. Pick the theme matching the photo's undertone (§F).
- No inline styles beyond data-* timing attributes; keep each file under maintainable length.
- Add the post to compositions/YYYY-MM-DD/batch-manifest.json. Exact schema (render-batch.js contract): `{"batch":"YYYY-MM-DD","posts":[{"slug":"story-01","html":"compositions/YYYY-MM-DD/story-01.html","output":"renders/YYYY-MM-DD/story-01"}]}`.
- Do not touch index.html except to add/remove a data-composition-src line for today's date.

## STEP 5 — PRE-FLIGHT GATE (mandatory before rendering)
1. Run: npx hyperframes lint
2. Parse every error: [file:line:col] rule_id: message.
3. Autonomously fix syntax/layout errors in code (missing data-composition-id, broken asset paths, missing @font-face, etc.).
4. Re-run npx hyperframes lint until the report shows: 0 error(s), 0 warning(s).
5. Run the comprehensive gate: npx hyperframes check
   - This runs lint + runtime + layout + motion + WCAG contrast in one browser session.
   - Verify: Lint 0 errors/0 warnings, Runtime 0 errors/0 warnings, Layout 0 errors/0 warnings (info-severity `canvas_overflow` findings from the router stacking posts 2..N inside the 1920 root are STRUCTURAL and accepted — see §F.4), Motion 0 errors/0 warnings, Contrast passes WCAG AA.
   - KNOWN BLIND SPOT: check's contrast sampler only measures story-01 inside the router canvas — posts 2..N are NOT contrast-verified. Apply the §F.2 bar-top--ink rule by inspection, not by gate luck.
   - Report is saved to .hyperframes/artifacts/checks/<uuid>.json
6. (Deprecated) Do not use `npx hyperframes validate` — it is deprecated in favor of `check`.
7. Show me the clean lint and check reports. Do not proceed to render until both gates are green.

## STEP 5.5 — BATCH PRE-FLIGHT ENFORCEMENT (mandatory, automated)
- `scripts/render-batch.js` executes `npm run preflight` (lint + check) prior to rendering any composition. **Never run `npm run preflight` manually when using `npm run render:daily`** — one batch = one check session (§F.4).
- If the preflight exit code !== 0, the batch aborts immediately with a clear error report. No composition renders until the gate is green.

## STEP 6 — FINAL RENDER (confirmation required)
1. Show me the list of compositions ready to render and the planned output paths under renders/YYYY-MM-DD/.
2. Ask for my explicit confirmation before triggering renders.
3. On confirmation, run the batch render (recommended):
   npx hyperframes render --composition compositions/YYYY-MM-DD/<slug>.html --format png-sequence --output renders/YYYY-MM-DD/<slug> --strict
   (one command per post, or npm run render:daily via scripts/render-batch.js)
4. For each post, verify the static PNG was written (the renderer emits `frame_000001.png` — underscore, 6-digit — inside the output folder; or use snapshot --at 0.0 --no-end for a single PNG).
5. Report the final render manifest: slug → output path → file size → pass/fail.
6. Do not move anything to archive/ until I confirm the exports are approved.

## EXIT CRITERIA FOR TODAY
- `npm run retire:batch` ran first; stale composition batches archived and router lines cleaned (§F.3)
- `npm run optimize:assets` was run first; every photo used came from `assets/raw/optimized/` under its SLUGGED name (raw originals untouched)
- Every post has a Step 1 vision inspection log and a confirmed Step 3 grounding table
- lint: 0 errors / 0 warnings
- All confirmed posts rendered as static PNG under renders/YYYY-MM-DD/
- Clean render manifest shown to me
- index.html unchanged except data-composition-src lines for today
```

---

## E. Immediate 3-Step Action Plan

Run these in order today to bring the workspace from 42/100 to production-ready.

### Step 1 — Close the red lint gate
Add a stable root `data-composition-id` (and `data-duration="0.033" data-no-timeline`) to both composition roots so `npx hyperframes lint` passes:

```html
<!-- in compositions/dk-01-timber-touch.html and dk-02-slow-mornings.html, on <article class="frame"> -->
<article class="frame" data-composition-id="dk-01-timber-touch" data-duration="0.033" data-no-timeline data-width="1080" data-height="1350" aria-label="...">
```

Then verify:
```
cd "D:\Projects\dk-pipeline"
npx hyperframes lint
# Expect: 0 error(s), 0 warning(s)
```

### Step 2 — Establish the `assets/fonts/` pipeline
```
mkdir assets\fonts assets\references assets\raw assets\logos
# Move the three font binaries from shared/fonts/ into assets/fonts/
# Update shared/fonts.css: url("./fonts/...") -> url("../../assets/fonts/...")
# and font-display: block -> font-display: swap
npx hyperframes lint   # must still be 0 errors
```

### Step 3 — Scaffold the daily production skeleton & scripts
```
# Add to package.json "scripts": lint, lint:verbose, validate, render:daily, render:post, snapshot
# Create folders:
mkdir compositions\archive renders\archive scripts
# Slim index.html into the router/manifest (data-composition-src only; no creative markup; 1080x1350 canvas)
# Create scripts/render-batch.js looping over compositions/YYYY-MM-DD/batch-manifest.json with --strict
npx hyperframes lint
npm run lint   # confirms npm script wiring works
```

After these three steps, the workspace has a green lint gate, a font intake contract matching the mission spec, a clean index.html router, and a scripted daily render loop — ready for 10–15 static posts/day.

---

## F. ENGINE CONTRACT & DAILY ZERO-SHOT RUNBOOK (authoritative)

Established 2026-10-20 after the daily-run forensic post-mortem. This section is
carried WITH the daily operator prompt (§D) — every "§F" reference inside §D
resolves here. Layout/geometry reference for the engine lives in §G.

### F.1 Asset truth (read this instead of inferring)
- Folders that actually exist: `assets/raw/`, `assets/raw/optimized/`, `assets/references/`
  (NOT "reference posts"), `assets/logos/`, `assets/fonts/`.
- Asset naming: `^[A-Za-z0-9._-]+\.(jpg|jpeg|png)$`. No spaces. `npm run optimize:assets`
  auto-slugs unsafe source names for the OPTIMIZED COPY (raw originals never renamed)
  and prints the mapping — reference the slugged name in compositions.
- `npm run optimize:assets` runs FIRST, always. All compositions source
  `assets/raw/optimized/` only. Re-run it any time raws change.
- The daily photo inventory is whatever `assets/raw/optimized/` contains after step 1 —
  NOTHING else. Example tables in this document use `⟨photo N⟩` placeholders; they do
  not describe real assets. Copy referencing a room/material/appliance not present in the
  Step-1 vision log for THAT photo is forbidden and will be rejected at grounding sign-off.

### F.2 Engine capability matrix (HyperFrames v0.8.163, this repo)
- Ratios: ONLY Story 9:16 (1080×1920) works without editing shared/story-system.css.
  `.frame` and `.photo--full` are hard-coded 1080×1920. DEFAULT RATIO = STORY; do not ask.
  Portrait/Square require a pre-approved engine change (root-filling rules), never per-post CSS.
- Composition imports: `../../shared/story-system.css` ONLY (it @imports token.css, fonts.css,
  brand.css). No per-post CSS. No inline styles except data-* timing attributes.
- Classes: `.frame`; `.photo.photo--full` + `.scrim.scrim--top|bottom`; scrim themes
  `.scrim--charcoal` (cool/neutral undertone photos) or `.scrim--warm` (amber/warm undertone);
  `.bar-top` (locked top:140/left:80, logo clamp 40×40) always = `<img class="dk-brand-logo">`
  + `<p class="brand">Direct Kitchens</p>`; `.copy.copy--bottom-left|--bottom-right|--centered`
  (pinned bottom:220px); `.t-eyebrow`, `.t-display` (+`<span class="serif-accent">` italic),
  `.cta`.
- BRAND-ON-PHOTO RULE: if the photo's top-left region is bright (white/cream), the header MUST
  be `class="bar-top bar-top--ink"` (dark ink variant `var(--ink, #1a1a1a)`; WCAG AA ≥4.5:1).
  White brand text is for dark-topped photos only. This is not optional — `check` fails otherwise.
- Hairline budget = 0: `.rule-v/.rule-h/.plus/.diamond/.tick` never appear.
- Token aliases: `.cta` renders via `--brass` and `.t-eyebrow` via `--bone`; both are formally
  declared in token.css (`--brass: var(--brass-400, #c6a77d)`, `--bone: var(--bone-50, #f5f2eb)`).
  `.t-display` letter-spacing uses `--track-tight` (−0.02em). No inline fallback drift.

### F.3 Batch lifecycle (prevents stale-lint lockouts)
- STEP 0 of every daily run: `npm run retire:batch` (scripts/retire-batch.js). It moves any
  `compositions/YYYY-MM-DD/` folder for a date ≠ today to `archive/stale-drafts/YYYY-MM-DD/`
  (merge-safe; existing archive files never overwritten) and strips stale router lines from
  `index.html`. `renders/` and existing archive content are never touched. Optional
  `--date YYYY-MM-DD` overrides the keep-date.
- Lint scope = `compositions/**` + `index.html`; `archive/` is out of scope.
- `index.html`: root keeps `class="hyperframes-root" data-width="1080" data-height="1920"`
  and carries ONLY today's `data-composition-src` lines (add today's, remove prior dates').
- `compositions/YYYY-MM-DD/batch-manifest.json` schema (render-batch.js contract):
  `{"batch":"YYYY-MM-DD","posts":[{"slug":"story-01","html":"compositions/YYYY-MM-DD/story-01.html","output":"renders/YYYY-MM-DD/story-01"}]}`
- Renderer emits `frame_000001.png` (underscore, 6-digit) — verify THAT name, not frame-00000.png.

### F.4 Gate semantics (what "green" means)
- `npx hyperframes lint`: 0 errors, 0 warnings.
- `npx hyperframes check`: 0 lint/runtime/motion errors; contrast ≥ WCAG AA;
  layout info-severity `canvas_overflow` findings caused by the router stacking posts 2..N
  inside the 1920 root are STRUCTURAL and accepted — they are not gate failures.
- KNOWN BLIND SPOT: check contrast-samples only the first composition in the router. Posts 2..N
  are not contrast-verified — which is why F.2's bar-top--ink rule must be applied by
  inspection, not by gate luck.
- NEVER run `npm run preflight` manually when using `npm run render:daily` — the batch script
  executes it internally. One batch = one check session. `validate` is deprecated.

### F.5 Typography decision tree (zero-shot)
1. Identify the reference's type category (this repo's references 1–5 = bold neo-grotesque
   sans; ref 6 = high-contrast display serif).
2. If the closest family is ALREADY in `assets/fonts/` + wired in `shared/fonts.css` (current:
   Archivo variable 100–900/62–125 → `--sans`; Cormorant Garamond Italic → `--serif`), USE IT
   and output "no drop required". Do not request a font drop.
3. Only if no local family matches: name the Google Font + weights + exact target filename
   (`<Family>-<Style>.woff2`), request the drop, then autonomously append the `@font-face`
   (font-display: swap, weight/stretch range) and update `--sans`/`--serif` in token.css.
4. No CDN font references anywhere, ever.

### F.6 Copy contract
- Per post: 1 eyebrow (≤2 words, category-style), 1 display headline (≤2 lines, ≤18 chars/line,
  ≤1 serif-accent italic word), 1 CTA from the fixed library: "Visit our showroom" |
  "Book a private design consultation".
- BANNED: prices, discounts, "%", "offer", "deal", "free", "early bird", T&Cs; any material,
  brand, appliance, or fitting NOT in that photo's Step-1 vision log ("hand-milled",
  "Calacatta", "hand-laid", appliance brands without visible badging = banned).
- Tone: restrained editorial, monochrome-first; no exclamation marks; no second-person hype.
- Alt text and `aria-label` must restate only verified inspection-log facts.

### F.7 Single-round confirmation protocol
Ask ONE bundled question round at Step 3 with these defaults pre-selected:
[photos] all optimized ∣ [reference anchor] user's pick ∣ [ratio] Story 9:16 ∣ [batch size]
min(photos, 2) ∣ [copy variant] bottom-left (alternate for visual rhythm in batches ≥2)
∣ [scrim] per undertone rule F.2. Reserve a second round ONLY for gate exceptions, each with
the forensic evidence attached.

---

## G. THE MASTER STORY ENGINE (LAYOUT REFERENCE — established 2026-10-20)

Ad-hoc per-post CSS generation is **terminated**. All story compositions are now driven by one deterministic layout engine.

### G.1 The single source of layout truth

| File | Role | Mutable? |
|------|------|----------|
| `shared/story-system.css` | **The Master Story Engine.** Owns reset, canvas, brand bar, scrims, copy/CTA positioning, and editorial typography for every story composition. | **IMMUTABLE** — edit only in a dedicated design-sprint session, never during a daily production run. |
| `shared/token.css` | Design tokens (colors, type scale, `--sans`/`--serif`, `--track-eyebrow`). `@import`ed by the engine. | Design-sprint only. |
| `shared/brand.css` | Base `.dk-brand-logo` / `.brand-logo` clamp. `@import`ed by the engine. | Design-sprint only. |
| `shared/shared.css` | **LEGACY.** No longer imported by story compositions. Retained only for archived non-story posts. | Frozen. |
| `compositions/YYYY-MM-DD/story-XX.html` | Markup + image source + variant selection only. **No `<style>` block, no inline styles, no local `.css` file.** | Overwritten daily. |

**FORBIDDEN — hard rule:** creating `compositions/YYYY-MM-DD/<slug>.css` (or any per-post stylesheet). Every composition links **exactly one** stylesheet:

```html
<link rel="stylesheet" href="../../shared/story-system.css">
```

The engine `@import`s `token.css` and `brand.css` internally, so a story HTML never links those directly either. Violations are a pre-flight failure.

### G.2 Brand safety — logo clamp (LOCKED)

```css
.bar-top { top: 140px; left: 80px; display: flex; align-items: center; gap: 14px; z-index: 10; }
.bar-top .dk-brand-logo,
.bar-top img { width: 40px; height: 40px; max-width: 40px; max-height: 40px;
               border-radius: 50%; object-fit: contain; flex-shrink: 0; }
.bar-top .brand { font: 500 13px/1 var(--sans); letter-spacing: .28em;
                  text-transform: uppercase; color: #fff; opacity: .9; }
/* Light-photo variant (WCAG AA over white/cream upper zones): */
.bar-top--ink .brand { color: var(--ink, #1a1a1a) !important; }
```

- **40×40px circular clamp**, anchored at `top: 140px / left: 80px` — inside the 9:16 top safe zone, never obstructing central photography.
- Header markup on every post (logo + wordmark pairing is invariant; only the wrapper class varies):
  ```html
  <!-- dark-topped photo (default) -->
  <header class="bar-top">
    <img src="../../assets/logos/logo.svg" alt="Direct Kitchens" class="dk-brand-logo">
    <p class="brand">Direct Kitchens</p>
  </header>

  <!-- bright-topped photo (white/cream ceiling or cabinetry behind the bar) -->
  <header class="bar-top bar-top--ink">
    <img src="../../assets/logos/logo.svg" alt="Direct Kitchens" class="dk-brand-logo">
    <p class="brand">Direct Kitchens</p>
  </header>
  ```
- **Selection rule (§F.2):** white brand text over a bright top-left region fails WCAG AA (measured 2.3–2.7:1) — use `bar-top--ink` whenever the region behind the bar is high-key. This is applied by INSPECTION: `check`'s contrast sampler only measures story-01 inside the router.

### G.3 Copy & CTA safety — 220px bottom safe zone (LOCKED)

```css
.copy { position: absolute; bottom: 220px; z-index: 10;
        display: flex; flex-direction: column; gap: 12px; }
```

- Every `.copy` block is pinned **220px** from the bottom edge — above the platform reply-bar/sticker band. Copy and CTA are **never clipped**.
- Margins: `copy--bottom-left` → `left: 80px; right: 120px`, `copy--bottom-right` → `left: 120px; right: 80px`, `copy--centered` → `left: 80px; right: 80px`.

### G.4 Controlled editorial dynamism — layout variants

Determinism at the system level, variety at the selection level. Each post picks **one** copy variant; the engine renders it identically every time.

| Variant | Class | Behaviour | Use when |
|---|---|---|---|
| **A — Bottom-Left** | `.copy--bottom-left` | Left-aligned, standard editorial anchor | Default; hero left of frame |
| **B — Bottom-Right** | `.copy--bottom-right` | Right-aligned counter-balance | Visual mass sits left of frame |
| **C — Centered** | `.copy--centered` | Symmetrical, architectural | Single strong central feature |

### G.5 Controlled editorial dynamism — scrim themes (color-adaptive)

Applied on the photo figure: `<figure class="photo photo--full scrim--{charcoal|warm}">`. Both themes share the geometry (`.scrim--top` **320px**, `.scrim--bottom` **520px**) and differ only in undertone, so contrast behaviour is predictable.

| Theme | Class | Undertone | Apply to |
|---|---|---|---|
| **Charcoal Cool** | `scrim--charcoal` | Neutral near-black (`rgba(0,0,0,·)` top / `rgba(12,12,14,·)` bottom) | Marble, white stone, cool utilities, greige |
| **Warm Amber** | `scrim--warm` | Warm brown-black (`rgba(20,14,8,·)` top / `rgba(24,16,10,·)` bottom) | Spotted gum, warm joinery, amber lighting, timber floors |

**Actual alpha ramps (as implemented — intentionally AIRY, max alpha ≤0.70).** Scrims deliberately keep editorial luminance and material detail; they are NOT the primary legibility mechanism. Text legibility is carried by the engine's multi-layer `text-shadow` depth on `.t-eyebrow`/`.t-display`/`.cta`, and brand-bar legibility over bright tops is carried by the `bar-top--ink` variant (§F.2), never by scrim alpha. Ramps are linear across the stated stops:

| Ramp | Stops (position % → alpha) |
|---|---|
| `.scrim--charcoal .scrim--top` (180deg) | `0%→0.40, 50%→0.15, 100%→0` |
| `.scrim--charcoal .scrim--bottom` (0deg) | `0%→0.65, 50%→0.35, 100%→0` |
| `.scrim--warm .scrim--top` (180deg) | `0%→0.45, 50%→0.18, 100%→0` |
| `.scrim--warm .scrim--bottom` (0deg) | `0%→0.70, 50%→0.40, 100%→0` |

**Edge-reset invariant.** The router also loads legacy `shared/shared.css`, whose `.scrim { inset: 0 }` pins `top: 0` on both scrim spans — CSS then honours `top` over `bottom` (over-constrained) and flips the bottom scrim to the top of the frame. `story-system.css` therefore resets `top: auto; bottom: auto` on `.scrim` and sets one explicit edge per variant. Do not remove these resets.

**Verification.** `hyperframes check`'s contrast sampler only measures text inside the router canvas, which contains story-01 alone (posts 02–09 stack below it). Run `powershell -File scripts/verify-contrast.ps1` to composite every text band of all 9 stories against the engine's scrim ramps and confirm worst-case-pixel WCAG AA. Both gates must be green before any commit.

### G.6 Editorial typography roles (engine-owned)

| Role | Class | Spec |
|---|---|---|
| Eyebrow | `.t-eyebrow` | 13px / 600 / `--track-eyebrow` / uppercase / `--bone` (token-declared) at 90% |
| Headline | `.t-display` | 52px / 700 / 1.08 / `--track-tight` (−0.02em) / white |
| Serif accent | `.serif-accent` (inside `.t-display`) | Cormorant Garamond italic 400 |
| CTA | `.cta` | 12px / 600 / `.22em` / uppercase / `--brass` (token-declared) |

### G.7 Dual CTA intent (brand copy policy)

Zero prices, zero discounts. Exactly two invitations, cycled by the batch manifest:

| CTA | Intent | Placement |
|---|---|---|
| **"Visit our showroom"** | Low-commitment foot-traffic invitation | Default closing line |
| **"Book a private design consultation"** | High-touch, appointment-only, $50K+ showroom strategy | Alternate posts / hero pieces |

### G.8 Composition contract (current, supersedes §C.3)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Direct Kitchens — story-NN</title>
  <link rel="stylesheet" href="../../shared/story-system.css">
</head>
<body>
  <main id="root" data-composition-id="dk-story-NN" data-duration="0.033" data-no-timeline
        data-width="1080" data-height="1920">
    <article class="frame" aria-label="...">
      <figure class="photo photo--full scrim--{charcoal|warm}">
        <img src="../../assets/raw/optimized/N.jpg" alt="...grounded alt text...">
        <span class="scrim scrim--top" aria-hidden="true"></span>
        <span class="scrim scrim--bottom" aria-hidden="true"></span>
      </figure>

      <header class="bar-top">
        <img src="../../assets/logos/logo.svg" alt="Direct Kitchens" class="dk-brand-logo">
        <p class="brand">Direct Kitchens</p>
      </header>

      <section class="copy copy--{bottom-left|bottom-right|centered}">
        <p class="t-eyebrow">…</p>
        <h1 class="t-display">…<span class="serif-accent">…</span></h1>
        <p class="cta">Visit our showroom</p>
      </section>
    </article>
  </main>
</body>
</html>
```

**Invariants (all enforced by `npm run preflight`):**
1. One stylesheet link — `story-system.css`. No per-post CSS anywhere.
2. Photos sourced **only** from `assets/raw/optimized/`.
3. Zero hairline/marker elements (`.tick`, `.rule-h`, `.rule-v`, `.plus`, `.diamond`, `.keyline`).
4. Header markup byte-identical across all posts.
5. Root `data-width="1080" data-height="1920"` matches the router canvas exactly.
6. Copy anchored at 220px; logo clamped at 40px.
