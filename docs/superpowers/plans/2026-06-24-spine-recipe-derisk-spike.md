# Spine-Recipe De-Risk Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the Illustrator-native cut recipe — clean silhouette (Photoshop) → Image Trace → Offset Path white edge → bake → cut — produces a smooth, organic cut comparable to today's pipeline, on ~5 varied real SKUs, and lock the recipe's tunables before any production build.

**Architecture:** Two throwaway spike scripts. A Photoshop script exports a clean black per-element silhouette PNG (the proven `loadLayerTransparency` → `smoothSelection` → `hardenSelection` recipe, minus the white-edge fill). An Illustrator script traces each silhouette, offsets it outward for the white edge, bakes the offset to geometry, and lays the traced outline + offset cut side-by-side for visual inspection. The deliverable is a findings record that resolves the open recipe decisions — it is NOT production pipeline code.

**Tech Stack:** Adobe ExtendScript (ES3) for Photoshop 2026 + Illustrator 2026; existing `utils/psUtils.jsx` and `utils/aiUtils.jsx` for proven helpers; scripts run from the app's File > Scripts (or dragged onto the app), output inspected visually on-canvas.

## Global Constraints

- ExtendScript ES3 only: no `let`/`const`, no arrow functions, no template literals.
- Each script has `#target photoshop` or `#target illustrator` at the top and wraps `main()` in try/catch that alerts the error with `e.line`.
- This is a SPIKE: scripts live in `tests/spike/`, are self-documenting throwaways, and are deleted once the recipe is locked. They reuse existing utils via `#include` but add no production code.
- ExtendScript geometry cannot be validated headlessly. Every "test" is: run in the app on real art, then walk the inspection checklist visually. No unit assertions.
- Recipe tunables (spike defaults, expected to change): silhouette smooth radius `12px` @300DPI; white-edge offset `1.69mm`; Image Trace preset `"Silhouettes"`; optional die-cut bleed `0mm` (decision 7.3).
- Element naming/parse: reuse `parseLayerName` (regex `/^(.+)\s\[([A-Z]+)(?:-([A-Z]+)([+-])?)?\]$/`).
- PNG export must use `exportDocument(..., ExportType.SAVEFORWEB, ...)` — `ExportOptionsPNG24` and `saveAs(asCopy)` are broken/dialog-blocked in PS 2026.

---

### Task 1: Photoshop per-element silhouette export spike

**Files:**
- Create: `tests/spike/ps_export_silhouette_spike.jsx`

**Interfaces:**
- Consumes: an open source PSD whose top-level layers are element art named per the convention; `utils/psUtils.jsx` helpers `parseLayerName`, `loadLayerTransparency`, `smoothSelection`, `hardenSelection`, `solidBlack`.
- Produces: `elem_NN_silhouette.png` files (flat black element shape on transparent, full-canvas so alignment is trivial) in `CONFIG.outFolder`, plus a console line `elem_NN <layer name>` mapping each file to its source element. NN is 1-based, zero-padded to 2.

- [ ] **Step 1: Write the spike script**

