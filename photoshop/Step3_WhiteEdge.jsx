// Step3_WhiteEdge.jsx — Phase function only.
// #included by PS_ToCaption.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Adds a white edge to every element Smart Object in the Resize Area Template.
// Runs after Step 2 (resize), before Step 3A (caption text), so the artist
// sees the final element — with white edge — when reviewing caption positions.
//
// For each top-level SO that matches the element naming convention, the script:
//   1. Sets it as the active layer
//   2. Runs the "White Base_Cutline" action from the "Cutline" action set
//      (creates a pixel layer named "White Base_Cutline" above the SO)
//   3. Moves that layer to just below the SO
//
// Prerequisites: Action file White edges.atn must be loaded in Photoshop.
//
// CONFIG values used:
//   actionSet:          "Cutline"           — action set name
//   actionName:         "White Base_Cutline" — action name within set
//   whiteEdgeLayerName: "White Base_Cutline" — exact name of the created layer
//
// Returns: { processed, skipped[] }

function runWhiteEdge(doc) {
    var processed = 0;
    var skipped   = [];

    // Suppress dialogs fired by the action (e.g. "Move command not available").
    // Always restore, even on error.
    var origDialogs = app.playbackDisplayDialogs;
    app.playbackDisplayDialogs = DialogModes.NO;

    try {
        // First pass: collect layer names to avoid index-shift as WBC layers are added.
        var layerNames = [];
        for (var i = 0; i < doc.layers.length; i++) {
            layerNames.push(doc.layers[i].name);
        }

        for (var i = 0; i < layerNames.length; i++) {
            var name = layerNames[i];

            if (name === CONFIG.skipLayerName) continue;

            var parsed = parseLayerName(name);
            if (!parsed) {
                log("[step3] SKIP | \"" + name + "\" — no [STYLE-CAT] code.");
                skipped.push(name + " (no code)");
                continue;
            }

            // Re-find by name — earlier WBC insertions shift indices.
            var soLayer = findLayerByName(doc, name);
            if (!soLayer) {
                log("[step3] SKIP | \"" + name + "\" — layer not found.");
                skipped.push(name + " (not found)");
                continue;
            }

            if (CONFIG.dryRun) {
                log("[step3] [DRY RUN] would add white edge | " + name);
                processed++;
                continue;
            }

            try {
                applyWhiteEdge(doc, soLayer);
                log("[step3] white edge | " + name);
                processed++;
            } catch (e) {
                log("[step3] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                skipped.push(name + " (error: " + e.message + ")");
            }
        }

    } finally {
        app.playbackDisplayDialogs = origDialogs;
    }

    return { processed: processed, skipped: skipped };
}

// Runs the white edge action on soLayer and moves the resulting White Base_Cutline
// layer to just below soLayer in the document layer stack.
function applyWhiteEdge(doc, soLayer) {
    doc.activeLayer = soLayer;

    app.doAction(CONFIG.actionName, CONFIG.actionSet);

    // The action creates a layer named CONFIG.whiteEdgeLayerName above the active layer.
    // doc.activeLayer is typically set to the new layer after the action runs;
    // fall back to a name-based search if not.
    var wbcLayer = null;
    if (doc.activeLayer && doc.activeLayer.name === CONFIG.whiteEdgeLayerName) {
        wbcLayer = doc.activeLayer;
    } else {
        // Fallback: find the first top-level layer with the expected name.
        // Risk: could find a WBC from a previous element if the action didn't
        // make the new layer active. Log a warning so this is visible.
        wbcLayer = findLayerByName(doc, CONFIG.whiteEdgeLayerName);
        if (wbcLayer) {
            log("[step3] WARN | \"" + soLayer.name
                + "\" — action did not set activeLayer; found WBC by name (may be wrong layer).");
        }
    }

    if (!wbcLayer) {
        throw new Error("\"" + CONFIG.whiteEdgeLayerName
            + "\" not found after running action on \"" + soLayer.name + "\". "
            + "Ensure White edges.atn is loaded and the action set is named \""
            + CONFIG.actionSet + "\".");
    }

    // Move WBC to just below the SO in the layer panel.
    wbcLayer.move(soLayer, ElementPlacement.PLACEAFTER);
}
