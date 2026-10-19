# dk-pipeline

**dk-pipeline** is a headless HyperFrames static creative engine for producing high-fidelity marketing creatives (1080×1350 static posts) at daily volume — zero CDN, zero runtime, fully local font and asset pipeline.

## Tech stack

- **[HyperFrames](https://hyperframes.heygen.com)** `^0.8.163` — headless composition renderer / linter / validator
- **Vanilla CSS Design Tokens** — `shared/token.css` is the single source of truth (semantic colors, type scale, spacing, shadow, motion)
- **Self-hosted fonts** — `.woff2` binaries in `assets/fonts/`, `@font-face` declared in `shared/fonts.css` (no Google Fonts CDN, `font-display: swap` for headless-safe rendering)
- **Node.js scripts** — `scripts/render-batch.js` drives the daily static-render loop with a `--strict` lint gate

## Project structure

```
dk-pipeline/
├── index.html                      # lightweight router/manifest (data-composition-src only)
├── package.json                    # scripts: lint, render:daily, render:post, snapshot
├── package-lock.json
├── hyperframes.json                # paths (blocks/components/assets) + media.autoProxy
├── .gitignore                      # node_modules, .hyperframes, renders, OS artifacts
├── README.md
├── scripts/
│   └── render-batch.js             # daily batch loop over batch-manifest.json (--strict)
├── compositions/                   # working directory, regenerated daily
│   ├── YYYY-MM-DD/
│   │   ├── post-*.html / post-*.css
│   │   └── batch-manifest.json
│   └── archive/                    # read-only after client sign-off
├── assets/                         # inputs only — never written by the pipeline
│   ├── references/                 # client reference posts
│   ├── raw/                        # client raw photos
│   ├── logos/                      # logo.svg (master), logo.png (fallback)
│   └── fonts/                      # .woff2 drop zone
├── shared/                         # brand system
│   ├── token.css                   # design tokens (single source of truth)
│   ├── fonts.css                   # @font-face → assets/fonts/*.woff2
│   ├── shared.css                  # primitives & utilities
│   └── brand.css                   # brand marks (.dk-brand-logo dimensions)
├── renders/                        # outputs (gitignored)
│   └── YYYY-MM-DD/
└── .hyperframes/                   # HyperFrames internal state (gitignored)
```

## Available npm scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run lint` | `hyperframes lint` | Lint the project — gate must be `0 errors, 0 warnings` before any render |
| `npm run render:daily` | `node scripts/render-batch.js` | Render today's batch as static PNGs into `renders/YYYY-MM-DD/` |
| `npm run snapshot` | `hyperframes snapshot` | Spot-check a static frame from a composition |
| `npm run validate` | `hyperframes validate` | Validate runtime (missing assets, headless font load, contrast) |
| `npm run render:post` | `hyperframes render --composition` | Render a single composition strictly |

## Daily production loop

```bash
# 1. Lint — gate must be green
npm run lint
#   (fix any errors; re-run until: 0 error(s), 0 warning(s))

# 2. Render the whole daily batch
npm run render:daily

# 3. Spot-check a frame
npm run snapshot
```

See `PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md` for the full operator prompt template and architecture blueprint.
