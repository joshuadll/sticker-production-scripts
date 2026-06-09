# Sticker Production Scripts — Claude Code Context

## Language
All scripts are ExtendScript (ES3). No let/const, no arrow functions, no template literals.
Always wrap main() in try/catch that alerts error with line number.

## Average SKU
27 elements per SKU. 1–5 working PSD files per SKU.

---

## Project architecture

```
sticker-production-scripts/
├── utils/
│   ├── psUtils.jsx          ← shared Photoshop helpers (#included by PS pipelines)
│   ├── aiUtils.jsx          ← shared Illustrator helpers (#included by AI pipelines)
│   └── json2.jsx            ← JSON.stringify/parse polyfill (ExtendScript has no native JSON); #included by PSAI + AI_BuildCutlines for the _elements.json sidecar
├── photoshop/
│   ├── Step1_CombineElements.jsx
│   ├── Step2A_AutoResize.jsx
│   ├── Step2B_WhiteEdge.jsx     ← adds white edge to each SO (before caption review)
│   ├── Step3A_CaptionText.jsx   ← places T layers; artist reviews before Step 3B
│   ├── Step3B_CaptionWhite.jsx  ← adds White pill + Caption plate; groups all layers
│   └── Step5_Silhouette.jsx     ← finalizes Elements group; builds transient black silhouette at export (not saved)
├── illustrator/
│   ├── Step6_CreateCutlines.jsx
│   ├── Step7A_DeepnestExport.jsx    ← classifies paths by extent ratio → exports _regular.svg + _irregular.svg
│   ├── Step7B_NestingImport.jsx    ← reads Deepnest SVG(s), applies full Deepnest transform (rotation + translation) to cutline GroupItems,
│   │                                    places per-element PNGs into Stickers layer; called by AI_ImportNesting
│   ├── Step8a_SimplifyCutlines.jsx     ← native RDP simplify of trace cutlines
│   ├── Step8b_CaptionNormalise.jsx      ← reset GC plate to spec → re-Unite cutline
│   ├── Step8c_OffsetPathQA.jsx         ← spacing + margin QA (pure geometry; no offset layer created)
│   ├── Step9A_Halfcut.jsx              ← GC/WC elements only: bezier ray → half-cut at plate junction
│   ├── Step9B_PeelingTab.jsx           ← stamps/unnamed: tab asset + compound path + half-cut at flat edge
│   ├── Step10_AssetExport.jsx          ← JPEG previews (white+green) + per-element PNGs; temp clip groups, no persistent Asset layer
│   ├── Step11_FinalFile.jsx            ← Save As {STK_CODE}_final.ai; strips non-production layers; renames halfcut layer
│   └── StepQA_NestingQuality.jsx       ← occupancy grid → NQI score (0-100); flags re-nest pockets
│                                          (collects cutlines recursively through GROUPS *and*
│                                           SUBLAYERS — stamps sit in a Cutlines sublayer;
│                                           pockets gated by AREA: pocketMinAreaMm2 90mm² — one
│                                           CONFIG knob; inscribed-circle radius via chamfer
│                                           distance still logged as a shape reference; overlay =
│                                           greedy-tiled free-cell fill, not bounding boxes)
├── pipelines/
│   ├── PS_BuildElements.jsx        ← Steps 1 → 2 → 3 (white edge) → 3A (caption text)
│   │                                                   (stop: artist reviews captions)
│   ├── PSAI_BuildAndExportCutlines.jsx ← Steps 3B (caption white+group) → 5 → per-element PNG export → BridgeTalk → AI Steps 6+7A
│   │                                       also exports {docName}_elements/ folder of per-element PNGs for AI_ImportNesting
│   │                                                   (stop: artist runs Deepnest manually on both SVGs then continues)
│   ├── AI_BuildCutlines.jsx            ← BridgeTalk target + re-run entry (Steps 6+7A); not run directly by artist
│   │                                       Re-run only: when Step 6 can't link a traced shape to an element,
│   │                                       artist renames it in the Cutlines layer, then re-runs to export SVGs
│   ├── AI_ImportNesting.jsx        ← run after Deepnest: reads nested SVG(s), applies full Deepnest transform
│   │                                   (rotation + translation) to each cutline GroupItem, places artwork PNGs
│   │                                   in Stickers layer at matching position/rotation
│   │                                   Deepnest nests each part in <g transform="translate() rotate()"> (Illustrator
│   │                                     bakes the transform on open) and STRIPS path ids (only originally-ungrouped
│   │                                     paths keep a name) → Step7B collects parts recursively (not layer.pathItems,
│   │                                     which is 0) and matches AREA-ONLY (global-greedy by closest area ratio;
│   │                                     translate+rotate preserve area so true pairs ≈1.0). No name matching.
│   │                                   Rotation: centroid→largest-anchor direction on baked geometry; bbox-swap fallback.
│   │                                   Working doc resolved by its Cutlines layer (NOT activeDocument — Pipeline 2
│   │                                     leaves an SVG in front); auto-discovers {base}_{regular,irregular}_nested.svg
│   │                                     + {base}_elements/ by STATting the convention names (Folder.getFiles can't
│   │                                     enumerate some macOS dirs); manual dialog fallback. Re-run safe: cutline
│   │                                     transforms target absolute SVG positions (converge); placed art cleared on entry.
│   │                                                   (stop: artist reviews layout for any unmatched elements)
│   ├── AI_RefineCutlines.jsx       ← Steps 8a Simplify → 8b Caption Normalise (stop: artist pencil refinements)
│   ├── AI_ExportFinal.jsx          ← Spacing+Margin QA guard (re-runs Step 8c's idempotent check) → 9A → 10 (Asset Export) → 11 (Final File)
│   │                                  (Step 9B temporarily removed; peeling tab stays in workflow but pipeline placement TBD)
│   └── AI_LayoutQA.jsx             ← independent, re-runnable layout QA: Step 8c Spacing+Margin + StepQA_NestingQuality (NQI).
│                                       Run on demand anytime between nesting and pencil (the artist loops nest ⇄ pencil); mutates
│                                       nothing structural. Spacing/margin is the export gate; NQI is advisory. (Replaces AI_NestingQA.)
├── tests/integration/
└── docs/
```

