# Step 6 — Create Cut Lines

## What it does

Builds the working document in code (`buildWorkingDocument` in aiUtils.jsx — no
template file), places the silhouette PNG exported by
`PSAI_BuildAndExportCutlines.jsx`, runs Image Trace (Silhouettes preset), converts each
traced shape from fill to stroke (0.25pt black), and names each resulting path
after its source element using positional matching against the elements sidecar
file.

## Input files (both produced by `PSAI_BuildAndExportCutlines.jsx` before BridgeTalk)

| File | Description |
|---|---|
| `{name}_silhouette.png` | Flat black PNG of the Silhouette layer only |
| `{name}_elements.txt` | PSD dimensions + one line per element: `displayName\|styleCode\|left\|top\|right\|bottom` (px) |

## Output

The working document (built in code) contains:
- A **Cutlines** layer (created above the Stickers layer) containing one
  named PathItem per element, 0.25pt black stroke, no fill.
- Stamp elements (`[ST]`) have their traced path replaced with a scaled copy
  of `Stamp Cutline Template.ai`.

## Playbook mapping

Playbook step 4 — Create Cut Lines.

Manual sequence:
1. Open Production File Template.ai
2. File > Place the Resize Area PSD — uncheck Link, Convert Layers to Objects
3. Resize to fit artboard (artist judgement)
4. Ungroup, delete Guide
5. Create Cutlines layer above Stickers, move silhouette there
6. Image Trace > Silhouettes preset
7. Expand trace result
8. Switch Fill → Stroke, 0.25pt
9. Ungroup
10. For stamp elements: replace traced path with Stamp Cutline Template.ai

Script automates steps 1, 3–10. Artist still positions/sizes if needed after.

## Key conventions

- **One path per element** — caption pill is part of the element silhouette
  (combined sticker). No `[Display Name] caption` paths.
- **Path naming** — by positional match: path centroid vs. element PSD bounds
  (transformed to AI coords using the placed PNG's position/scale).
- **Stamp replacement** — only if `CONFIG.stampTemplatePath` is set; otherwise
  logs a warning and leaves the traced path in place.
- **Scaling** — PNG is scaled to `CONFIG.workingAreaWidthMm` wide, centred on
  artboard. Artist can adjust after.

## Confirmed values

| Parameter | Value |
|---|---|
| Cut line stroke | 0.25pt black (CMYK 0,0,0,100), no fill |
| Cutlines layer | Above "Stickers" layer |
| Offset path | 1mm (Step 8b) |
| Working area | 190 × 267 mm (A4 minus margins) |

## Artist CONFIG (set before first run)

In `PSAI_BuildAndExportCutlines.jsx`:
- `aiPipelinePath` — full path to `pipelines/AI_BuildCutlines.jsx`

In `pipelines/AI_BuildCutlines.jsx`:
- `stampTemplatePath` — full path to `Stamp Cutline Template.ai`

## Files

- Step function: `illustrator/Step6_CreateCutlines.jsx`
- Pipeline: `pipelines/AI_BuildCutlines.jsx`
- Utilities used: `utils/aiUtils.jsx` (`setStrokeStyle`, `blackCmyk`, `boundsCenter`, `mmToPoints`, `findLayer`, `log`, `scriptAlert`)

## Testing

See `tests/integration/run-step6.sh`.

Verify after run:
1. Cutlines layer exists above Stickers in the AI document
2. Each element has exactly one named path (name = element display name)
3. Each path: 0.25pt black stroke, no fill
4. Stamp elements have template-based cutlines (if `stampTemplatePath` is set)
5. Log shows no unmatched paths
