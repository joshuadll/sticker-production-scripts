// Step3A_CaptionText.jsx — Phase function only.
// #included by PS_ToCaption.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Creates a caption text layer (T) positioned below each eligible element.
// Leaves layers ungrouped and unlocked — artist reviews positions and
// optionally curves text before running PS_AfterCaption (Step 3B).
//
// Skips: ST (stamps), layers without [STYLE-CAT] code, CONFIG.skipLayerName.
// Returns: { placed, skipped[] }

function runCaptionText(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var placed  = 0;
    var skipped = [];

    try {
        // First pass: collect SO layer names to avoid index-shift as T layers are added.
        var layerNames = [];
        for (var i = 0; i < doc.layers.length; i++) {
            layerNames.push(doc.layers[i].name);
        }

        for (var i = 0; i < layerNames.length; i++) {
            var name = layerNames[i];

            if (name === CONFIG.skipLayerName) continue;

            var parsed = parseLayerName(name);
            if (!parsed) {
                log("[step3A] SKIP | \"" + name + "\" — no [STYLE-CAT] code.");
                skipped.push(name + " (no code)");
                continue;
            }

            if (!needsCaption(parsed)) {
                log("[step3A] SKIP | \"" + name + "\" — style " + parsed.styleCode
                    + " does not need a caption.");
                continue;
            }

            // Re-find by name — earlier T layer insertions shift indices.
            var soLayer = findLayerByName(doc, name);
            if (!soLayer) {
                log("[step3A] SKIP | \"" + name + "\" — not found at placement time.");
                skipped.push(name + " (not found)");
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
    var bottom  = bounds[3].as("px");
    var centerX = (left + right) / 2;

    // Baseline Y = element bottom + gap + approximate ascender.
    // captionBaselineOffsetPx is a tunable estimate; text top will land at
    // approximately (elementBottom + captionGap). Tune if placement is off.
    var baselineY = bottom + CONFIG.captionGap + CONFIG.captionBaselineOffsetPx;

    // Add layer above active layer, then immediately move it below SO.
    doc.activeLayer = soLayer;
    var textLayer   = doc.artLayers.add();
    textLayer.kind  = LayerKind.TEXT;

    var ti           = textLayer.textItem;
    ti.contents      = displayName;
    ti.font          = font;
    ti.size          = new UnitValue(CONFIG.captionSizePt, "pt");
    ti.tracking      = CONFIG.captionTracking;
    ti.justification = Justification.CENTER;

    var black = new SolidColor();
    black.rgb.red   = 0;
    black.rgb.green = 0;
    black.rgb.blue  = 0;
    ti.color = black;

    // Position in pixels (ruler is already PIXELS).
    ti.position = [centerX, baselineY];

    // Place T layer just above the SO so it ends up at the top of the group
    // after Step 3B grouping (panel order: T → White → SO → White Base_Cutline).
    textLayer.move(soLayer, ElementPlacement.PLACEBEFORE);
}
