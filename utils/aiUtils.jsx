// aiUtils.jsx — Shared Illustrator utilities
// #included by pipeline scripts. Not run directly.
// All functions assume CONFIG is defined in the including pipeline script.

// ─── REGEX ────────────────────────────────────────────────────────────────────

// Same naming convention as Photoshop — element names are consistent across apps.
// Matches "Horseshoe Bend [WC-LM]" → captures (Horseshoe Bend)(WC)(LM)
// Matches "Orlando Stamp [ST]"     → captures (Orlando Stamp)(ST)(undefined)
var NAME_REGEX = /^(.+)\s\[([A-Z]+)(?:-([A-Z]+))?\]$/;

// ─── PURE HELPERS ─────────────────────────────────────────────────────────────

function parseLayerName(name) {
    var m = name.match(NAME_REGEX);
    if (!m) return null;
    return {
        displayName: m[1],
        styleCode:   m[2],
        catCode:     m[3] || null
    };
}

// Converts millimetres to Illustrator points (1 mm = 2.834645 pt).
// Used for offset path distances, stroke weights, etc.
function mmToPoints(mm) {
    return mm * 2.834645;
}

// Returns the centre {x, y} of an Illustrator geometricBounds array
// [left, top, right, bottom]. Note: Illustrator y-axis is inverted.
function boundsCenter(bounds) {
    return {
        x: (bounds[0] + bounds[2]) / 2,
        y: (bounds[1] + bounds[3]) / 2
    };
}

// Returns true if a path item is a caption path (name ends with " caption").
// NOTE: Step 6 does not produce separate caption paths — caption is part of the
// element silhouette. This helper is retained for potential use in Steps 8b/9.
function isCaption(pathItem) {
    return (/\scaption$/).test(pathItem.name);
}

// ─── DOM HELPERS ──────────────────────────────────────────────────────────────

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

// Finds a top-level layer by exact name (case-sensitive).
// Returns null if not found. Illustrator uses exact string matching — no fallback.
function findLayer(doc, name) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === name) return doc.layers[i];
    }
    return null;
}

// Finds a path item by exact name within a layer.
// Returns null if not found.
function findPathInLayer(layer, name) {
    for (var i = 0; i < layer.pathItems.length; i++) {
        if (layer.pathItems[i].name === name) return layer.pathItems[i];
    }
    return null;
}

// ─── COLOUR HELPERS ───────────────────────────────────────────────────────────

// Returns a CMYKColor set to 100% black.
function blackCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 100;
    return c;
}

// Returns a CMYKColor set to 100% red (used for QA stroke).
function redCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 100; c.yellow = 100; c.black = 0;
    return c;
}

// ─── PATH STYLE HELPERS ───────────────────────────────────────────────────────

// Applies stroke style to a PathItem or CompoundPathItem.
// colorObj must be a CMYKColor (or RGBColor) instance.
function setStrokeStyle(path, weightPt, colorObj) {
    path.stroked    = true;
    path.strokeWidth = weightPt;
    path.strokeColor = colorObj;
    path.filled     = false;
}

// Expected additions for Steps 8b/9:
//   createOffsetPath(path, offsetMm)     — 1mm offset path
//   getCompoundPathItems(layer)          — compound path iteration
