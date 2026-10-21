# HyperFrames Production Pipeline Audit & Daily Automation Blueprint

**Project:** `dk-pipeline` (`D:\Projects\dk-pipeline`)
**Engine:** HyperFrames `v0.8.163` (devDependency)
**Target:** 10–15 high-fidelity static marketing creatives per day, zero-friction, repeatable daily engine.
**Audited:** 2026-10-19 · **Hardened & re-verified:** 2026-10-21
**Status (2026-10-21):** Pipeline is **HARDENED** — batch lifecycle is **automated** (`retire:batch` → `optimize:assets` → `preflight` → `render:daily`) and contrast validation is **deterministic** (`npm run photo-fit`, all-posts WCAG AA gate). **Intraday multi-batch (Model A)** is live: nested `batch-XX/` folders, CONTINUOUS slugs, `npm run batch:new` scaffolding, and the fail-closed `npm run check:paths` gate (§F.9). Lint gate: 0 errors / 0 warnings.

---

## A. Architecture Audit & Production Readiness Score

### A.1 Current file tree

```
dk-pipeline/
├── index.html                      # lightweight ROUTER only — one data-composition-src line per post today (root 1080×1920)
├── package.json                    # hyperframes ^0.8.163; scripts: lint, check, photo-fit, preflight, optimize:assets, retire:batch, render:daily, render:post, snapshot (§C.5)
├── package-lock.json
├── hyperframes.json                # paths: blocks=compositions, components=compositions/components, assets=assets; media.autoProxy=true
├── .hyperframes/                   # HyperFrames internal state + artifacts/checks/<uuid>.json (gitignored)
├── node_modules/                   # installed hyperframes + deps (gitignored)
├── PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md
├── scripts/
│   ├── lib/batch-date.js           # shared LOCAL-calendar-date resolver: --date > positional > DK_BATCH_DATE > today
│   ├── lib/batch-context.js        # Model A batch identity (§F.9): listBatches / detectNextBatch / detectNextSlug / resolveBatchContext
│   ├── retire-batch.js             # retire:batch — stale batches → archive/stale-drafts/ + router-line cleanup (§F.3)
│   ├── downscale-assets.js         # optimize:assets — raw → web copies, auto-slugging → assets/raw/optimized/slug-map.json
│   ├── photo-fit.js                # photo-fit — deterministic all-posts WCAG AA contrast authority (gate + design modes)
│   ├── check-paths.js              # check:paths — fail-closed relative-path gate for the ACTIVE batch (§F.9)
│   ├── new-batch.js                # batch:new — scaffold the next batch-XX + Schema-v2 manifest + surgical router sync (§F.9)
│   ├── render-batch.js             # render:daily — preflight → loop the ACTIVE batch manifest → renders/YYYY-MM-DD/[batch-XX/]/
│   └── verify-contrast.ps1         # ⚠ TOMBSTONE (2026-10-21) — superseded by photo-fit.js; do not run
├── compositions/                   # WORKING BATCHES — created daily, retired automatically
│   └── 2026-10-21/                 # today's batch — FLAT legacy layout = immutable batch-01 (§F.9)
│       ├── batch-manifest.json     # render-batch contract (Schema v1 legacy): {"batch":"YYYY-MM-DD","posts":[{slug,html,output}]}
│       ├── story-01.html … story-03.html
│       └── batch-XX/               # INTRADAY batches nest here (Model A, §F.9): story-NN.html (depth-3 links) + Schema-v2 manifest
├── archive/
│   └── stale-drafts/               # retired batches (read-only): 2026-10-19/, 2026-10-20/
├── assets/                         # INPUTS ONLY — never written except by optimize:assets
│   ├── raw/                        # client raw photos (originals never modified/renamed)
│   │   └── optimized/              # ONLY source for compositions (≤2048px, JPEG q~85, <2MB, auto-slugged)
│   │       └── slug-map.json       # persisted slug mapping: source name → slugged name
│   ├── references/                 # client reference posts (never rendered)
│   ├── logos/                      # logo.svg (master) + logo.png (fallback)
│   └── fonts/                      # .woff2 drop zone per typography pipeline (§C.2)
├── shared/
│   ├── story-system.css            # ⚙ MASTER STORY ENGINE — single immutable layout engine (see §F/§G)
│   ├── token.css                   # brand design tokens (single source of truth)
│   ├── fonts.css                   # @font-face → assets/fonts/*.woff2 (see §C.2)
│   ├── brand.css                   # .dk-brand-logo + brand marks (scoped, single place)
│   └── shared.css                  # LEGACY primitives — not imported by story compositions
└── renders/                        # OUTPUTS: YYYY-MM-DD/ (daily statics) + archive/ (signed-off exports)
```

### A.2 Execution flow (current)

1. `npm run retire:batch` runs FIRST — any `compositions/YYYY-MM-DD/` folder that is not today moves to `archive/stale-drafts/YYYY-MM-DD/` (merge-safe) and its stale `data-composition-src` lines are stripped from `index.html` (§F.3).
2. `npm run optimize:assets` — raw photos become web-optimized copies in `assets/raw/optimized/` (≤2048px, q~85, <2MB, auto-slugged with the mapping persisted to `slug-map.json`); raw originals are never modified.
3. Each story composition is a self-contained HTML document importing ONLY `../../shared/story-system.css` (which `@import`s token.css / fonts.css / brand.css). No per-post CSS, no inline styles beyond data-* attributes.
4. `index.html` is the router/manifest: one `data-composition-src` line per post of the current day on a 1080×1920 root; rewritten by the daily lifecycle, never accumulating creative markup.
5. Gating: `npm run preflight` = `hyperframes lint && node scripts/check-paths.js && node scripts/photo-fit.js && hyperframes check` — lint + fail-closed relative-path validation (§F.9) + all-posts deterministic WCAG AA + runtime/layout/motion in one chained run (§C.5, §F.4).
6. `npm run render:daily` (scripts/render-batch.js) executes preflight, then renders each `batch-manifest.json` entry to `renders/YYYY-MM-DD/<slug>/frame_000001.png` with `--strict`.

