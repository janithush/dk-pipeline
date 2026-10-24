# dk-pipeline

**dk-pipeline** is a headless HyperFrames static creative engine for producing high-fidelity
Direct Kitchens Instagram/Facebook **Stories (1080×1920)** at daily volume — zero CDN, zero
runtime, fully local font and asset pipeline, zero-friction automated production.

## Tech stack

- **[HyperFrames](https://hyperframes.heygen.com)** `0.8.191` (exact pin) — headless composition renderer / linter / validator
- **Vanilla CSS engine** — `shared/story-system.css` is the single source of layout truth (geometry lives in CSS custom properties that the validation scripts scrape live — scripts and styles are synchronized *by construction*)
- **Self-hosted fonts** — `.woff2` binaries in `assets/fonts/`, `@font-face` declared in `shared/fonts.css` (no Google Fonts CDN, `font-display: swap` for headless-safe rendering)
- **Node.js scripts** — `scripts/produce.js` drives the entire day; deterministic gates in `scripts/photo-fit.js` (WCAG oracle + self-heal ladder) and `scripts/verify-contrast.js` (browser-authority certification)

## Project structure

```
dk-pipeline/
├── index.html                      # lightweight router/manifest (data-composition-src only, 1080×1920)
├── package.json                    # scripts: produce, ship, batch:new, preflight, optimize:assets, retire:batch, render:daily …
├── hyperframes.json                # paths (blocks/components/assets) + media.autoProxy
├── .gitignore                      # node_modules, .hyperframes, renders, raw originals, OS artifacts
├── scripts/
│   ├── produce.js                  # operator entrypoint: prepare / ship / status (§H)
│   ├── photo-fit.js                # gate: deterministic WCAG AA oracle + self-heal escalation ladder
│   ├── verify-contrast.js          # gate: per-post browser-authority contrast certification
│   ├── check-paths.js              # gate: fail-closed path + manifest-parity validation
│   ├── new-batch.js                # intraday batch scaffolder + surgical router sync
│   ├── render-batch.js             # strict render loop over the ACTIVE batch manifest (--strict --no-best-effort)
│   ├── qa-vision.js                # advisory lens-1 vision QA (snapshot + Gemini describe; fail-open) · qa-vision-prompt.txt (v1)
│   ├── retire-batch.js             # shipped-aware stale-batch archivist + router cleanup
│   ├── downscale-assets.js         # ffmpeg optimizer: raw → optimized (≤2048px, ≤2MB, slug-mapped)
│   └── lib/                        # batch-date.js (local-calendar date truth) · batch-context.js (batch identity)
├── compositions/YYYY-MM-DD/        # working directory: batch-XX/story-NN.html + Schema-v2 batch-manifest.json
├── archive/                        # stale-drafts/ (shipped) · unshipped/ (abandoned) · retire-log.json
├── assets/                         # inputs only: raw/ (originals) · raw/optimized/ (only render source) ·
│                                   #   references/ · logos/ · fonts/
├── shared/                         # story-system.css (engine) · token.css · fonts.css · brand.css · shared.css (legacy)
├── renders/                        # outputs (gitignored): YYYY-MM-DD/batch-XX/<slug>/frame_000001.png
└── PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md   # full architecture + runbooks (§A–§H)
```

## Daily production loop (the operator's entire job)

```bash
# 1. Drop raw photos into assets/raw/

# 2. Prepare the day (retire stale dates → optimize assets → scaffold batch → photo ledger)
npm run produce

# 3. Build posts (agent/creative step — see PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md §D/§H)
#    compositions/YYYY-MM-DD/batch-XX/<slug>.html + manifest entries

# 4. Ship the batch (self-healing preflight → render → certify → git commit — unattended)
npm run produce -- ship
```

Multi-batch days: scaffold the next intraday batch with `npm run batch:new` (continuous slugs
are automatic), build posts, then `npm run produce -- ship` again — earlier batches on the same
day are never overwritten.

## Key npm scripts

| Script | Purpose |
|--------|---------|
| `npm run produce` | Prepare the production day (retire → optimize → scaffold → report) |
| `npm run produce -- ship` | Certify + render + git-commit the active batch, unattended |
| `npm run produce -- status` | Read-only state report (+ consumed/available photo ledger) |
| `npm run batch:new` | Scaffold the next intraday batch (`--sync-router` appends router lines) |
| `npm run preflight` | lint → check-paths → photo-fit `--fix` → verify-contrast (same chain ship runs) |
| `npm run qa:vision` | advisory dual-lens vision QA (lens 1): per-post snapshot + Gemini describe; needs `GEMINI_API_KEY`, otherwise a clean SKIP — never gates |
| `npm run check:zones` | advisory safe-zone sweep: samples the bottom 28% copy platform as a warning-severity zone |
| `npm run optimize:assets` | Re-optimize raws (`-- --prune` also removes stale unreferenced optimized copies) |
| `npm run retire:batch` | Shipped-aware archival of stale dates + router cleanup |
| `npm run render:daily` | Strict render loop for the active batch |

Full architecture, engine contract (§F/§G), intraday multi-batch runbook (§F.9), and the
zero-friction factory contract (§H): see **PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md**.