```javascript
// tests/spike/ps_export_silhouette_spike.jsx — THROWAWAY spike (delete after recipe lock).
// Exports a clean black silhouette PNG per element from the active source PSD, using the
// proven alpha → smooth → harden recipe (the thin-PS exporter's core), minus the white edge.
#target photoshop
#include "../../utils/psUtils.jsx"

var CONFIG = {
    smoothRadiusPx: 12,                 // SPIKE TUNABLE — blur to kill jaggedness without losing detail
    outFolder:      "~/Desktop/spine-spike"
};

function main() {
    var doc = app.activeDocument;
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var out = new Folder(CONFIG.outFolder);
    if (!out.exists) out.create();

    // Snapshot top-level layers (adding/removing layers re-indexes doc.layers mid-loop).
    var refs = [], i;
    for (i = 0; i < doc.layers.length; i++) refs.push(doc.layers[i]);

    var n = 0;
    for (i = 0; i < refs.length; i++) {
        var lyr = refs[i];
        if (!parseLayerName(lyr.name)) continue;        // only named element layers
        n++;
        var base = "elem_" + (n < 10 ? "0" : "") + n;

        // Build the silhouette: alpha → smooth → harden → fill black on a temp layer.
        loadLayerTransparency(lyr);
        smoothSelection(CONFIG.smoothRadiusPx);
        hardenSelection(doc);
        var sil = doc.artLayers.add();
        sil.name = "__sil";
        doc.selection.fill(solidBlack());
        doc.selection.deselect();

        // Isolate the black shape: hide every other layer, keep only the temp silhouette.
        var j;
        for (j = 0; j < refs.length; j++) refs[j].visible = false;
        sil.visible = true;

        exportPng(doc, out.fsName + "/" + base + "_silhouette.png");
        $.writeln(base + "  " + lyr.name);

        // Cleanup: remove temp layer, restore all visibility for the next element.
        sil.remove();
        for (j = 0; j < refs.length; j++) refs[j].visible = true;
    }

    app.preferences.rulerUnits = origUnits;
    alert("Spike: exported " + n + " silhouette(s) to\n" + out.fsName);
}

function exportPng(doc, path) {
    var opt = new ExportOptionsSaveForWeb();
    opt.format       = SaveDocumentType.PNG;
    opt.PNG8         = false;
    opt.transparency = true;
    doc.exportDocument(new File(path), ExportType.SAVEFORWEB, opt);
}

try { main(); }
catch (e) { alert("Spike error line " + e.line + ": " + e.message); }
```

- [ ] **Step 2: Run it on a real source SKU**

Open a real source PSD whose elements are named per the convention (e.g. a Slovakia source PSD). Run via File > Scripts > Browse… → `ps_export_silhouette_spike.jsx`.
Expected: an alert "Spike: exported N silhouette(s)" and `~/Desktop/spine-spike/elem_01_silhouette.png …` on disk.

- [ ] **Step 3: Inspect the silhouettes (the test)**

Open the exported PNGs. Checklist:
- Each is a single solid black shape on transparent, one element, no caption.
- Edge is smooth — no stair-step jaggedness from the watercolour alpha.
- Fine features (thin spires, peninsulas) are NOT melted away by the smooth.
If edges are jagged → raise `smoothRadiusPx`; if detail is lost → lower it. Re-run until clean. Record the value that works per SKU type.

- [ ] **Step 4: Commit**

```bash
git add tests/spike/ps_export_silhouette_spike.jsx
git commit -m "spike: PS per-element silhouette exporter (de-risk)"
```

---

### Task 2: Illustrator trace → offset → bake → cut spike

**Files:**
- Create: `tests/spike/ai_trace_offset_spike.jsx`

**Interfaces:**
- Consumes: the `elem_NN_silhouette.png` files from Task 1 in `CONFIG.inFolder`; `utils/aiUtils.jsx` helpers `mmToPoints`, `blackCmyk`, `strokeRecursive`.
- Produces: an on-canvas grid where each cell shows the traced outline (light fill) + the baked offset cut (black stroke, no fill). Visual only; nothing written to disk.

- [ ] **Step 1: Write the spike script**