### A.3 What works well right now

| Area | Observation |
|------|-------------|
| **Fonts** | Local `@font-face` in `shared/fonts.css` → `assets/fonts/*.woff2`; no external CDN at render time. Headless-safe by design (verified 2026-10-21). |
| **Design tokens** | `token.css` is a clean single source of truth (semantic colors, type scale, spacing, shadow, motion); the engine consumes only token-declared aliases. |
| **Engine vocabulary** | `.frame`, `.scrim`, `.copy` variants, `.t-eyebrow`/`.t-display`/`.cta`, `bar-top--ink` live in `shared/story-system.css` — one stylesheet drives every story (§F.2). Legacy `.rule-*`/`.plus`/`.diamond` primitives are frozen (hairline budget = 0). |
| **Logo sizing** | Clamped by the engine: 40×40px circular mask at `top:140px / left:80px` (§G.2); logo markup is byte-identical across posts — no per-post CSS. |
| **CLI works** | `hyperframes lint`, `check`, `render`, `snapshot` present and functional at v0.8.163 (`validate` deprecated in favor of `check`). |
| **Output dir wired** | `hyperframes.json` `"paths": { "assets": "assets" }` and `.hyperframes/render-outputs.json` `["renders"]`. |
| **Single-engine isolation** | Every composition links exactly one stylesheet (the engine), so there is no cross-post bleed; the router loads only `data-composition-src` documents. |

### A.4 Readiness score: **98 / 100 — PRODUCTION READY & HARDENED**

Verdict: **PRODUCTION READY & HARDENED (verified 2026-10-21).** The operational shell the 2026-10-19 audit found missing (batch manifest, daily segregation, green lint gate, asset taxonomy, scripted lifecycle) is built and proven in a live daily run: batch lifecycle automated end-to-end, contrast validation deterministic across every post, and a preflight chain that gates every render. The residual 2 points are held for composition-level WCAG AA remediation on the batch being worked — a defect-remediation backlog item, not a tooling gap.

**Score breakdown (points earned / possible):**

| Criterion | Score | Justification |
|-----------|-------|---------------|
| Local font intake (verified) | 10/10 | `assets/fonts/` drop zone with `<Family>-<Style>.woff2` naming; local `@font-face` (`font-display: swap`) wired to `--sans`/`--serif` tokens; zero CDN references. |
| Design token system | 10/10 | `token.css` centralized; engine consumes only token-declared aliases (no inline fallback drift). |
| Lint gate is green | 10/10 | `npx hyperframes lint` → **0 errors / 0 warnings** (verified 2026-10-21); enforced by preflight and by `render:daily` internally. |
| Batch lifecycle automated | 10/10 | `retire:batch` → `optimize:assets` → build → `preflight` → `render:daily`; stale batches archive themselves and router lines self-clean (§F.3). |
| Asset taxonomy via auto-slugging | 10/10 | `raw/`, `raw/optimized/`, `references/`, `logos/`, `fonts/` segregation; `optimize:assets` auto-slugs unsafe names with the mapping persisted to `slug-map.json`. |
| Render pipeline for statics | 10/10 | `--format png-sequence` + `--composition <file>` + `--strict`, looped over `batch-manifest.json` by `render:daily`. |
| Logo / brand safety | 10/10 | `assets/logos/logo.svg` master + PNG fallback; engine-clamped 40×40 circle; byte-identical markup; `bar-top--ink` contrast variant (§G.2). |
| index.html hygiene | 10/10 | Pure router: one `data-composition-src` line per post of the current day; stale lines stripped automatically (§C.4, §F.3). |
| package.json script surface | 10/10 | `lint`, `check`, `photo-fit`, `preflight`, `optimize:assets`, `retire:batch`, `render:daily` wired — zero-friction daily loop scripted (§C.5). |
| Deterministic contrast gate | 8/10 | `photo-fit` validates EVERY manifest post, all bands, worst-case pixel, engine-scrim composited — wired into preflight. −2 held: batch 2026-10-21 surfaced 4 true AA FAILs awaiting composition-level remediation (a defect backlog, not a gate/tooling gap; the gate is honest, not tuned to green). |
| **Total** | **98/100** | |