**There are two kinds of files — they have different rules:**

### Pipeline scripts (pipelines/*.jsx)
The only files artists run. These own CONFIG and main().
- Must have `#target photoshop` or `#target illustrator` at top
- Must have a `CONFIG` object with all tuneable values, including `dryRun`, `suppressAlerts`, `logPath`
- Must have `main()` with validation, history snapshots, and try/catch per phase
- `#include` utils first, then step files, then define CONFIG, then main()

```javascript
#target photoshop
#include "../utils/psUtils.jsx"
#include "../photoshop/Step1_CombineElements.jsx"
#include "../photoshop/Step2A_AutoResize.jsx"

var CONFIG = { dryRun: false, ... };
var _root = $.fileName ? new File($.fileName).parent.parent.fsName : Folder.desktop.fsName;
CONFIG.logPath = _root + "/pipelines/PipelineName.log";
// Asset paths (if needed): CONFIG.someAssetPath = _root + "/assets/SomeFile.ai";

function main() { ... }
main();
```

### Step files (photoshop/*.jsx, illustrator/*.jsx)
Contain one phase function each. No `#target`, no `CONFIG`, no `main()`.
- Export exactly one named function: `runCombine()`, `runResize()`, `runCaption()`, etc.
- All functions assume `CONFIG` and utils are already in scope (provided by the pipeline)
- Log prefix must be `[stepN]` e.g. `log("[step1] placed | " + name)`

### Shared utils (utils/*.jsx)
Contain all functions shared across steps. No `#target`, no `CONFIG`, no `main()`.
- psUtils.jsx: NAME_REGEX, parseLayerName, getTargetPx, needsCaption, longestEdge,
  scalePercent, isCaptionPlate, findLayerByName, findTextLayerByDisplayName,
  solidBlack, solidWhite, selectLayerById, addLayerToSelectionById,
  log, scriptAlert, isValidTemplate, clearElementLayers,
  convertToSmartObject, resizeLayerToTarget, loadLayerTransparency
