// Step2A_AutoResize.jsx — Phase function only.
// #included by pipeline scripts. Requires: psUtils.jsx, CONFIG in scope.
//
// Resizes every element Smart Object in the template to its correct
// pixel target (longest edge) based on its category code.

function runResize(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var resized = 0;
    var skipped = [];

    try {
        for (var i = 0; i < doc.layers.length; i++) {
            var layer = doc.layers[i];

            if (!layer.name) {
                log("[step2] SKIP | unnamed layer at index " + i);
                skipped.push("(unnamed at index " + i + ")");
                continue;
            }

            var parsed = parseLayerName(layer.name);
            if (!parsed) {
                log("[step2] SKIP | \"" + layer.name + "\" — no [STYLE-CAT] code.");
                skipped.push(layer.name + " (no [STYLE-CAT] code)");
                continue;
            }

            var targetPx = getTargetPx(parsed);
            if (targetPx === null) {
                var code = parsed.catCode || parsed.styleCode;
                log("[step2] SKIP | \"" + layer.name + "\" — unrecognised category \"" + code + "\".");
                skipped.push(layer.name + " (unrecognised category: " + code + ")");
                continue;
            }

            var ok = resizeLayerToTarget(layer, targetPx);
            if (!ok) {
                log("[step2] SKIP | \"" + layer.name + "\" — zero bounds (hidden or empty).");
                skipped.push(layer.name + " (zero bounds)");
                continue;
            }

            log("[step2] resized | " + layer.name + " -> " + targetPx + "px");
            resized++;
        }
    } finally {
        // Always restore ruler units — even if an error is thrown above.
        app.preferences.rulerUnits = origUnits;
    }

    return { resized: resized, skipped: skipped };
}
