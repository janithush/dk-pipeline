# WORKFLOW — dk-pipeline Unified Multi-Format Production Manual (P7.0)

The operator's manual for producing a full day of posts across all three
delivery formats. Architecture doctrine lives in
`PRODUCTION_PIPELINE_AUDIT_AND_DAILY_BLUEPRINT.md`; the reel-specific motion +
audio doctrine lives in `docs/LIVING-STORY-SPEC.md`; this file is the *step-by-step*.

---

## §1 Format Taxonomy

Every manifest `posts[]` entry carries an additive `kind` field (Schema v1/v2
stay valid — unknown additive fields are ignored by every gate):

| `kind` | Composition file | Renderer | Deliverable leaf | Gates that bind |
|---|---|---|---|---|
| `static` | `<slug>.html` | `render:daily` (png-sequence) | `renders/<date>/<batch>/<slug>/` | preflight chain (lint · check-paths · photo-fit · verify-contrast) |
| `compound-static` | `<slug>.html` (layout-family grid, e.g. `hero-split-1-2`) | `render:daily` (png-sequence) | `renders/<date>/<batch>/<slug>/` | same as static (+ browser AA on every pane's copy) |
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
   (`detectNextSlug` rule, §F.9) — a 4.5s pilot reel and a 20s showpiece in
   one batch own story-02 and story-04 respectively.

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
# 3. author posts + manifest entries (kind + variant per post)
#    compositions/<date>/batch-<NN>/<slug>.html
npm run batch:new --sync-router       # or let ship's step 2/6 do it (idempotent)
# 4. gate + ship the batch
npm run ship                          # or: node scripts/produce.js ship
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
| `hyperframes lint` fails on an OLD date's batch | its optimized photos were retired | recover files from git history (§5) or `npm run retire:batch` |
