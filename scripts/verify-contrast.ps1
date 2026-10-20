# SUPERSEDED 2026-10-21 by scripts/photo-fit.js (scrapes story-system.css at runtime).
#
# This script was retired because it had drifted from the engine:
#   - Scrim alpha constants were stale (0.95-0.97 vs. the engine's real 0.40-0.70
#     gradient stops), producing structurally FALSE PASS verdicts.
#   - The photo list was hardcoded to the old batch (1.jpg ... 9.jpg).
#   - It only ever validated the batch it was written for, not the live manifest.
#
# Use instead:
#   npm run photo-fit                 # gate: every post in today's manifest
#   npm run photo-fit -- --photo <f>  # design: feasibility matrix for one photo
