// Step5_Silhouette.jsx — Phase function only.
// #included by PSAI_BuildAndExportCutlines.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Runs after Step 3B (caption white + grouping). All top-level layers are
// [Display Name] [STYLE-CAT] groups plus one Guide layer.
//
// This phase finalizes the Elements group (folds in any stray element layers
// Step 3B skipped). It does NOT create a persistent Silhouette layer: the flat
// black silhouette is generated transiently at export time by
// createSilhouetteLayer() — see exportSilhouettePng() in the pipeline. Captions
// (TEXT, "White" pill, "Caption plate") are excluded from the silhouette; Step 6
// rebuilds the caption region parametrically and unites it with the traced
// element outline to form the final cutline.
//
// Final saved layer stack:
//   Elements    ← group of all element groups
//   Guide       ← untouched
//
// Idempotent: re-running is a no-op once every element is inside Elements.
//
// Returns: { processed }  (processed = 1 on success, 0 if nothing to do)

function runSilhouette(doc) {

    if (CONFIG.dryRun) {
        log("[step5] [DRY RUN] would finalize Elements group.");
        return { processed: 1 };
    }

    // ── Ensure "Elements" group exists ─────────────────────────────────────────
    var elementsGroup = findLayerByName(doc, "Elements");

    if (!elementsGroup) {
        // Elements should have been created by Step 3B. If absent, nothing to do.
        log("[step5] ERROR | Elements group not found — was Step 3B run?");
        return { processed: 0 };
    }

    // Move any remaining top-level element layers (skipped by Step3B because
    // they had no T layer) into Elements. These are ArtLayers so move() works.
    for (var ei = doc.layers.length - 1; ei >= 0; ei--) {
        var elyr = doc.layers[ei];
        if (elyr === elementsGroup) continue;
        if (parseLayerName(elyr.name)) {
            elyr.move(elementsGroup, ElementPlacement.PLACEATBEGINNING);
            log("[step5] moved skipped element into Elements | " + elyr.name);
        }
    }

    log("[step5] Elements group finalized.");
    return { processed: 1 };
}

// ─── TRANSIENT SILHOUETTE ─────────────────────────────────────────────────────

// Builds a flat black pixel layer covering element art only (captions excluded)
// and returns it. The caller is responsible for removing it after use — this
// layer is never saved into the working PSD. Returns the ArtLayer, or null if
// the Elements group is missing or has empty bounds.
function createSilhouetteLayer(doc) {
    var elementsGroup = findLayerByName(doc, "Elements");
    if (!elementsGroup) {
        log("[step5] ERROR | Elements group not found — cannot build silhouette.");
        return null;
    }

    // Hide caption sub-layers so the loaded transparency excludes them.
    var hiddenCaptionLayers = hideCaptionSublayers(elementsGroup);
    log("[step5] hid " + hiddenCaptionLayers.length + " caption sub-layer(s).");

    // Duplicate + merge the Elements group to get a temporary flat ArtLayer,
    // then load its transparency. Loading directly from a LayerSet in PS 2026
    // returns a full-canvas selection when the group has no pixel mask.
    var dupGroup     = elementsGroup.duplicate(elementsGroup, ElementPlacement.PLACEBEFORE);
    var stampedLayer = dupGroup.merge();
    loadLayerTransparency(stampedLayer);
    stampedLayer.remove();

    restoreVisibility(hiddenCaptionLayers);

    // Guard against an empty selection (empty group).
    var selBounds = doc.selection.bounds;
    var selW = selBounds[2] - selBounds[0];
    var selH = selBounds[3] - selBounds[1];
    if (selW === 0 || selH === 0) {
        doc.selection.deselect();
        log("[step5] ERROR | Elements group has empty bounds — nothing to silhouette.");
        return null;
    }

    // Create a new pixel layer above Elements, fill the selection black.
    doc.activeLayer = elementsGroup;
    var silLayer = doc.artLayers.add();
    silLayer.kind = LayerKind.NORMAL;
    silLayer.move(elementsGroup, ElementPlacement.PLACEBEFORE);

    doc.selection.fill(solidBlack());
    doc.selection.deselect();

    silLayer.name = "Silhouette";
    log("[step5] transient Silhouette built.");
    return silLayer;
}

// ─── CAPTION SUBLAYER HELPERS ────────────────────────────────────────────────

// Hides caption sub-layers (TEXT, "White" pill, "Caption plate") inside every
// element group so the loaded group transparency excludes them. Returns the list
// of layers it actually hid (only those that were visible), for restoration.
// Only hides TEXT layers when the group has a real Step-3B caption structure
// (White pill or Caption plate present) — art-text inside an element group
// must remain visible in the art export and silhouette.
function hideCaptionSublayers(elementsGroup) {
    var hidden = [];
    var g;
    for (g = 0; g < elementsGroup.layerSets.length; g++) {
        var grp = elementsGroup.layerSets[g];

        // Determine whether this group has a real caption structure before
        // deciding to hide its TEXT layer(s).
        var hasCaption = false;
        var a, s;
        for (a = 0; a < grp.artLayers.length; a++) {
            if (grp.artLayers[a].name === "White") { hasCaption = true; break; }
        }
        if (!hasCaption) {
            for (s = 0; s < grp.layerSets.length; s++) {
                if (grp.layerSets[s].name === "Caption plate") { hasCaption = true; break; }
            }
        }

        for (a = 0; a < grp.artLayers.length; a++) {
            var al = grp.artLayers[a];
            var isCapText = hasCaption && al.kind === LayerKind.TEXT;
            if ((isCapText || al.name === "White") && al.visible) {
                al.visible = false;
                hidden.push(al);
            }
        }

        for (s = 0; s < grp.layerSets.length; s++) {
            var ls = grp.layerSets[s];
            if (ls.name === "Caption plate" && ls.visible) {
                ls.visible = false;
                hidden.push(ls);
            }
        }
    }
    return hidden;
}

// Restores visibility for layers hidden by hideCaptionSublayers.
function restoreVisibility(layers) {
    for (var i = 0; i < layers.length; i++) {
        layers[i].visible = true;
    }
}

// selectLayerById, addLayerToSelectionById, solidBlack defined in psUtils.jsx.
