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
│   ├── Step2_AutoResize.jsx
│   ├── Step3_AutoCaption.jsx
│   ├── Step4_WhiteEdge.jsx
│   └── Step5_Silhouette.jsx
├── illustrator/
│   ├── Step6_CreateCutlines.jsx
│   ├── Step8a_SimplifyCutlines.jsx
│   ├── Step8b_OffsetPathQA.jsx
│   ├── Step9_PeelingTabHalfcut.jsx
│   └── Step10_AssetExportFinalFile.jsx
├── pipelines/
│   ├── PS_ToCaption.jsx        ← Steps 1 → 2 → 3      (stop: artist reviews captions)
│   ├── PS_AfterCaption.jsx     ← Steps 4 → 5 → BridgeTalk → AI Step 6
│   │                                                   (stop: artist does Deepnest manually)
│   ├── AI_AfterDeepnest.jsx    ← Step 8a Simplify      (stop: artist pencil refinements)
│   └── AI_AfterPencil.jsx      ← Steps 8b → 9 → 10    (done)
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
#include "../photoshop/Step2_AutoResize.jsx"

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
  scalePercent, log, scriptAlert, isValidTemplate, clearNonGuideLayers,
  convertToSmartObject, resizeLayerToTarget
- aiUtils.jsx: NAME_REGEX, parseLayerName, mmToPoints, boundsCenter, isCaption,
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

## Illustrator layer names (exact strings, no case-insensitive fallback needed)
Working file stack: Asset > Margin > Offset Path > Halfcut > Cutlines > Stickers > Grid > Color Block
Final file stack: Cutlines > Halfcut/Peeling Tab > Stickers

## Cutline path names (set by Step 6 script)
Main element: `[Display Name]`  e.g. `Horseshoe Bend`
Caption:       `[Display Name] caption`  e.g. `Horseshoe Bend caption`
Caption detection: path.name.match(/ caption$/)

## Key confirmed values
Cut line stroke: 0.25pt black, no fill
Offset path: 1mm exactly, Joins: Miter, Miter limit: 4
QA stroke colour: #ff0000
Working area: 19 × 26.7 cm (A4 minus margins)
Grid: 1 square = 1 inch = 2.5 cm
Caption font: Kalam Regular, 16pt, tracking -20

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

PS_AfterCaption knows the output PSD path after Step 5 saves it.
It sends that path + the AI template path to Illustrator via BridgeTalk.
The AI pipeline's `openTemplateAndImport()` function receives both and proceeds.

```javascript
// In PS_AfterCaption.jsx CONFIG:
// aiTemplatePath: "/path/to/Production_File_Template.ai"  // ⚠️ CONFIRM location
// bridgeTalkTimeout: 20  // seconds

function handOffToIllustrator(psdPath) {
    var bt = new BridgeTalk();
    bt.target = "illustrator";
    bt.body = 'openTemplateAndImport("'
        + CONFIG.aiTemplatePath.replace(/\\/g, "/") + '","'
        + psdPath.replace(/\\/g, "/") + '");';
    bt.onError = function(e) { log("[pipeline] BridgeTalk error: " + e.body); };
    bt.send(CONFIG.bridgeTalkTimeout);
    log("[pipeline] BridgeTalk: handed off to Illustrator.");
}

// In AI_AfterDeepnest.jsx / AI pipeline entry point:
function openTemplateAndImport(templatePath, psdPath) {
    var doc = app.open(new File(templatePath));
    placePsd(doc, psdPath);  // implemented in Step6_CreateCutlines.jsx
    log("[ai-pipeline] template opened, PSD placed: " + psdPath);
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

## Spec pages (read before building each script)
Step 1:     docs/step1-combine.md
Step 2:     docs/step2-auto-resize.md
Step 3:     docs/step3-auto-caption.md
Step 4:     docs/step4-white-edge.md
Step 5:     docs/step5-silhouette.md
Step 6:     docs/step6-cut-lines.md
Step 8a:    docs/step8a-simplify.md
Step 8b:    docs/step8b-offset-path-qa.md
Step 9:     docs/step9-peeling-tab.md
Step 10:    docs/step10-asset-export-final-file.md
