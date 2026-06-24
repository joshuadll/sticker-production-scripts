// Step3B_CaptionWhite.jsx — element-grouping phase (native-caption flow).
// #included by PS_BuildElements.jsx (Pipeline 1). Requires: psUtils.jsx, CONFIG in scope.
//
// Captions are NO LONGER authored in Photoshop — they are placed + built natively in
// Illustrator (Step 6 / Pipeline 2). This step's sole remaining job is the per-element
// GROUPING that Step 5 / export / sidecar depend on: each element's SO + its White
// Base_Cutline (white edge, from Step 2B) are grouped into a per-element LayerSet inside
// "Elements". Every element (WC/GC/ST) is grouped the same simple way, with no caption
// layers. The GC "Caption plate" artwork (imported by Step 1) is left at top level for
// Step5b to export as a PNG (AI places + scales it behind the native caption text).
//
// (The legacy caption-authoring code — White pill capsule, plate elongation, analytic
//  seat, spine carry — was removed when captions moved to Illustrator. See git history.)
//
// Returns: { grouped, skipped[], captionLess[] }  (captionLess kept for caller compatibility)

function runCaptionWhite(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var grouped = 0;
    var skipped = [];

    try {
        // Create the Elements wrapper group first so element sub-groups are built directly
        // inside it (PS 2026 restricts moving/duplicating a LayerSet into another LayerSet).
        var elementsGroup = findLayerByName(doc, "Elements");
        if (!elementsGroup) {
            elementsGroup = doc.layerSets.add();
            elementsGroup.name = "Elements";
        }

        // Snapshot refs upfront (grouping removes layers from doc.layers). Reverse order
        // (bottom-to-top) so each sub-group added to the top of Elements keeps its z-order.
        var layerRefs = [], i;
        for (i = 0; i < doc.layers.length; i++) layerRefs.push(doc.layers[i]);

        for (i = layerRefs.length - 1; i >= 0; i--) {
            var soLayer = layerRefs[i];
            var name    = soLayer.name;
            if (name === "Caption plate" || name === "Elements") continue;

            var parsed = parseLayerName(name);
            if (!parsed) continue;

            if (CONFIG.dryRun) {
                log("[step3B] [DRY RUN] would group | " + name);
                grouped++;
                continue;
            }
            try {
                groupNoCaption(doc, elementsGroup, soLayer, name);
                log("[step3B] grouped | " + name);
                grouped++;
            } catch (e) {
                log("[step3B] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                skipped.push(name + " (error: " + e.message + ")");
            }
        }
    } finally {
        app.preferences.rulerUnits = origUnits;
    }

    return { grouped: grouped, skipped: skipped, captionLess: [] };
}

// Groups an element: SO + its adjacent White Base_Cutline (white edge) into a LayerSet
// named groupName, inside elementsGroup.
function groupNoCaption(doc, elementsGroup, soLayer, groupName) {
    var wbcLayer = findAdjacentCutline(doc, soLayer);
    var layers   = wbcLayer ? [soLayer, wbcLayer] : [soLayer];
    if (!wbcLayer) {
        log("[step3B] WARN | \"" + groupName
            + "\" — no White Base_Cutline found below SO. "
            + "Ensure Step 2B (white edge) ran before this step.");
    }
    selectAndGroup(elementsGroup, layers, groupName);
}

// Creates a LayerSet (groupName) inside elementsGroup and moves the given ArtLayers into it,
// bottom-to-top with PLACEATBEGINNING to preserve z-order.
function selectAndGroup(elementsGroup, layers, groupName) {
    if (!layers || layers.length === 0) return;

    var group = elementsGroup.layerSets.add();
    group.name = groupName;

    for (var i = layers.length - 1; i >= 0; i--) {
        layers[i].move(group, ElementPlacement.PLACEATBEGINNING);
    }
}

// Finds the White Base_Cutline layer immediately below soLayer in the stack.
// Step 2B (white edge) always places it at soIndex + 1. Returns null if not found.
function findAdjacentCutline(doc, soLayer) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i] === soLayer) {
            var next = (i + 1 < doc.layers.length) ? doc.layers[i + 1] : null;
            if (next && next.name === CONFIG.whiteEdgeLayerName) {
                return next;
            }
            return null; // next layer exists but is not a WBC
        }
    }
    return null;
}
