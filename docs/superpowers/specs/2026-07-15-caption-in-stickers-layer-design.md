# Caption printed artwork → Stickers layer (shipped final file)

**Date:** 2026-07-15
**Branch:** `worktree-fix+caption-in-stickers-layer`
**Status:** Design approved, pre-implementation

## Problem

An artist reported: the caption (white pill + text + GC plate raster) is attached to
the cutlines and gets treated as something to cut. The cutting machine reads the
**Cutlines** and **Halfcut** layers and cuts any **visible** path it finds there. The
caption's printed artwork must therefore live in the **Stickers** layer, not the
Cutlines layer.

### Current structure (post native-caption rewrite)

Every captioned element is one `GroupItem` named `{displayName}` in the Cutlines layer
(`assembleElementGroup`, `buildCaption` in `utils/aiUtils.jsx`). Members:

| Member | Visible? | Filled? | Role |
|---|---|---|---|
| `{name}` | visible | no (stroked) | fused cut path = `Unite(outline, pill)` — the real cut |
| `{name} outline` | hidden | — | element-art trace (re-Unite operand) |
| `{name} plate` | **visible** (re-shown for captions) | white | the pill — printed white background |
| `{name} caption text` | visible | yes | caption text |
| `{name} caption plate` | visible | (raster) | GC decorative raster |

Default-tab (uncaptioned peel-tab) elements instead carry `{name} tab fill` (visible,
printed) plus a hidden `{name} plate` (the tab cut operand).

So three-plus **visible, filled** printed items sit inside the Cutlines layer and would
be cut. The fused cut path already traces the pill silhouette (the peel tab), so the cut
itself is correct — the redundant *printed* pill/text/raster are the problem.

## Decisions (settled during brainstorming)

1. **Cutter rule:** the machine cuts *visible* paths in Cutlines/Halfcut and **ignores
   hidden** ones. → hidden helpers (`{name} outline`, hidden plate operands) may stay;
   only visible printed items must move.
2. **Scope:** fix the **shipped `{STK}_final.ai` only**. The working file keeps today's
   structure (caption rides nesting for free as a cutline-group member). No change to
   Steps 6/7B/8b/10 or to the working-file layout.

## Approach

Relocate the visible printed caption artwork from the Cutlines groups to the Stickers
layer **at final-file production (Step 11)**, operating on the saved final copy only.

### Why Step 11 (vs. build-time on Stickers + transform sync)

The caption lives in the cutline group specifically so it inherits the Step 7B nest
rotate/translate and the Step 8b normalise scale for free. Moving it to Stickers at
build time would require re-implementing that transform-sync for the caption (as the
art PNG does via `_nestPivotMatrix` + rot-stamp reconciliation) across multiple steps —
large and risky. By Step 11 every transform has already run and the caption is exactly
co-located with its cutline, so relocation is a pure layer move that **preserves absolute
position** — no re-transform, no re-seat.

## Component

New private helper in `illustrator/Step11_FinalFile.jsx`:

```
_s11MoveCaptionsToStickers(fd)   // fd = the final-file copy (app.activeDocument after saveAs)
```

Called from `runFinalFile` **after** the non-production layer strip and **before** the
final `saveAs` (currently `Step11_FinalFile.jsx:86`).

### Algorithm

