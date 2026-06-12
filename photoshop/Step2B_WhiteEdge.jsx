// Step2B_WhiteEdge.jsx — Phase function only.
// #included by PS_BuildElements.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Adds a white edge to every element Smart Object in the Resize Area Template.
// Runs after Step 2 (resize), before Step 3A (caption text), so the artist
// sees the final element — with white edge — when reviewing caption positions.
//
// For each top-level SO that matches the element naming convention, the script:
//   1. Loads the SO's transparency as a selection
//   2. Expands the selection by CONFIG.whiteEdgePx to form the border
//   3. Creates a white-filled pixel layer named "White Base_Cutline" below the SO
//
// No action file dependency — fully self-contained.
//
// CONFIG values used:
//   whiteEdgePx:             border width in pixels  ⚠️ confirm with artist
//   whiteEdgeSmoothRadiusPx: Select>Modify>Smooth radius applied to the band's
//                            outer edge before fill, so the traced cutline is
//                            clean (0 → skip smoothing)  ⚠️ tune with artist
//   whiteEdgeLayerName:      "White Base_Cutline"    — name of the created layer
//
// Returns: { processed, skipped[] }

function runWhiteEdge(doc) {
    var processed = 0;
    var skipped   = [];

    log("[step2B] smooth radius | " + CONFIG.whiteEdgeSmoothRadiusPx + "px");

    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    try {
        // Collect layer references upfront to avoid index-shift as WBC layers are added.
        var layerRefs = [];
        for (var i = 0; i < doc.layers.length; i++) {
            layerRefs.push(doc.layers[i]);
        }

        for (var i = 0; i < layerRefs.length; i++) {
            var soLayer = layerRefs[i];
            var name    = soLayer.name;

            var parsed = parseLayerName(name);
            if (!parsed) {
                log("[step2B] SKIP | \"" + name + "\" — no [STYLE-CAT] code.");
                skipped.push(name + " (no code)");
                continue;
            }

            if (CONFIG.dryRun) {
                log("[step2B] [DRY RUN] would add white edge | " + name);
                processed++;
                continue;
            }

            try {
                applyWhiteEdge(doc, soLayer);
                log("[step2B] white edge | " + name);
                processed++;
            } catch (e) {
                log("[step2B] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                skipped.push(name + " (error: " + e.message + ")");
            }
        }

    } finally {
        app.preferences.rulerUnits = origUnits;
    }

    return { processed: processed, skipped: skipped };
}

// Creates a white-filled border layer below soLayer by:
//   1. Loading the SO's transparency as a selection
//   2. Expanding by CONFIG.whiteEdgePx to form the border
//   3. Filling a new layer with white
//   4. Moving it to just below the SO
//
// Guard: if a layer named CONFIG.whiteEdgeLayerName already sits directly
// below soLayer, the step is skipped (prevents double-application on re-run).
function applyWhiteEdge(doc, soLayer) {
    // Re-run guard: skip if WBC already exists directly below this SO.
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i] === soLayer) {
            var next = (i + 1 < doc.layers.length) ? doc.layers[i + 1] : null;
            if (next && next.name === CONFIG.whiteEdgeLayerName) {
                log("[step2B] SKIP | \"" + soLayer.name
                    + "\" — White Base_Cutline already present. Skipping re-application.");
                return;
            }
            break;
        }
    }

    // Load SO's transparency as a selection (Ctrl+click equivalent, no rasterising).
    loadLayerTransparency(soLayer);

    // Expand to create border width.
    doc.selection.expand(CONFIG.whiteEdgePx);

    // Smooth the expanded band's outer edge (Select > Modify > Smooth) BEFORE
    // filling. This is the contour Step 5 silhouettes and Step 6 traces, so a
    // clean band here yields clean cutlines without any Illustrator-side RDP
    // (former Step 8a). The printed white edge and the cutline both derive from
    // this one smoothed raster, so they stay consistent. radius 0 → no-op.
    smoothSelection(CONFIG.whiteEdgeSmoothRadiusPx);

    // Create white layer, fill, deselect.
    var wbcLayer  = doc.artLayers.add();
    wbcLayer.name = CONFIG.whiteEdgeLayerName;
    doc.selection.fill(solidWhite());
    doc.selection.deselect();

    // Move to just below the SO.
    wbcLayer.move(soLayer, ElementPlacement.PLACEAFTER);
}
