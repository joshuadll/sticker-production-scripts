// psUtils.jsx — Shared Photoshop utilities
// #included by pipeline scripts. Not run directly.
// All functions assume CONFIG is defined in the including pipeline script.

// ─── REGEX ────────────────────────────────────────────────────────────────────

// Matches "Horseshoe Bend [WC-LM]" → captures (Horseshoe Bend)(WC)(LM)
// Matches "Orlando Stamp [ST]"     → captures (Orlando Stamp)(ST)(undefined)
var NAME_REGEX = /^(.+)\s\[([A-Z]+)(?:-([A-Z]+))?\]$/;

// ─── PURE HELPERS ─────────────────────────────────────────────────────────────
// No Adobe API calls — logic only.

function parseLayerName(name) {
    var m = name.match(NAME_REGEX);
    if (!m) return null;
    return {
        displayName: m[1],
        styleCode:   m[2],
        catCode:     m[3] || null
    };
}

// Returns target pixel size from CONFIG.sizeTable, or null if unrecognised.
// Stamps use styleCode "ST" directly — no catCode in their name.
function getTargetPx(parsed) {
    if (!parsed) return null;
    if (parsed.styleCode === "ST") return CONFIG.sizeTable["ST"];
    if (parsed.catCode && CONFIG.sizeTable[parsed.catCode] !== undefined) {
        return CONFIG.sizeTable[parsed.catCode];
    }
    return null;
}

// Returns true if the element should receive a caption (WC and GC styles only).
function needsCaption(parsed) {
    if (!parsed) return false;
    return parsed.styleCode === "WC" || parsed.styleCode === "GC";
}

function longestEdge(bounds) {
    var w = bounds[2] - bounds[0];
    var h = bounds[3] - bounds[1];
    return (w >= h) ? w : h;
}

function scalePercent(currentPx, targetPx) {
    return (targetPx / currentPx) * 100;
}

// ─── DOM HELPERS ──────────────────────────────────────────────────────────────
// Thin wrappers — Adobe API calls only, no logic.

function log(msg) {
    $.writeln(msg);
    var f = new File(CONFIG.logPath);
    f.open("a");
    f.writeln(msg);
    f.close();
}

function scriptAlert(msg) {
    log(msg);
    if (!CONFIG.suppressAlerts) alert(msg);
}

// Returns true if doc matches expected template dimensions.
function isValidTemplate(doc) {
    return Math.round(doc.width.as("cm")) === CONFIG.templateWidthCm;
}

// Removes all top-level layers except CONFIG.skipLayerName.
// Loops backwards to avoid index shifting on removal.
function clearNonGuideLayers(doc) {
    for (var i = doc.layers.length - 1; i >= 0; i--) {
        if (doc.layers[i].name !== CONFIG.skipLayerName) {
            doc.layers[i].remove();
        }
    }
}

// Converts the currently active layer to an embedded Smart Object.
function convertToSmartObject() {
    executeAction(
        stringIDToTypeID("newPlacedLayer"),
        new ActionDescriptor(),
        DialogModes.NO
    );
}

// Resizes layer so its longest edge equals targetPx, anchored at centre.
// Caller must set ruler units to PIXELS first.
// Returns false if layer has zero bounds (hidden or empty).
function resizeLayerToTarget(layer, targetPx) {
    var bounds  = layer.bounds;
    var longest = longestEdge(bounds);
    if (longest === 0) return false;
    var pct = scalePercent(longest, targetPx);
    layer.resize(pct, pct, AnchorPosition.MIDDLECENTER);
    return true;
}