```javascript
// tests/spike/ai_trace_offset_spike.jsx — THROWAWAY spike (delete after recipe lock).
// Traces each silhouette PNG, offsets outward for the white edge, bakes to geometry, and
// lays the outline + cut side-by-side for cut-quality inspection. Reuses the proven
// Step6 trace recipe + the aiUtils Offset Path effect string.
#target illustrator
#include "../../utils/aiUtils.jsx"

var CONFIG = {
    inFolder:    "~/Desktop/spine-spike",
    whiteEdgeMm: 1.69,        // SPIKE TUNABLE — white-edge offset
    bleedMm:     0.0,         // decision 7.3: >0 adds a second offset (cut = edge + bleed)
    cellMm:      60,          // layout cell size
    gapMm:       10,
    colsPerRow:  4,
    // Optional trace tuning (null = use the "Silhouettes" preset value):
    traceThreshold:     null,
    tracePathFidelity:  null,
    traceCornerFidelity:null,
    traceNoiseFidelity: null
};

function main() {
    var inF = new Folder(CONFIG.inFolder);
    var doc = app.documents.add();                 // default RGB spike doc
    var layer = doc.layers[0];
    layer.name = "spine-spike";

    var cell = mmToPoints(CONFIG.cellMm), gap = mmToPoints(CONFIG.gapMm), m = mmToPoints(10);
    var built = 0, idx = 0;

    // Loop elem_01.. by stat (Folder.getFiles is unreliable on some macOS dirs).
    while (true) {
        idx++;
        var base = "elem_" + (idx < 10 ? "0" : "") + idx;
        var sil = new File(inF.fsName + "/" + base + "_silhouette.png");
        if (!sil.exists) break;

        var col = built % CONFIG.colsPerRow, row = Math.floor(built / CONFIG.colsPerRow);
        var ox = m + col * (cell + gap);
        var oy = -(m + row * (cell + gap));        // AI y-up: rows go downward (negative)
        buildOne(doc, layer, sil, ox, oy, cell);
        built++;
    }

    app.redraw();
    alert("Spine spike: built " + built + " element(s).\nInspect each cut vs its outline.");
}

function buildOne(doc, layer, silFile, ox, oy, cell) {
    // ── 1. Trace the silhouette ──────────────────────────────────────────────
    var placed = layer.placedItems.add();
    placed.file = silFile;
    var sc = cell / Math.max(placed.width, placed.height) * 100;
    placed.resize(sc, sc);
    placed.position = [ox, oy];

    var pi = placed.trace();
    var to = pi.tracing.tracingOptions;
    to.loadFromPreset("Silhouettes");
    if (CONFIG.traceThreshold     !== null) to.threshold      = CONFIG.traceThreshold;
    if (CONFIG.tracePathFidelity  !== null) to.pathFidelity   = CONFIG.tracePathFidelity;
    if (CONFIG.traceCornerFidelity!== null) to.cornerFidelity = CONFIG.traceCornerFidelity;
    if (CONFIG.traceNoiseFidelity !== null) to.noiseFidelity  = CONFIG.traceNoiseFidelity;
    app.redraw();                                  // trace is async — force it
    var tg = pi.tracing.expandTracing();           // GroupItem of paths, replaces the PluginItem

    deselectAll(doc);
    tg.selected = true;
    app.executeMenuCommand("ungroup");

    // Collect bare paths; drop a canvas-frame path (bbox ~ the whole cell) if Image Trace made one.
    var paths = collectSelected(doc), outline = pickOutline(paths);
    if (!outline) return;

    // ── 2. White-edge offset → bake to geometry ──────────────────────────────
    var cut = outline.duplicate();
    applyOffset(doc, cut, CONFIG.whiteEdgeMm);
    cut = app.selection[0];
    if (CONFIG.bleedMm > 0) { applyOffset(doc, cut, CONFIG.bleedMm); cut = app.selection[0]; }

    // ── 3. Style for inspection: outline = light fill, cut = black stroke, no fill ──
    outline.filled = true; outline.stroked = false;
    outline.fillColor = _grey(85);
    strokeRecursive(cut, 0.5, blackCmyk());
    cut.filled = false;
}

// Applies one live Offset Path (round joins) and bakes it with expandStyle. The baked
// path is left as the sole selection. mlim=miter limit, ofst=offset pt, jntp=1 round.
function applyOffset(doc, item, mm) {
    var ofst = mmToPoints(mm);
    item.applyEffect('<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4 R ofst '
        + ofst + ' I jntp 1 "/></LiveEffect>');
    deselectAll(doc);
    item.selected = true;
    app.executeMenuCommand("expandStyle");
}

// Largest-area item = the element outline. Black-on-transparent traces with NO canvas
// frame, so no frame-drop is needed; if a frame ever appears, add an area-drop here.
function pickOutline(paths) {
    var best = null, bestA = -1, i;
    for (i = 0; i < paths.length; i++) {
        var b = paths[i].geometricBounds;          // [l,t,r,b]
        var a = Math.abs((b[2] - b[0]) * (b[1] - b[3]));
        if (a > bestA) { bestA = a; best = paths[i]; }
    }
    return best;
}

// The just-traced shapes are the current selection after ungroup (NOT the whole layer —
// prior cells' outlines/cuts also live there). Accept paths and compound paths.
function collectSelected(doc) {
    var out = [], i, s = app.selection;
    if (!s) return out;
    for (i = 0; i < s.length; i++) {
        var t = s[i].typename;
        if (t === "PathItem" || t === "CompoundPathItem") out.push(s[i]);
    }
    return out;
}

function deselectAll(doc) {
    var s = app.selection, i;
    if (!s) return;
    for (i = 0; i < s.length; i++) { try { s[i].selected = false; } catch (e) {} }
}

function _grey(pct) { var c = new GrayColor(); c.gray = pct; return c; }

try { main(); }
catch (e) { alert("Spike error line " + e.line + ": " + e.message); }
```

