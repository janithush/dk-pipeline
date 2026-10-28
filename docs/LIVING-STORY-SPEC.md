# Direct Kitchens — Living Story Motion & Audio Specification

**Version:** P5.1 Production Standard
**Baseline Anchor:** Certified P5.1 Pipeline Delivery
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
| **Compound Transition** | $t = 8.50\text{s}$ | `whoosh-soft-01.mp3` | -8.5 dB (linear 0.3758) | 8.35s (0 dB) → 8.50s (-5.0 dB) → 8.90s (-5.0 dB) → 9.20s (0 dB) |
| **Logo Emblem Reveal** | $t = 16.50\text{s}$ | `click-tactile-01.mp3` | -6.5 dB (linear 0.4732) | 16.35s (0 dB) → 16.50s (-6.0 dB hold to 17.50s) |
| **CTA Action Settle** | $t = 17.20\text{s}$ | `accent-pop-01.mp3` | -7.5 dB (linear 0.4217) | Floor at -6.0 dB until 17.50s |
| **Acoustic Bed Tail** | $t = 17.50\text{s} - 20.00\text{s}$ | `dk-bed-acoustic-claps-01.mp3` | Calibrated (+0.5 dB baseline) | Exponential decay from -6.0 dB down to -60.0 dB at 20.0s |

### Master Limiter Ceiling

- The composition root must fix the TruePeak limiter ceiling at **-3.6 dBTP** to safeguard against AAC codec overshoot, guaranteeing delivery compliance $\le -3.0\text{ dBTP}$ and integrated loudness at $-14 \pm 0.5\text{ LUFS}$.

---

## 3. Scene Progression & Choreography

[0.0s - 4.5s] Scene 1: Hero Architectural Wide (DSC00689)
- Scale: 1.00 -> 1.05 slow micro-zoom (Stationary Scrim Law)
- Archivo Bold Headline + Cormorant Garamond Italic accent bloom

[4.5s - 8.5s] Scene 2: Full-Frame Portrait Macro (DSC00716)
- 0.4s cross-dissolve with subtle directional drift

[8.5s - 12.5s] Scene 3: 54/46 Compound Split-Pane Layout
- Top Pane (54% height): DSC00702 (Contextual dining room wide, settle drift)
- Bottom Pane (46% height): DSC00791 (Chrome knob macro, bottom push-wipe)
- Audio: Synchronized -8.5 dB whoosh with -5.0 dB bed ducking

[12.5s - 16.5s] Scene 4: Functional Lifestyle Anchor (DSC00797)
- Pantry pull-out detail with directional settle

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
