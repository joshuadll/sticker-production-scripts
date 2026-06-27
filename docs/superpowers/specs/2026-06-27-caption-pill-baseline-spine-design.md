# Caption pill spine — baseline rewrite — design

**Date:** 2026-06-27
**Branch:** `feature/illustrator-native-rewrite`
**Status:** approved; implemented + validated (TDD + Illustrator regression)

## Symptom

Several WC captions (e.g. **Michael's Gate**, Bratislava Castle, Blue Church, Čumil Statue,
Kraslice, Kroje, Fujara, Slovakia Map) rendered a **curved white pill under perfectly straight
text**. ~8 of 24 captions in the Slovakia fixture were affected.

## Root cause

The pill is swept along a **spine** fitted to the text. The original (PS Step 3B, faithfully
ported to `aiUtils`) estimated the spine as the **least-squares quadratic through the vertical
MIDPOINT of the inked span in each ~1mm column**, snapping straight only if the fit's deviation
from the **mean** stayed within 0.5mm.

Three compounding flaws:

1. **The midpoint is a noisy centreline estimator.** A column's ink midpoint depends on which
   glyph features are present (caps vs x-height vs ascenders) and on isolated marks (an
   apostrophe sits high). So the midpoint trend bows/tilts even when the baseline is dead flat.
2. **The snap metric measured deviation from the MEAN**, which folds the linear *tilt* of the
   noisy midpoints into the "curvature" test. Most false-curves were almost entirely tilt
   (Slovakia Map: 10pt by the mean metric, 0.7pt of true curvature).
3. **The AI port had regressed the sampler** from a 1mm *band* (PS read the bounding span of all
   ink in the slice) to a single *scan line*, which over-reacts to isolated marks and gaps.

The PS original would mis-curve the same captions; it was invisible only because the PS pill was
a low-res raster, re-traced and white-edged. The new pipeline draws a crisp vector capsule, so
the flaw surfaced.

## Decision

Keep curved-caption support (artists do arc text via Warp/envelope), but rebuild the estimator on
the **baseline** instead of the midpoint. Chosen over a literal port (leaves 3–4 captions curved)
and over keeping the midpoint approach with tweaks (the midpoint is fundamentally noisy).

## Algorithm (baseline-based)

1. **Band sampler** (`_capSampleTextOutline`): outline a copy of the text; per 1mm band record the
   **bottom-of-ink** (baseline candidate) and the ink height. Restores the PS band behaviour
   (`_capBandSpan` = union of per-scanline spans across the slice).
2. **Robust baseline fit** (`_capRobustBaselineFit`): least-squares quadratic through the
   per-band bottoms, rejecting **descenders** (sit below) and **floating marks** —
   apostrophes/dots/accents (sit above) — via a median/MAD inlier test, 2 iterations.
3. **Straight vs curved**: curved only if there are `≥ minCols` inliers (default 8 — too few
   columns can't distinguish a curve from noise) **and** the inlier fit's deviation from its
   **endpoint chord** (pure curvature, tilt removed) exceeds the snap (`snapMm`, default 0.6mm).
4. **Build the spine**:
   - **straight / multi-line / degenerate** → the proven flat bbox stadium (unchanged): a
     horizontal spine at the text-box centre, radius covers the full box incl. descenders.
   - **curved** → centreline = baseline curve lifted by half the line height (baseline and
     centreline are parallel arcs under a warp); radius from a high percentile of band heights.

Key insight: the **baseline is glyph-height-invariant** — straight text fits flat regardless of
caps/x-height/ascenders/punctuation — and under a warp the baseline shares the centreline's
curvature, so measuring on the clean baseline is both robust and correct.

## Why the straight path is low-risk

Everything that snaps straight uses the *existing, trusted* flat-capsule code. On this fixture all
24 captions snap straight, so straight-text output is unchanged in shape. The baseline-derived
**curved** spine runs only for genuinely warped text — which can't be validated here (no warped
fixture), so it is touched minimally and flagged for a future warped-text fixture.

## Validation

- **Unit (node, TDD):** `tests/integration/unit/test-caption-spinefit.js` — flat-baseline +
  descenders + floating marks → straight (outliers rejected); arced baseline → curved & follows;
  `< minCols` → straight; pure flat → bow 0, nothing rejected; `_capBandSpan` span/null.
- **Illustrator regression:** the real `_capSampleTextOutline` + `_capRobustBaselineFit` on all 24
  fixture captions → **0 curved**, max long-word bow 1.11pt vs 1.7pt snap; short words
  (Kroje/Tram/Pirohy/Fujara) straight via the min-column guard.
- **Pipeline 2 end-to-end:** `run.sh` builds all captions + exports both SVGs; golden re-baselined
  (pill/seat geometry changed).

## Tuning knobs (`buildCaptionPill` opts; defaults)

- `sliceMm` 1.0 — band width.
- `snapMm` 0.6 — curvature snap (was 0.5; raised for margin now that tilt is excluded).
- `minCols` 8 — minimum inlier columns before a curve is trusted.
- `pctile` 0.9 — band-height percentile → curved-line height.

## Out of scope

- Warped-text fixture + validation of the curved branch (recommended next).
- GC plate-raster path (no GC element in the fixture).
