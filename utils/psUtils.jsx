// psUtils.jsx — Shared Photoshop utilities
// #included by pipeline scripts. Not run directly.
// All functions assume CONFIG is defined in the including pipeline script.

// ─── REGEX ────────────────────────────────────────────────────────────────────

// Matches "Horseshoe Bend [WC-LM]"  → captures (Horseshoe Bend)(WC)(LM)(undefined)
// Matches "Eiffel Tower [WC-LM+]"   → captures (Eiffel Tower)(WC)(LM)(+)
// Matches "Small Snack [WC-FD-]"    → captures (Small Snack)(WC)(FD)(-)
// Matches "Orlando Stamp [ST]"      → captures (Orlando Stamp)(ST)(undefined)(undefined)
// Matches "Big Stamp [ST+]"         → captures (Big Stamp)(ST)(undefined)(+)
// Matches "Tiny Stamp [ST-]"        → captures (Tiny Stamp)(ST)(undefined)(-)
// The size hint is OUTSIDE the catCode group so it can follow a category-less
// style code (stamps): a hinted stamp still parses, and getTargetPx ignores the
// hint (ST is a fixed 450px). Without this an "[ST+]" typo would parse to null and
// the stamp would be silently skipped by the pipeline.
var NAME_REGEX = /^(.+)\s\[([A-Z]+)(?:-([A-Z]+))?([+-])?\]$/;

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

// Returns finished-size pixels for an element = inches (from CONFIG.sizeTable) ×
// working resolution. Resolution is CONFIG.sourceDPI, falling back to templateDPI/300
// so callers are safe before detection runs. null for an unrecognised category.
// Stamps use styleCode "ST" directly; sizeHint "+"/"-" pick the large/small table.
function getTargetPx(parsed) {
    if (!parsed) return null;
    var dpi = CONFIG.sourceDPI || CONFIG.templateDPI || 300;
    var inches = null;
    if (parsed.styleCode === "ST") {
        inches = CONFIG.sizeTable["ST"];
    } else if (parsed.catCode) {
        var cat = parsed.catCode;
        if (parsed.sizeHint === "+" && CONFIG.sizeTableLarge && CONFIG.sizeTableLarge[cat] !== undefined) {
            inches = CONFIG.sizeTableLarge[cat];
        } else if (parsed.sizeHint === "-" && CONFIG.sizeTableSmall && CONFIG.sizeTableSmall[cat] !== undefined) {
            inches = CONFIG.sizeTableSmall[cat];
        } else if (CONFIG.sizeTable[cat] !== undefined) {
            inches = CONFIG.sizeTable[cat];
        }
    }
    if (inches === null || inches === undefined) return null;
    return Math.round(inches * dpi);
}

