# Default Peel Tab for Untabbed Elements — Design

**Date:** 2026-06-30
**Status:** Design (approved for planning)
**Branch:** TBD (`feature/default-peel-tab`)

## Problem

WC/GC elements get a named caption that doubles as a peeling tab. Everything else —
**ST stamps and any uncaptioned element** — currently ships with **no peel tab and no
half-cut**. An artist has to add one by hand.

An earlier attempt existed (`illustrator/Step9B_PeelingTab.jsx`, added in `974a44d`,
removed in `c245b19`) but was "not well refined": it only looked at **horizontal** edges,
positioned the tab **flush** to the edge (never seated into the art), and drew a **straight**
half-cut. We are replacing that with a version that routes the default tab through the
**same seat → unite → curved-half-cut machinery the named captions already use**.

## Goal

Every non-WC/GC element automatically gets a default peel tab:
- placed roughly in **Pipeline 1** (best edge + outward orientation) for the artist to review
  and optionally reposition, then
- seated, cut, and half-cut in **Pipeline 2** through the existing caption primitives.

## Confirmed decisions

1. **Scope:** ALL non-WC/GC elements (ST stamps + uncaptioned) get an auto tab. This
   **reverses** the current behavior where stamps get no half-cut (`ST|0` note → Step 9A
   skips, artist hides the tab manually).
2. **Edge choice:** the **longest near-straight perimeter run, anywhere** on the element
   (top/side/bottom), ignoring position. The tab is oriented **perpendicular to that edge,
   pointing outward**.
3. **Sizing / asset choice:** tabs keep their **authored real-world size** (no scaling).
   Use the **"PEEL HERE"** tab when the chosen edge length ≥ its width + margin; otherwise
   the **semi-circle** tab.
4. **Tab structure:** each tab asset has two parts — a **cutline** (the cut path) and a
   **fill** (a colored shape that bleeds slightly past the cut). **Only the cutline enters
   the sticker cut**; the **fill is a ride-along printed-ink member** that never affects the
   cut shape (exactly like the GC decorative plate raster today).
5. **Reuse structure:** mirror the caption path. New isolated code; the validated
   `buildCaption` is left untouched.

## Assets

- `assets/Peel_Teb_B.ai` — "PEEL HERE tab" (trapezoid). **Preferred.**
- `assets/Peel_Tab_A.ai` — semi-circle tab. **Fallback** when no edge is long enough for
  PEEL HERE.

Each file is a single "Layer 1" containing two unnamed paths. They are distinguished at
runtime by paint attributes:
- **cutline** = stroked path, no fill.
- **fill** = filled path, no stroke (geometrically a bit larger — the bleed).

If the two-item heuristic is ambiguous for an asset, that is a **hard error** naming the
element (no silent guess).

## Architecture (Approach A — mirror the caption path)

### Pipeline 1 — Step 6 (`Step6_CreateCutlines.jsx`)

Replace the current ST/uncaptioned **else-branch** (which only names the bare cut path) with
`placeDefaultTab()`:

1. Name the traced silhouette `[Display Name] outline` (separable component, matching WC/GC —
   today the stamp trace is named just `[Display Name]`).
2. `pickTabEdge(outline)` → choose the longest near-straight edge (see below).
3. Choose asset by edge length (PEEL HERE vs semi-circle).
4. `placeTabAsset(file, edge)` → paste the asset's cutline + fill into a loose group
   `[Display Name] tab`, rotate to the edge direction, translate so the tab's inner (attach)
   edge sits just over the chosen art edge. **No seat / unite / half-cut yet.**
5. Log the chosen edge + outward normal for artist review.

The artist then reviews and may move/rotate the `[Display Name] tab` group, exactly as they
review caption text today. Pipeline 1 still stops for review.

### Pipeline 2 — `runBuildAndExport` (`AI_BuildAndExportCutlines.jsx`)

Today the loop does `if (styleCode !== "WC" && styleCode !== "GC") continue;`. Add a branch:
for non-WC/GC elements, find the placed `[Display Name] tab` group (at the artist's current
pose) and call `buildDefaultTab()`.

### `buildDefaultTab(doc, layer, tabGroup, outline, opts)` — new in `aiUtils.jsx`

Mirrors `buildCaption` minus the pill/text build:

1. Extract the tab group's **cutline** (the plate) and **fill** (the ride-along).
2. Ride-group the fill, then `seatPlateToOutline(name, outline, cutline, fillRide)` — pulls
   the cutline's inner-edge points into the art to depth `d`, fill rides rigidly. Operates at
   the tab's arbitrary orientation.
