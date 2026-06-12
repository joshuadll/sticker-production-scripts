// psUtils.jsx — Shared Photoshop utilities
// #included by pipeline scripts. Not run directly.
// All functions assume CONFIG is defined in the including pipeline script.

// ─── REGEX ────────────────────────────────────────────────────────────────────

// Matches "Horseshoe Bend [WC-LM]"  → captures (Horseshoe Bend)(WC)(LM)(undefined)
// Matches "Eiffel Tower [WC-LM+]"   → captures (Eiffel Tower)(WC)(LM)(+)
// Matches "Small Snack [WC-FD-]"    → captures (Small Snack)(WC)(FD)(-)
// Matches "Orlando Stamp [ST]"      → captures (Orlando Stamp)(ST)(undefined)(undefined)
var NAME_REGEX = /^(.+)\s\[([A-Z]+)(?:-([A-Z]+)([+-])?)?\]$/;

// ─── PURE HELPERS ─────────────────────────────────────────────────────────────
// No Adobe API calls — logic only.

function parseLayerName(name) {
    var m = name.match(NAME_REGEX);
    if (!m) return null;
    return {
        displayName: m[1],
        styleCode:   m[2],
        catCode:     m[3] || null,
        sizeHint:    m[4] || null   // "+" = large end, "-" = small end, null = midpoint
    };
}

// Returns target pixel size from CONFIG.sizeTable, or null if unrecognised.
// Stamps use styleCode "ST" directly — no catCode in their name.
// sizeHint "+" uses sizeTableLarge; "-" uses sizeTableSmall; null uses sizeTable midpoints.
function getTargetPx(parsed) {
    if (!parsed) return null;
    if (parsed.styleCode === "ST") return CONFIG.sizeTable["ST"];
    if (!parsed.catCode) return null;
    var cat = parsed.catCode;
    if (parsed.sizeHint === "+" && CONFIG.sizeTableLarge && CONFIG.sizeTableLarge[cat] !== undefined) {
        return CONFIG.sizeTableLarge[cat];
    }
    if (parsed.sizeHint === "-" && CONFIG.sizeTableSmall && CONFIG.sizeTableSmall[cat] !== undefined) {
        return CONFIG.sizeTableSmall[cat];
    }
    if (CONFIG.sizeTable[cat] !== undefined) return CONFIG.sizeTable[cat];
    return null;
}

// Loads a layer's transparency channel as the active selection without rasterising.
// Equivalent to Ctrl+clicking the layer thumbnail in the Layers panel.
// Ruler units do not affect this operation.
function loadLayerTransparency(layer) {
    app.activeDocument.activeLayer = layer;
    var desc   = new ActionDescriptor();
    var selRef = new ActionReference();
    selRef.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
    desc.putReference(charIDToTypeID("null"), selRef);
    // Use putEnumerated("Chnl","Chnl","Trsp") — the compound putProperty+putEnumerated
    // form stopped working in Photoshop 2026.
    var trspRef = new ActionReference();
    trspRef.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Trsp"));
    desc.putReference(charIDToTypeID("T   "), trspRef);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
}

// Rounds the active selection's jagged edge — the scriptable equivalent of
// Select > Modify > Smooth (Sample Radius). The Selection DOM object exposes
// expand/contract/feather but NOT smooth, so this drives it via Action Manager
// (event "smooth", radius key "Rds " in pixels).
//
// Used by Step 2B to smooth the expanded white-edge band BEFORE filling, so the
// silhouette Step 5 builds from that band — and the cutline Step 6 traces from
// the silhouette — are clean from birth (replaces the old Illustrator-side RDP
// pass, former Step 8a). radiusPx <= 0 is a no-op.
function smoothSelection(radiusPx) {
    if (!radiusPx || radiusPx <= 0) return;
    var desc = new ActionDescriptor();
    desc.putUnitDouble(charIDToTypeID("Rds "), charIDToTypeID("#Pxl"), radiusPx);
    executeAction(charIDToTypeID("Smth"), desc, DialogModes.NO);
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
    f.encoding = "UTF-8";   // accented element names (Devín, Šúľance) write as valid
                            // UTF-8, not invalid Mac-Roman bytes that break grep
    f.lineFeed = "Unix";    // ensure \n line endings so grep/diff work correctly
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

// Removes top-level layers that match the element naming convention.
// Leaves all other layers (Background, etc.) untouched.
// Loops backwards to avoid index shifting on removal.
function clearElementLayers(doc) {
    for (var i = doc.layers.length - 1; i >= 0; i--) {
        if (parseLayerName(doc.layers[i].name)) {
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

// Finds a top-level layer by exact name. Returns null if not found.
function findLayerByName(doc, name) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === name) return doc.layers[i];
    }
    return null;
}

// Returns true if the element uses the plate caption treatment.
// Reads CONFIG.captionPlateCodes — an array of [styleCode, catCode] pairs.
// e.g. [["GC", "LM"]] means only GC-LM uses the plate treatment.
function isCaptionPlate(parsed) {
    if (!parsed || !parsed.styleCode || !parsed.catCode) return false;
    var codes = CONFIG.captionPlateCodes;
    if (!codes) return false;
    for (var i = 0; i < codes.length; i++) {
        if (codes[i][0] === parsed.styleCode && codes[i][1] === parsed.catCode) {
            return true;
        }
    }
    return false;
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

// ─── COLOR HELPERS ────────────────────────────────────────────────────────────

function solidBlack() {
    var c = new SolidColor();
    c.rgb.red = 0; c.rgb.green = 0; c.rgb.blue = 0;
    return c;
}

function solidWhite() {
    var c = new SolidColor();
    c.rgb.red = 255; c.rgb.green = 255; c.rgb.blue = 255;
    return c;
}

// ─── TEXT LAYER SEARCH ────────────────────────────────────────────────────────

// Finds the first top-level TEXT layer whose name matches displayName.
// Returns null if not found.
function findTextLayerByDisplayName(doc, displayName) {
    // Normalize curly/smart apostrophes (U+2018, U+2019) to straight (U+0027).
    // Photoshop smart-quotes text content on placement, so the T layer name may
    // use U+2019 while displayName (parsed from the SO layer) uses U+0027.
    function norm(s) {
        var r = "";
        for (var ci = 0; ci < s.length; ci++) {
            var code = s.charCodeAt(ci);
            r += (code === 0x2018 || code === 0x2019) ? "'" : s.charAt(ci);
        }
        return r;
    }
    var normDisplay = norm(displayName);
    for (var i = 0; i < doc.layers.length; i++) {
        var layer = doc.layers[i];
        if (layer.kind !== LayerKind.TEXT) continue;
        if (norm(layer.name) === normDisplay) return layer;
        try {
            if (norm(layer.textItem.contents) === normDisplay) return layer;
        } catch (e) {}
    }
    return null;
}

// ─── LAYER SELECTION HELPERS ─────────────────────────────────────────────────
// Used by Step3B (selectAndGroup) and Step5 (grouping fallback).

// Selects a single layer by its internal ID (replaces current selection).
function selectLayerById(layer) {
    var desc = new ActionDescriptor();
    var ref  = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(stringIDToTypeID("makeVisible"), false);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
}

// Adds a layer to the current selection by its internal ID.
function addLayerToSelectionById(layer) {
    var desc = new ActionDescriptor();
    var ref  = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(stringIDToTypeID("makeVisible"), false);
    desc.putEnumerated(
        stringIDToTypeID("selectionModifier"),
        stringIDToTypeID("selectionModifierType"),
        stringIDToTypeID("addToSelection")
    );
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
}