- [ ] **Step 2: Run it on the Task-1 output**

With `~/Desktop/spine-spike` populated by Task 1, run via File > Scripts > Browse… → `ai_trace_offset_spike.jsx`.
Expected: an alert "Spine spike: built N element(s)" and a grid of outline+cut pairs on a new document.

- [ ] **Step 3: Inspect cut quality (the test)**

Per cell, checklist:
- The black cut line is smooth and organic — no stair-steps, no boolean spikes, no nicks into the shape.
- The cut sits at a uniform ~1.69 mm outside the traced outline (the white-edge band reads even all around).
- Concave bays and thin features keep a clean offset (round joins didn't pinch or self-intersect).
- Side-by-side with today's pipeline cut for the same element: the new cut is at least as clean.
If jagged/nicked → revisit `smoothRadiusPx` (Task 1) and/or set `tracePathFidelity`/`traceNoiseFidelity`. If the band is uneven → check the offset value. Re-run until clean.

- [ ] **Step 4: Commit**

```bash
git add tests/spike/ai_trace_offset_spike.jsx
git commit -m "spike: AI trace -> offset -> bake -> cut (de-risk)"
```

---

### Task 3: Run across 5 varied SKUs + record findings

**Files:**
- Create: `docs/superpowers/specs/2026-06-24-spine-recipe-findings.md`

**Interfaces:**
- Consumes: Tasks 1 & 2 scripts; ~5 real source PSDs spanning the hard cases.
- Produces: a findings doc that resolves the recipe decisions and gates the production build.

- [ ] **Step 1: Pick 5 varied SKUs**

Choose source PSDs covering: (a) a flat-bottomed element, (b) a wispy/feathered watercolour, (c) a busy multi-element sheet, (d) a small icon (IC/ST), (e) one typical mid-size (LM/MP). List them in the findings doc.

- [ ] **Step 2: Run the recipe on each**

For each SKU: run Task 1 (note the `smoothRadiusPx` that worked), then Task 2 (note `whiteEdgeMm` and any trace tuning). Walk both inspection checklists.

- [ ] **Step 3: Compare against today's pipeline**

For each SKU, open the current pipeline's cut for the same element and compare smoothness/cleanliness side-by-side. Note any SKU where the new recipe is worse.

- [ ] **Step 4: Write the findings doc**

Record, with verdicts:
- Per-SKU result (clean / needs-tuning / fails) + screenshots if useful.
- Locked tunables: `smoothRadiusPx`, `whiteEdgeMm`, any trace fidelity overrides.
- **Decision 7.1** — does the thin-PS recipe hold across messy SKUs? (If yes → proceed to the production spine build. If a SKU fails → diagnose: tuning, or a genuine recipe gap.)
- **Decision 7.3** — is one offset (cut = white-edge boundary) right, or is a `bleedMm` second offset needed?
- **Decision 7.2** (note, for the artist) — confirm the white edge should scale with the sticker.
- Anything that should change in the slice-1 design doc.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-24-spine-recipe-findings.md
git commit -m "spike: record spine-recipe de-risk findings + locked tunables"
```

---

## Outcome

When this plan completes, the recipe is proven (or its gap is diagnosed) on real, varied art, the tunables are locked, and decisions 7.1 / 7.3 are resolved. That unblocks writing the full slice-1 production build plan (PS exporter + AI ingest) with no speculative code. If a SKU fails the recipe, the findings doc captures whether it's a tuning issue or a reason to revisit thin-PS vs. pure-AI.
