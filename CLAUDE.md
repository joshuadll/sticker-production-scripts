# Sticker Production Scripts — Claude Code Context

## Language and target
All scripts are ExtendScript (ES3). No let/const, no arrow functions, no template literals.
Always include `#target photoshop` or `#target illustrator` at top of file.
Always wrap main() in try/catch that alerts error with line number.
Put all tuneable values in a CONFIG object at the top of every file.

## Average SKU
27 elements per SKU. 1–5 working PSD files per SKU.

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

## Cutline path names (set by Step 4 script)
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

## Script structure conventions
Every script must follow this pattern — no exceptions:

1. `CONFIG` object at top with all tuneable values, including `dryRun: false`
2. Pure helper functions (no Adobe API calls — logic only, easy to reason about)
3. DOM helper functions (thin wrappers around Adobe API calls)
4. `log(msg)` function that writes to both `$.writeln` and `CONFIG.logPath` file
5. `main()` wrapped in try/catch with history snapshot + undo on failure

**dryRun flag** — every script must support it. When true, log what would happen without touching any layer or file.
```javascript
if (CONFIG.dryRun) {
    log("Would resize: " + layer.name + " to " + targetPx + "px");
} else {
    resizeLayer(layer, targetPx);
}
```

**History snapshot + undo on catch** — wrap all destructive work:
```javascript
var snapshot = doc.activeHistoryState;
try {
    doWork();
} catch (e) {
    doc.activeHistoryState = snapshot;
    alert("Error on line " + e.line + ": " + e.message);
}
```

**File logger** — always included, never rely solely on $.writeln:
```javascript
function log(msg) {
    $.writeln(msg);
    var f = new File(CONFIG.logPath);
    f.open("a");
    f.writeln(msg);
    f.close();
}
```

**Defensive guards** — validate every assumption before acting. Include the layer name and what was expected in the error message:
```javascript
if (!layer || !layer.name) {
    log("SKIP: expected named layer at index " + i + ", got null");
    continue;
}
```

**Pure vs DOM separation** — keep logic functions free of Adobe API calls so they can be reasoned about independently:
```javascript
// Pure — no Adobe API, contains only logic
function parseLayerName(name) { ... }
function getTargetPx(categoryCode) { ... }

// DOM — thin, contains only Adobe API calls
function resizeLayer(layer, targetPx) { ... }
```

## Testing conventions
See docs/testing.md for full details.
When scaffolding any new step script, always create the corresponding integration
test runner in tests/integration/ alongside it. See docs/testing.md for the
exact file structure and shell runner pattern.

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

## Spec pages (read these when building each script)
Step 1:     docs/step1-white-edge.md
Step 2a:    docs/step2a-auto-resize.md
Step 2b:    docs/step2b-auto-caption.md
Step 3:     docs/step3-silhouette.md
Step 4:     docs/step4-cut-lines.md
Step 6:     docs/step6-offset-path-qa.md
Step 7:     docs/step7-peeling-tab.md
Steps 8-9:  docs/steps8-9-asset-export.md