- aiUtils.jsx: NAME_REGEX, parseLayerName, mmToPoints, boundsCenter, isCaption,
  blackCmyk, whiteCmyk, redCmyk, setStrokeStyle, strokeRecursive,
  buildPlate, buildCapsuleFromSpine, deriveCutline, assembleElementGroup,
  findGroupMember, reuniteCutline, rebuildPlateToHeight,
  rdpSimplify, simplifyPathItem,
  samplePathToPolygons, pointInPolygon, segmentsIntersect,
  polygonsOverlap, boundsWithin, minPolygonSetDistance,
  parseNote, getOrCreateHalfcutLayer, drawHalfcutLine,
  buildWorkingDocument (builds A4/CMYK doc + Margin/Stickers/Grid/Color Block layers, no template),
  marginRect (shared safe-area rect: documented 190×267mm working area),
  log, scriptAlert, findLayer, findPathInLayer

---

## Element naming convention (Photoshop layer groups)
Format: `[Display Name] [STYLE-CAT]`
Examples: `Horseshoe Bend [WC-LM]`, `Key Lime Pie [WC-FD]`, `Orlando Stamp [ST]`
Parsing regex (ES3): /^(.+)\s\[([A-Z]+)(?:-([A-Z]+))?\]$/
  Group 1 = display name (= caption text)
  Group 2 = style code: WC / GC / ST
  Group 3 = category code: TL / LM / MP / TR / IC / FD

Category resize targets:
  TL: 3 in / 900px | LM: 2.3 in / 690px | MP: 1.8–2 in / ~570px
  TR: 1.8–2 in / ~570px | IC: 1.8 in / 540px | FD: 1.5–2 in / ~525px | ST: 1.5 in / 450px

## Photoshop layer stack — state handed off to Illustrator (after Step 5)
The saved PSD has exactly one meaningful top-level layer after Step 5:
  Elements           ← LayerSet containing all [Display Name] [STYLE-CAT] element groups

The silhouette is NOT a saved layer. It is built transiently at export time by
createSilhouetteLayer() (in Step5_Silhouette.jsx), exported to {name}_silhouette.png by
exportSilhouettePng(), then removed — the working PSD is never polluted with a black raster.
Step 5's runSilhouette() phase only finalizes the Elements group (folds in any stray element
layers Step 3B skipped).

Silhouette implementation note: before loading transparency, createSilhouetteLayer hides
caption sub-layers (TEXT, "White" pill, "Caption plate") so the silhouette covers element
art only. This is intentional — Step 6 rebuilds the caption and unites it with the traced
element outline into a fused cutline (art + caption). WC: the real curved/tilted capsule,
rebuilt from the White-pill spine+radius carried in the sidecar (buildCapsuleFromSpine), so
the cutline follows the actual caption. GC: an axis-aligned parametric pill (buildPlate).
Deepnest still receives the full sticker outline. To avoid the
PS 2026 full-canvas-selection bug when loading a LayerSet's transparency, it duplicates +
merges the Elements group to a flat ArtLayer and loads that layer's transparency.

PSAI_BuildAndExportCutlines exports (written before BridgeTalk handoff, sibling to PSD):
  {name}_silhouette.png   ← element-art-only flat black PNG (captions excluded; Step 6 adds them back)
  {name}_elements.json    ← JSON sidecar (json2.jsx polyfill; ExtendScript has no native
                            JSON). Shape:
                              { psdWidth, psdHeight, elements: [
                                  { displayName, styleCode, left, top, right, bottom,
                                    caption: null | { lines, left, top, right, bottom,
                                                      radius?, spine?: [{x,y}, …] } } ] }
                            caption is null for stamps/uncaptioned. radius + spine are
                            present only for WC captions: the fitted White-pill capsule
                            (px). Step 6 rebuilds the real curved/tilted caption capsule
                            from them, so the cutline follows the caption; GC/stamps omit
                            radius+spine → GC uses the parametric pill. PSAI always runs
                            Step 3B in-session, so every WC caption carries a spine (Step 6
                            relies on this). JSON (vs the old pipe-delimited text) prevents
                            delimiter collisions with caption display names.
  {name}_elements/        ← per-element trimmed PNGs (one per element group, transparent background)
                            used by AI_ImportNesting / Step7B to populate the Stickers layer after Deepnest