3. `deriveCutline(outline, cutline)` → Unite → `assembleElementGroup` → keep the fill as a
   visible member.
4. `group.note = _capNoteFormat("ST", 0, cutlineArea, needsReview)` — **`lines:0` marks
   "tab, not text."**
5. `syncHalfcut(doc, group)` → submerged-arc half-cut (straight or curved), same as captions.

An unseated tab (artist placed it off the art → no real overlap) returns `{ok:false}` and is
a **hard error** in `AI_ExportFinal`: it names the element and aborts before Steps 10/11.
Identical to the caption no-fallback rule.

### New shared helpers (`aiUtils.jsx`)

- `pickTabEdge(outline)` → `{ midX, midY, dirAngle, lengthMm, outwardNormalAngle }`.
  Generalizes the old `_findLongestHorizontalSeg`: accumulate the longest run of perimeter
  segments whose direction stays within an angle tolerance of the run's own direction (so
  diagonal/vertical edges qualify, not just horizontal). Outward normal = perpendicular to
  the chord pointing away from the polygon centroid.
- `placeTabAsset(file, edge)` → opens the asset, identifies cutline vs fill by paint attrs,
  pastes both into `[name] tab`, rotates + translates to the edge.

## Reconciling existing stamp handling

Three existing touch-points change:

1. **Note format:** `ST|0` ("stamp, no half-cut") → `_capNoteFormat("ST", 0, area, review)`
   for a tabbed stamp. `lines:0` distinguishes a tab from a text caption; the area lets
   Step 8b normalise it like any plate.
2. **`wrapStampsInGroups` / `unwrapStampGroups`** exist only because a bare-path stamp had no
   group to host the spacing halo (wrapped during the working phase, unwrapped to bare paths
   at export). A tabbed stamp is now a **permanent** group (it ships with a fused cutline +
   half-cut), so it is treated like any caption group — no wrap/unwrap. The wrap/unwrap path
   is gated to fire only for a stamp with **no** tab (defensive; should not occur once all
   non-WC/GC elements are tabbed).
3. **Step 9A** currently selects only GC/WC and skips ST. It will include default-tab groups
   (their half-cut is already built by `syncHalfcut` in Pipeline 2; Step 9A re-syncs them in
   its canonical pass, like captions).

## Error handling

- Ambiguous asset (can't tell cutline from fill) → hard error, names the element.
- No near-straight edge found by `pickTabEdge` → hard error, names the element.
- Unseated tab in Pipeline 2 → `{ok:false}` → `AI_ExportFinal` aborts before export.

## CONFIG knobs (new)

- `peelTabAssetPathPeelHere` = `_root + "/assets/Peel_Teb_B.ai"`
- `peelTabAssetPathSemiCircle` = `_root + "/assets/Peel_Tab_A.ai"`
- `peelHereTabWidthMm` — measured from the asset at runtime; CONFIG holds the fit margin only.
- `peelTabEdgeFitMarginMm` — extra length required beyond the tab width to prefer PEEL HERE.
- `peelTabEdgeStraightToleranceDeg` — straightness tolerance for `pickTabEdge` (generalizes
  the old 5°).

## Validation watch-items (cannot validate in Adobe from here → guard + log + checklist)

- `seatPlateToOutline` was validated for **bottom-ish** captions; an **arbitrary-edge /
  steeply-rotated** tab is new. Guard + log the seat tilt / overhang; add a PS/AI checklist
  item. Do not claim the seat works at all orientations until validated.
- `pickTabEdge` outward-normal sign on **concave** shapes — log the chosen edge + normal in
  Pipeline 1 for artist review.
- Real tab widths come from measuring the two assets at runtime; the A-vs-B default margin is
  a first guess to tune with the artist.

## Testing

- **Unit (node-check + geometry):** `pickTabEdge` on synthetic polygons (horizontal,
  diagonal, vertical, concave) — asserts longest edge + outward normal sign.
- **Pipeline 2 integration:** extend the existing `ai-build-and-export-cutlines` fixture (or
  add a stamp-bearing fixture) so the default-tab branch is exercised: tab seated, cutline
  united, half-cut built, both SVGs exported. Golden-log workflow as today.
- The current Pipeline 2 fixture is WC-only (Slovakia: 24 WC + 2 ST). The 2 ST elements
  become the default-tab coverage once Pipeline 1 places their tabs — fixture regen required.

## Out of scope

- Scaling tabs per size category (decided: fixed real size).
- GC-SKU plate-raster validation (tracked separately).
- Manual per-stamp tab hiding (the playbook's old manual workflow is replaced).