```
stickersLayer = findLayer(fd, CONFIG.stickersLayerName)   // "Sticker"
cutlinesLayer = findLayer(fd, CONFIG.cutlinesLayerName)   // "Cutlines"
if (!stickersLayer) -> hard error (no fallback: printed art needs a home)
if (!cutlinesLayer) -> log warn, return (nothing to relocate)

snapshot groups = [g for g in cutlinesLayer.pageItems if g is GroupItem]
elementsMoved = 0, itemsMoved = 0
for each group g in snapshot:
    cutPath = findGroupMember(g, "")            // member named exactly g.name (stroked, unfilled)
    movers  = [child for child in g.pageItems (snapshot) if child !== cutPath and child.hidden === false]
    if movers is empty: continue
    capGroup = stickersLayer.groupItems.add()
    capGroup.name = g.name + " caption"
    move capGroup to TOP of stickersLayer (PLACEATBEGINNING — above all art rasters)
    move each m in movers into capGroup, preserving their existing relative z-order
        (invariant: pill behind raster behind text; do NOT reverse — pick the placement
         enum/iteration direction that keeps order, e.g. iterate back-to-front with
         PLACEATBEGINNING)
        itemsMoved++ per moved item
    elementsMoved++
log "[step11] captions relocated to Stickers | " + elementsMoved + " element(s), " + itemsMoved + " item(s)"
```

Notes:
- **Identification is naming-independent:** keep the one member equal to `group.name`
  (the fused cut, stroked & unfilled); move every *other visible* child. Survives future
  caption-member renames. Matches the existing stroked-unfilled/filled convention
  (`_classifyAssetPaths`, `aiUtils.jsx:3032`).
- **Alignment:** `move()` preserves absolute artwork coordinates → each caption stays
  exactly inside the cut that traces it.
- **Z-order (print only; cutter ignores Stickers):** target print stack is
  `art (bottom) → white pill → GC raster → text (top)`. The pill/raster/text already sit
  in the correct relative order inside the source group; wrapping them in a `{name} caption`
  group at the top of Stickers preserves that and keeps captions above all art. Captions
  never overlap a *different* element's art, so one "all captions on top" pass is safe.

### Post-move assertion (warn-on-all)

After relocation, walk `cutlinesLayer` and confirm every remaining **visible** item is a
cut path (stroked & unfilled). Any leftover **filled visible** item →
`log "[step11] *** PRINTED ITEM LEFT IN CUTLINES *** | " + name` (does not abort — advisory,
surfaces regressions).

## Edge cases

- **No captioned elements** (all bare stamps / uncaptioned no-tab): loop is a clean no-op.
- **Default tabs:** `{name} tab fill` is visible & filled → relocates (it is printed,
  never a cut). Its `{name} plate` (tab cut operand) is hidden → stays.
- **Bare stamps:** PathItems, not groups → skipped by the `is GroupItem` filter.
- **Missing Stickers layer:** hard error, consistent with the pipeline's no-fallback rule.
- **Idempotency:** Step 11 `saveAs` produces a fresh final copy each run where the caption
  is still in the group, so the helper always starts from the same state.

## Out of scope

- The "smoothing for the caption is different" issue — handled in a separate worktree.
- Any working-file structural change (settled: shipped-file-only).
- Step 10 per-element PNG export — unchanged; it runs before Step 11 and still sees the
  caption in the group.

## Testing

Runs only in live Illustrator (per project practice for un-headless-testable Adobe code:
guard + log + manual checklist).

- Update the `ai-export-final` integration golden log to include the new
  `captions relocated to Stickers | …` line (and any assertion lines).
- Add a runner assertion: in the produced `{STK}_final.ai`, the **Cutlines** layer holds
  **zero filled visible items** and the **Stickers** layer gained one `{name} caption`
  group per captioned element.
- Regenerate the golden **2×** and diff for determinism before committing.

### Manual checklist (artist / live Illustrator)

1. Run Pipeline 2 → nest → normalise → `AI_ExportFinal` on a captioned SKU (WC and GC).
2. Open `{STK}_final.ai`. Confirm: Cutlines layer contains only cut contours + hidden
   helpers; Stickers layer contains the art plus a `{name} caption` group per element.
3. Confirm each caption is visually unchanged (position, pill, text, GC raster on top of art).
4. Confirm the fused cut still traces the pill (peel tab intact) and the half-cut is
   untouched in the Halfcut layer.
5. Send to the cutter / RIP: confirm the caption artwork is **printed, not cut**.