// Physical millimetres → pixels at the working resolution. Used for the white edge
// and smooth radius so they stay a constant physical width at any source DPI.
function mmToPx(mm) {
    if (mm === null || mm === undefined) return 0;
    var dpi = CONFIG.sourceDPI || CONFIG.templateDPI || 300;
    return Math.round(mm / 25.4 * dpi);
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

// Hardens the active selection to a CRISP, 1-bit edge (at its ~50%-coverage
// boundary). A selection off loadLayerTransparency + expand + smooth is
// ANTI-ALIASED — its boundary fades over a few pixels. Two downstream readers then
// disagree on where that fuzzy edge "is": the caption seat (Step3B _probeBorder)
// reads the OUTERMOST covered pixel, while Illustrator's Image Trace (Step6) cuts
// the ~50% coverage contour ~3px further in. That gap silently swallows the
// caption<->art overlap and detaches the caption cutline on flat-bottomed elements
// (the Tatra-chamois failure). Hardening removes the fuzz so BOTH readers land on
// the same crisp contour and the seat's overlap translates 1:1 into the traced
// cutline — letting the overlap budget stay small. Verified: a crisp white edge is
// preserved faithfully through the silhouette build (no erosion). See
// memory: caption_overlap_translation_bug.
//
// Method = path round-trip. A channel-Threshold leaves a soft band, and a fill of
// an anti-aliased selection is itself anti-aliased, so neither crisps the result.
// Converting the selection to a vector work path and back with anti-aliasing OFF
// rasterises a genuinely hard (0px-fringe) selection. makeWorkPath follows the
// ~50% contour (tolerance in px); makeSelection(antiAlias=false) makes it crisp.
function hardenSelection(doc) {
    doc.selection.makeWorkPath(0.5);
    var wp = doc.pathItems[doc.pathItems.length - 1];
    wp.makeSelection(0, false, SelectionType.REPLACE);   // feather 0, antiAlias OFF
    try { wp.remove(); } catch (e) {}
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

// Copies this run's log to `folderFsName` under `niceName` so a FAILURE's details land
// right next to the artist's files (their job folder) instead of the hidden
// ~/Library/Application Support path. Reads + rewrites (not File.copy) so spaced/unicode
// paths and UTF-8 element names survive. Returns the beside-files path, or CONFIG.logPath
// if the copy can't be made (caller still has a usable path to show).
function copyLogBeside(folderFsName, niceName) {
    try {
        if (!folderFsName) return CONFIG.logPath;
        var src = new File(CONFIG.logPath);
        if (!src.exists) return CONFIG.logPath;
        src.encoding = "UTF-8"; src.open("r"); var txt = src.read(); src.close();
        var dest = new File(folderFsName + "/" + niceName);
        dest.encoding = "UTF-8"; dest.lineFeed = "Unix";
        if (!dest.open("w")) return CONFIG.logPath;
        dest.write(txt); dest.close();
        return dest.fsName;
    } catch (e) { return CONFIG.logPath; }
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

// ─── CAPTION ↔ ELEMENT MATCHING ───────────────────────────────────────────────
// A caption belongs to the element it sits NEXT TO, not the element whose name it
// happens to spell. The artist legitimately shortens caption text ("National Animal
// - Tatra chamois" → "Tatra chamois") or moves it to any side during the review stop.
// Photoshop AUTO-RENAMES a text layer to its contents on every edit (verified PS 2026:
// even an explicitly script-set name is overwritten when contents change), so the
// layer name is NOT a stable key — a process rule like "don't rename the caption" is
// unenforceable. We therefore match the whole document at once (buildCaptionAssignment):
//   1) name fast-path — an UN-edited caption still spells its element's display name,
//      so bind it exactly (apostrophe-normalized). Zero ambiguity, no geometry.
//   2) positional — remaining captions ↔ elements by GLOBAL mutual nearest-neighbour
//      (min bounding-box gap, greedy by ascending gap, each side claimed once). One
//      pass over the doc, so there is no per-element re-scan and no dependence on
//      iteration order. A max-gap ceiling (element-relative) stops a genuinely
//      uncaptioned element from absorbing a far-away stray text layer.

// Returns a layer's bounds as plain px numbers [left, top, right, bottom]
// (top < bottom; PS y increases downward). Caller need not set ruler units.
function layerBoundsPx(layer) {
    var b = layer.bounds;
    return [b[0].as("px"), b[1].as("px"), b[2].as("px"), b[3].as("px")];
}

// Minimum gap (px) between two axis-aligned boxes [l,t,r,b]; 0 if they touch or
// overlap. Direction-agnostic: index 0/2 are the x-range, 1/3 the y-range.
function boxGap(a, b) {
    var dx = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]));
    var dy = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
    return Math.sqrt(dx * dx + dy * dy);
}

// Normalizes curly/smart apostrophes (U+2018, U+2019) to straight (U+0027) so a
// caption auto-named with a smart quote ("Michael’s Gate") matches a display name
// parsed with a straight one ("Michael's Gate"). Photoshop smart-quotes on placement.
function _normQuotes(s) {
    var r = "", ci, code;
    for (ci = 0; ci < s.length; ci++) {
        code = s.charCodeAt(ci);
        r += (code === 0x2018 || code === 0x2019) ? "'" : s.charAt(ci);
    }
    return r;
}

// True if a TEXT layer's name OR contents equals displayName (quote-normalized) —
// the un-edited-caption fast path.
function _captionNameMatches(textLayer, displayName) {
    var nd = _normQuotes(displayName);
    if (_normQuotes(textLayer.name) === nd) return true;
    try { if (_normQuotes(textLayer.textItem.contents) === nd) return true; } catch (e) {}
    return false;
}