## Illustrator layer names (exact strings except where noted)
Exceptions (case-insensitive search, consistent standard):
- **Halfcut layer**: Steps 9A/9B search case-insensitively via `getOrCreateHalfcutLayer()` in aiUtils (seen as "Half cut", "Halfcut", "halfcut lines"); creates as "Halfcut" if absent. Step 11 standardises to `"Halfcut/Peeling Tab"` when saving the final file.
- **Stickers layer**: `"Sticker"` (singular) everywhere. Built in code by `buildWorkingDocument` and found by exact `findLayer(doc, CONFIG.stickersLayerName)` — all pipeline CONFIGs use the same name, so no case-insensitive/plural fallback (the doc is always code-built, never from a template, so there's no naming variety to tolerate).
- **Asset layer**: NOT created by the automated pipeline. Step 10 builds temporary clip groups per-export and discards them — the working file stays clean. (The manual workflow created a persistent Asset layer; the script does not.)
Working file stack: Margin > Offset Path > Halfcut > Cutlines > Stickers > Grid > Color Block
Final file stack: Cutlines > Halfcut/Peeling Tab > Stickers

Step 8c does **pure-geometry QA** — no Offset Path layer is created. It measures
inter-cutline distance directly (< 2mm → fail) and checks cut-line bounds against
the safe area returned by `marginRect(doc)` (aiUtils) — the documented 190×267mm
working area (A4 minus 10mm top/left/right + 20mm bottom). No script reads or
writes an Offset Path layer.

Cut lines are **never recoloured in place** — every QA visual goes on one shared,
toggleable overlay layer, `"Layout QA"` (CONFIG.qaLayerName), so the real cut lines
stay pristine 0.25pt black and the artist shows/hides all QA at once. Flags are
**colour-coded by problem type**: SPACING pinches are **red** (an echo of each
offending outline + a connector and dots across the sub-2mm gap — it's a point
between two stickers); MARGIN overflow is **amber** (an outline echo + a filled
overhang sliver beyond the safe line, clipped via `clipPolygonToHalfPlane` — it's an
area, showing how far over and which way to pull in). The same `"Layout QA"` layer
also carries StepQA's NQI pocket fills (Step 8c runs first and resets the layer;
StepQA appends). Step 11 strips `"layout qa"` by name, so QA never reaches print.

The **Margin** band layer IS created — by `buildWorkingDocument()` (aiUtils): a
30%-black even-odd compound path (outer = artboard, inner = safe area), locked, on
top. The inner rectangle is the single boundary shared by `marginRect()`: nesting
placement (Step 7B aligns the regular/irregular clusters to the margin top-left, not
the artboard), Step 8c margin QA, and the Nesting QA score (StepQA masks everything
outside the margin and scores NQI/utilization against the printable area only).

StepQA pocket detection: occupancy = union of all Cutlines paths (recurse groups AND
sublayers) dilated by the 2mm spacing; free cells → connected pockets. A pocket is
"recoverable" (reduces NQI) when its **AREA ≥ `pocketMinAreaMm2`** (default 90mm² —
the single tuning knob; measured after the spacing band is removed, so it's genuinely
extra space). Each pocket's largest-inscribed-circle radius is still computed via a
chamfer (near-Euclidean, ortho=1/diag=√2) distance transform and logged as a shape
reference, but it is NOT the gate. Review overlay fills the exact free cells of each
flagged pocket (semi-transparent red) using greedy maximal-rectangle tiling — a few
big boxes per pocket, not one strip per row, so it draws fast (~27s, not 2min+).

## Cutline structure (set by Step 6 script)
Each non-stamp element is a GroupItem named `[Display Name]` in the Cutlines layer:
  [Display Name]          ← visible fused cutline path = Unite(element_outline, plate)
  [Display Name] outline  ← element-art-only trace (hidden; separable component)
  [Display Name] plate    ← caption pill (hidden; separable component). WC: the real
                            curved/tilted capsule rebuilt from the PS spine+radius (sidecar
                            suffix) so the cutline follows the caption. GC: axis-aligned
                            parametric pill (buildPlate).

The cutline is still one closed contour per sticker (nesting requires this). The components
are kept separable so caption normalization in Steps 8a/8b is a re-Unite, not path surgery.
Stamp elements (ST): traced silhouette path named `[Display Name]` (PathItem, no group). Stamp cutline design approach TBD — `assets/Stamp Cutline Template.ai` is committed but not currently placed by any script.

