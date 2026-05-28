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
