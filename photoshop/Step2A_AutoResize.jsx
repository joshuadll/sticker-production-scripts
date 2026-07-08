// Step2A_AutoResize.jsx — Phase function only.
// #included by pipeline scripts. Requires: psUtils.jsx, CONFIG in scope.
//
// Resizes every element Smart Object in the template to its correct
// pixel target (longest edge) based on its category code, then arranges
// all elements in a grid so caption review is readable.

function runResize(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var resized = 0;
    var skipped = [];

    try {
        // Snapshot layer refs upfront — resizing layers can shift the live
        // doc.layers collection, causing iterations to skip elements.
        log("[step2] doc.layers.length = " + doc.layers.length);
        var layerRefs = [];
        for (var i = 0; i < doc.layers.length; i++) {
            log("[step2] layer[" + i + "] = " + doc.layers[i].name);
            layerRefs.push(doc.layers[i]);
        }

        for (var i = 0; i < layerRefs.length; i++) {
            var layer = layerRefs[i];

            if (!layer.name) {
                log("[step2] SKIP | unnamed layer at index " + i);
                skipped.push("(unnamed at index " + i + ")");
                continue;
            }

            var parsed = parseLayerName(layer.name);
            if (!parsed) {
                log("[step2] SKIP | \"" + layer.name + "\" — no [STYLE-CAT] code.");
                continue;
            }

            var targetPx = getTargetPx(parsed);
            if (targetPx === null) {
                var code = parsed.catCode || parsed.styleCode;
                log("[step2] SKIP | \"" + layer.name + "\" — unrecognised category \"" + code + "\".");
                skipped.push(layer.name + " (unrecognised category: " + code + ")");
                continue;
            }

            // The category target is the FINISHED element size (art + white edge).
            // Step 2B later expands each side by whiteEdgeMm (in px), growing the
            // longest edge by 2×edgePx. Resize the art smaller by that amount
            // so the final white-edged element lands on the category target.
            // Stamps (ST) don't get white edge — resize to the full target directly.
            var edgePx = (CONFIG.whiteEdgeMm !== undefined && parsed.styleCode !== "ST")
                ? mmToPx(CONFIG.whiteEdgeMm) : 0;
            var artTargetPx = targetPx - 2 * edgePx;
            if (artTargetPx < 1) {
                log("[step2] SKIP | \"" + layer.name + "\" — target " + targetPx
                    + "px minus white edge (" + (2 * edgePx) + "px) is non-positive.");
                skipped.push(layer.name + " (target smaller than white edge)");
                continue;
            }

            var ok = resizeLayerToTarget(layer, artTargetPx);
            if (!ok) {
                log("[step2] SKIP | \"" + layer.name + "\" — zero bounds (hidden or empty).");
                skipped.push(layer.name + " (zero bounds)");
                continue;
            }

            if (edgePx > 0) {
                log("[step2] resized | " + layer.name + " -> art " + artTargetPx
                    + "px (final " + targetPx + "px incl. " + (2 * edgePx) + "px white edge)");
            } else {
                log("[step2] resized | " + layer.name + " -> art " + artTargetPx + "px");
            }
            resized++;
        }

        // Grid layout — arrange all resized elements so caption review is readable.
        runGridLayout(doc);

    } finally {
        // Always restore ruler units — even if an error is thrown above.
        app.preferences.rulerUnits = origUnits;
    }

    return { resized: resized, skipped: skipped };
}

// Arranges all element layers in a left-to-right grid with uniform cell size.
// Cell size = largest target px + gridPaddingMm (in px) on each side.
// Rows wrap when the next cell would exceed the canvas width.
function runGridLayout(doc) {
    var padding  = mmToPx(CONFIG.gridPaddingMm !== undefined ? CONFIG.gridPaddingMm : 5.08); // DPI-scaled (5.08mm ≈ 60px @300)
    var cellSize = getTargetPx({ styleCode: "WC", catCode: "TL", sizeHint: null }) + padding * 2; // TL largest
    var canvasW  = doc.width.as("px");

    var cols     = Math.floor(canvasW / cellSize);
    if (cols < 1) { cols = 1; }

    var col = 0;
    var row = 0;
    var laid = 0;

    for (var i = doc.layers.length - 1; i >= 0; i--) {
        var layer = doc.layers[i];
        if (!layer.name || !parseLayerName(layer.name)) { continue; }

        var b = layer.bounds; // [left, top, right, bottom] as UnitValues
        var w = b[2].as("px") - b[0].as("px");
        var h = b[3].as("px") - b[1].as("px");

        // Centre of the target cell
        var cellLeft = col * cellSize;
        var cellTop  = row * cellSize;
        var targetX  = cellLeft + (cellSize - w) / 2;
        var targetY  = cellTop  + (cellSize - h) / 2;

        // Current top-left of layer
        var curX = b[0].as("px");
        var curY = b[1].as("px");

        layer.translate(targetX - curX, targetY - curY);

        log("[step2] grid | " + layer.name + " -> col " + col + " row " + row);
        laid++;

        col++;
        if (col >= cols) { col = 0; row++; }
    }

    log("[step2] grid layout done | " + laid + " element(s), " + cols + " col(s), cell " + cellSize + "px");
}
