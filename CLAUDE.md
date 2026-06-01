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
│   └── aiUtils.jsx          ← shared Illustrator helpers (#included by AI pipelines)
├── photoshop/
│   ├── Step1_CombineElements.jsx
│   ├── Step2A_AutoResize.jsx
│   ├── Step2B_WhiteEdge.jsx     ← adds white edge to each SO (before caption review)
│   ├── Step3A_CaptionText.jsx   ← places T layers; artist reviews before Step 3B
│   ├── Step3B_CaptionWhite.jsx  ← adds White pill + Caption plate; groups all layers
│   └── Step5_Silhouette.jsx     ← groups elements → loads transparency → fills black (NOT clip/merge)
├── illustrator/
│   ├── Step6_CreateCutlines.jsx
│   ├── Step7A_DeepnestExport.jsx    ← classifies paths by extent ratio → exports _regular.svg + _irregular.svg
│   ├── Step8a_SimplifyCutlines.jsx     ← native RDP simplify of trace cutlines
│   ├── Step8b_CaptionNormalise.jsx      ← reset GC plate to spec → re-Unite cutline
│   ├── Step8c_OffsetPathQA.jsx         ← spacing + margin QA (pure geometry; no offset layer created)
│   ├── Step9A_Halfcut.jsx              ← GC/WC elements only: bezier ray → half-cut at plate junction
│   ├── Step9B_PeelingTab.jsx           ← stamps/unnamed: tab asset + compound path + half-cut at flat edge
│   ├── Step10_AssetExport.jsx          ← JPEG previews (white+green) + per-element PNGs; temp clip groups, no persistent Asset layer
│   ├── Step11_FinalFile.jsx            ← Save As {STK_CODE}_final.ai; strips non-production layers; renames halfcut layer
│   └── StepQA_NestingQuality.jsx       ← occupancy grid → NQI score (0-100); flags re-nest pockets
├── pipelines/
│   ├── PS_ToCaption.jsx        ← Steps 1 → 2 → 3 (white edge) → 3A (caption text)
│   │                                                   (stop: artist reviews captions)
│   ├── PS_AfterCaption.jsx     ← Steps 3B (caption white+group) → 5 → BridgeTalk → AI Step 6
│   │                                                   (stop: review cutlines, then run AI_Deepnest.jsx)
│   ├── AI_ToCutlines.jsx       ← Step 6 entry point (called by BridgeTalk from PS_AfterCaption)
│   ├── AI_Deepnest.jsx         ← Step 7A: classify cutlines → export _regular.svg + _irregular.svg for Deepnest
│   │                                                   (stop: artist runs Deepnest manually on both SVGs then continues)
│   ├── AI_AfterDeepnest.jsx    ← Steps 8a Simplify → 8b Caption Normalise (stop: artist pencil refinements)
│   ├── AI_AfterPencil.jsx      ← Steps 8c → 9A → 9B → 10 (Asset Export) → 11 (Final File)
│   │                                  (all steps built; halts after 8c if flagged > 0; 9B can be omitted if peeling tab is removed from process)
│   └── AI_NestingQA.jsx        ← runs StepQA_NestingQuality; artist runs after Deepnest to gate re-nest
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

var CONFIG = { dryRun: false, skipLayerName: "Guide", ... };
CONFIG.logPath = new File($.fileName).parent.fsName + "/PipelineName.log";

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
  log, scriptAlert, isValidTemplate, clearNonGuideLayers,
  convertToSmartObject, resizeLayerToTarget, loadLayerTransparency
- aiUtils.jsx: NAME_REGEX, parseLayerName, mmToPoints, boundsCenter, isCaption,
  blackCmyk, whiteCmyk, redCmyk, setStrokeStyle, strokeRecursive,
  buildPlate, deriveCutline, assembleElementGroup,
  findGroupMember, reuniteCutline, rebuildPlateToHeight,
  rdpSimplify, simplifyPathItem,
  samplePathToPolygons, pointInPolygon, segmentsIntersect,
  polygonsOverlap, boundsWithin, minPolygonSetDistance,
  parseNote, getOrCreateHalfcutLayer, drawHalfcutLine,
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
The PSD imported by Step 6 has exactly three top-level layers:
  Silhouette         ← flat black pixel layer (element art only — captions excluded; see note)
  Elements           ← LayerSet containing all [Display Name] [STYLE-CAT] element groups
  Guide              ← locked; excluded from grouping by CONFIG.skipLayerName

Step 5 implementation note: before loading transparency, Step 5 hides caption sub-layers
(TEXT, "White" pill, "Caption plate") so the silhouette covers element art only. This is
intentional — Step 6 rebuilds the caption parametrically and unites it with the traced
element outline, producing a fused cutline (art + caption) identical in shape to the old
single-pass trace. Deepnest still receives the full sticker outline. Visibility is restored
after the fill.

PS_AfterCaption BridgeTalk exports (written before handoff, sibling to PSD):
  {name}_silhouette.png  ← element-art-only flat black PNG (captions excluded; Step 6 adds them back)
  {name}_elements.txt    ← PSD dimensions + per element:
                           displayName|styleCode|left|top|right|bottom|capLines|capLeft|capTop|capRight|capBottom
                           (stamps write 0|0|0|0|0 for the cap fields)

## Illustrator layer names (exact strings except where noted)
Exceptions (case-insensitive search, consistent standard):
- **Halfcut layer**: Steps 9A/9B search case-insensitively via `getOrCreateHalfcutLayer()` in aiUtils (seen as "Half cut", "Halfcut", "halfcut lines"); creates as "Halfcut" if absent. Step 11 standardises to `"Halfcut/Peeling Tab"` when saving the final file.
- **Stickers layer**: Standard is `"Sticker"` (singular). Scripts search case-insensitively with a plural fallback so existing files with "Stickers" don't break.
- **Asset layer**: NOT created by the automated pipeline. Step 10 builds temporary clip groups per-export and discards them — the working file stays clean. (The manual workflow created a persistent Asset layer; the script does not.)
Working file stack: Margin > Offset Path > Halfcut > Cutlines > Stickers > Grid > Color Block
Final file stack: Cutlines > Halfcut/Peeling Tab > Stickers

Step 8c does **pure-geometry QA** — no Offset Path layer is created. It measures
inter-cutline distance directly (< 2mm → fail) and checks cut-line bounds against
the **Margin** layer rect (else computed from working area). Violations are flagged
red on the cut line. No script writes the Margin or Offset Path layers.

## Cutline structure (set by Step 6 script)
Each non-stamp element is a GroupItem named `[Display Name]` in the Cutlines layer:
  [Display Name]          ← visible fused cutline path = Unite(element_outline, plate)
  [Display Name] outline  ← element-art-only trace (hidden; separable component)
  [Display Name] plate    ← parametric caption pill (hidden; separable component)

The cutline is still one closed contour per sticker (nesting requires this). The components
are kept separable so caption normalization in Steps 8a/8b is a re-Unite, not path surgery.
Stamp elements: a placed copy of Stamp Cutline Template.ai named `[Display Name]` (no group).

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
Caption font: Kalam Regular, 16pt, tracking -20

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
    skipLayerName:    "Guide",   // CONFIRM with artist before first run
    templateWidthCm:  42,
    templateDPI:      300,
    sourceFolderPath: "",        // testing only — leave empty for interactive use
    suppressAlerts:   false,     // testing only — suppresses alert() dialogs
    logPath:          ""         // resolved below
};
CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/PipelineName.log";

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

