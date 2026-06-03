// Step5_Silhouette.jsx — Phase function only.
// #included by PSAI_BuildAndExportCutlines.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Runs after Step 3B (caption white + grouping). All top-level layers are
// [Display Name] [STYLE-CAT] groups plus one Guide layer.
//
// Creates a flat black "Silhouette" pixel layer from element art only — caption
// text, White pill, and Caption plate are hidden before loading transparency so
// they are excluded. Step 6 rebuilds the caption region parametrically and unites
// it with the traced element outline to form the final cutline.
//
// Final layer stack:
//   Silhouette  ← new flat black pixel layer (element art only)
//   Elements    ← group of all element groups (original, untouched)
//   Guide       ← untouched
//
// Idempotent: if Silhouette already exists, logs a warning and returns.
//
// Returns: { processed }  (processed = 1 on success, 0 if already done)

function runSilhouette(doc) {

    // ── Idempotency guard ──────────────────────────────────────────────────────
    if (findLayerByName(doc, "Silhouette")) {
        log("[step5] SKIP | Silhouette layer already exists — already run.");
        return { processed: 0 };
    }

    if (CONFIG.dryRun) {
        log("[step5] [DRY RUN] would create Silhouette layer.");
        return { processed: 1 };
    }

    // ── Step 1: Ensure "Elements" group exists ─────────────────────────────────
    var elementsGroup = findLayerByName(doc, "Elements");

    if (!elementsGroup) {
        // Collect only layers that match the element naming convention.
        var toGroup = [];
        for (var i = 0; i < doc.layers.length; i++) {
            if (parseLayerName(doc.layers[i].name)) {
                toGroup.push(doc.layers[i]);
            }
        }

        if (toGroup.length === 0) {
            log("[step5] ERROR | no element layers found to group.");
            return { processed: 0 };
        }

        // Create group and move layers in — iterating reverse with PLACEATBEGINNING
        // preserves the original top-to-bottom z-order inside the group.
        var group = doc.layerSets.add();
        group.name = "Elements";
        for (var j = toGroup.length - 1; j >= 0; j--) {
            toGroup[j].move(group, ElementPlacement.PLACEATBEGINNING);
        }
        elementsGroup = group;
        log("[step5] grouped " + toGroup.length + " element(s) → Elements");
    } else {
        log("[step5] Elements group already exists — skipping group step.");
    }

    // ── Step 2: Load Elements group transparency as selection ──────────────────
    // Hide caption sub-layers before loading so the silhouette covers element art
    // only. Step 6 rebuilds the caption region parametrically.
    var hiddenCaptionLayers = hideCaptionSublayers(elementsGroup);
    log("[step5] hid " + hiddenCaptionLayers.length + " caption sub-layer(s).");

    loadLayerTransparency(elementsGroup);
    restoreVisibility(hiddenCaptionLayers);

    // Check that something was selected (guard against empty group).
    var selBounds = doc.selection.bounds;
    var selW = selBounds[2] - selBounds[0];
    var selH = selBounds[3] - selBounds[1];
    if (selW === 0 || selH === 0) {
        doc.selection.deselect();
        log("[step5] ERROR | Elements group has empty bounds — nothing to silhouette.");
        return { processed: 0 };
    }

    // ── Step 3: Create new pixel layer above Elements ──────────────────────────
    doc.activeLayer = elementsGroup;
    var silLayer = doc.artLayers.add();
    silLayer.kind = LayerKind.NORMAL;

    // Move new layer above the Elements group (it starts above activeLayer).
    silLayer.move(elementsGroup, ElementPlacement.PLACEBEFORE);

    // ── Step 4: Fill selection with black ──────────────────────────────────────
    doc.selection.fill(solidBlack());
    doc.selection.deselect();

    // ── Step 5: Name the new layer ─────────────────────────────────────────────
    silLayer.name = "Silhouette";

    log("[step5] Silhouette created.");
    return { processed: 1 };
}

// ─── CAPTION SUBLAYER HELPERS ────────────────────────────────────────────────

// Hides caption sub-layers (TEXT, "White" pill, "Caption plate") inside every
// element group so the loaded group transparency excludes them. Returns the list
// of layers it actually hid (only those that were visible), for restoration.
function hideCaptionSublayers(elementsGroup) {
    var hidden = [];
    var g;
    for (g = 0; g < elementsGroup.layerSets.length; g++) {
        var grp = elementsGroup.layerSets[g];

        var a;
        for (a = 0; a < grp.artLayers.length; a++) {
            var al = grp.artLayers[a];
            if ((al.kind === LayerKind.TEXT || al.name === "White") && al.visible) {
                al.visible = false;
                hidden.push(al);
            }
        }

        var s;
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
