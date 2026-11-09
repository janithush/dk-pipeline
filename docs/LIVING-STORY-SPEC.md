# Direct Kitchens — Living Story Motion & Audio Specification

**Version:** P7.6 Production Standard (Cinematic Kinetics · Generalized CTA suite · 4-Format Canon)
**Baseline Anchor:** Certified P7.0 Pipeline Delivery · P7.2 audio-gain certification · P7.3 scrim-depth + teardown certification · P7.4 Solid Editorial Tile · P7.5 Pure-Visual Grid + 4-Post Suite Integration (2026-11-01)
**Target Specs:** 20.0s (600 frames @ 30 FPS) | 1080×1920 (9:16) | H.264 High bt709

---

## 1. Executive Summary & Delivery Artifacts

- **Primary Delivery Video:** `renders/<date>/<batch>/<slug>/living-20s.mp4` (~11–15 MB)
- **Settled Ad Creative / Poster:** `renders/<date>/<batch>/<slug>/poster-settled.png` (~0.8–1.4 MB)
- **Storage Policy (P7.0/P7.3):** `scripts/cleanup-render.js` prunes all intermediate sequence frames; local disk retention is strictly capped at **≤ 20.0 MB per deliverable leaf directory** (`living-20s.mp4` + `poster-settled.png`); parent batch folders are EXEMPT from the leaf budget. P7.3 additionally sweeps orphaned Chromium automation temp profiles (`%TEMP%` + `.hyperframes/`, 60-min idle guard) so repeated daily rehearsals never accumulate render-lane disk residue.
- **Delivery render lane (P7.3):** `render:reels` runs `--quality delivery --strict --no-best-effort` with the teardown seam applied — the engine's bundled 5s capture-session close race is relaxed to 15s so the end-of-render teardown of 6 concurrent audio streams across multi-worker Chromium completes gracefully (the P7.2-certified 2026-10-31 story-03 600-frame delivery previously hit the force-shutdown race).

---

## 2. Audio Engine Architecture & Default Cue Doctrine

The production pipeline mandates a 100% music-driven mix (zero voiceover) with automated dynamic ducking and strict limiter ceilings:

| Event / Cue | Timestamp | Audio Asset | Gain Staging | Bed Ducking Pocket |
| :--- | :--- | :--- | :--- | :--- |
| **Material Study Cut** | $t = 4.50\text{s}$ | `whoosh-soft-01.mp3` | -5.0 dB (linear 0.5623) | **-9.0 dB notch** (0.3758 abs · −9.0 dB relative to the +1.0 dB body 1.1220, ratio ≈ 0.335): 4.40s (0 dB) → 4.50s → 4.90s → 5.20s (0 dB), 0.10s attack |
| **Compound Transition** | $t = 8.50\text{s}$ | `whoosh-soft-01.mp3` | -5.0 dB (linear 0.5623) | **-9.0 dB notch** (0.3758 abs, same staging): 8.40s (0 dB) → 8.50s → 8.95s → 9.25s (0 dB), 0.10s attack |
| **Lateral Push-Wipe (Pantry)** | $t = 12.50\text{s}$ | `accent-page-turn-01.mp3` | -5.0 dB (linear 0.5623) | **-9.0 dB notch** (0.3758 abs, same staging): 12.40s (0 dB) → 12.50s → 12.90s → 13.20s (0 dB), 0.10s attack |
| **Logo Emblem Reveal** | $t = 16.50\text{s}$ | `click-tactile-01.mp3` | -6.5 dB (linear 0.4732) | 16.35s (0 dB) → 16.50s (-6.0 dB hold to 17.50s) |
| **CTA Action Settle** | $t = 17.20\text{s}$ | `accent-pop-01.mp3` | -7.5 dB (linear 0.4217) | Floor at -6.0 dB until 17.50s |
| **Acoustic Bed Tail** | $t = 17.50\text{s} - 20.00\text{s}$ | `dk-bed-acoustic-claps-01.mp3` | Calibrated (+1.0 dB baseline / 1.1220 — P7.2 certified P6.0 restoration; the P7.0-era +0.5 dB (1.0593) form measured I −14.7 LUFS, 0.2 LU under the −14.5 floor) | Exponential decay from -6.0 dB down to -60.0 dB at 20.0s |

### Motion Doctrine (P7.0 Cinematic Kinetics)