GroupItem.note carries caption metadata (set by Step 6, survives the Deepnest gap):
  Format: "{styleCode}|{capLines}"  e.g. "GC|2"
  Step 8b reads this to know plate spec (0.5cm / 0.8cm). Missing note → Step 8b skips (logs warn).
  Step 9A reads this to select GC/WC elements (half-cut at plate junction); Step 9B reads this to skip GC/WC and process ST/missing (tab asset).
  Step 10 reads this for PNG tab hiding: GC/WC → export directly (no tab on cutline); ST/null → check for compound sub-path tab to hide.

## Key confirmed values
Cut line stroke: 0.25pt black, no fill
Half-cut stroke: 0.25pt black, no fill (same weight as cut lines)
Minimum spacing between elements: 2mm (checked by Step 8c via direct distance measurement)
QA stroke colour: #ff0000
Working area: 19 × 26.7 cm (A4 minus margins)
Grid: 1 square = 1 inch = 2.5 cm
Caption font: Kalam Regular, 8pt, tracking -20

Half-cut functional requirement: the caption plate acts as a peeling tab — the artist grabs
the caption and peels the element off the backing as a separate flake sticker. The half-cut
must connect exactly to the outer cutline at both endpoints (where the Unite boundary
transitions from element art to plate edge) so both pieces have clean edges when separated.
Step 9A uses bezier ray intersection (_cutlineCrossingsAtY, coarse scan + bisection)
to find these exact crossing points — not a bounding-box approximation.

---

## Script structure conventions

### Pipeline script pattern (the only one with main())

```javascript
#target photoshop
#include "../utils/psUtils.jsx"
#include "../photoshop/StepN_Name.jsx"

var CONFIG = {
    dryRun:           false,
    templateWidthCm:  42,
    templateDPI:      300,
    sourceFolderPath: "",        // testing only — leave empty for interactive use
    suppressAlerts:   false,     // testing only — suppresses alert() dialogs
    logPath:          ""         // resolved below
};
var _root = $.fileName
    ? new File($.fileName).parent.parent.fsName
    : Folder.desktop.fsName;
CONFIG.logPath = _root + "/pipelines/PipelineName.log";
// Asset paths resolve automatically — no manual config needed:
// CONFIG.someAssetPath = _root + "/assets/SomeFile.ai";

function main() {
    // 1. Validate document
    // 2. Init log
    // 3. Resolve source folder (dialog or CONFIG.sourceFolderPath)
    // 4. Per phase: take snapshot → call step function → catch + rollback on error
    // 5. Completion alert
}
main();
```

### Step file pattern (phase function only)

```javascript
// StepN_Name.jsx — Phase function only.
// #included by pipeline scripts. Requires: psUtils.jsx (or aiUtils.jsx), CONFIG in scope.

function runStepN(doc /*, other args */) {
    // ... work ...
    log("[stepN] resized | " + layer.name + " -> " + targetPx + "px");
    return { /* result summary */ };
}
```

### dryRun flag — every step function must support it

```javascript
if (CONFIG.dryRun) {
    log("[stepN] [DRY RUN] would place | " + name);
} else {
    doWork();
}
```

### History snapshots — one per phase in the pipeline, not in step files

```javascript
var snapshotA = doc.activeHistoryState;
try {
    combineResult = runCombine(doc, folder);
} catch (e) {
    doc.activeHistoryState = snapshotA;
    log("[pipeline] ERROR | step 1 line " + e.line + ": " + e.message);
    scriptAlert("ERROR in Step 1.\n" + e.message + "\nLog: " + CONFIG.logPath);
    return;
}
```

### BridgeTalk handoff (PS → AI) — used at end of PSAI_BuildAndExportCutlines.jsx

Before sending, PSAI_BuildAndExportCutlines exports two sidecar files next to the PSD:
- `{name}_silhouette.png` — element-art-only flat black PNG (captions excluded)
- `{name}_elements.json`  — JSON: `{ psdWidth, psdHeight, elements: [{ displayName, styleCode, left, top, right, bottom, caption }] }`, where `caption` is `null` or `{ lines, left, top, right, bottom, radius?, spine? }` (WC captions carry `radius`+`spine` = real capsule geometry; see the layer-stack section). Uses the json2.jsx polyfill.

