// Step3A_CaptionText.jsx — Phase function only.
// #included by PS_BuildElements.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Creates a caption text layer (T) positioned below each eligible element.
// Leaves layers ungrouped and unlocked — artist reviews positions and
// optionally curves text before running PSAI_BuildAndExportCutlines (Step 3B).
//
// Skips: ST (stamps), layers without [STYLE-CAT] code.
// Returns: { placed, skipped[] }

function runCaptionText(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var placed  = 0;
    var skipped = [];

    try {
        // Collect layer references upfront to avoid index-shift as T layers are added.
        var layerRefs = [];
        for (var i = 0; i < doc.layers.length; i++) {
            layerRefs.push(doc.layers[i]);
        }

        // Re-run guard, computed ONCE before placing anything. On a fresh run there are
        // no captions yet, so this is empty and every element gets one; on a re-run all
        // captions exist and each element resolves to its own, so we skip (idempotent).
        // Computing it up front (not per-element after captions start appearing) is what
        // prevents a just-placed neighbour caption from being mis-claimed mid-pass.
        var captionAssign = buildCaptionAssignment(doc, CONFIG.captionMaxGapFrac);

        for (var i = 0; i < layerRefs.length; i++) {
            var soLayer = layerRefs[i];
            var name    = soLayer.name;

            var parsed = parseLayerName(name);
            if (!parsed) {
                log("[step3A] SKIP | \"" + name + "\" — no [STYLE-CAT] code.");
                continue;
            }

            if (!needsCaption(parsed)) {
                log("[step3A] SKIP | \"" + name + "\" — style " + parsed.styleCode
                    + " does not need a caption.");
                continue;
            }

            // Re-run guard: skip if this element already owns a caption (idempotency).
            if (captionAssign[soLayer.id]) {
                log("[step3A] SKIP | \"" + name + "\" — caption already present nearby.");
                continue;
            }

            if (CONFIG.dryRun) {
                log("[step3A] [DRY RUN] would place caption | " + name);
                placed++;
                continue;
            }

            try {
                var font = isCaptionPlate(parsed) ? CONFIG.captionFontPlate : CONFIG.captionFont;

                if (isCaptionPlate(parsed)) {
                    log("[step3A] WARN | \"" + name
                        + "\" — GC-LM: using captionFontPlate=\"" + font + "\" "
                        + "(⚠️ confirm with artist: correct font, or is caption embedded in plate artwork?)");
                }

                placeCaptionText(doc, soLayer, parsed.displayName, font);
                log("[step3A] placed | " + name);
                placed++;

            } catch (e) {
                log("[step3A] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                skipped.push(name + " (error: " + e.message + ")");
            }
        }

    } finally {
        app.preferences.rulerUnits = origUnits;
    }

    return { placed: placed, skipped: skipped };
}

// Creates a text layer for displayName, positioned below soLayer.
// T layer is placed directly below the SO in the layer stack.
function placeCaptionText(doc, soLayer, displayName, font) {
    var bounds  = soLayer.bounds;
    var left    = bounds[0].as("px");
    var right   = bounds[2].as("px");
    var centerX = (left + right) / 2;

    // Use White Base_Cutline bottom as the reference so captionGap is measured
    // from the visible white border edge. Pill top = refBottom + captionGap − penRadius,
    // so a captionGap of ~15px (with penRadius ≈ 20px) gives ~5px overlap into the
    // border — enough for a robust Unite in Step 6 without being visible.
    var refBottom = bounds[3].as("px");
    for (var j = 0; j < doc.layers.length; j++) {
        if (doc.layers[j] === soLayer) {
            var below = (j + 1 < doc.layers.length) ? doc.layers[j + 1] : null;
            if (below && below.name === CONFIG.whiteEdgeLayerName) {
                refBottom = below.bounds[3].as("px");
            }
            break;
        }
    }

    var textLayer   = doc.artLayers.add();
    textLayer.kind  = LayerKind.TEXT;

    var ti           = textLayer.textItem;
    ti.contents      = displayName;
    // Explicitly name the layer to match displayName exactly. Without this,
    // Photoshop auto-names it from ti.contents and may apply smart-quote
    // conversion (straight apostrophe → curly), causing Step3B's search to fail.
    textLayer.name   = displayName;
    ti.font          = font;
    ti.size          = new UnitValue(CONFIG.captionSizePt, "pt");
    ti.tracking      = CONFIG.captionTracking;
    ti.justification = Justification.CENTER;
    ti.color         = solidBlack();

    // Place at a rough baseline so Photoshop renders the text and bounds are readable.
    ti.position = [centerX, refBottom + CONFIG.captionGap];

    // Read actual rendered bounds and shift so text top lands at refBottom + captionGap.
    // This replaces the fixed ascender estimate — works for any font or size.
    var tb      = textLayer.bounds;
    var textTop = tb[1].as("px");
    ti.position = [centerX, refBottom + CONFIG.captionGap + (refBottom + CONFIG.captionGap - textTop)];

    // Place T layer just above the SO so it ends up at the top of the group
    // after Step 3B grouping (panel order: T → White → SO → White Base_Cutline).
    textLayer.move(soLayer, ElementPlacement.PLACEBEFORE);
}