- **Beat-Synced Punch-Zooms:** every transition carries an expo.out punch (scale 1.00 → 1.12–1.13) locked to a bed clap accent (4.5 / 8.55 / 12.5s), replacing all flat 1.05 micro-zooms.
- **Lateral Slider Pans:** wide frames ride motorized lateral glides (S1 x −110 → +42 right-to-left across the cabinetry line; S4 counter-glide x +90 → −22 behind its wipe). **
  Bounding-box safety:** any laterally panning frame holds scale ≥ 1.15 so no canvas edge is ever exposed.
- **Second Directional Transition:** Scene 4 enters on a masked lateral push-wipe (clip right inset 100% → 0%, 0.75s power3.out) instead of a fifth cross-dissolve, paired with the page-turn cue.

### Master Limiter Ceiling

- The composition root must fix the TruePeak limiter ceiling at **-3.6 dBTP** to safeguard against AAC codec overshoot, guaranteeing delivery compliance $\le -3.0\text{ dBTP}$ and integrated loudness at $-14 \pm 0.5\text{ LUFS}$.

---

## 3. Scene Progression & Choreography

[0.0s - 4.5s] Scene 1: Hero Architectural Wide (DSC00689)
- P7.0 Motorized slider: x -110 -> +42 across the cabinetry line (right -> left), scale 1.15 -> 1.16 hold
- Arrival punch 1.00 -> 1.12 expo.out at t=0.50s (bed full-arrival clap); pure Archivo Bold headline bloom (P7.7 typography canon — zero serif accents)

[4.5s - 8.5s] Scene 2: Full-Frame Portrait Macro (DSC00716)
- 0.45s cross-dissolve + whoosh (-5.0 dB) under a -9.0 dB bed notch
- Beat-synced punch-zoom 1.00 -> 1.13 expo.out at the 4.5s clap, relay settle 1.13 -> 1.07

[8.5s - 12.5s] Scene 3: 54/46 Compound Split-Pane Layout
- Top pane (54% height): DSC00702 — punch 1.00 -> 1.12, drift to 1.06 / y -18
- Bottom pane (46% height): DSC00791 — counter-settle 1.14 / x -26 / y +18 -> 1.07 / x +10 / y 0
- Audio: Synchronized -5.0 dB whoosh with -9.0 dB notch (0.10s attack)

[12.5s - 16.5s] Scene 4: Functional Lifestyle Anchor (DSC00797)
- P7.0 Lateral push-wipe entrance: clip right inset 100% -> 0% (0.75s power3.out); page-turn cue -5.0 dB under -9.0 dB notch
- Punch-zoom 1.00 -> 1.13 with lateral counter-glide x +90 -> -22