Then sends both sidecar paths to AI_BuildCutlines.jsx via BridgeTalk. No template
file is passed — the AI side builds its own working document (see below).

```javascript
// In PSAI_BuildAndExportCutlines.jsx — paths are auto-resolved from _root ($.fileName):
// CONFIG.aiPipelinePath = _root + "/pipelines/AI_BuildCutlines.jsx";
// CONFIG.bridgeTalkTimeout = 20;  // seconds

function handOffToIllustrator(doc) {
    var silhPngPath  = exportSilhouettePng(doc);   // → {name}_silhouette.png
    var elementsPath = writeElementsFile(doc);     // → {name}_elements.json
    function esc(p) { return p.replace(/\\/g, "/").replace(/"/g, '\\"'); }
    var aiStatus = null;
    var bt = new BridgeTalk();
    bt.target = "illustrator";
    // Set the handoff flag first so AI_BuildCutlines' bottom dispatch does NOT auto-run
    // its direct-run main(); end the body with buildDocAndImport(...) so its returned
    // JSON status string is this message's result.
    bt.body = '$.global.__aiBuildCutlinesHandoff = true;'
        + '$.evalFile(new File("' + esc(CONFIG.aiPipelinePath) + '"));'
        + 'buildDocAndImport("' + esc(silhPngPath) + '","' + esc(elementsPath) + '");';
    bt.onResult = function(m) { aiStatus = m.body; };   // JSON status from the AI half
    bt.send(CONFIG.bridgeTalkTimeout);
    return aiStatus ? JSON.parse(aiStatus) : null;      // main() reports the real outcome
}

// In AI_BuildCutlines.jsx — entry point called by BridgeTalk (runs Steps 6 + 7A).
// Returns a JSON status string (parsed by PSAI's onResult) so the PS-side completion
// alert reflects the real Illustrator outcome instead of always saying "Done".
function buildDocAndImport(silhPngPath, elementsFilePath) {
    var doc = buildWorkingDocument();   // aiUtils — builds A4/CMYK doc + layers, no template
    var result = runCreateCutlines(doc, silhPngPath, elementsFilePath);
    // Saves the working doc next to the sidecar (so Step 7A's doc.fullName resolves),
    // then: halts if result.unmatched > 0 (artist renames paths, re-runs directly);
    // else continues automatically to runDeepnestExport(doc). Returns _status(...) JSON.
}
// Dispatch (bottom of file): one-shot read-and-clear of $.global.__aiBuildCutlinesHandoff
// decides whether to auto-run main() (direct double-click re-run) or stay quiet (handoff).
```

**The AI pipeline has no template-file dependency.** `buildWorkingDocument()` in
aiUtils.jsx creates the working document from scratch — A4 (210×297mm) CMYK, with
layers (top→bottom) Margin (30%-black even-odd band, outer=artboard + inner=safe
area, locked) > Stickers (empty) > Grid (vector 1-inch lines, locked) >
Color Block (full-sheet rect, fill CMYK(55,0,100,0), locked). Cutlines/Halfcut are
added later by their steps, above Stickers. `assets/Production_File_Template.ai` is
no longer used.

### Defensive guards — validate every assumption before acting

```javascript
if (!layer || !layer.name) {
    log("[stepN] SKIP | unnamed layer at index " + i);
    continue;
}
```

### Log format — prefix every line with [stepN] or [pipeline]

```
[pipeline] === PS_BuildElements start ===
[step1] found | 3 PSD file(s)
[step1] placed | Horseshoe Bend [WC-LM] from source.psd -> resize to 690px
[step2] resized | Horseshoe Bend [WC-LM] -> 690px
[step2] SKIP | Orlando Stamp [ST] — zero bounds
[pipeline] === PS_BuildElements done ===
```

---

## Testing conventions
See docs/testing.md for full details.
When scaffolding any new step, always create the corresponding integration
test runner in tests/integration/ alongside it.

Photoshop integration test fixtures:
  tests/integration/fixtures/source-psds/              ← source PSDs for combine tests (≥1 required)
  PS_BuildElements creates its own template document — no pre-opened PSD needed.
  tests/integration/fixtures/elements-captioned-ungrouped.psd  ← output of PS_BuildElements
    (SO + T layers, ungrouped); input for run-psai-build-export-cutlines.sh

