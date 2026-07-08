# Resolution-aware pipeline (source-DPI driven end-to-end)

**Date:** 2026-07-08
**Status:** Approved design — ready for implementation plan
**Author:** Joshua + Claude

## Problem

Exported assets from the final pipeline (`AI_ExportFinal` → Step 10) are pixelated
compared to the artist's manual export. Two proximate causes were fixed inline first
(JPEG previews exported at the ExportOptionsJPEG default 72 DPI; per-element PNGs at
150 DPI). But the deeper issue is that **the pipeline discards all source resolution
above 300 DPI long before export**, so raising the export knob to 600 would only
*upsample* 300-DPI art — no real detail gained.

Resolution is pinned to 300 at two upstream points:

1. **Template build** — `PS_BuildElements.createTemplateDoc()` creates the working PSD
   at `CONFIG.templateDPI = 300`.
2. **Resize** — `Step 2A` resizes every element to a **fixed pixel count** from
   `CONFIG.sizeTable` (e.g. `LM = 615px`), and those px values equal `inches × 300`.

Step 1 imports elements via `layer.duplicate()` into the template, which copies pixels
1:1 but reinterprets them at the *template's* resolution; Step 2A then normalizes to the
fixed px target. So a 600-DPI source PSD's extra pixels are thrown away twice.

## Goal

Make the resolution of the **source PSD** flow through the entire pipeline as a single
detected value, so:

- A 300-DPI source produces 300-DPI output (unchanged from today).
- A 600-DPI source produces 600-DPI output (native, lossless).
- Any arbitrary DPI works — no hardcoded 300, no magic per-element pixel counts.

Physical sizes (element size, white edge) must stay identical in real-world units at
every DPI; only pixel density changes.

## Non-goals

- Changing element physical sizes, the caption system, nesting, or QA.
- Measuring/adapting resolution from the *placed raster* at export time (rejected:
  art is embedded as a `RasterItem` with no pixel-dimension API, is rotated/scaled by
  nesting, and — decisively — the source never exceeds 300 today, so there is nothing
  to detect downstream of the resize). Detection must happen where the info is clean:
  Photoshop, from `doc.resolution`.
- A manual DPI knob (Approach B). Auto-detection from the source is the requirement.

## Design

### Single source of truth

The **working document's resolution** governs everything. It is determined once in
Pipeline 1:

- If Pipeline 1 **adopts an already-open** valid template doc → `sourceDPI = doc.resolution`.
- If Pipeline 1 **creates** the template → Step 1 reads every source PSD's
  `.resolution`, warns on any mismatch (listing each file + its DPI), and builds the
  template at the **highest** resolution found.

The resolved value is stored at runtime as `CONFIG.sourceDPI`. `templateDPI: 300`
remains only as a fallback default when no source resolution can be determined.

### Data flow

```
PHOTOSHOP (Pipeline 1)                    ILLUSTRATOR
──────────────────────                    ───────────
Step 1 opens source PSDs
   │  read each .resolution
   │  warn on mismatch, use HIGHEST ──► sourceDPI (CONFIG.sourceDPI)
   ▼
build template AT sourceDPI
   │
Step 2A resize:  targetPx = round(inches × sourceDPI)   ┐
Step 2B edge:    edgePx   = round(mm/25.4 × sourceDPI)  ├─ physical units × DPI
   │                                                     ┘
   ▼
Step5b sidecar  {…, sourceDPI: N} ───────────────► Step 6 place:  72/sourceDPI
element PNGs (native px)                          ► Step 7B place: 72/sourceDPI
                                                  ► Step 10 export PNG @ sourceDPI
```

### Units by unit

**1. DPI detection — `PS_BuildElements` (+ Step 1 helper)**
- Add a resolution-resolution step to `main()`: adopt open doc's `resolution`, else
  scan the source PSDs Step 1 will open, warn-on-mismatch, use max.
- `createTemplateDoc()` builds at the resolved `sourceDPI` instead of `templateDPI`.
- Store the resolved value in `CONFIG.sourceDPI` (runtime field).
- The existing `doc.resolution !== templateDPI` WARN (line ~220) becomes informational
  or is removed — we now adopt the doc's actual resolution rather than assuming 300.

