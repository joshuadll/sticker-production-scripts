// Step2B_WhiteEdge.jsx — Phase function only.
// #included by PS_BuildElements.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Adds a white edge to every element Smart Object in the Resize Area Template.
// Runs after Step 2 (resize), before Step 3A (caption text), so the artist
// sees the final element — with white edge — when reviewing caption positions.
//
// For each top-level SO that matches the element naming convention, the script:
//   1. Loads the SO's transparency as a selection
//   2. Expands the selection by whiteEdgeMm (in px) to form the border
//   3. Creates a white-filled pixel layer named "White Base_Cutline" below the SO
//
// No action file dependency — fully self-contained.
//
// CONFIG values used:
//   whiteEdgeMm:             border width in millimetres  ⚠️ confirm with artist
//   whiteEdgeSmoothRadiusMm: Select>Modify>Smooth radius (mm) applied to the band's
//                            outer edge before fill, so the traced cutline is
//                            clean (0 → skip smoothing)  ⚠️ tune with artist
//   whiteEdgeLayerName:      "White Base_Cutline"    — name of the created layer
//
// Returns: { processed, skipped[] }

function runWhiteEdge(doc) {
    var processed = 0;
    var skipped   = [];

    log("[step2B] smooth radius | " + mmToPx(CONFIG.whiteEdgeSmoothRadiusMm) + "px");

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

            if (parsed.styleCode === "ST") {
                log("[step2B] SKIP | \"" + name + "\" — stamp element, no white edge.");
                skipped.push(name + " (stamp)");
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
//   2. Expanding by whiteEdgeMm (in px) to form the border
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
    doc.selection.expand(mmToPx(CONFIG.whiteEdgeMm));

    // Smooth the expanded band's outer edge (Select > Modify > Smooth) BEFORE
    // filling. This is the contour Step 5 silhouettes and Step 6 traces, so a
    // clean band here yields clean cutlines without any Illustrator-side RDP
    // (former Step 8a). The printed white edge and the cutline both derive from
    // this one smoothed raster, so they stay consistent. radius 0 → no-op.
    smoothSelection(mmToPx(CONFIG.whiteEdgeSmoothRadiusMm));

    // Harden the smoothed band to a CRISP 1-bit edge before filling (psUtils.hardenSelection:
    // makeWorkPath -> makeSelection with antiAlias OFF). Keeps the smoothed SHAPE; only crisps
    // the EDGE.
    //
    // Why this is here NOW is not why it was here originally — do not restore the old rationale:
    //   da3c1a3 (2026-06-15) added it to make the OLD Photoshop caption-seat probe agree with
    //     Illustrator's Image Trace. That probe is GONE (the native-caption rewrite moved seating
    //     to Illustrator, against the traced vector via aiUtils.seatPlateToOutline), so the seat
    //     no longer cares either way.
    //   1e3aa65 / PR #18 (2026-07-15) removed it, reasoning that nothing read the hard edge any
    //     more and that it caused "jagged exported PNG edges".
    //   RESTORED 2026-07-17 (artist): the anti-aliased edge shipped BLURRY exported edges and
    //     degraded the traced cutlines — Image Trace was fitting the ~50% contour of a soft
    //     gradient rather than a definite boundary, so the cut wandered.
    //
    // So the reason to harden today is the TRACE and the printed edge, not the seat. Note the
    // tension this sits in: hard reads as stair-stepped, soft reads as blurry — both are symptoms
    // of resolving a ~1.7mm edge at 300dpi, which is what the resolution-aware pipeline addresses.
    hardenSelection(doc);

    // Create white layer, fill, deselect.
    var wbcLayer  = doc.artLayers.add();
    wbcLayer.name = CONFIG.whiteEdgeLayerName;
    doc.selection.fill(solidWhite());
    doc.selection.deselect();

    // Move to just below the SO.
    wbcLayer.move(soLayer, ElementPlacement.PLACEAFTER);
}