// All top-level TEXT layers in the document (the caption candidates).
function _topLevelTextLayers(doc) {
    var out = [], i;
    for (i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].kind === LayerKind.TEXT) out.push(doc.layers[i]);
    }
    return out;
}

// All top-level element layers eligible to receive a caption (valid [STYLE-CAT]
// name, caption-bearing style, not a stamp). These are the elements a caption may
// be assigned to. Stamps are excluded so a caption never gets pulled onto one.
function _captionableElements(doc) {
    var out = [], i, p;
    for (i = 0; i < doc.layers.length; i++) {
        p = parseLayerName(doc.layers[i].name);
        if (!p) continue;
        if (p.styleCode === "ST") continue;
        if (!needsCaption(p)) continue;
        out.push(doc.layers[i]);
    }
    return out;
}

// Builds the whole-document caption→element assignment ONCE. Returns a map keyed by
// element layer .id → { caption: textLayer, gap: px, by: "name"|"pos" }. Compare/key
// by .id — ExtendScript hands back distinct wrapper objects for the same layer, so
// === on wrappers is unreliable. Callers in a loop must call this ONCE up front (not
// per element) and index the result, both for cost and so the assignment is decided
// from the full layer set rather than a pool that shrinks as elements get grouped.
//
// maxGapFrac (default 0.5): a positional pair is rejected when its gap exceeds
// maxGapFrac × the element's SMALLER side. Element-relative so it is DPI/scale-free —
// a caption more than half an element away is not that element's caption.
function buildCaptionAssignment(doc, maxGapFrac) {
    if (maxGapFrac === undefined || maxGapFrac === null) { maxGapFrac = 0.5; }

    var texts = _topLevelTextLayers(doc);
    var elems = _captionableElements(doc);
    var assign = {};            // elementId -> { caption, gap, by }
    var claimedText = {};       // text index -> true
    var claimedElem = {};       // elementId -> true
    var i, j;

    // Precompute bounds + display names once (DOM reads are the dominant cost).
    var tB = [], eB = [], eName = [], eId = [];
    for (i = 0; i < texts.length; i++) { tB.push(layerBoundsPx(texts[i])); }
    for (j = 0; j < elems.length; j++) {
        eB.push(layerBoundsPx(elems[j]));
        eName.push(parseLayerName(elems[j].name).displayName);
        eId.push(elems[j].id);
    }

    // 1) Name fast-path — un-edited caption still spells its element's display name.
    for (j = 0; j < elems.length; j++) {
        for (i = 0; i < texts.length; i++) {
            if (claimedText[i]) continue;
            if (_captionNameMatches(texts[i], eName[j])) {
                assign[eId[j]] = { caption: texts[i], gap: boxGap(eB[j], tB[i]), by: "name" };
                claimedText[i] = true; claimedElem[eId[j]] = true;
                break;
            }
        }
    }

    // 2) Positional — global mutual nearest-neighbour over the unclaimed remainder.
    // Build all in-range pairs, sort by ascending gap, claim each side once. Greedy
    // ascending-gap == closest mutual pairs first; deterministic ties by element then
    // text index (ES3 sort isn't stable, so tie-break explicitly).
    var pairs = [];
    for (j = 0; j < elems.length; j++) {
        if (claimedElem[eId[j]]) continue;
        var minDim = Math.min(Math.abs(eB[j][2] - eB[j][0]), Math.abs(eB[j][3] - eB[j][1]));
        var ceiling = maxGapFrac * minDim;
        for (i = 0; i < texts.length; i++) {
            if (claimedText[i]) continue;
            var g = boxGap(eB[j], tB[i]);
            if (g <= ceiling) { pairs.push({ e: j, t: i, g: g }); }
        }
    }
    pairs.sort(function (a, b) { return (a.g - b.g) || (a.e - b.e) || (a.t - b.t); });
    for (var k = 0; k < pairs.length; k++) {
        var p = pairs[k];
        if (claimedElem[eId[p.e]] || claimedText[p.t]) continue;
        assign[eId[p.e]] = { caption: texts[p.t], gap: p.g, by: "pos" };
        claimedElem[eId[p.e]] = true; claimedText[p.t] = true;
    }

    return assign;
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