### BridgeTalk handoff (PS → AI) — used at end of PS_AfterCaption.jsx

Before sending, PS_AfterCaption exports two sidecar files next to the PSD:
- `{name}_silhouette.png` — element-art-only flat black PNG (captions excluded)
- `{name}_elements.txt`   — PSD dimensions + `displayName|styleCode|left|top|right|bottom|capLines|capLeft|capTop|capRight|capBottom` per element

Then sends all three paths to AI_ToCutlines.jsx via BridgeTalk.

```javascript
// In PS_AfterCaption.jsx CONFIG:
// aiTemplatePath:  "/path/to/Production_File_Template.ai"  // ⚠️ CONFIRM location
// aiPipelinePath:  "/path/to/pipelines/AI_ToCutlines.jsx"  // ⚠️ CONFIRM location
// bridgeTalkTimeout: 20  // seconds

function handOffToIllustrator(doc) {
    var silhPngPath  = exportSilhouettePng(doc);   // → {name}_silhouette.png
    var elementsPath = writeElementsFile(doc);     // → {name}_elements.txt
    function esc(p) { return p.replace(/\\/g, "/").replace(/"/g, '\\"'); }
    var bt = new BridgeTalk();
    bt.target = "illustrator";
    bt.body = '$.evalFile(new File("' + esc(CONFIG.aiPipelinePath) + '"));'
        + 'openTemplateAndImport("' + esc(CONFIG.aiTemplatePath) + '","'
        + esc(silhPngPath) + '","' + esc(elementsPath) + '");';
    bt.send(CONFIG.bridgeTalkTimeout);
}

// In AI_ToCutlines.jsx — entry point called by BridgeTalk:
function openTemplateAndImport(templatePath, silhPngPath, elementsFilePath) {
    var doc = app.open(new File(templatePath));
    runCreateCutlines(doc, silhPngPath, elementsFilePath);
}
```

### Defensive guards — validate every assumption before acting

```javascript
if (!layer || !layer.name) {
    log("[stepN] SKIP | unnamed layer at index " + i);
    continue;
}
```

### Log format — prefix every line with [stepN] or [pipeline]

```
[pipeline] === PS_ToCaption start ===
[step1] found | 3 PSD file(s)
[step1] placed | Horseshoe Bend [WC-LM] from source.psd -> resize to 690px
[step2] resized | Horseshoe Bend [WC-LM] -> 690px
[step2] SKIP | Orlando Stamp [ST] — zero bounds
[pipeline] === PS_ToCaption done ===
```

---

## Testing conventions
See docs/testing.md for full details.
When scaffolding any new step, always create the corresponding integration
test runner in tests/integration/ alongside it.

The shared fixture for all Photoshop integration tests:
  tests/integration/fixtures/resize-area-template.psd  ← one file, used by all PS runners
  tests/integration/fixtures/source-psds/              ← source PSDs for combine tests

Test runners patch CONFIG via perl injection (sourceFolderPath + suppressAlerts)
and run the pipeline script, not individual step files.

---

## Photoshop API patterns (non-obvious)
Run action:         app.doAction("White Base_Cutline", "Cutline")
Move layer below:   layer.move(targetLayer, ElementPlacement.PLACEAFTER)
Convert to SO:      executeAction(stringIDToTypeID("newPlacedLayer"), new ActionDescriptor(), DialogModes.NO)
Group layers:       executeAction(stringIDToTypeID("groupLayersEvent"), desc, DialogModes.NO)
Suppress dialogs:   app.playbackDisplayDialogs = DialogModes.NO (restore to DialogModes.ERROR after)

## Shared asset paths (update CONFIG.assetsFolder if location changes)
[Team Drive]/Production Assets/Peeling Tab Asset.ai
[Team Drive]/Production Assets/Stamp Cutline Template.ai

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