**Verification evidence (2026-10-21):**
- `npx hyperframes lint` → `0 error(s), 0 warning(s)` on the live workspace (every composition root carries `data-composition-id` / `data-duration` / `data-no-timeline`; router root matches `data-width="1080" data-height="1920"`).
- `npm run preflight` wired exactly as `hyperframes lint && node scripts/check-paths.js && node scripts/photo-fit.js && hyperframes check`; `render-batch.js` executes it before any render.
- `npm run photo-fit` reproduces browser-measured ground truth (story-01: 4/4 bands match `hyperframes check`'s sampled post) while extending coverage to EVERY manifest post — and flags the 4 genuinely failing bands of batch 2026-10-21 instead of masking them.
- Local font intake verified: `assets/fonts/` present, `@font-face` local-only, no CDN references in project CSS.
- Why 98 and not 100: the 4 identified AA FAIL bands need composition-level remediation (variant/theme/`.copy--ink`/copy shortening) in the daily run — process and tooling for that remediation are already in place (§F.8).

---

## B. Failure Points & Scaling Bottlenecks (The "Day 3 Breakdown")

### B.1 Asset clutter — flat `assets/` bucket

> **STATUS (2026-10-21): RESOLVED — systemic defect closed.**
> `assets/` is taxonomized into `raw/` (originals never modified or renamed), `raw/optimized/` (the ONLY source for compositions — auto-slugged to `^[A-Za-z0-9._-]+\.(jpg|jpeg|png)$`, mapping persisted to `assets/raw/optimized/slug-map.json`), `references/`, `logos/` (canonical `logo.svg` master + `logo.png` fallback — no logo versions multiply), and `fonts/` (the designated `.woff2` drop zone).

<details>
<summary>Historical defect record (2026-10-19)</summary>

`assets/` mixes raw client photos (`dk-raw-01*.jpg`, `dk-raw-02*.jpg`) and `logo.png` with no subfolders. There is **no `references/` inbox** for client-supplied reference graphics. By Day 3 (30–45 posts), raw images, references, and logos collide in one folder:
- Raw photos overwritten or confused with references.
- Logo versions multiply (`logo.png`, `logo-final.png`, `logo_new.svg`) with no canonical source.
- Font intake has no designated drop zone (`assets/fonts/` does not exist).
</details>

### B.2 Font pipeline — no `.woff2` intake contract

> **STATUS (2026-10-21): RESOLVED — intake contract verified.**
> `assets/fonts/` exists as the single drop zone with `<Family>-<Style>.woff2` naming; `shared/fonts.css` declares local `@font-face` blocks (`font-display: swap`, declared weight/stretch ranges) and `token.css` wires `--sans`/`--serif`. No CDN font references anywhere in project CSS (verified 2026-10-21); decision tree lives at §F.5.

<details>
<summary>Historical defect record (2026-10-19)</summary>

- Fonts live in `shared/fonts/`, referenced from `shared/fonts.css` via `url("./fonts/...")`. The mission requires `assets/fonts/` as the single `.woff2` drop zone with local `@font-face` declarations.
- No naming convention (`<Family>-<Style>.woff2`), no variable-font `font-stretch` documentation, no fallback-stack rule.
- `font-display: block` is used; for headless static capture this can briefly hide text if a font binary is missing or misnamed — a silent render risk.
</details>

### B.3 `index.html` bloat & composition accumulation

> **STATUS (2026-10-21): RESOLVED — router manifest + lifecycle automation.**
> `index.html` is a pure router (only `data-composition-src` lines for the current day, on the 1080×1920 root); batches live in `compositions/YYYY-MM-DD/` with a `batch-manifest.json`; and `npm run retire:batch` (scripts/retire-batch.js) automatically moves stale batches to `archive/stale-drafts/YYYY-MM-DD/` while stripping their router lines — no accumulation, no monolith (§C.4, §F.3).

<details>
<summary>Historical defect record (2026-10-19)</summary>

- `index.html` is an isolated placeholder (1080×1080, `data-composition-id="main"`). It imports nothing from `compositions/`.
- There is **no composition router/manifest** (`data-composition-src`) and no batch list. If daily posts are added to `index.html` as sections, it becomes a multi-thousand-line monolith within days and breaks the "clean entry point" constraint.
- Each post is a full HTML document — fine for isolation, but 30–45 posts = 90 files in `compositions/` with no daily segregation.
</details>

### B.4 Shared CSS bleeding
- `shared.css` sets global `body` (background gradients, `place-items: center`) and `.frame`/`.photo` primitives. Because each composition is its own document, bleed doesn't happen today — but there is **no CSS-scoping strategy** if compositions are ever previewed together or loaded through a router. Post-specific overrides live in per-post `.css` files, which is correct, but there is no naming/scoping convention (e.g., `.dk-post-01`) to guarantee collisions can't happen.

### B.5 Lint gate is red (blocker)

> **STATUS (2026-10-21): CLOSED — lint gate is GREEN.**
> `npx hyperframes lint` reports **0 error(s), 0 warning(s)** on the live workspace, `npm run preflight` enforces lint → photo-fit → check before every render, and `render-batch.js` refuses to render a non-green gate. The 2026-10-19 failure output below is retained as the historical record of the blocker.

<details>
<summary>Historical blocker evidence (2026-10-19)</summary>

`npx hyperframes lint` output:

```
◆  Linting dk-pipeline/3 files

✗ [compositions\dk-01-timber-touch.html:14:1] root_missing_composition_id: Root composition is missing `data-composition-id`.
   Fix: Add a stable `data-composition-id` to the entry composition wrapper.
✗ [compositions\dk-02-slow-mornings.html:13:1] root_missing_composition_id: Root composition is missing `data-composition-id`.
   Fix: Add a stable `data-composition-id` to the entry composition wrapper.

◇  2 error(s), 0 warning(s)
```

Consequences at the time (all now closed):
- Every batch must pass lint before capture (§1 constraint). As of 2026-10-19 the gate failed, so **no batch could ship** until fixed.
- `hyperframes render --strict` would fail on these compositions.
- Missing `data-composition-id` also means `snapshot --composition <id>` cannot target these posts by ID.
</details>

---

## C. The Master Architecture Blueprint

### C.1 Optimized directory schema

```
dk-pipeline/
├── index.html                      # LIGHTWEIGHT ROUTER/MANIFEST ONLY (no creative markup; 1080×1920 root)
├── package.json                    # hyperframes ^0.8.163 + scripts: lint, check, photo-fit, preflight, optimize:assets, retire:batch, render:daily (§C.5)
├── package-lock.json
├── hyperframes.json                # unchanged (paths + autoProxy)
├── .hyperframes/                   # HF internal state (gitignored)
├── node_modules/                   # (gitignored)
├── scripts/
│   ├── lib/batch-date.js           # shared local-date resolver (§F.8)
│   ├── lib/batch-context.js        # intraday batch identity + Schema validation (§F.9)
│   ├── retire-batch.js             # stale-batch archivist (see §C.5, §F.3)
│   ├── downscale-assets.js         # optimize:assets + auto-slugging → slug-map.json
│   ├── photo-fit.js                # deterministic all-posts WCAG AA gate
│   ├── check-paths.js              # fail-closed relative-path gate (§F.9)
│   ├── new-batch.js                # batch:new scaffolder + router sync (§F.9)
│   └── render-batch.js             # daily batch loop (see §C.5)
├── compositions/                   # WORKING DIRECTORY — regenerated daily
│   ├── YYYY-MM-DD/                 # one daily batch; retired automatically after the day
│   │   ├── batch-XX/               # INTRADAY batch folder (Model A, §F.9)
│   │   │   ├── story-04.html       # HTML ONLY, DEPTH-3 links — per-post .css is FORBIDDEN (§C.3, §F.9)
│   │   │   └── batch-manifest.json # Schema v2: {"date","batch","posts"}
│   │   ├── story-01.html           # HTML ONLY — per-post .css is FORBIDDEN (§C.3)
│   │   ├── story-02.html
│   │   └── batch-manifest.json     # legacy flat (batch-01) ordered list of posts for the day
├── archive/
│   └── stale-drafts/YYYY-MM-DD/    # HISTORICAL — retired batches, read-only after sign-off
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

**package.json scripts (live configuration — keep dependency list clean, only scripts added):**

```json
{
  "name": "dk-pipeline",
  "version": "1.0.0",
  "scripts": {
    "lint": "hyperframes lint",
    "lint:verbose": "hyperframes lint --lint-verbose",
    "check": "hyperframes check",
    "check:paths": "node scripts/check-paths.js",
    "photo-fit": "node scripts/photo-fit.js",
    "batch:new": "node scripts/new-batch.js",
    "preflight": "hyperframes lint && node scripts/check-paths.js && node scripts/photo-fit.js && hyperframes check",
    "optimize:assets": "node scripts/downscale-assets.js",
    "retire:batch": "node scripts/retire-batch.js",
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
# 0. Lifecycle first — retire stale batches, then optimize today's raws (auto-slugged)
npm run retire:batch
npm run optimize:assets

# 1. Pre-flight gate: lint → check:paths (fail-closed relative paths, §F.9) → photo-fit (all-posts WCAG AA) → check — MUST be green before any render
npm run preflight
#   lint: "0 error(s), 0 warning(s)" | check:paths: "all resolve … exit 0" | photo-fit: "0 FAIL band(s), exit 0" | check: 0 lint/runtime/motion errors

# 2. Render the whole daily batch — runs preflight internally (do NOT pre-run it yourself, §F.4):
npm run render:daily

# 3. Render a single post strictly (manual, outside the batch flow):
npx hyperframes render --composition compositions/YYYY-MM-DD/story-01.html \
  --format png-sequence --output renders/YYYY-MM-DD/story-01 --strict

# 4. Spot-check a static frame via snapshot:
npx hyperframes snapshot --composition dk-story-01 --at 0.0 --no-end \
  --output renders/YYYY-MM-DD/story-01-preview

# 5. Operator confirms outputs → the batch retires to archive/stale-drafts/ on the next run (§F.3)
```

**Failure-handling loop:**
1. `npx hyperframes lint` → parse `[file:line:col] rule_id: message`.
2. Auto-correct in code (e.g., add missing `data-composition-id`, fix broken `src` asset path, add `@font-face` for missing font).
3. Re-run `npx hyperframes lint` → verify `0 error(s)`.
4. `npm run photo-fit` → any FAIL band is a TRUE defect: fix by changing copy variant/theme, shortening the copy block, switching to `.copy--ink` (§G.9), or swapping the photo — **never by tuning the gate**.
5. Only then `npx hyperframes render ... --strict` (or `npm run render:daily`, which re-runs preflight itself).
6. If render fails, inspect `.hyperframes/` + render diagnostics, fix, re-lint, re-render.

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
- Compositions for today go in compositions/YYYY-MM-DD/; exports go in renders/YYYY-MM-DD/. INTRADAY (second or later batch today): if compositions/YYYY-MM-DD/ already holds ANY batch (a flat batch-manifest.json or a batch-XX/ folder), do NOT add flat files — run `npm run batch:new` and follow §F.9 (nested compositions/YYYY-MM-DD/batch-XX/ folder, CONTINUOUS intraday slugs, depth-3 links, exports under renders/YYYY-MM-DD/batch-XX/).
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
For each confirmed post, create compositions/YYYY-MM-DD/<slug>.html ONLY (per-post .css files are FORBIDDEN — see §F): INTRADAY, when today's folder already contains a batch, the file goes into compositions/YYYY-MM-DD/batch-XX/ instead — run `npm run batch:new` FIRST (it creates the folder + Schema-v2 manifest and prints the first CONTINUOUS slug); §F.9 governs intraday runs:
- Root: data-composition-id="dk-<slug>", data-duration="0.033", data-no-timeline, data-width="1080" data-height="1920" (Story 9:16 — the default and only engine-supported ratio; see §F.2). **Composition root dimensions must exactly match the index.html root canvas.**
- Imports: ../../shared/story-system.css ONLY (it @imports token.css + brand.css internally). Do NOT link shared.css, token.css, or any per-post stylesheet. INSIDE a batch-XX/ folder the SAME links are DEPTH 3: ../../../shared/story-system.css and ../../../assets/... (../../ there is one level short and silently unstyles the render — `npm run check:paths` fails closed on it); root-absolute "/shared/..." is forbidden (headless file:// cannot resolve it). See §F.9.
- Logo: <img src="../../assets/logos/logo.svg" alt="Direct Kitchens" class="dk-brand-logo"> inside <header class="bar-top">, always paired with <p class="brand">Direct Kitchens</p>. The engine clamps it to a 40×40px circle anchored at top 140px / left 80px. **No per-post logo CSS.**
- **Brand contrast rule:** if the photo's top-left region is bright (white/cream ceilings, pale cabinetry), the header MUST be `<header class="bar-top bar-top--ink">` (dark ink wordmark — WCAG AA ≥4.5:1). White brand text is only for dark-topped photos. The logo + `<p class="brand">` pairing is unchanged (§F.2).
- **Hairline Constraint — Strictly Zero:** `.rule-v`, `.rule-h`, `.plus`, `.diamond`, and `.tick` elements must not appear in any composition. Total hairline budget = 0.
- Copy roles: engine classes only — `.t-eyebrow`, `.t-display` (with `.serif-accent` for the italic accent word), and `.cta`, inside a `.copy` block using one of the three variants (`copy--bottom-left`, `copy--bottom-right`, `copy--centered`). The `.copy` block is pinned at `bottom: 220px` by the engine and is never clipped.
- Scrims: `<span class="scrim scrim--top">` + `<span class="scrim scrim--bottom">` inside `<figure class="photo photo--full scrim--{charcoal|warm}">`. Pick the theme matching the photo's undertone (§F).
- No inline styles beyond data-* timing attributes; keep each file under maintainable length.
- Add the post to compositions/YYYY-MM-DD/batch-manifest.json. Exact schema (render-batch.js contract): `{"batch":"YYYY-MM-DD","posts":[{"slug":"story-01","html":"compositions/YYYY-MM-DD/story-01.html","output":"renders/YYYY-MM-DD/story-01"}]}`. INTRADAY: add it to the ACTIVE batch's own manifest at compositions/YYYY-MM-DD/batch-XX/batch-manifest.json — Schema v2 `{"date":"YYYY-MM-DD","batch":"batch-XX","posts":[{"slug":"story-04",...}]}` with output renders/YYYY-MM-DD/batch-XX/<slug> (§F.9).
- Do not touch index.html except to add/remove a data-composition-src line for today's date. Prefer `node scripts/new-batch.js --sync-router`, which appends the ACTIVE batch's lines surgically inside #root (root attributes, comments and EOL untouched), is idempotent, and hard-fails on duplicate post ids or manifest entries whose HTML file does not exist yet (§F.9).

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
- `scripts/render-batch.js` executes `npm run preflight` (lint → check:paths → photo-fit → check) prior to rendering any composition. **Never run `npm run preflight` manually when using `npm run render:daily`** — one batch = one check session (§F.4).
- If the preflight exit code !== 0, the batch aborts immediately with a clear error report. No composition renders until the gate is green.

## STEP 6 — FINAL RENDER (confirmation required)
1. Show me the list of compositions ready to render and the planned output paths under renders/YYYY-MM-DD/ (INTRADAY: renders/YYYY-MM-DD/batch-XX/ — render:daily refuses any manifest output that escapes the active batch's render root, §F.9).
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
- check:paths: 0 broken relative paths (`npm run check:paths` exit 0, §F.9)
- INTRADAY RUNS (second+ batch today): batch scaffolded by `npm run batch:new` into compositions/YYYY-MM-DD/batch-XX/, slugs CONTINUED (never reset), manifest Schema v2, router lines appended via `--sync-router`, renders under renders/YYYY-MM-DD/batch-XX/ (§F.9)
- All confirmed posts rendered as static PNG under renders/YYYY-MM-DD/
- Clean render manifest shown to me
- index.html unchanged except data-composition-src lines for today
```

---

## E. Immediate 3-Step Action Plan

> **OPERATIONAL STATUS (2026-10-21): ALL THREE STEPS COMPLETED & OPERATIONAL.**
> The plan below is retained as the historical migration record of the 42/100 → production-ready transition. Live today: a green lint gate (0 errors / 0 warnings), the `assets/fonts/` intake contract wired to local `@font-face`, and the scripted daily lifecycle in `package.json` (`retire:batch` → `optimize:assets` → build → `preflight` → `render:daily`). The workspace now scores **98/100 — PRODUCTION READY & HARDENED** (§A.4).

Historical plan (executed 2026-10-19 → 2026-10-20), in order:

### Step 1 — Close the red lint gate ✅ COMPLETED & OPERATIONAL (verified 0 errors / 0 warnings on 2026-10-21)
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

### Step 2 — Establish the `assets/fonts/` pipeline ✅ COMPLETED & OPERATIONAL (`assets/fonts/` drop zone live; local `@font-face` + `--sans`/`--serif` token wiring verified 2026-10-21)
```
mkdir assets\fonts assets\references assets\raw assets\logos
# Move the three font binaries from shared/fonts/ into assets/fonts/
# Update shared/fonts.css: url("./fonts/...") -> url("../../assets/fonts/...")
# and font-display: block -> font-display: swap
npx hyperframes lint   # must still be 0 errors
```

### Step 3 — Scaffold the daily production skeleton & scripts ✅ COMPLETED & OPERATIONAL (`lint`/`preflight`/`optimize:assets`/`retire:batch`/`render:daily` live in `package.json` — §C.5)
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
  (pinned bottom:220px) plus the ADDITIVE `.copy--ink` color variant for bright surfaces (§G.9);
  `.t-eyebrow`, `.t-display` (+`<span class="serif-accent">` italic),
  `.cta`.
- BRAND-ON-PHOTO RULE: if the photo's top-left region is bright (white/cream), the header MUST
  be `class="bar-top bar-top--ink"` (dark ink variant `var(--ink, #1a1a1a)`; WCAG AA ≥4.5:1).
  White brand text is for dark-topped photos only. This is not optional — `check` fails otherwise,
  and `npm run photo-fit`'s brand band row verifies it per post (§F.4).
- Hairline budget = 0: `.rule-v/.rule-h/.plus/.diamond/.tick` never appear.
- Token aliases: `.cta` renders via `--brass` and `.t-eyebrow` via `--bone`; both are formally
  declared in token.css (`--brass: var(--brass-400, #c6a77d)`, `--bone: var(--bone-50, #f5f2eb)`).
  `.t-display` letter-spacing uses `--track-tight` (−0.02em). No inline fallback drift.

### F.3 Batch lifecycle (prevents stale-lint lockouts)
- STEP 0 of every daily run: `npm run retire:batch` (scripts/retire-batch.js). It moves any
  `compositions/YYYY-MM-DD/` folder for a date ≠ today to `archive/stale-drafts/YYYY-MM-DD/`
  (merge-safe; existing archive files never overwritten) and strips stale router lines from
  `index.html`. `renders/` and existing archive content are never touched. TODAY = the
  machine's **LOCAL calendar date** (`scripts/lib/batch-date.js`); override priority when
  targeting a specific batch: `--date YYYY-MM-DD` > positional `YYYY-MM-DD` arg >
  `DK_BATCH_DATE` env (never derive dates from UTC — §F.8).
- Lint scope = `compositions/**` + `index.html`; `archive/` is out of scope.
- `index.html`: root keeps `class="hyperframes-root" data-width="1080" data-height="1920"`
  and carries ONLY today's `data-composition-src` lines (add today's, remove prior dates').
- `compositions/YYYY-MM-DD/batch-manifest.json` schema (render-batch.js contract):
  `{"batch":"YYYY-MM-DD","posts":[{"slug":"story-01","html":"compositions/YYYY-MM-DD/story-01.html","output":"renders/YYYY-MM-DD/story-01"}]}`
- Renderer emits `frame_000001.png` (underscore, 6-digit) — verify THAT name, not frame-00000.png.
- **Intraday second+ batches:** §F.9 governs — nested `compositions/YYYY-MM-DD/batch-XX/` + CONTINUOUS slugs + Schema-v2 manifests, scaffolded by `npm run batch:new`; flat historical folders (e.g. 2026-10-21) remain immutable legacy `batch-01`. Date-based retirement above is unchanged and archives nested `batch-XX/` subfolders wholesale.

### F.4 Gate semantics (what "green" means)
- `npx hyperframes lint`: 0 errors, 0 warnings.
- `npm run photo-fit` (gate mode): EVERY post in the ACTIVE batch manifest resolved via
  `scripts/lib/batch-context.js` (nested `compositions/YYYY-MM-DD/batch-XX/batch-manifest.json`,
  legacy flat `compositions/YYYY-MM-DD/batch-manifest.json` = batch-01; the gated path is echoed
  in the output; §F.9),
  every band (eyebrow / h1 / cta / brand) ≥ WCAG AA (4.5:1 small, 3.0:1 large) at the worst-case
  pixel, composited with the engine's own scrim gradients scraped live from `story-system.css`
  (no copied constants). Exit 0 only when every band of every post passes. A FAIL band is a TRUE
  defect — remediate via variant/theme change, shorter copy, `.copy--ink` (§G.9), or a photo swap;
  NEVER tune the gate to go green.
- `npx hyperframes check`: 0 lint/runtime/motion errors; layout info-severity `canvas_overflow`
  findings caused by the router stacking posts 2..N inside the 1920 root are STRUCTURAL and
  accepted — they are not gate failures. Its contrast sampler still measures only the first
  router composition; that historical posts-02..N blind spot is CLOSED by photo-fit's all-posts
  coverage. The two are complementary: photo-fit = deterministic worst-case coverage of every
  post; check = rendered-pixel confirmation plus the full runtime/layout/motion suite.
- `npm run preflight` = `hyperframes lint && node scripts/check-paths.js && node scripts/photo-fit.js && hyperframes check`.
  NEVER run `npm run preflight` manually when using `npm run render:daily` — the batch script
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

### F.8 2026-10-21 hardening amendments (operator addenda — authoritative)

The §D operator prompt template is a FROZEN, production-validated artifact (byte-identical by
sanctuary rule). The amendments below were ratified in the 2026-10-21 hardening round and govern
the daily run where they overlap §D — they are carried WITH §D exactly like §F itself.

- **Date basis (§D Step 0):** batch dates resolve to the machine's **LOCAL calendar date** via
  `scripts/lib/batch-date.js` (shared by retire/render/photo-fit). No flag is needed for a normal
  daily run; overrides in priority order: `--date YYYY-MM-DD` > positional `YYYY-MM-DD` argument >
  `DK_BATCH_DATE` environment variable > local today. Never rely on UTC-derived dates — the
  UTC/local divergence window after midnight was the root cause of the 2026-10-21 batch-date defect.
- **Inspection protocol (§D Step 1):** inspect images SEQUENTIALLY — exactly ONE image per tool
  call, one image at a time. Batch/multi-image reads evict earlier images from context and silently
  destroy the evidence base — every photo must be seen, and seen alone, before it is reasoned about.
- **Feasibility probe (§D Step 1):** run `npm run photo-fit -- assets/raw/optimized/<file>`
  (design mode) on every candidate photo BEFORE design discussion. Carry the viable
  variant × theme matrix into Step 3 — a combination photo-fit reported infeasible must NOT be
  proposed downstream.
- **Contrast pre-check (§D Step 3):** every grounding table MUST include a `Contrast pre-check`
  row citing that photo's photo-fit result (viable variants/themes + worst ratio per band) before
  any composition is written. If photo-fit reports the full copy block infeasible for every
  variant: change variant/theme, shorten the copy block, use `.copy--ink` (§G.9), or swap the
  photo — never "ship and hope", never a blind browser spot-check.
- **Gate semantics (§D Step 5):** `npm run photo-fit` gate mode is the ALL-POSTS contrast
  authority (§F.4); `npm run preflight` = lint → check:paths → photo-fit → check. photo-fit FAILs are true
  defects to remediate — never tune the gate.
- **Exit criteria (§D end of run):** slug map persisted (`assets/raw/optimized/slug-map.json`);
  every grounding table carries its Contrast pre-check row; photo-fit green (0 FAIL bands,
  exit 0) before renders are approved.

### F.9 INTRADAY MULTI-BATCH RUNBOOK (Model A — added 2026-10-21)

Multiple automated batches per calendar day (`batch-01`, `batch-02`, …) with no collisions, no
manual bookkeeping, and no overwrite risk for earlier same-day runs. This section is the
authoritative intraday companion to §F.3 and is referenced from §D — when ANY batch folder for
today already exists, follow §F.9 instead of the flat daily instructions.

**Resolver/scaffolder/gate authority (the only place batch identity is computed):**

| Tool | Role |
|---|---|
| `scripts/lib/batch-context.js` | Batch identity: `listBatches` / `detectNextBatch` / `detectNextSlug` / `resolveBatchContext` (consumes `batch-date.js` — date truth stays in one place) |
| `npm run batch:new` (`scripts/new-batch.js`) | Scaffolds the NEXT batch folder + Schema-v2 manifest; `--sync-router` appends router lines |
| `npm run check:paths` (`scripts/check-paths.js`) | Fail-closed relative-path gate (closes lint's silent `<link>` skip) |

**Model A — nested directory structure:**

```
compositions/YYYY-MM-DD/batch-XX/<slug>.html        # one folder per intraday batch
compositions/YYYY-MM-DD/batch-XX/batch-manifest.json
renders/YYYY-MM-DD/batch-XX/<slug>/frame_000001.png # manifest `output` fields carry the nesting
```

- **Batch identity:** `batch-NN`, zero-padded, monotonically increasing per calendar day.
  `detectNextBatch` = max existing slot + 1 (gaps are NEVER refilled). Target overrides for
  render/check/photo-fit: `--batch batch-NN` > `DK_BATCH_ID` env > default = highest-numbered
  batch directory (the one just scaffolded). Dates continue to resolve via `batch-date.js`
  (local calendar day, `--date` > positional > `DK_BATCH_DATE` > today).
- **Intraday CONTINUOUS slug numbering:** slugs never reset within a day — batch 1 ships
  `story-01..03`, batch 2 starts at `story-04` (`detectNextSlug` scans the date root AND every
  `batch-XX/` subfolder). Continuity is what keeps router ids (`id="post-NN"`,
  `data-composition-id="dk-story-NN"`) globally unique across same-day batches;
  `--sync-router` hard-fails on any reused post id.
- **Manifest Schema v2 (nested batches):** `{"date":"YYYY-MM-DD","batch":"batch-XX","posts":[{"slug","html","output"}]}`.
  `render:daily` and `photo-fit` refuse a nested manifest whose `date`/`batch` do not match the
  resolved context, and `render:daily` additionally refuses any `post.output` that escapes
  `renders/YYYY-MM-DD/batch-XX/` (cross-batch overwrite = hard fail). The legacy flat manifest
  keeps Schema v1 (`"batch"` holds the DATE) and is validated against the date as before.
- **Router (`index.html`):** new batches APPEND their `data-composition-src` lines inside `#root`
  (continuous slugs keep them unique); root attributes, comments and EOL style are never touched.
  `retire:batch` still strips everything by DATE at midnight — unchanged (§F.3).

**Historical flat batches are IMMUTABLE legacy `batch-01`:** a date folder that holds a
date-level `batch-manifest.json` and no `batch-XX/` subdirectories IS `batch-01` (e.g.
`compositions/2026-10-21/` with its approved `story-01..03.html`). It is never moved, renamed, or
rewritten; the resolver folds it into slot 01, which is why the first intraday folder created on
such a day is `batch-02`.

**`npm run batch:new` scaffolding flow (zero-shot):**

1. `npm run batch:new` → creates `compositions/<DATE>/<nextBatch>/` + an empty Schema-v2
   `batch-manifest.json`, validates `index.html`'s `#root` structure, and prints the next free
   slug plus the depth-3 import block (`--date` / `DK_BATCH_DATE` honored; scaffolding always
   creates the NEXT free id — it never overwrites).
2. Create `<slug>.html` in that folder (template §G.8 with **depth-3** links, below).
3. Append its `{slug, html, output}` entry to that batch's `batch-manifest.json`
   (`output` = `renders/<DATE>/<batch-XX>/<slug>`).
4. `node scripts/new-batch.js --sync-router` → appends the router line(s) for the ACTIVE batch
   (idempotent; refuses if a manifest post's HTML file does not exist yet — fail-closed).
5. `npm run preflight` → `hyperframes lint && node scripts/check-paths.js && node scripts/photo-fit.js && hyperframes check`.

**Depth-3 relative links (INSIDE a `batch-XX/` folder — one level deeper than legacy):**

```html
<link rel="stylesheet" href="../../../shared/story-system.css">
<img src="../../../assets/logos/logo.svg" alt="Direct Kitchens" class="dk-brand-logo">
<img src="../../../assets/raw/optimized/<file>.jpg" alt="...">
```

- Depth math: `compositions/<DATE>/batch-XX/<slug>.html` sits 3 folders below the project root —
  `../../` is ONE LEVEL SHORT there and silently unstyles the render (HyperFrames lint SKIPS an
  unresolvable `<link>` instead of failing).
- `npm run check:paths` closes that hole: for the ACTIVE batch it requires EXACTLY ONE stylesheet
  per composition resolving to `shared/story-system.css`, every `<img>`/`<source>`/`<video>` src
  resolving to an existing file UNDER `assets/`, and rejects root-absolute (`/shared/...` —
  headless `file://` cannot resolve it) or any reference escaping the project root. Exit 1 with
  per-file `fix:` diagnostics on any violation.
- Everything else is depth-agnostic by construction: CSS-internal `@import`/`url()` resolve
  relative to `shared/`, `photo-fit` resolves `<img>` relative to each composition file, and
  `retire-batch` matches router lines by their DATE segment — none of them change.

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
- **Selection rule (§F.2):** white brand text over a bright top-left region fails WCAG AA (measured 2.3–2.7:1) — use `bar-top--ink` whenever the region behind the bar is high-key. Apply by INSPECTION, verified per post by `npm run photo-fit`'s brand band row (the `check` sampler only measures story-01 inside the router — §F.4).

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

**Verification (2026-10-21 — authoritative command).** `hyperframes check`'s contrast sampler only measures text inside the router canvas, which contains story-01 alone. The all-posts contrast authority is **`npm run photo-fit`** (`node scripts/photo-fit.js`): gate mode reads `compositions/YYYY-MM-DD/batch-manifest.json` and evaluates every text band of every post (eyebrow / h1 / cta / brand) against WCAG AA — 4.5:1 small, 3.0:1 large — at the worst-case pixel, composited with these scrim ramps **scraped live from `story-system.css`** (no copied constants), and exits 0 only when every band passes. Use `npm run photo-fit -- assets/raw/optimized/<file>` (design mode) to read a photo's feasible variant × theme matrix before composing, and `DK_PHOTOFIT_DEBUG=1` to print worst-pixel coordinates. **`scripts/verify-contrast.ps1` is a tombstone (stale alphas, hardcoded old batch) — do not run it.** Both gates — `npm run photo-fit` and `hyperframes check` — must be green before any commit (§F.4).

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

### G.9 `.copy--ink` — additive copy variant for bright surfaces (added 2026-10-21)

For high-key photography (white stone, beadboard, pale cabinetry) where the white/bone copy stack cannot clear WCAG AA even with the engine's dark text-shadows, the engine ships an **opt-in, purely additive** variant:

```css
/* Applied on the copy section: <section class="copy copy--bottom-right copy--ink"> */
.copy--ink .t-eyebrow { color: var(--ink); opacity: 0.9; text-shadow: 0 1px 8px rgba(255,255,255,.6), 0 2px 16px rgba(255,255,255,.45); }
.copy--ink .t-display { color: var(--ink); text-shadow: 0 2px 12px rgba(255,255,255,.55), 0 4px 24px rgba(255,255,255,.4); }
.copy--ink .cta       { color: var(--espresso-800, #2A211A); text-shadow: 0 1px 8px rgba(255,255,255,.7); }
.copy--ink .t-display .serif-accent { color: var(--espresso-700, #3E3027); }
```

- **What it changes:** recolors the copy stack to dark ink (`var(--ink)` / espresso) and adds a light-halo `text-shadow` so dark type stays legible over highlights. Eyebrow uses `--bone`→ink inversion, CTA stays warm-dark espresso rather than brass for legibility.
- **What it does NOT change:** geometry, positioning, sizing, tracking — `.copy--ink` only adds rules; every existing class (`copy--*`, `t-eyebrow`, `t-display`, `cta`, `serif-accent`) remains byte-functional without it. The variant is combinatorial: add it alongside any layout variant (`copy--bottom-left|bottom-right|centered`).
- **When to use it:** whenever the Step-3 **Contrast pre-check** (`npm run photo-fit -- <file>`, §F.8) reports the default white/bone stack infeasible over a bright surface and a scrim/variant change isn't enough. It is one of the four sanctioned remediations (variant/theme, shorten copy, `.copy--ink`, swap photo) — never a substitute for re-running the gate.
- **Usage:** `<section class="copy copy--bottom-right copy--ink">` — no per-post CSS, no inline styles.