**2. Physical-unit config + `getTargetPx` — `psUtils` + PS CONFIG**
- Convert `sizeTable` / `sizeTableLarge` / `sizeTableSmall` from px-at-300 to **inches**
  (the finished sizes already documented in the CONFIG comments):

  | cat | current px | inches |
  |-----|-----------|--------|
  | TL  | 900 | 3.0 |
  | LM  | 615 | 2.05 |
  | MP  | 570 | 1.9 |
  | TR  | 570 | 1.9 |
  | IC  | 495 | 1.65 |
  | FD  | 525 | 1.75 |
  | ST  | 450 | 1.5 |
  | LM+ | 690 | 2.3 | MP+ 600 → 2.0 | TR+ 600 → 2.0 | IC+ 540 → 1.8 | FD+ 600 → 2.0 |
  | LM- | 540 | 1.8 | MP- 540 → 1.8 | TR- 540 → 1.8 | IC- 450 → 1.5 | FD- 450 → 1.5 |

- `getTargetPx(parsed)` returns `Math.round(inches × CONFIG.sourceDPI)`.
- `whiteEdgePx: 20` → `whiteEdgeMm: 1.7`; `whiteEdgeSmoothRadiusPx: 20` → mm. Resolve
  to px at runtime: `Math.round(mm / 25.4 × sourceDPI)`.
- `gridPaddingPx: 60` (layout-only, working-PSD grid arrangement) — scale by DPI for
  proportional consistency (cell size = TL px + 2×padding); not output-critical.
- **Round-trip guarantee at 300 DPI:** `2.05 × 300 = 615`, `1.7mm → round(1.7/25.4×300)
  = 20px`, etc. — every current value is reproduced exactly, so 300-DPI golden tests do
  not drift. Verify by running the PS integration test 2×.

**3. Sidecar carries `sourceDPI` — Step5b `writeElementsFile`**
- Add `sourceDPI: Math.round(doc.resolution)` to the `_elements.json` top-level object,
  alongside `psdWidth` / `psdHeight`.

**4. AI placement reads the sidecar — Step 6 (`AI_BuildCutlines`) + Step 7B (`AI_ImportNesting`)**
- Both already read the sidecar and both compute `72 / CONFIG.sourceDPI`. Replace the
  hardcoded `CONFIG.sourceDPI: 300` with the sidecar's `sourceDPI` (CONFIG value becomes
  the fallback). Physical placement size stays exact at any DPI.

**5. AI export at source DPI — `AI_ExportFinal` / Step 10**
- `AI_ExportFinal.main()` reads `sourceDPI` from `{base}_elements.json` beside the
  working `.ai` (mirror `AI_ImportNesting._readElementsSidecar`) and sets
  `CONFIG.pngExportScale = sourceDPI`.
- Step 10 is otherwise unchanged — it already exports PNGs at `CONFIG.pngExportScale`.
- `jpegPreviewDpi` stays a fixed preview knob (default 300); a full-sheet proof does not
  need 600-DPI density.

### Error handling

- **Source-PSD resolution mismatch** → warn-on-all (log each file + DPI), use highest.
- **Sidecar missing / unreadable / no `sourceDPI`** at an AI step → fall back to `300`
  and log a warning. Never silently assume.
- **Zero / non-numeric `doc.resolution`** → guard; fall back to `templateDPI` default.

### Testing

- Existing 300-DPI integration fixtures must produce byte-identical goldens (the inch
  and mm values reproduce the current px targets exactly). Confirm by running each
  affected runner 2× for determinism.
- Add a unit assertion that `getTargetPx` scales with `sourceDPI` (e.g. `LM` → 615 at
  300, 1230 at 600) and that white-edge px scales likewise.
- Manual Adobe validation (cannot run headless here): run a real 600-DPI source SKU
  through Pipelines 1 → 3 and confirm (a) element physical sizes unchanged, (b) white
  edge physically unchanged, (c) exported PNGs are 2× the pixel dimensions of the 300
  case and visually crisp. Guard + log where automated validation isn't possible.

## Rollout / risk

- Changes span both Photoshop (Pipeline 1) and Illustrator (Steps 6/7B/10) plus the
  sidecar schema and `psUtils.getTargetPx`. It is one coherent change but touches many
  files; land on a branch, `--no-ff` merge.
- Backward compatibility: a sidecar written before this change has no `sourceDPI` field
  → AI steps fall back to 300 (current behavior). Safe.
- The size-table format change is the highest-risk item for golden drift; the 300-DPI
  round-trip check is the guard.