[16.5s - 20.0s] Scene 5: Signature White End-Card (#ffffff)
- t = 16.50s: Centered circular dk emblem snaps + tactile click (-6.5 dB)
- t = 17.20s: CTA text rises into view + accent pop (-7.5 dB) — the generalized cta-B lockup (P7.6), authored as the balanced 2-line stack `Book a design consultation<br>Call 1300 449 799`
- 3.5s total hold time with natural acoustic decay

---

## 4. Brand & Layout Doctrines

1. **Stationary Scrim Law:** All scale and translate animations live strictly on child image elements inside overflow-clipped frames. Gradient scrims and branding bars remain fixed siblings to prevent optical pulsation.
2. **Typography Doctrine (P7.7 — Typography Canon Unification, 2026-11-09):** Primary headlines are set EXCLUSIVELY in pure Archivo Bold (`--sans`, weight 700): every glyph shares the identical modern geometric grotesque structure, with zero letter-to-letter style contrast. The `.serif-accent` span and the Cormorant Garamond italic accent device are DEPRECATED everywhere (static, tile, reel scenes, end-card) — the engine neutralizes the class (`font-style: normal; font-family: inherit; font-weight: inherit;`) and no composition may author it. Scale law: full-bleed/mono headlines 52px / 1.08 / −0.02em; the Format 2 solid bone tile runs its own commanding editorial scale `.pane--solid-bone .t-display` = 48px / 1.12 / −0.02em / `--ink`. The CTA metrics suite is LOCKED across all three active textual formats: `var(--sans)` / 20px / 600 / 0.12em / 1.4 / uppercase — the 2-line cta-B lockup renders byte-identically on story-02's tile and the reel end-card (the former 30px end-card scale override is retired).
3. **Approved CTA Suite (P7.3 head-office routing · P7.6 generalization — single source of truth: the active batch's `ctaLibrary`):** every lockup is drawn from the verified generalized 4-variant suite (rotate A → B → C → D by post index, cyclic; the "·" separator may be carried by an authored `<br>` in narrow columns so the phone lockup never splits mid-number):
   - Variant A (Tri-Showroom Network): *"Visit our showrooms: Blackburn · Moonee Ponds · Bayswater"*
   - Variant B (Direct Consultation Booking; end-card default): *"Book a design consultation · Call 1300 449 799"*
   - Variant C (Digital URL & Clear Call Lockup): *"Explore custom kitchens at directkitchens.com.au · Call 1300 449 799"*
   - Variant D (Melbourne Craftsmanship Authority): *"Melbourne custom kitchens designed & built · Call 1300 449 799"*
   Isolated factory-contact CTAs are REMOVED (P7.3): bookings route to HEAD OFFICE, never the plant. P7.6 (2026-11-08): branch/head-office locators ("Blackburn", "Head Office") are ELIMINATED from Variants B and D — prospects across Greater Melbourne must never read the CTA as geographically restricted; the locators survive ONLY in Variant A (tri-showroom geography) and provenance records. Do NOT re-insert "Head Office" into Variant D.
4. **Reel End-Card Safe Zones (P7.2/P7.3 certified):** the Scene-5 white end-card keeps the engine copy contract — centered ink stack, 176px circular emblem, copy tops well inside the 220px bottom safe zone on the static lanes (the reel's end-card re-pins the block to the centered composition; platform UI adjacency is unchanged). Scene copy over photo panes rides the deepened **680px** bottom ramp (`--scrim-bottom: 680px`, P7.3) so the CTA envelope's worst rows sit near ramp progress 68% (deep-ramp alpha ≈ 0.50).
5. **Banned Legacy Copy:** The phrases *"Built in Melbourne"* (unqualified) and *"Quality and Craft"* are permanently deprecated; unqualified "free"-economy phrasing stays off the verified suite (the end-card legacy string "Book your free design consultation" predates the suite and is NOT a ctaLibrary variant — new reels author Variant B verbatim).
6. **P7.5 4-Format Production Canon — Format Harmony & Asset Discipline:**
   The daily batch now delivers a complete 4-post suite across four distinct layout families:
   | Post | `kind` | Layout Family | Description |
   |------|--------|---------------|-------------|
   | story-01 | `static` | `mono-full` | Full-bleed static hero — wide room architecture, deep 680px bottom scrim, copy platform at 220px. |
   | story-02 | `editorial-split` | `hero-split-editorial` | Format 2: Top hero + solid bone editorial tile (ink-on-bone native AAA, zero scrim/eyebrow) + pure detail macro (no copy). |
   | story-03 | `reel` | (GSAP timeline) | Format 4: 20s Living Story Reel — 5-scene cinematic kinetics, P7.2 certified audio baseline, generalized cta-B end-card (P7.6 2-line lockup). |
   | story-04 | `pure-grid` | `hero-split-pure-grid` | Format 3: Top hero + 2 subject-diverse detail macros — ZERO text, ZERO scrims, brand bar only. |
   - **Asset Diversity Law (cross-format):** The two detail macros in `pure-grid` MUST be subject-diverse (e.g., hardware pull + joinery corner — NO twin pullouts/drawers). The wide hero may be shared with at most ONE other post in the batch (typically `editorial-split` for continuity). All three static-lane formats (`static`, `editorial-split`, `pure-grid`) share the same brand bar contract and render via `render:daily` png-sequence to the same leaf namespace (`renders/<date>/<batch>/<slug>/poster-settled.png`).

---

## 5. Verification Gates & Release Criteria

Before any batch artifact is certified for release, all gates must pass with zero exceptions:

- **Lint & Paths:** `npm run preflight` → 0 errors, 0 warnings.
- **Contrast & Layout:** `npx hyperframes check` → 100% WCAG AA compliance across text elements.
- **Render Strictness:** `hyperframes render` with `--strict --no-best-effort` (the P7.3 teardown seam relaxes the 5s browser-close race to 15s so the audio-heavy page teardown completes gracefully).
- **Loudness Standards:** -14 ±0.5 LUFS integrated, TruePeak $\le -3.0\text{ dBTP}$, 0 clipping counts.
- **P7.2/P7.3 Certified Metrics of Record (2026-10-31 story-03 600-frame delivery):** audio cert I −14.3 LUFS · TP −3.3 dBTP · 0 clipped samples · 600/600 frames; preflight lint 0/0 · check-paths 1:1 parity · browser AA verify PASS; P7.3 adds the 680px scrim depth (photo-fit native pass, 0 ladder-exhaustion deferrals) and the 15s teardown race.