run-psai-build-export-cutlines.sh is a COMBINED two-phase end-to-end runner: Phase 1 drives
Photoshop (PSAI → real {name}_silhouette.png + {name}_elements.json sidecars in /tmp); Phase 2
drives Illustrator through the real buildDocAndImport handoff (Steps 6+7A) and asserts cutlines
(unmatched=0) + both SVGs on disk. Up-front clean slate: closes all docs in BOTH apps + clears
stale /tmp artifacts at the START (not on exit), leaving outputs open for inspection. Requires
both Adobe apps. The standalone AI-only test (run-ai-build-cutlines.sh) was removed 2026-06-05.

Test runners are named after the pipeline they test (e.g. run-ps-build-elements.sh, run-ai-refine-cutlines.sh).
They patch CONFIG via perl injection (sourceFolderPath + suppressAlerts + absolute #include paths)
and run the pipeline script, not individual step files.

---

## Photoshop API patterns (non-obvious)
Move layer below:   layer.move(targetLayer, ElementPlacement.PLACEAFTER)
Convert to SO:      executeAction(stringIDToTypeID("newPlacedLayer"), new ActionDescriptor(), DialogModes.NO)
Group layers:       executeAction(stringIDToTypeID("groupLayersEvent"), desc, DialogModes.NO)
Suppress dialogs:   app.playbackDisplayDialogs = DialogModes.NO (restore to DialogModes.ERROR after)
Load transparency:  putEnumerated("Chnl","Chnl","Trsp") form — the compound putProperty+putEnumerated form stopped working in PS 2026
Live collection:    doc.layers re-indexes when layers are resized/added — always snapshot refs into an array before iterating if you modify layers in the loop

## Shared asset paths (committed to repo — no config needed)
assets/Stamp Cutline Template.ai
assets/Peeling Tab Asset.ai
All paths resolve via: _root + "/assets/FileName.ai" where _root = new File($.fileName).parent.parent.fsName

Note: the AI working document is built in code by `buildWorkingDocument()` (aiUtils.jsx).
The old `Production_File_Template.ai` is no longer used and has been removed from the repo.

## Per-SKU source folder convention
The source folder passed to PS_BuildElements may contain an optional file:
  Caption_Plate.psd  ← GC-LM SKUs only; omit for WC-only SKUs
Step 1 imports it automatically if present. It must contain the Caption plate
artwork as the top-level group (L/C/R sub-layers), which Step 3B elongates per element.

## Final file naming
[STK_CODE]_final.ai — parse STK code as everything before first space in working filename

## Notion references
Manual playbook (source of truth for what each step does):
  https://www.notion.so/2c60fc586739806cbf25ec60a90416be

Automation project page (ROI estimates, phasing, time breakdowns):
  https://www.notion.so/36d0fc586739811084f9f96b0820447a

Playbook step → script step mapping:
  Playbook 1 (White Edge + SO)   → Step 2B_WhiteEdge
  Playbook 2 (Resize + Caption)  → Step 2A + Step 3A + Step 3B
  Playbook 3 (Silhouette)        → Step 5_Silhouette
  Playbook 4 (Cut Lines)         → Step 6_CreateCutlines (Illustrator)

## Spec pages (read before building each script)
Step 1:     docs/step1-combine.md
Step 2:     docs/step2-auto-resize.md
Step 3:     docs/step3-auto-caption.md
Step 4:     docs/step4-white-edge.md
Step 5:     docs/step5-silhouette.md
Step 6:     docs/step6-cut-lines.md
Step 7A:    docs/step7a-deepnest-export.md
Step 8a:    docs/step8a-simplify.md
Step 8b:    docs/step8b-caption-normalise.md
Step 8c:    docs/step8c-offset-path-qa.md
Step 9A:    https://www.notion.so/36e0fc58673981af80e9f007b3b7d064 (Notion — half-cut lines for GC/WC elements)
Step 9B:    https://www.notion.so/3720fc58673981599039d3243dbf2cd6 (Notion — peeling tab for stamps/unnamed elements)
Step 10+11: https://www.notion.so/36d0fc58673981c1a808e6ee74384aca (Notion — asset export + final file)
