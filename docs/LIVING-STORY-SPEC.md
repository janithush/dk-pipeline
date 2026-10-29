# Direct Kitchens — Living Story Motion & Audio Specification

**Version:** P6.0 Production Standard (Cinematic Kinetics)
**Baseline Anchor:** Certified P6.0 Pipeline Delivery
**Target Specs:** 20.0s (600 frames @ 30 FPS) | 1080×1920 (9:16) | H.264 High bt709

---

## 1. Executive Summary & Delivery Artifacts

- **Primary Delivery Video:** `renders/2026-10-26/batch-01/story-01/living-20s.mp4` (~11.1 MB)
- **Settled Ad Creative / Poster:** `renders/2026-10-26/batch-01/story-01/poster-settled.png` (~769 KB)
- **Storage Policy:** `scripts/cleanup-render.js` prunes all intermediate sequence frames; local disk retention is strictly capped at **< 15.0 MB** per delivered composition.

---

## 2. Audio Engine Architecture & Default Cue Doctrine

The production pipeline mandates a 100% music-driven mix (zero voiceover) with automated dynamic ducking and strict limiter ceilings:

| Event / Cue | Timestamp | Audio Asset | Gain Staging | Bed Ducking Pocket |
| :--- | :--- | :--- | :--- | :--- |
| **Material Study Cut** | $t = 4.50\text{s}$ | `whoosh-soft-01.mp3` | -5.0 dB (linear 0.5623) | **-9.0 dB notch** (0.3548): 4.40s (0 dB) → 4.50s → 4.90s → 5.20s (0 dB), 0.10s attack |
| **Compound Transition** | $t = 8.50\text{s}$ | `whoosh-soft-01.mp3` | -5.0 dB (linear 0.5623) | **-9.0 dB notch** (0.3548): 8.40s (0 dB) → 8.50s → 8.95s → 9.25s (0 dB), 0.10s attack |
| **Lateral Push-Wipe (Pantry)** | $t = 12.50\text{s}$ | `accent-page-turn-01.mp3` | -5.0 dB (linear 0.5623) | **-9.0 dB notch** (0.3548): 12.40s (0 dB) → 12.50s → 12.90s → 13.20s (0 dB), 0.10s attack |
| **Logo Emblem Reveal** | $t = 16.50\text{s}$ | `click-tactile-01.mp3` | -6.5 dB (linear 0.4732) | 16.35s (0 dB) → 16.50s (-6.0 dB hold to 17.50s) |
| **CTA Action Settle** | $t = 17.20\text{s}$ | `accent-pop-01.mp3` | -7.5 dB (linear 0.4217) | Floor at -6.0 dB until 17.50s |
| **Acoustic Bed Tail** | $t = 17.50\text{s} - 20.00\text{s}$ | `dk-bed-acoustic-claps-01.mp3` | Calibrated (+0.5 dB baseline) | Exponential decay from -6.0 dB down to -60.0 dB at 20.0s |

### Motion Doctrine (P6.0 Cinematic Kinetics)

- **Beat-Synced Punch-Zooms:** every transition carries an expo.out punch (scale 1.00 → 1.12–1.13) locked to a bed clap accent (4.5 / 8.55 / 12.5s), replacing all flat 1.05 micro-zooms.
- **Lateral Slider Pans:** wide frames ride motorized lateral glides (S1 x −110 → +42 right-to-left across the cabinetry line; S4 counter-glide x +90 → −22 behind its wipe). **
  Bounding-box safety:** any laterally panning frame holds scale ≥ 1.15 so no canvas edge is ever exposed.
- **Second Directional Transition:** Scene 4 enters on a masked lateral push-wipe (clip right inset 100% → 0%, 0.75s power3.out) instead of a fifth cross-dissolve, paired with the page-turn cue.

### Master Limiter Ceiling

- The composition root must fix the TruePeak limiter ceiling at **-3.6 dBTP** to safeguard against AAC codec overshoot, guaranteeing delivery compliance $\le -3.0\text{ dBTP}$ and integrated loudness at $-14 \pm 0.5\text{ LUFS}$.

---

## 3. Scene Progression & Choreography

[0.0s - 4.5s] Scene 1: Hero Architectural Wide (DSC00689)
- P6.0 Motorized slider: x -110 -> +42 across the cabinetry line (right -> left), scale 1.15 -> 1.16 hold
- Arrival punch 1.00 -> 1.12 expo.out at t=0.50s (bed full-arrival clap); Archivo Bold Headline + Cormorant Garamond Italic accent bloom

[4.5s - 8.5s] Scene 2: Full-Frame Portrait Macro (DSC00716)
- 0.45s cross-dissolve + whoosh (-5.0 dB) under a -9.0 dB bed notch
- Beat-synced punch-zoom 1.00 -> 1.13 expo.out at the 4.5s clap, relay settle 1.13 -> 1.07

[8.5s - 12.5s] Scene 3: 54/46 Compound Split-Pane Layout
- Top pane (54% height): DSC00702 — punch 1.00 -> 1.12, drift to 1.06 / y -18
- Bottom pane (46% height): DSC00791 — counter-settle 1.14 / x -26 / y +18 -> 1.07 / x +10 / y 0
- Audio: Synchronized -5.0 dB whoosh with -9.0 dB notch (0.10s attack)

[12.5s - 16.5s] Scene 4: Functional Lifestyle Anchor (DSC00797)
- P6.0 Lateral push-wipe entrance: clip right inset 100% -> 0% (0.75s power3.out); page-turn cue -5.0 dB under -9.0 dB notch
- Punch-zoom 1.00 -> 1.13 with lateral counter-glide x +90 -> -22

[16.5s - 20.0s] Scene 5: Signature White End-Card (#ffffff)
- t = 16.50s: Centered circular dk emblem snaps + tactile click (-6.5 dB)
- t = 17.20s: CTA text rises into view + accent pop (-7.5 dB)
- 3.5s total hold time with natural acoustic decay

---

## 4. Brand & Layout Doctrines

1. **Stationary Scrim Law:** All scale and translate animations live strictly on child image elements inside overflow-clipped frames. Gradient scrims and branding bars remain fixed siblings to prevent optical pulsation.
2. **Typography Doctrine:** Primary headlines are set in Archivo Bold. Cormorant Garamond is strictly restricted to single italic accent words inside headlines (e.g., *hardware*, *drawer*, *light*). Full Cormorant headlines are prohibited.
3. **Approved CTA Suite (`manifest.json` v3):**
   - Variant A: *"Book your free design consultation"*
   - Variant B: *"Visit our Melbourne showrooms"*
   - Variant C: *"Custom kitchens made for your home"*
   - Variant D: *"Designed & built in Melbourne"*
4. **Banned Legacy Copy:** The phrases *"Built in Melbourne"* (unqualified) and *"Quality and Craft"* are permanently deprecated.

---

## 5. Verification Gates & Release Criteria

Before any batch artifact is certified for release, all gates must pass with zero exceptions:

- **Lint & Paths:** `npm run preflight` → 0 errors, 0 warnings.
- **Contrast & Layout:** `npx hyperframes check` → 100% WCAG AA compliance across text elements.
- **Render Strictness:** `hyperframes render` with `--strict --no-best-effort`.
- **Loudness Standards:** -14 ±0.5 LUFS integrated, TruePeak $\le -3.0\text{ dBTP}$, 0 clipping counts.
