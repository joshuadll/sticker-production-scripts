// aiUtils.jsx — Shared Illustrator utilities
// #included by pipeline scripts. Not run directly.
// All functions assume CONFIG is defined in the including pipeline script.

// ─── REGEX ────────────────────────────────────────────────────────────────────

// Same naming convention as Photoshop — element names are consistent across apps.
// Matches "Horseshoe Bend [WC-LM]"  → captures (Horseshoe Bend)(WC)(LM)(undefined)
// Matches "Eiffel Tower [WC-LM+]"   → captures (Eiffel Tower)(WC)(LM)(+)
// Matches "Small Snack [WC-FD-]"    → captures (Small Snack)(WC)(FD)(-)
// Matches "Orlando Stamp [ST]"      → captures (Orlando Stamp)(ST)(undefined)(undefined)
var NAME_REGEX = /^(.+)\s\[([A-Z]+)(?:-([A-Z]+)([+-])?)?\]$/;

// ─── PURE HELPERS ─────────────────────────────────────────────────────────────

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

// Logging is normally immediate (one file open/write/close per line) so a crash
// never loses context. On hot paths that emit many lines (e.g. Layout QA logs per
// path + per pocket), the per-call syscall churn is measurable on slow disks. A
// pipeline can opt into buffered logging with beginLogBuffer(): log() then
// accumulates in memory and flushLog() writes the whole run in ONE open/close.
// Default (buffer null) is the original immediate behaviour, so every other
// pipeline is unaffected. flushLog() is also called from scriptAlert() so any
// buffered context is on disk before a modal alert blocks the script.
var _logBuf = null;   // non-null array → buffering active

function beginLogBuffer() {
    _logBuf = [];
}

function _writeLogLines(lines) {
    if (lines.length === 0) return;
    var f = new File(CONFIG.logPath);
    f.encoding = "UTF-8";       // accented element names (Devín, Šúľance) write as
                                // valid UTF-8, not invalid Mac-Roman bytes
    f.lineFeed = "Unix";        // \n terminators so grep/diff treat the log as text
    f.open("a");
    f.write(lines.join("\n") + "\n");
    f.close();
}

function flushLog() {
    if (_logBuf === null) return;
    _writeLogLines(_logBuf);
    _logBuf = null;             // back to immediate mode after a flush
}

function log(msg) {
    $.writeln(msg);
    if (_logBuf !== null) { _logBuf.push(msg); return; }
    _writeLogLines([msg]);
}

function scriptAlert(msg) {
    log(msg);
    flushLog();                 // ensure buffered context hits disk before blocking
    if (!CONFIG.suppressAlerts) alert(msg);
}

// Per-phase wall-timer for profiling slow runs. `lap()` returns the ms elapsed
// since the last lap (or since creation) and resets, so a phase is timed with one
// call: `var t = _newPhaseTimer(); … phaseA(); var msA = t.lap(); phaseB(); …`.
// Uses Date (NOT $.hiresTimer, which returns nonsense deltas in Illustrator).
function _newPhaseTimer() {
    return {
        last: (new Date()).getTime(),
        lap: function () {
            var now = (new Date()).getTime();
            var d = now - this.last;
            this.last = now;
            return d;
        }
    };
}

// Finds a top-level layer by exact name (case-sensitive).
// Returns null if not found. Illustrator uses exact string matching — no fallback.
function findLayer(doc, name) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === name) return doc.layers[i];
    }
    return null;
}

// Builds the working document the AI pipeline runs on. The values below are the
// print-production spec — they must match the press/cutting setup, so don't change
// them without confirming against a real production file:
//   - A4 sheet (210 x 297 mm), CMYK, mm ruler units
//   - Color Block : full-sheet green rect, fill CMYK(55,0,100,0), locked, bottom
//                   (the green background for Step 10's green preview JPEG)
//   - Grid        : vector 1-inch reference grid, locked (artist manual-check aid)
//   - Stickers    : empty (Step 7B places nested artwork here)
// Cutlines / Halfcut layers are created later by their own steps, above Stickers.
// Returns the new document.
function buildWorkingDocument() {
    var SHEET_W_MM = 210;   // A4 — matches template artboard
    var SHEET_H_MM = 297;
    var GRID_MM    = 25.4;  // 1 inch

    var doc = app.documents.add(
        DocumentColorSpace.CMYK,
        mmToPoints(SHEET_W_MM),
        mmToPoints(SHEET_H_MM)
    );
    doc.rulerUnits = RulerUnits.Millimeters;

    var ab     = doc.artboards[0].artboardRect; // [left, top, right, bottom] pt
    var left   = ab[0], top = ab[1], right = ab[2], bottom = ab[3];

    // Default doc ships with one empty layer — repurpose it as Color Block (bottom).
    var colorBlock = doc.layers[0];
    colorBlock.name = CONFIG.colorBlockLayerName ? CONFIG.colorBlockLayerName : "Color Block";
    doc.activeLayer = colorBlock;
    var green = doc.pathItems.rectangle(top, left, right - left, top - bottom);
    green.stroked   = false;
    green.filled    = true;
    green.fillColor = _bwdGreen();
    colorBlock.locked = true;

    // Grid (above Color Block): vector 1-inch lines.
    var grid = doc.layers.add();
    grid.name = "Grid";
    var gridColor = _bwdGridColor();
    var step = mmToPoints(GRID_MM);
    var x, y;
    for (x = left; x <= right + 0.01; x += step) {
        _bwdGridLine(grid, x, top, x, bottom, gridColor);
    }
    for (y = top; y >= bottom - 0.01; y -= step) {
        _bwdGridLine(grid, left, y, right, y, gridColor);
    }
    grid.locked = true;

    // Stickers (above Grid): empty; Step 7B fills it after nesting.
    var stickers = doc.layers.add();
    stickers.name = CONFIG.stickersLayerName ? CONFIG.stickersLayerName : "Sticker";

    // Margin band (top): the printable-area guide. Cutlines must stay inside it
    // (touching allowed); nesting and QA both reference its inner rectangle.
    _bwdMarginBand(doc);

    log("[aiutils] built working document | A4 CMYK | Margin > Stickers > Grid > Color Block");
    return doc;
}

// Canonical printable-area spec — the SINGLE source of truth for the margin.
// Documented working area: 190 x 267 mm = A4 minus 10mm top/left/right + 20mm bottom.
// Pipelines reference these (e.g. workingAreaWidthMm: MARGIN_SPEC.workingAreaWidthMm)
// instead of repeating literals, so the value cannot drift between pipeline and QA.
var MARGIN_SPEC = {
    marginLeftMm:       10,
    marginTopMm:        10,
    workingAreaWidthMm: 190,
    workingAreaHeightMm: 267
};

// Single source of truth for the shared QA overlay layer name. Pipelines set
// CONFIG.qaLayerName from this, and Step 11 strips QA_LAYER_NAME.toLowerCase() —
// so the reserved name cannot drift between where it's created and where it's
// stripped (a drift would leak the overlay into the final print file).
var QA_LAYER_NAME = "Layout QA";

// Inner safe-area rectangle as geometricBounds [left, top, right, bottom] (AI y-up).
// Reads CONFIG when a pipeline supplies the values, else falls back to MARGIN_SPEC —
// so nesting, the drawn margin band, and Steps 8c/QA all resolve the same boundary.
function marginRect(doc) {
    var ab = doc.artboards[0].artboardRect;
    var lM = (CONFIG && CONFIG.marginLeftMm        != null) ? CONFIG.marginLeftMm       : MARGIN_SPEC.marginLeftMm;
    var tM = (CONFIG && CONFIG.marginTopMm         != null) ? CONFIG.marginTopMm        : MARGIN_SPEC.marginTopMm;
    var wW = (CONFIG && CONFIG.workingAreaWidthMm   != null) ? CONFIG.workingAreaWidthMm  : MARGIN_SPEC.workingAreaWidthMm;
    var wH = (CONFIG && CONFIG.workingAreaHeightMm  != null) ? CONFIG.workingAreaHeightMm : MARGIN_SPEC.workingAreaHeightMm;
    var left   = ab[0] + mmToPoints(lM);
    var top    = ab[1] - mmToPoints(tM);
    var right  = left  + mmToPoints(wW);
    var bottom = top   - mmToPoints(wH);
    return [left, top, right, bottom];
}

// Builds the "Margin" layer's band: a compound path of two rectangles (outer =
// artboard, inner = safe area), filled 30% black with the even-odd rule so the
// border band shows and the printable interior is a transparent hole. Locked,
// brought to front — matches the band style artists are used to seeing.
function _bwdMarginBand(doc) {
    var ab = doc.artboards[0].artboardRect;   // [l, t, r, b]
    var mr = marginRect(doc);                  // inner safe area [l, t, r, b]

    var margin = doc.layers.add();
    margin.name = (CONFIG && CONFIG.marginLayerName) ? CONFIG.marginLayerName : "Margin";
    doc.activeLayer = margin;

    var outer = margin.pathItems.rectangle(ab[1], ab[0], ab[2] - ab[0], ab[1] - ab[3]);
    var inner = margin.pathItems.rectangle(mr[1], mr[0], mr[2] - mr[0], mr[1] - mr[3]);

    // Style the rects BEFORE compounding — setting fill on the compound does not
    // propagate to its sub-paths (they keep the default 0-ink fill), so the band
    // would render invisible. Set black fill + no stroke on each rect first.
    var rects = [outer, inner], ri;
    for (ri = 0; ri < rects.length; ri++) {
        rects[ri].filled     = true;
        rects[ri].fillColor  = blackCmyk();
        rects[ri].stroked    = false;
    }

    // "Make Compound Path" on the two rects — the inner becomes a hole.
    app.selection = null;
    outer.selected = true;
    inner.selected = true;
    app.executeMenuCommand("compoundPath");
    app.selection = null;

    var cp = margin.compoundPathItems[0];
    cp.evenodd = true;   // inner rect reads as a hole
    cp.opacity = 30;     // 30% black band — container opacity (applies to the whole compound)

    margin.zOrder(ZOrderMethod.BRINGTOFRONT);
    margin.locked = true;
    return margin;
}

// CMYK(55,0,100,0) — the template's Color Block green (Step 10 green preview).
function _bwdGreen() {
    var c = new CMYKColor();
    c.cyan = 55; c.magenta = 0; c.yellow = 100; c.black = 0;
    return c;
}

// Light grey for the reference grid — subtle, non-printing visual aid.
function _bwdGridColor() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 20;
    return c;
}

// Draws one thin open grid line on the given layer.
function _bwdGridLine(layer, x1, y1, x2, y2, color) {
    var ln = layer.pathItems.add();
    ln.setEntirePath([[x1, y1], [x2, y2]]);
    ln.filled      = false;
    ln.stroked     = true;
    ln.strokeColor = color;
    ln.strokeWidth = 0.3;
    ln.closed      = false;
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

// Returns a CMYKColor set to 0% ink (white).
function whiteCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 0;
    return c;
}

// Returns a CMYKColor set to 100% red (used for QA stroke).
function redCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 100; c.yellow = 100; c.black = 0;
    return c;
}

// Warm amber/orange — the QA colour for MARGIN overflow, distinct at a glance from
// the red used for spacing pinches. Reads clearly over the grey margin band where
// the overhang fill sits.
function amberCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 55; c.yellow = 100; c.black = 0;
    return c;
}

// Cool blue — the NEUTRAL "this element needs attention" halo colour. Deliberately
// not red/amber so an element with BOTH a spacing and a margin issue isn't forced
// into one type-colour: the halo just says "look here" (visible at full-sheet zoom
// as a tint over the sticker), while the red/amber badges carry the problem type.
function haloCmyk() {
    var c = new CMYKColor();
    c.cyan = 70; c.magenta = 30; c.yellow = 0; c.black = 0;
    return c;
}

// Strong blue — the CAPTION-SEAT review badge (Step 3B's conform flagged an uneven
// seat via the note "…|R"). Distinct from the warm red/amber problem badges; says
// "eyeball this caption". Advisory only — it does NOT gate export.
function seatReviewCmyk() {
    var c = new CMYKColor();
    c.cyan = 90; c.magenta = 60; c.yellow = 0; c.black = 0;
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

// Calls fn(pathItem) on every leaf PathItem reachable from item, handling the three
// container shapes uniformly: a PathItem is the leaf; a CompoundPathItem is styled
// through its sub-paths (its own .filled/.strokeColor do NOT reliably propagate —
// setting them left fused cutlines black-filled); a GroupItem is recursed via
// pageItems (the typed collections pathItems/compoundPathItems/groupItems are
// inconsistently recursive across AI versions and silently miss deeper nestings,
// while pageItems lists every direct child of any type). Both strokeRecursive and
// _qaFillRecursive share this walker so a traversal fix lands in one place.
function applyToPathTree(item, fn) {
    if (item.typename === "PathItem") {
        fn(item);
        return;
    }
    if (item.typename === "CompoundPathItem") {
        for (var c = 0; c < item.pathItems.length; c++) fn(item.pathItems[c]);
        return;
    }
    if (item.typename === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) applyToPathTree(item.pageItems[i], fn);
    }
}

// Applies stroke style (and clears fill) to every leaf path of item (PathItem,
// CompoundPathItem sub-paths, or any depth of GroupItem).
function strokeRecursive(item, weightPt, colorObj) {
    applyToPathTree(item, function (p) { setStrokeStyle(p, weightPt, colorObj); });
}

// ─── CAPTION PLATE HELPERS ───────────────────────────────────────────────────

// Builds a caption-plate pill PathItem from AI-space bounds [left, top, right,
// bottom] (AI y-up). Fully rounded ends (radius = half height).
function buildPlate(layer, aiBounds) {
    var left = aiBounds[0], top = aiBounds[1], right = aiBounds[2], bottom = aiBounds[3];
    var w = right - left;
    var h = top - bottom;
    var r = (h < w ? h : w) / 2; // never exceed the shorter half-extent
    var p = layer.pathItems.roundedRectangle(top, left, w, h, r, r);
    p.filled  = true;   // filled so the boolean union has an area to add
    p.stroked = false;
    return p;
}

// Builds a caption-plate capsule PathItem that FOLLOWS a fitted spine (curved or
// tilted captions), instead of an axis-aligned pill. spinePts is an array of
// {x,y} in AI points (y-up); radius in points. This is the AI-side twin of
// Step 3B's _capsulePolygon (Photoshop) — same offset-spine-plus-end-caps math —
// so the cutline's caption portion matches the real White pill. Returns a filled,
// unstroked PathItem ready for deriveCutline's boolean union.
function buildCapsuleFromSpine(layer, spinePts, radius) {
    var poly = _capsulePolygon(spinePts, radius);
    var p = layer.pathItems.add();
    p.setEntirePath(poly);
    p.closed  = true;   // setEntirePath can drop the closed flag
    p.filled  = true;
    p.stroked = false;
    return p;
}

// Offsets a spine polyline by ±radius into a closed capsule polygon (rounded ends).
// Returns an array of [x,y] for setEntirePath. Ported from Step3B_CaptionWhite.jsx.
function _capsulePolygon(spine, r) {
    var n = spine.length, i;
    var top = [], bot = [];

    for (i = 0; i < n; i++) {
        // Local tangent from neighbours (forward/backward diff at the ends).
        var p0 = spine[i > 0 ? i - 1 : i];
        var p1 = spine[i < n - 1 ? i + 1 : i];
        var tx = p1.x - p0.x, ty = p1.y - p0.y;
        var len = Math.sqrt(tx * tx + ty * ty) || 1;
        var nx = -ty / len, ny = tx / len;   // unit normal
        top.push([spine[i].x + r * nx, spine[i].y + r * ny]);
        bot.push([spine[i].x - r * nx, spine[i].y - r * ny]);
    }

    var endT   = _capUnit(spine[n - 1].x - spine[n - 2 >= 0 ? n - 2 : 0].x,
                          spine[n - 1].y - spine[n - 2 >= 0 ? n - 2 : 0].y);
    var startT = _capUnit(spine[0].x - spine[1 < n ? 1 : 0].x,
                          spine[0].y - spine[1 < n ? 1 : 0].y);

    var poly = [], k;
    for (k = 0; k < top.length; k++) poly.push(top[k]);                // one edge
    _appendCap(poly, spine[n - 1], r, top[n - 1], bot[n - 1], endT);   // end cap
    for (k = bot.length - 1; k >= 0; k--) poly.push(bot[k]);           // other edge
    _appendCap(poly, spine[0], r, bot[0], top[0], startT);             // start cap
    return poly;
}

// Appends a semicircular arc of points around centre C (radius r), from fromPt to
// toPt, sweeping through the outward direction `through`.
function _appendCap(poly, C, r, fromPt, toPt, through) {
    var steps = 10;
    var a0 = Math.atan2(fromPt[1] - C.y, fromPt[0] - C.x);
    var a1 = Math.atan2(toPt[1]   - C.y, toPt[0]   - C.x);
    var sweep = a1 - a0;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI)  sweep -= 2 * Math.PI;
    var midAng = a0 + sweep / 2;
    if (Math.cos(midAng) * through[0] + Math.sin(midAng) * through[1] < 0) {
        sweep += (sweep > 0 ? -2 * Math.PI : 2 * Math.PI);
    }
    var s;
    for (s = 1; s < steps; s++) {
        var ang = a0 + sweep * (s / steps);
        poly.push([C.x + r * Math.cos(ang), C.y + r * Math.sin(ang)]);
    }
}

function _capUnit(x, y) {
    var len = Math.sqrt(x * x + y * y) || 1;
    return [x / len, y / len];
}

// Derives the fused cutline = boolean union of element_outline and plate.
// Duplicates both inputs so the originals survive as separable components.
// Returns the resulting item (PathItem, CompoundPathItem, or wrapping GroupItem).
// If the junction doesn't match expectations, swap this body — callers only
// depend on the return value. See docs/caption-separability-architecture.md.
function deriveCutline(outline, plate) {
    var parent = outline.parent;

    var dupOutline = outline.duplicate();
    var dupPlate   = plate.duplicate();

    // Build the union group via the DOM so the operand set is deterministic
    // regardless of the global selection (the "group" menu command no-ops here).
    var unionGroup = parent.groupItems.add();
    dupOutline.move(unionGroup, ElementPlacement.PLACEATEND);
    dupPlate.move(unionGroup, ElementPlacement.PLACEATEND);

    // Clear the selection one item at a time via the DOM. The two other ways to
    // clear are both ruled out on the heavy working doc: `app.selection = null`
    // deadlocks on redraw once the doc accumulates items, and a cross-document
    // temp doc crashes Illustrator (stale live-object reference). `deselectall`
    // (menu) silently no-ops. Per-item `.selected = false` is the remaining
    // lightweight, in-place, crash-free option.
    var sel = app.selection;
    var snap = [];
    var k;
    for (k = 0; k < sel.length; k++) { snap.push(sel[k]); }
    for (k = 0; k < snap.length; k++) { try { snap[k].selected = false; } catch (e) {} }

    unionGroup.selected = true;

    // Live Pathfinder Add unites the selected group's children; expandStyle bakes
    // the live effect into concrete geometry. (No scriptable DOM equivalent.)
    var prevLevel = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    app.executeMenuCommand("Live Pathfinder Add");
    app.executeMenuCommand("expandStyle");
    app.userInteractionLevel = prevLevel;

    return app.selection[0];
}

// Assembles the per-element bundle as a GroupItem so the components ride along
// with the cutline through nesting transforms. Members are named; outline and
// plate are hidden, cutline stays visible. Returns the GroupItem.
// TODO Step 7A follow-up: update to read cutline from each group rather than
// bare PathItems in the Cutlines layer.
function assembleElementGroup(layer, displayName, elementOutline, plate, cutline) {
    var grp = layer.groupItems.add();
    grp.name = displayName;

    elementOutline.name = displayName + " outline";
    plate.name          = displayName + " plate";
    cutline.name        = displayName;

    elementOutline.move(grp, ElementPlacement.PLACEATEND);
    plate.move(grp, ElementPlacement.PLACEATEND);
    cutline.move(grp, ElementPlacement.PLACEATBEGINNING);

    elementOutline.hidden = true;
    plate.hidden          = true;

    return grp;
}

// ─── SEPARABLE-GROUP MEMBER ACCESS ────────────────────────────────────────────
// The per-element bundle (see assembleElementGroup) names its members
// `{displayName}` (visible cutline), `{displayName} outline`, `{displayName} plate`.
// These finders let Steps 8a/8b reach a member without assuming child order.

// Returns the group member whose name is group.name + suffix ("" = cutline,
// " outline", " plate"), or null. Matches the first item with that exact name.
function findGroupMember(group, suffix) {
    var want = group.name + suffix;
    for (var i = 0; i < group.pageItems.length; i++) {
        if (group.pageItems[i].name === want) return group.pageItems[i];
    }
    return null;
}

// ─── RE-UNITE (shared by Steps 8a + 8b) ───────────────────────────────────────

// Re-derives the visible cutline as Unite(outline, plate) and swaps it into the
// group, keeping outline/plate as separable (hidden) components. Used after
// either input changes (8a simplifies outline; 8b resets plate). The boolean op
// needs visible operands, so outline/plate are un-hidden for the op then restored.
// Returns the new cutline item (PathItem/CompoundPathItem/GroupItem).
function reuniteCutline(group, outline, plate, strokePt) {
    var outlineHidden = outline.hidden;
    var plateHidden   = plate.hidden;
    outline.hidden = false;
    plate.hidden   = false;

    var oldCutline = findGroupMember(group, "");

    var newCutline = deriveCutline(outline, plate);
    // Clean the caption junction on the fresh union (no-op when weldFilletRadiusPt is null).
    // Idempotent: a re-Unite re-spikes, this re-cleans → converges. syncHalfcut (called by
    // the Step 8b caller after this) re-fits the half-cut to the cleaned contour.
    cleanCaptionJunction(newCutline, plate, outline, { filletRadiusPt: CONFIG.weldFilletRadiusPt });
    strokeRecursive(newCutline, strokePt, blackCmyk());

    if (oldCutline) oldCutline.remove();
    newCutline.name = group.name;
    newCutline.move(group, ElementPlacement.PLACEATBEGINNING);

    outline.hidden = outlineHidden;
    plate.hidden   = plateHidden;
    return newCutline;
}

// ─── PATH SIMPLIFICATION (Step 8a) ────────────────────────────────────────────
// Native Ramer–Douglas–Peucker anchor reduction + Catmull-Rom bezier refit with
// corner preservation. Illustrator's Object>Path>Simplify is not scriptable
// without a dialog, so this reproduces it deterministically. tolerance/cornerAngle
// are supplied by the caller (CONFIG).

// Perpendicular distance from point p to the line through a–b (all {x,y}).
function _perpDistance(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    if (len2 === 0) {
        var ex = p.x - a.x, ey = p.y - a.y;
        return Math.sqrt(ex * ex + ey * ey);
    }
    var num = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
    return num / Math.sqrt(len2);
}

// Turn angle (deviation from straight, degrees 0..180) at cur between prev and next.
function _turnAngle(prev, cur, next) {
    var v1x = cur.x - prev.x, v1y = cur.y - prev.y;
    var v2x = next.x - cur.x, v2y = next.y - cur.y;
    var m1 = Math.sqrt(v1x * v1x + v1y * v1y);
    var m2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (m1 === 0 || m2 === 0) return 0;
    var cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
    if (cos > 1) cos = 1; else if (cos < -1) cos = -1;
    return Math.acos(cos) * 180 / Math.PI;
}

// Classic recursive RDP on an open polyline of {x,y}. Returns the kept points.
function rdpSimplify(points, epsilon) {
    if (points.length < 3) return points.slice(0);
    var end = points.length - 1;
    var dmax = 0, index = 0, i;
    for (i = 1; i < end; i++) {
        var d = _perpDistance(points[i], points[0], points[end]);
        if (d > dmax) { dmax = d; index = i; }
    }
    if (dmax > epsilon) {
        var r1 = rdpSimplify(points.slice(0, index + 1), epsilon);
        var r2 = rdpSimplify(points.slice(index), epsilon);
        return r1.slice(0, r1.length - 1).concat(r2);
    }
    return [points[0], points[end]];
}

// RDP for a closed polyline: split at the anchor farthest from anchors[0], RDP
// each arc, recombine without repeating the shared endpoints.
function _rdpClosed(anchors, epsilon) {
    var n = anchors.length;
    if (n < 4) return anchors.slice(0);
    var far = 0, dmax = -1, i;
    for (i = 1; i < n; i++) {
        var dx = anchors[i].x - anchors[0].x;
        var dy = anchors[i].y - anchors[0].y;
        var d = dx * dx + dy * dy;
        if (d > dmax) { dmax = d; far = i; }
    }
    var firstHalf  = anchors.slice(0, far + 1);
    var secondHalf = anchors.slice(far).concat([anchors[0]]);
    var k1 = rdpSimplify(firstHalf, epsilon);
    var k2 = rdpSimplify(secondHalf, epsilon);
    return k1.slice(0, k1.length - 1).concat(k2.slice(0, k2.length - 1));
}

// Rewrites a PathItem from a reduced anchor list, assigning Catmull-Rom handles
// for smooth points and zero-length handles (sharp) for corners / open endpoints.
function _applySmoothPath(path, anchors, cornerAngleDeg) {
    var closed = path.closed;
    var n = anchors.length;
    var coords = [], i;
    for (i = 0; i < n; i++) coords.push([anchors[i].x, anchors[i].y]);

    path.setEntirePath(coords);
    path.closed = closed; // setEntirePath can drop the closed flag

    var pts = path.pathPoints;
    for (i = 0; i < n; i++) {
        var prev = anchors[(i - 1 + n) % n];
        var cur  = anchors[i];
        var next = anchors[(i + 1) % n];
        var isEndpoint = (!closed && (i === 0 || i === n - 1));
        var isCorner   = isEndpoint || _turnAngle(prev, cur, next) >= cornerAngleDeg;
        var pp = pts[i];
        if (isCorner) {
            pp.leftDirection  = [cur.x, cur.y];
            pp.rightDirection = [cur.x, cur.y];
            pp.pointType = PointType.CORNER;
        } else {
            var tx = (next.x - prev.x) / 6;
            var ty = (next.y - prev.y) / 6;
            pp.rightDirection = [cur.x + tx, cur.y + ty];
            pp.leftDirection  = [cur.x - tx, cur.y - ty];
            pp.pointType = PointType.SMOOTH;
        }
    }
}

// Simplifies a PathItem (or each sub-path of a CompoundPathItem) in place.
// tolerancePt is the RDP epsilon (points); cornerAngleDeg preserves sharp corners.
// Returns the number of sub-paths actually reduced.
function simplifyPathItem(path, tolerancePt, cornerAngleDeg) {
    if (path.typename === "CompoundPathItem") {
        var reduced = 0, i;
        for (i = 0; i < path.pathItems.length; i++) {
            reduced += simplifyPathItem(path.pathItems[i], tolerancePt, cornerAngleDeg);
        }
        return reduced;
    }
    if (path.typename !== "PathItem") return 0;

    var pts = path.pathPoints;
    if (pts.length < 4) return 0; // too few anchors to meaningfully reduce

    var anchors = [], j;
    for (j = 0; j < pts.length; j++) {
        anchors.push({ x: pts[j].anchor[0], y: pts[j].anchor[1] });
    }

    var kept = path.closed ? _rdpClosed(anchors, tolerancePt)
                           : rdpSimplify(anchors, tolerancePt);

    if (kept.length >= anchors.length) return 0;            // no reduction
    if (kept.length < (path.closed ? 3 : 2)) return 0;      // would collapse — bail

    _applySmoothPath(path, kept, cornerAngleDeg);
    return 1;
}

// ─── STEP 9 SHARED HELPERS ────────────────────────────────────────────────────

// Parses group.note "GC|2" (or "GC|2|R") → { styleCode, capLines, needsReview }.
// Returns null for empty/missing. The optional 3rd field "R" marks a caption seat that
// Step 3B's conform flagged for review (surfaced by AI Layout QA). Used by Step 9A /
// syncHalfcut (filter GC/WC) and Step 8c/AI_LayoutQA (the review marker).
function parseNote(note) {
    if (!note || note === "") return null;
    var parts = note.split("|");
    return {
        styleCode:   parts[0],
        capLines:    parts.length > 1 ? parseInt(parts[1], 10) : 1,
        needsReview: parts.length > 2 && parts[2] === "R"
    };
}

// Returns the halfcut layer (case-insensitive match on CONFIG.halfcutLayerName).
// Creates it above the Cutlines layer if absent.
function getOrCreateHalfcutLayer(doc) {
    var name = CONFIG.halfcutLayerName;
    var i;
    for (i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name.toLowerCase() === name.toLowerCase()) {
            return doc.layers[i];
        }
    }
    var newLayer = doc.layers.add();
    newLayer.name = name;
    var cutLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (cutLayer) {
        newLayer.move(cutLayer, ElementPlacement.PLACEBEFORE);
    }
    log("[step9] created halfcut layer: " + name);
    return newLayer;
}

// Draws a 2-point straight PathItem on layer. Stroke: CONFIG.halfcutStrokePt, black, no fill.
// Returns the line (callers may name it). The straight-chord fallback for syncHalfcut.
function drawHalfcutLine(layer, x1, y1, x2, y2) {
    var line = layer.pathItems.add();
    line.setEntirePath([[x1, y1], [x2, y2]]);
    line.closed = false;
    setStrokeStyle(line, CONFIG.halfcutStrokePt, blackCmyk());
    return line;
}

// Draws an open multi-point PathItem (the half-cut seam polyline) on layer, named
// "{baseName} halfcut" so syncHalfcut can find + clear it on the next run. pts =
// [{x,y}, …]. Stroke = CONFIG.halfcutStrokePt, black, no fill.
function drawHalfcutPath(layer, pts, baseName) {
    var coords = [], i;
    for (i = 0; i < pts.length; i++) coords.push([pts[i].x, pts[i].y]);
    var line = layer.pathItems.add();
    line.setEntirePath(coords);
    line.closed = false;
    if (baseName) line.name = baseName + " halfcut";
    setStrokeStyle(line, CONFIG.halfcutStrokePt, blackCmyk());
    return line;
}

// Removes any existing half-cut path(s) for one element (named "{baseName} halfcut")
// from the halfcut layer, so syncHalfcut is idempotent under the re-run loops (Step 7B
// clears art on entry, Step 8b runs repeatedly). Snapshots refs first — the live
// pathItems collection re-indexes on remove. Returns the number removed.
function _removeHalfcutFor(layer, baseName) {
    var want = baseName + " halfcut";
    var doomed = [], i;
    for (i = 0; i < layer.pathItems.length; i++) {
        if (layer.pathItems[i].name === want) doomed.push(layer.pathItems[i]);
    }
    for (i = 0; i < doomed.length; i++) { try { doomed[i].remove(); } catch (e) {} }
    return doomed.length;
}

// Re-derives and draws ONE element's half-cut from its CURRENT caption seam, so the
// half-cut tracks the caption after any step that creates/moves/rescales it (Step 6
// birth, Step 7B nest-import, Step 8b normalise, Step 9A export). Idempotent: clears
// this element's prior "{name} halfcut" first. GC/WC only (gated on the cutline note);
// stamps / uncaptioned skip. The seam is the arc of the plate's outline submerged in
// the art — straight rigid seat → a near-straight cut, arc/tilted seat → a curved cut
// (the half-cut is derived from real geometry, never assumed flat). Returns
// { ok, reason, curved, fallback }.
//   opts: { extendMm, followSeam } (default from CONFIG.halfcutExtendMm / halfcutFollowSeam)
function syncHalfcut(doc, group, opts) {
    opts = opts || {};
    var extendMm   = (opts.extendMm   != null) ? opts.extendMm   : CONFIG.halfcutExtendMm;
    var followSeam = (opts.followSeam != null) ? opts.followSeam : (CONFIG.halfcutFollowSeam !== false);

    if (!group || group.typename !== "GroupItem") {
        return { ok: false, reason: "stamp / non-group (no caption seam)" };
    }
    var note = parseNote(group.note);
    if (!note || (note.styleCode !== "GC" && note.styleCode !== "WC")) {
        return { ok: false, reason: "not GC/WC" };
    }

    var plate   = findGroupMember(group, " plate");
    var outline = findGroupMember(group, " outline");
    var cutline = findGroupMember(group, "");
    if (!plate)   return { ok: false, reason: "plate subpath not found in group" };
    if (!cutline) return { ok: false, reason: "cutline not found in group" };

    var hcLayer = getOrCreateHalfcutLayer(doc);
    _removeHalfcutFor(hcLayer, group.name);

    var ext = mmToPoints(extendMm);

    // Primary: trace the real seam (the plate's inner edge submerged in the art). Build the
    // seam with RAW ends (extendPt 0), then extend each end to the actual cut line + a 1mm
    // overshoot ALONG THE ART OUTLINE — so the half-cut meets the cut line even where the
    // junction fillet has pulled the contour in off the old plate∩art crossing, and the
    // overshoot tucks along the body cut (not into the caption). cutline is the cleaned member.
    if (followSeam && outline) {
        var seam = plateSeamPath(plate, outline, 0, CONFIG.halfcutSeamSteps);
        if (seam && seam.length >= 2) {
            _extendHalfcutEndsToCutline(seam, cutline, outline, ext, CONFIG.halfcutSeamSteps);
            drawHalfcutPath(hcLayer, seam, group.name);
            return { ok: true, curved: seam.length > 2 };
        }
    }

    // Fallback: legacy flat chord at the plate-top junction Y (bezier-ray crossings).
    var junctionY = plate.geometricBounds[1];
    var crossings = _cutlineCrossingsAtY(cutline, junctionY);
    var x1, x2;
    if (crossings.length >= 2) {
        x1 = crossings[0];
        x2 = crossings[crossings.length - 1];
    } else {
        x1 = plate.geometricBounds[0];
        x2 = plate.geometricBounds[2];
    }
    var line = drawHalfcutLine(hcLayer, x1 - ext, junctionY, x2 + ext, junctionY);
    if (line) line.name = group.name + " halfcut";
    return { ok: true, curved: false, fallback: true };
}

// Builds the half-cut seam polyline = the arc of the PLATE outline that lies INSIDE
// the element art (the submerged inner edge), clipped to the two points where the
// plate boundary crosses the art boundary, then extended by extendPt past each end
// along its own tangent so both peeled flakes get a clean edge. Straight rigid seat →
// a near-straight run (≈ the legacy chord); arc/tilted seat → a curved run. Returns
// [{x,y}, …] (>=2 pts) or null when the plate isn't seated into the art (no inside run,
// or fully buried) — the caller then uses the straight-chord fallback.
function plateSeamPath(plate, outline, extendPt, steps) {
    var s = steps || 16;
    var platePolys = samplePathToPolygons(plate, s);
    var artPolys   = samplePathToPolygons(outline, s);
    if (platePolys.length === 0 || artPolys.length === 0) return null;
    var pp = _largestPoly(platePolys);
    if (!pp) return null;
    var n = pp.length;
    if (n < 4) return null;

    // Inside-art flag per plate vertex (even-odd, so art holes count as outside).
    var inside = [], i, anyIn = false, anyOut = false;
    for (i = 0; i < n; i++) {
        inside[i] = _pointInPolysEO(pp[i], artPolys);
        if (inside[i]) anyIn = true; else anyOut = true;
    }
    if (!anyIn || !anyOut) return null;   // floating (none in) or buried (none out)

    // Longest cyclic run of inside=true. Scan 2n so a run wrapping index 0 is found whole.
    var bestStart = -1, bestLen = 0, curStart = -1, curLen = 0, idx;
    for (i = 0; i < 2 * n; i++) {
        idx = i % n;
        if (inside[idx]) {
            if (curLen === 0) curStart = idx;
            curLen++;
            if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
        } else {
            curLen = 0;
        }
        if (bestLen >= n) break;
    }
    if (bestStart < 0 || bestLen < 1) return null;
    if (bestLen > n) bestLen = n;

    var firstIn     = bestStart;
    var lastIn      = (bestStart + bestLen - 1) % n;
    var beforeFirst = (firstIn - 1 + n) % n;     // outside neighbour
    var afterLast   = (lastIn + 1) % n;          // outside neighbour
    var crossStart  = _segCrossArt(pp[beforeFirst], pp[firstIn], artPolys);
    var crossEnd    = _segCrossArt(pp[afterLast],   pp[lastIn],  artPolys);

    var seam = [crossStart];
    for (i = 0; i < bestLen; i++) seam.push(pp[(bestStart + i) % n]);
    seam.push(crossEnd);

    // Extend each end OUTWARD (away from the submerged run) past the cutline.
    if (extendPt > 0 && seam.length >= 2) {
        var L = seam.length;
        seam[0]     = _extendPoint(seam[0],     seam[1],     extendPt);
        seam[L - 1] = _extendPoint(seam[L - 1], seam[L - 2], extendPt);
    }
    return seam;
}

// Even-odd point-in-polygons test across a sampled path's subpaths (holes subtract).
function _pointInPolysEO(pt, polys) {
    var inside = false, i;
    for (i = 0; i < polys.length; i++) {
        if (pointInPolygon(pt, polys[i])) inside = !inside;
    }
    return inside;
}

// Largest-bbox-area polygon of a set (the plate capsule is a single sub-poly, but a
// Unite/group can wrap extras — take the dominant one).
function _largestPoly(polys) {
    var best = null, bestA = -1, i, bb, a;
    for (i = 0; i < polys.length; i++) {
        bb = _polyBbox(polys[i]);
        a = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
        if (a > bestA) { bestA = a; best = polys[i]; }
    }
    return best;
}

// Given a OUTSIDE the art and b INSIDE the art, bisects to the boundary crossing {x,y}.
function _segCrossArt(a, b, artPolys) {
    var lo = a, hi = b, mid, k;
    for (k = 0; k < 24; k++) {
        mid = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
        if (_pointInPolysEO(mid, artPolys)) hi = mid; else lo = mid;
    }
    return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
}

// Returns `from` moved AWAY from `toward` by dist (extends the seam outward past `from`).
function _extendPoint(from, toward, dist) {
    var dx = from.x - toward.x, dy = from.y - toward.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return { x: from.x, y: from.y };
    return { x: from.x + dx / len * dist, y: from.y + dy / len * dist };
}

// Extends both ends of a raw seam polyline so each meets the CUT LINE, with an overshootPt
// (1mm) tail that follows the ART outline (the body cut, not the caption). Mutates seam[0]
// and seam[last] in place. This decouples the half-cut endpoint from the old plate∩art
// crossing: after the junction fillet pulls the contour off that crossing, the seam end is
// re-projected onto the cleaned cut line so the peel tab still closes. Falls back to a fixed
// outward extension when the cut line can't be sampled or the seam tangent never crosses it.
function _extendHalfcutEndsToCutline(seam, cutline, outline, overshootPt, steps) {
    var L = seam.length;
    if (L < 2) return;
    var cutPolys = cutline ? samplePathToPolygons(cutline, steps) : [];
    var artPolys = outline ? samplePathToPolygons(outline, steps) : [];
    if (cutPolys.length === 0) {                              // can't sample cut line → legacy
        seam[0]     = _extendPoint(seam[0],     seam[1],     overshootPt);
        seam[L - 1] = _extendPoint(seam[L - 1], seam[L - 2], overshootPt);
        return;
    }
    var capPt = overshootPt + mmToPoints(10);                // reach a retracted shoulder, bounded
    seam[0]     = _seamEndToCutline(seam[0],     seam[1],     cutPolys, artPolys, overshootPt, capPt);
    seam[L - 1] = _seamEndToCutline(seam[L - 1], seam[L - 2], cutPolys, artPolys, overshootPt, capPt);
}

// Re-projects one seam endpoint onto the cut line: walks the seam's end-tangent line to the
// nearest cut-line crossing P, then returns P + overshootPt along the ART outline tangent at
// P (oriented to continue outward). Falls back to a fixed seam-tangent extension when no
// crossing is found within capPt.
function _seamEndToCutline(endPt, innerPt, cutPolys, artPolys, overshootPt, capPt) {
    var dx = endPt.x - innerPt.x, dy = endPt.y - innerPt.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return { x: endPt.x, y: endPt.y };
    var ux = dx / len, uy = dy / len;
    var P = _rayCutlineCross(endPt, ux, uy, cutPolys, capPt);
    // Fallback when the seam tangent never meets the cut line (a partial-overlap seam ends
    // mid-pill, with the real junction shoulder off the tangent): aim at the nearest cut-line
    // point lying outward of the seam end, so the half-cut still reaches the contour.
    if (!P) P = _nearestCutPointOutward(endPt, ux, uy, cutPolys, capPt);
    if (!P) return _extendPoint(endPt, innerPt, overshootPt);
    var tan = (artPolys.length > 0) ? _artTangentAt(P, artPolys) : null;
    if (!tan) return { x: P.x + ux * overshootPt, y: P.y + uy * overshootPt };
    if (tan.x * ux + tan.y * uy < 0) { tan = { x: -tan.x, y: -tan.y }; }   // continue outward
    return { x: P.x + tan.x * overshootPt, y: P.y + tan.y * overshootPt };
}

// Nearest cut-line sample vertex that lies OUTWARD of the seam end (positive projection on
// the seam tangent) and within capPt. The half-cut-reach fallback for partial-overlap seams.
function _nearestCutPointOutward(endPt, ux, uy, polys, capPt) {
    var best = null, bd = Infinity, cap2 = capPt * capPt, i, j, poly, v, rx, ry, d2;
    for (i = 0; i < polys.length; i++) {
        poly = polys[i];
        for (j = 0; j < poly.length; j++) {
            v = poly[j];
            rx = v.x - endPt.x; ry = v.y - endPt.y;
            if (rx * ux + ry * uy < 1.0) continue;     // must be outward of the seam end
            d2 = rx * rx + ry * ry;
            if (d2 > cap2) continue;
            if (d2 < bd) { bd = d2; best = { x: v.x, y: v.y }; }
        }
    }
    return best;
}

// Nearest crossing of the line through P (direction ±(ux,uy)) with the cut-line polygons,
// found by even-odd inside-test sign change + bisection, picking the crossing closest to P
// (searches both directions). Returns {x,y} or null. Used to land a half-cut end on the
// cut line regardless of which side of it the raw seam endpoint fell.
function _rayCutlineCross(P, ux, uy, polys, capPt) {
    var step = 0.5, base = _pointInPolysEO(P, polys);
    var best = null, bestAbs = Infinity, s, sgn, prevIn, prevT, kk, t, p2, ins, b, lo, hi, loIn, mid, mp, mi, ct;
    for (s = 0; s < 2; s++) {
        sgn = (s === 0) ? 1 : -1;
        prevIn = base; prevT = 0;
        for (kk = 1; kk * step <= capPt; kk++) {
            t = sgn * kk * step;
            p2 = { x: P.x + ux * t, y: P.y + uy * t };
            ins = _pointInPolysEO(p2, polys);
            if (ins !== prevIn) {
                lo = prevT; hi = t; loIn = prevIn;
                for (b = 0; b < 20; b++) {
                    mid = (lo + hi) / 2; mp = { x: P.x + ux * mid, y: P.y + uy * mid };
                    mi = _pointInPolysEO(mp, polys);
                    if (mi === loIn) lo = mid; else hi = mid;
                }
                ct = (lo + hi) / 2;
                if (Math.abs(ct) < bestAbs) { bestAbs = Math.abs(ct); best = { x: P.x + ux * ct, y: P.y + uy * ct }; }
                break;
            }
            prevIn = ins; prevT = t;
        }
    }
    return best;
}

// Unit tangent of the art outline at the polygon vertex nearest P (central difference).
function _artTangentAt(P, artPolys) {
    var bi = -1, bp = -1, bd = Infinity, i, j, poly, dx, dy, d;
    for (i = 0; i < artPolys.length; i++) {
        poly = artPolys[i];
        for (j = 0; j < poly.length; j++) {
            dx = poly[j].x - P.x; dy = poly[j].y - P.y; d = dx * dx + dy * dy;
            if (d < bd) { bd = d; bi = i; bp = j; }
        }
    }
    if (bi < 0) return null;
    poly = artPolys[bi]; var n = poly.length;
    var a = poly[(bp - 1 + n) % n], c = poly[(bp + 1) % n];
    var tx = c.x - a.x, ty = c.y - a.y, tl = Math.sqrt(tx * tx + ty * ty);
    if (tl < 1e-6) return null;
    return { x: tx / tl, y: ty / tl };
}

// Returns a sorted array of X values where pathItem's outline crosses targetY (AI
// y-up). Handles PathItem and CompoundPathItem via coarse scan + bisection (reuses
// _bezierPoint). Used by syncHalfcut's straight-chord fallback. Moved here from
// Step9A so the half-cut engine is self-contained (callable from Steps 6/7B/8b/9A).
function _cutlineCrossingsAtY(pathItem, targetY) {
    var out = [], i;
    if (pathItem.typename === "PathItem") {
        _crossingsInSubPath(pathItem, targetY, out);
    } else if (pathItem.typename === "CompoundPathItem") {
        for (i = 0; i < pathItem.pathItems.length; i++) {
            _crossingsInSubPath(pathItem.pathItems[i], targetY, out);
        }
    } else if (pathItem.typename === "GroupItem") {
        for (i = 0; i < pathItem.pathItems.length; i++) {
            _crossingsInSubPath(pathItem.pathItems[i], targetY, out);
        }
        for (i = 0; i < pathItem.compoundPathItems.length; i++) {
            var cp = pathItem.compoundPathItems[i];
            for (var j = 0; j < cp.pathItems.length; j++) {
                _crossingsInSubPath(cp.pathItems[j], targetY, out);
            }
        }
    }
    out.sort(function(a, b) { return a - b; });
    return out;
}

// Walks one PathItem's bezier segments. For each segment crossing targetY, bisects to
// the precise X and pushes it into out[].
function _crossingsInSubPath(subPath, targetY, out) {
    var pts   = subPath.pathPoints;
    var n     = pts.length;
    var limit = subPath.closed ? n : n - 1;
    var STEPS  = 64;
    var BISECT = 20;
    var i, j, k, t, lo, hi, mid, ptA, ptB, curY;

    for (i = 0; i < limit; i++) {
        var next = (i + 1) % n;
        var p0 = pts[i].anchor;
        var p1 = pts[i].rightDirection;
        var p2 = pts[next].leftDirection;
        var p3 = pts[next].anchor;

        var prevY = p0[1], prevT = 0;

        for (j = 1; j <= STEPS; j++) {
            t    = j / STEPS;
            ptA  = _bezierPoint(p0, p1, p2, p3, t);
            curY = ptA.y;

            if ((prevY > targetY) !== (curY > targetY)) {
                lo = prevT; hi = t;
                for (k = 0; k < BISECT; k++) {
                    mid = (lo + hi) / 2;
                    ptB = _bezierPoint(p0, p1, p2, p3, mid);
                    if ((ptB.y > targetY) === (prevY > targetY)) {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
                ptB = _bezierPoint(p0, p1, p2, p3, (lo + hi) / 2);
                out.push(ptB.x);
            }
            prevY = curY;
            prevT = t;
        }
    }
}

// ─── CAPTION-JUNCTION CLEANUP (post-Unite spike/sliver removal) ───────────────
// The fused cutline = Unite(element_outline, caption_plate). Where the pill grazes the
// art near-tangentially, Pathfinder leaves a degenerate self-intersection at each
// plate∩art junction: a near-180° "open break" / reversal, a 120–160° "horn", and
// sometimes a tiny sliver sub-path. cleanCaptionJunction removes those. Per junction it
// brackets the whole spike CLUSTER (not one anchor — deleting one promotes its neighbour)
// to clean anchors on each side and rebuilds that span as a smooth circular-arc cubic
// (kappa handle = (4/3)·tan(θ/4)·R, R implied by the bracket chord + turn angle), so the
// junction becomes a soft rounded transition. Junctions are located from the REAL pill∩art
// crossings (works for the tilted WC capsule + the GC pill — not the axis-aligned bbox).
// Idempotent: a fresh Unite's spike is a CORNER anchor and fires; the SMOOTH anchors this
// leaves don't re-fire, so re-running (Step 8b's reuniteCutline) converges. Keeps ONE
// closed contour. No-op when filletRadiusPt is null/0. Returns { filleted, slivers }.
//
// See docs/caption-junction-cutline-quality.md for the diagnosis + why the rejected
// alternatives (raster white-fill, plate-edge extrusion, single-anchor delete) don't work.
function cleanCaptionJunction(cutline, plate, outline, opts) {
    opts = opts || {};
    var R = (opts.filletRadiusPt != null) ? opts.filletRadiusPt : null;
    if (R == null || R <= 0 || !plate || !outline || !cutline) return { filleted: 0, slivers: 0 };
    var steps = (opts.seamSteps != null) ? opts.seamSteps
              : ((typeof CONFIG !== "undefined" && CONFIG.halfcutSeamSteps) ? CONFIG.halfcutSeamSteps : 16);

    var crossings = _captionCrossings(plate, outline, steps);
    if (crossings.length === 0) return { filleted: 0, slivers: 0 };

    // Merge near-duplicate crossings (a sliver presents two crossings a few pt apart).
    var mergeD = (opts.mergeDistPt != null) ? opts.mergeDistPt : 6;
    var merged = [], i, k, dup;
    for (i = 0; i < crossings.length; i++) {
        dup = false;
        for (k = 0; k < merged.length; k++) {
            var dx = crossings[i].x - merged[k].x, dy = crossings[i].y - merged[k].y;
            if (dx * dx + dy * dy <= mergeD * mergeD) { dup = true; break; }
        }
        if (!dup) merged.push(crossings[i]);
    }

    var slivers = _removeJunctionSlivers(cutline, crossings,
        (opts.sliverBandPt != null) ? opts.sliverBandPt : 30,
        (opts.sliverMaxAreaPt2 != null) ? opts.sliverMaxAreaPt2 : 400);

    var main = _largestLeafPath(cutline);
    if (!main) return { filleted: 0, slivers: slivers };

    // Collapse near-coincident consecutive anchors first — the Unite leaves degenerate
    // zero-length-segment folds (duplicate anchors) at some junctions; their noise-angle
    // turns survive the fillet otherwise. Tol stays well under the pill-cap step (~2px) so
    // real cap/art anchors are untouched.
    _collapseDuplicateAnchors(main, (opts.dupTolPt != null) ? opts.dupTolPt : 0.8);

    var filleted = 0, ci;
    for (ci = 0; ci < merged.length; ci++) {
        if (_filletAtCrossing(main, merged[ci], opts)) filleted++;
    }
    return { filleted: filleted, slivers: slivers };
}

// Every pill∩art boundary crossing (each inside<->outside transition on the pill polygon)
// = one junction corner. Robust to partial / multi-island overlap (returns all of them),
// unlike plateSeamPath's single longest-run. Returns [{x,y}, ...] in document points.
function _captionCrossings(plate, outline, steps) {
    var platePolys = samplePathToPolygons(plate, steps);
    var artPolys   = samplePathToPolygons(outline, steps);
    if (platePolys.length === 0 || artPolys.length === 0) return [];
    var pp = _largestPoly(platePolys);
    if (!pp || pp.length < 4) return [];
    var n = pp.length, inside = [], i;
    for (i = 0; i < n; i++) inside[i] = _pointInPolysEO(pp[i], artPolys);
    var out = [], j;
    for (i = 0; i < n; i++) {
        j = (i + 1) % n;
        if (inside[i] !== inside[j]) {
            var a = inside[i] ? pp[j] : pp[i];   // outside vertex
            var b = inside[i] ? pp[i] : pp[j];   // inside vertex
            out.push(_segCrossArt(a, b, artPolys));
        }
    }
    return out;
}

// All leaf PathItems of a cutline (PathItem / CompoundPathItem / GroupItem).
function _cjLeafPaths(item, acc) {
    var t = item.typename, i;
    if (t === "PathItem") { acc.push(item); }
    else if (t === "CompoundPathItem") { for (i = 0; i < item.pathItems.length; i++) acc.push(item.pathItems[i]); }
    else if (t === "GroupItem") { for (i = 0; i < item.pageItems.length; i++) _cjLeafPaths(item.pageItems[i], acc); }
    return acc;
}

function _cjBboxAreaOf(p) { var b = p.geometricBounds; return Math.abs((b[2] - b[0]) * (b[1] - b[3])); }

// Largest-bbox leaf path of a cutline = the real outer contour (slivers are tiny).
function _largestLeafPath(cutline) {
    var leaves = _cjLeafPaths(cutline, []), best = null, bestA = -1, i, a;
    for (i = 0; i < leaves.length; i++) { a = _cjBboxAreaOf(leaves[i]); if (a > bestA) { bestA = a; best = leaves[i]; } }
    return best;
}

// Removes degenerate sliver sub-paths: a NON-largest leaf that is tiny (bbox area below
// maxAreaPt2) AND sits entirely within bandPt of the junction crossings — i.e. the union's
// self-intersection sliver, not a real hole in the art. Returns the count removed.
function _removeJunctionSlivers(cutline, crossings, bandPt, maxAreaPt2) {
    var leaves = _cjLeafPaths(cutline, []);
    if (leaves.length < 2) return 0;
    var largest = _largestLeafPath(cutline);
    var doomed = [], i, kk, p;
    for (i = 0; i < leaves.length; i++) {
        p = leaves[i];
        if (p === largest) continue;
        if (_cjBboxAreaOf(p) > maxAreaPt2) continue;          // big hole → real, keep
        var pts = p.pathPoints, allNear = true;
        for (kk = 0; kk < pts.length; kk++) {
            var an = { x: pts[kk].anchor[0], y: pts[kk].anchor[1] };
            var near = false, c;
            for (c = 0; c < crossings.length; c++) {
                var dx = an.x - crossings[c].x, dy = an.y - crossings[c].y;
                if (dx * dx + dy * dy <= bandPt * bandPt) { near = true; break; }
            }
            if (!near) { allNear = false; break; }
        }
        if (allNear) doomed.push(p);
    }
    for (i = 0; i < doomed.length; i++) { try { doomed[i].remove(); } catch (e) {} }
    return doomed.length;
}

// Removes consecutive (and wrap-around) anchors within tolPt of the previous kept anchor —
// degenerate zero-length-segment folds from the boolean Unite. Preserves handles/types of
// the kept anchors. Returns the count removed. Safe: tolPt is far below the pill-cap step.
function _collapseDuplicateAnchors(sub, tolPt) {
    if (sub.typename !== "PathItem") return 0;
    var pts = sub.pathPoints, n = pts.length;
    if (n < 5) return 0;
    var A = [], L = [], R = [], PT = [], i;
    for (i = 0; i < n; i++) { A[i] = pts[i].anchor; L[i] = pts[i].leftDirection; R[i] = pts[i].rightDirection; PT[i] = pts[i].pointType; }
    var tol2 = tolPt * tolPt, keep = [], removed = 0, dx, dy;
    for (i = 0; i < n; i++) {
        if (keep.length > 0) {
            var pk = keep[keep.length - 1];
            dx = A[i][0] - A[pk][0]; dy = A[i][1] - A[pk][1];
            if (dx * dx + dy * dy <= tol2) { removed++; continue; }
        }
        keep.push(i);
    }
    if (keep.length >= 4) {                                  // wrap: last vs first
        var f = keep[0], l = keep[keep.length - 1];
        dx = A[l][0] - A[f][0]; dy = A[l][1] - A[f][1];
        if (dx * dx + dy * dy <= tol2) { keep.pop(); removed++; }
    }
    if (removed === 0 || keep.length < 4) return 0;
    var coords = [], oL = [], oR = [], oT = [], k;
    for (k = 0; k < keep.length; k++) { coords.push([A[keep[k]][0], A[keep[k]][1]]); oL.push(L[keep[k]]); oR.push(R[keep[k]]); oT.push(PT[keep[k]]); }
    sub.setEntirePath(coords);
    sub.closed = true;
    var np = sub.pathPoints;
    for (k = 0; k < coords.length && k < np.length; k++) {
        np[k].leftDirection  = oL[k];
        np[k].rightDirection = oR[k];
        np[k].pointType      = oT[k];
    }
    return removed;
}

function _cjTurnAt(A, i, n) {
    var p = A[(i - 1 + n) % n], c = A[i], q = A[(i + 1) % n];
    return _turnAngle({ x: p[0], y: p[1] }, { x: c[0], y: c[1] }, { x: q[0], y: q[1] });
}
function _cjDist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
function _cjUnit(ax, ay) { var l = Math.sqrt(ax * ax + ay * ay) || 1; return [ax / l, ay / l]; }

// Fillets one junction crossing C on the main cut-line subpath. Finds the spike apex
// (sharp CORNER anchor nearest C), brackets the whole cluster to clean anchors on each
// side, removes the in-between anchors, and rebuilds the span as a smooth circular-arc
// cubic tangent to both clean edges. Returns true if it acted (idempotent: a no-op once the
// crossing carries only SMOOTH/gentle anchors). opts knobs documented on cleanCaptionJunction.
function _filletAtCrossing(sub, C, opts) {
    if (sub.typename !== "PathItem" || !sub.closed) return false;
    var sharpDeg  = (opts.junctionSharpDeg  != null) ? opts.junctionSharpDeg  : 50;
    var cleanDeg  = (opts.cornerCleanDeg    != null) ? opts.cornerCleanDeg    : 35;
    var maxSeed   = (opts.maxSeedDistPt     != null) ? opts.maxSeedDistPt     : 8;
    var hScale    = (opts.handleScale       != null) ? opts.handleScale       : 1.0;
    var reversalDeg = (opts.reversalDeg     != null) ? opts.reversalDeg       : 95;
    var maxAbsorb   = (opts.maxAbsorbEach   != null) ? opts.maxAbsorbEach     : 8;

    var pts = sub.pathPoints, n = pts.length;
    if (n < 5) return false;
    var A = [], L = [], R = [], PT = [], i;
    for (i = 0; i < n; i++) { A[i] = pts[i].anchor; L[i] = pts[i].leftDirection; R[i] = pts[i].rightDirection; PT[i] = pts[i].pointType; }

    // seed = anchor nearest C (the spike apex sits on the crossing)
    var seed = -1, bestD = Infinity;
    for (i = 0; i < n; i++) { var d = _cjDist(A[i], [C.x, C.y]); if (d < bestD) { bestD = d; seed = i; } }
    if (seed < 0 || bestD > maxSeed) return false;
    if (_cjTurnAt(A, seed, n) < sharpDeg) return false;     // already clean here

    // Idempotency guard: a junction this pass already filleted leaves SMOOTH bracket anchors
    // at the crossing. If the sharpest CORNER-type anchor within maxSeed of C is below
    // sharpDeg, there's no spike left — no-op. A fresh Unite's spike is always a CORNER point.
    var haveSharpCorner = false, qi;
    for (qi = 0; qi < n; qi++) {
        if (_cjDist(A[qi], [C.x, C.y]) > maxSeed) continue;
        if (PT[qi] === PointType.SMOOTH) continue;
        if (_cjTurnAt(A, qi, n) >= sharpDeg) { haveSharpCorner = true; break; }
    }
    if (!haveSharpCorner) return false;

    // Initial bracket: first anchor (each direction) with turn < cleanDeg.
    var iA = (seed - 1 + n) % n, ka = 0;
    while (ka < 12 && _cjTurnAt(A, iA, n) >= cleanDeg) { iA = (iA - 1 + n) % n; ka++; }
    var iB = (seed + 1) % n, kb = 0;
    while (kb < 12 && _cjTurnAt(A, iB, n) >= cleanDeg) { iB = (iB + 1) % n; kb++; }
    if (iA === iB) return false;

    // Iteratively expand each bracket while the bracket anchor would itself be a reversal
    // relative to the proposed straight bridge iA<->iB. Re-evaluating after each expansion
    // absorbs the whole cluster — including the near-tangential RETURN anchor — instead of
    // promoting it to a new spike (the failure mode of single-anchor deletion).
    function bracketReverses(iEnd, iOther, fwd) {
        var nb = fwd ? (iEnd + 1) % n : (iEnd - 1 + n) % n;
        var v1 = [A[iEnd][0] - A[iOther][0], A[iEnd][1] - A[iOther][1]];   // chord into iEnd
        var v2 = [A[nb][0] - A[iEnd][0], A[nb][1] - A[iEnd][1]];          // outward edge
        var m1 = Math.sqrt(v1[0]*v1[0]+v1[1]*v1[1]), m2 = Math.sqrt(v2[0]*v2[0]+v2[1]*v2[1]);
        if (m1 < 1e-6 || m2 < 1e-6) return false;
        var c = (v1[0]*v2[0]+v1[1]*v2[1])/(m1*m2); if (c > 1) c = 1; else if (c < -1) c = -1;
        return (Math.acos(c) * 180 / Math.PI) >= reversalDeg;
    }
    var guard = 0;
    while (guard++ < 2 * maxAbsorb) {
        var moved = false;
        if (bracketReverses(iB, iA, true)  && kb < maxAbsorb) { iB = (iB + 1) % n; kb++; moved = true; }
        if (bracketReverses(iA, iB, false) && ka < maxAbsorb) { iA = (iA - 1 + n) % n; ka++; moved = true; }
        if (!moved) break;
        if (iA === iB) return false;
    }

    // Cluster = indices strictly between iA and iB through the seed (forward arc).
    var cluster = [], ii = (iA + 1) % n;
    while (ii !== iB) { cluster.push(ii); ii = (ii + 1) % n; if (cluster.length > n) return false; }

    // Clean edge directions + circular-arc cubic handle (kappa formula, R from the chord).
    var dirA = _cjUnit(A[iA][0] - A[(iA - 1 + n) % n][0], A[iA][1] - A[(iA - 1 + n) % n][1]);  // into iA
    var dirB = _cjUnit(A[(iB + 1) % n][0] - A[iB][0], A[(iB + 1) % n][1] - A[iB][1]);            // out of iB
    var chord = _cjDist(A[iA], A[iB]);
    var dot = dirA[0]*dirB[0] + dirA[1]*dirB[1]; if (dot > 1) dot = 1; else if (dot < -1) dot = -1;
    var theta = Math.acos(dot);                          // deflection between clean edges (rad)
    var s2 = Math.sin(theta / 2), h;
    if (s2 < 1e-3) { h = chord / 3; }
    else { h = (4 / 3) * Math.tan(theta / 4) * (chord / (2 * s2)); }
    h *= hScale;
    if (h < 0) h = 0;
    if (h > chord * 0.42) h = chord * 0.42;              // cap so the handle can't dip the bridge

    var rm = {}; for (i = 0; i < cluster.length; i++) rm[cluster[i]] = true;
    rm[iA] = false; rm[iB] = false;

    var coords = [], oL = [], oR = [], oT = [], newIA = -1, newIB = -1;
    for (i = 0; i < n; i++) {
        if (rm[i]) continue;
        if (i === iA) newIA = coords.length;
        if (i === iB) newIB = coords.length;
        coords.push([A[i][0], A[i][1]]); oL.push(L[i]); oR.push(R[i]); oT.push(PT[i]);
    }
    if (coords.length < 4 || newIA < 0 || newIB < 0) return false;

    oR[newIA] = [A[iA][0] + dirA[0] * h, A[iA][1] + dirA[1] * h];   // iA right handle along +dirA
    oT[newIA] = PointType.SMOOTH;
    oL[newIB] = [A[iB][0] - dirB[0] * h, A[iB][1] - dirB[1] * h];   // iB left handle along -dirB
    oT[newIB] = PointType.SMOOTH;

    sub.setEntirePath(coords);
    sub.closed = true;                                   // setEntirePath can drop the flag
    var np = sub.pathPoints;
    for (i = 0; i < coords.length && i < np.length; i++) {
        np[i].leftDirection  = oL[i];
        np[i].rightDirection = oR[i];
        np[i].pointType      = oT[i];
    }
    return true;
}

// ─── PURE GEOMETRY (Step 8c QA) ───────────────────────────────────────────────
// Point-space helpers (document points, AI y-up). NOTE: StepQA_NestingQuality.jsx
// keeps its own private _qa_ sampling helpers in sheet-relative mm for the
// occupancy grid; these are general point-space versions, kept separate to avoid
// refactoring that working step. Deterministic and unit-testable.

// Cubic bezier point at parameter t. p0..p3 are [x, y] anchor/handle arrays.
function _bezierPoint(p0, p1, p2, p3, t) {
    var mt  = 1 - t;
    var q0x = mt * p0[0] + t * p1[0], q0y = mt * p0[1] + t * p1[1];
    var q1x = mt * p1[0] + t * p2[0], q1y = mt * p1[1] + t * p2[1];
    var q2x = mt * p2[0] + t * p3[0], q2y = mt * p2[1] + t * p3[1];
    var r0x = mt * q0x   + t * q1x,   r0y = mt * q0y   + t * q1y;
    var r1x = mt * q1x   + t * q2x,   r1y = mt * q1y   + t * q2y;
    return { x: mt * r0x + t * r1x, y: mt * r0y + t * r1y };
}

// Samples one PathItem's bezier segments into a closed polyline of {x, y}.
function _sampleSubPath(subPath, stepsPerSeg) {
    var pts = subPath.pathPoints;
    if (!pts || pts.length < 2) return [];

    var n = pts.length;

    // Snapshot the DOM PathPoints ONCE. Each .anchor/.leftDirection/.rightDirection
    // read crosses the ExtendScript↔host bridge — the dominant cost here — and the
    // old loop read pts[i] both as the current point and (next iteration) as the
    // previous point's neighbour, doubling the crossings. Reading each point once
    // into plain JS arrays yields identical sample coordinates, just faster.
    var A = [], L = [], R = [];
    var k, pp;
    for (k = 0; k < n; k++) {
        pp = pts[k];
        A[k] = pp.anchor;
        L[k] = pp.leftDirection;
        R[k] = pp.rightDirection;
    }

    var poly = [];
    var limit = subPath.closed ? n : n - 1;
    var i, j, t, next;

    for (i = 0; i < limit; i++) {
        next = (i + 1) % n;
        var p0 = A[i];
        var p1 = R[i];
        var p2 = L[next];
        var p3 = A[next];
        for (j = 0; j < stepsPerSeg; j++) {
            t = j / stepsPerSeg;
            poly.push(_bezierPoint(p0, p1, p2, p3, t));
        }
    }
    return poly;
}

// Samples a PathItem/CompoundPathItem/GroupItem into an array of closed polygons
// (each [{x, y}, …] in document points). stepsPerSeg controls precision.
function samplePathToPolygons(item, stepsPerSeg) {
    var polys = [];
    var i, sub;

    if (item.typename === "PathItem") {
        sub = _sampleSubPath(item, stepsPerSeg);
        if (sub.length >= 3) polys.push(sub);

    } else if (item.typename === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) {
            sub = _sampleSubPath(item.pathItems[i], stepsPerSeg);
            if (sub.length >= 3) polys.push(sub);
        }

    } else if (item.typename === "GroupItem") {
        // Pathfinder/offset results are sometimes wrapped in a group.
        for (i = 0; i < item.pathItems.length; i++) {
            sub = _sampleSubPath(item.pathItems[i], stepsPerSeg);
            if (sub.length >= 3) polys.push(sub);
        }
        for (i = 0; i < item.compoundPathItems.length; i++) {
            var cp = samplePathToPolygons(item.compoundPathItems[i], stepsPerSeg);
            for (var k = 0; k < cp.length; k++) polys.push(cp[k]);
        }
        for (i = 0; i < item.groupItems.length; i++) {
            var gp = samplePathToPolygons(item.groupItems[i], stepsPerSeg);
            for (var m = 0; m < gp.length; m++) polys.push(gp[m]);
        }
    }
    return polys;
}

// True if point pt {x, y} is inside polygon poly ([{x, y}, …]) — ray casting.
function pointInPolygon(pt, poly) {
    var inside = false;
    var n = poly.length;
    var i, j;
    for (i = 0, j = n - 1; i < n; j = i++) {
        var yi = poly[i].y, yj = poly[j].y;
        if ((yi > pt.y) !== (yj > pt.y)) {
            var xint = (poly[j].x - poly[i].x) * (pt.y - yi) / (yj - yi) + poly[i].x;
            if (pt.x < xint) inside = !inside;
        }
    }
    return inside;
}

// True if segment a-b intersects segment c-d (all {x, y}). Uses orientation signs.
function segmentsIntersect(a, b, c, d) {
    function cross(o, p, q) {
        return (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    }
    var d1 = cross(c, d, a);
    var d2 = cross(c, d, b);
    var d3 = cross(a, b, c);
    var d4 = cross(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return false;
}

// True if two polygon sets overlap: any edge crossing, or either contains a
// vertex of the other (handles full containment with no edge crossing).
function polygonsOverlap(polysA, polysB) {
    var ai, bi, i, j;
    for (ai = 0; ai < polysA.length; ai++) {
        var A = polysA[ai];
        for (bi = 0; bi < polysB.length; bi++) {
            var B = polysB[bi];
            // Edge-edge crossings.
            for (i = 0; i < A.length; i++) {
                var a1 = A[i], a2 = A[(i + 1) % A.length];
                for (j = 0; j < B.length; j++) {
                    var b1 = B[j], b2 = B[(j + 1) % B.length];
                    if (segmentsIntersect(a1, a2, b1, b2)) return true;
                }
            }
            // Containment (no crossing): one vertex inside the other.
            if (pointInPolygon(A[0], B)) return true;
            if (pointInPolygon(B[0], A)) return true;
        }
    }
    return false;
}

// True if inner geometricBounds [left, top, right, bottom] (AI y-up) lies entirely
// within outer geometricBounds. tolPt allows a small slack (sub-point rounding).
function boundsWithin(inner, outer, tolPt) {
    var t = tolPt || 0;
    return inner[0] >= outer[0] - t &&   // left
           inner[1] <= outer[1] + t &&   // top  (y-up: smaller is lower)
           inner[2] <= outer[2] + t &&   // right
           inner[3] >= outer[3] - t;     // bottom
}

// Closest point ON segment a–b to point p, plus the SQUARED distance. Returns
// { dist2, qx, qy } — qx/qy is the witness point on the segment (all {x, y}).
// minPolygonSetDistanceEx compares squared distances in its hot loop and takes a
// single sqrt at the very end, so the per-pair sqrt (millions of calls) is avoided;
// monotonicity of sqrt makes every comparison identical to a sqrt-based one. (If a
// caller ever needs the actual distance, Math.sqrt(dist2) at the call site.)
function _ptSegClosestSq(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var qx, qy;
    if (len2 === 0) {
        qx = a.x; qy = a.y;
    } else {
        var tv = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        if (tv < 0) tv = 0; else if (tv > 1) tv = 1;
        qx = a.x + tv * dx; qy = a.y + tv * dy;
    }
    var fx = p.x - qx, fy = p.y - qy;
    return { dist2: fx * fx + fy * fy, qx: qx, qy: qy };
}

// Axis-aligned bounding box of a polygon ([{x,y}, …]) as {x0, x1, y0, y1}.
function _polyBbox(poly) {
    var x0 = poly[0].x, x1 = poly[0].x, y0 = poly[0].y, y1 = poly[0].y;
    var i, p;
    for (i = 1; i < poly.length; i++) {
        p = poly[i];
        if (p.x < x0) x0 = p.x; else if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y; else if (p.y > y1) y1 = p.y;
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
}

// Squared distance from point p {x,y} to AABB bb {x0,x1,y0,y1}; 0 if inside.
// This is a LOWER BOUND on p's distance to any point of a polygon contained in bb,
// so if it already exceeds the running minimum the whole polygon can be skipped for
// this vertex without affecting the exact result.
function _ptBboxDist2(p, bb) {
    var dx = (p.x < bb.x0) ? (bb.x0 - p.x) : (p.x > bb.x1 ? p.x - bb.x1 : 0);
    var dy = (p.y < bb.y0) ? (bb.y0 - p.y) : (p.y > bb.y1 ? p.y - bb.y1 : 0);
    return dx * dx + dy * dy;
}

// Minimum distance (points) between two sets of sampled polygons. Returns 0
// immediately if either polygon set contains a vertex of the other (full
// containment). Otherwise the exact minimum is the smallest point-to-edge
// distance across all polygon pairs (both directions). Relies on the sample
// density being fine enough relative to the spacing threshold — at 12 steps/
// segment and typical sticker scales, samples are ~0.4 mm apart, well inside
// the 2 mm QA threshold.
function minPolygonSetDistance(polysA, polysB) {
    return minPolygonSetDistanceEx(polysA, polysB).dist;
}

// Same minimum-distance computation as minPolygonSetDistance, but also returns
// the witness pair — the two closest points, one on each polygon set — so QA can
// draw a connector spanning the actual gap. Returns
//   { dist, ax, ay, bx, by }
// where (ax,ay) lies on polysA and (bx,by) on polysB. On full containment
// (dist 0) the witness collapses to the contained vertex (connector degenerates
// to a dot, which still marks the spot). Points are in the polygons' own
// coordinate space (document points, as produced by samplePathToPolygons).
function minPolygonSetDistanceEx(polysA, polysB) {
    // Work in SQUARED distance throughout (no per-pair sqrt) and prune each vertex
    // against the other polygon's bounding box. Both are exact: sqrt is monotonic so
    // every comparison is unchanged, and a vertex whose distance to B's bbox already
    // exceeds the running min cannot beat it (bbox distance is a lower bound), so
    // skipping it leaves the minimum AND the witness pair byte-identical to brute
    // force. This is the heavy inner loop of spacing QA — formerly ~13s of the run.
    var minD2 = Infinity;
    var wax = 0, way = 0, wbx = 0, wby = 0;
    var ai, bi, pi, qi, c;

    // Precompute each B polygon's bbox ONCE — it doesn't depend on ai, so computing
    // it inside the ai-loop would rescan every B once per A polygon (only bites
    // multi-poly compound-path sets, but it's free to hoist).
    var bbBs = [];
    for (bi = 0; bi < polysB.length; bi++) bbBs[bi] = _polyBbox(polysB[bi]);

    for (ai = 0; ai < polysA.length; ai++) {
        var A = polysA[ai];
        var nA = A.length;
        var bbA = _polyBbox(A);
        for (bi = 0; bi < polysB.length; bi++) {
            var B = polysB[bi];
            var nB = B.length;
            if (pointInPolygon(A[0], B)) {
                return { dist: 0, ax: A[0].x, ay: A[0].y, bx: A[0].x, by: A[0].y };
            }
            if (pointInPolygon(B[0], A)) {
                return { dist: 0, ax: B[0].x, ay: B[0].y, bx: B[0].x, by: B[0].y };
            }
            var bbB = bbBs[bi];
            // A vertices vs B edges — witness on A is the vertex, on B the projection.
            for (pi = 0; pi < nA; pi++) {
                var ap = A[pi];
                if (_ptBboxDist2(ap, bbB) >= minD2) continue;  // exact prune
                for (qi = 0; qi < nB; qi++) {
                    c = _ptSegClosestSq(ap, B[qi], B[(qi + 1) % nB]);
                    if (c.dist2 < minD2) {
                        minD2 = c.dist2;
                        wax = ap.x; way = ap.y; wbx = c.qx; wby = c.qy;
                    }
                }
            }
            // B vertices vs A edges — witness on B is the vertex, on A the projection.
            for (pi = 0; pi < nB; pi++) {
                var bp = B[pi];
                if (_ptBboxDist2(bp, bbA) >= minD2) continue;  // exact prune
                for (qi = 0; qi < nA; qi++) {
                    c = _ptSegClosestSq(bp, A[qi], A[(qi + 1) % nA]);
                    if (c.dist2 < minD2) {
                        minD2 = c.dist2;
                        wbx = bp.x; wby = bp.y; wax = c.qx; way = c.qy;
                    }
                }
            }
        }
    }
    return { dist: Math.sqrt(minD2), ax: wax, ay: way, bx: wbx, by: wby };
}


// ─── QA VISUAL OVERLAY ──────────────────────────────────────────────────────────
// One throwaway layer holds EVERY QA visual — spacing/margin flag markers (Step 8c)
// and NQI pocket fills (StepQA) — so the artist toggles a single layer to show/hide
// all of it, and the real cutlines stay pristine 0.25pt black (no in-place recolor).
// Step 11 strips this layer by name, so it never reaches the final print file.

// Returns the shared QA layer, creating it if absent. With reset=true, any existing
// QA layer is removed and rebuilt empty (clears stale markers from a prior run) —
// the FIRST phase of a run passes reset=true; later phases pass reset=false to
// append. Brought to front and unlocked so its contents draw over the artwork.
function getOrCreateQALayer(doc, name, reset) {
    var existing = findLayer(doc, name);
    if (existing) {
        if (!reset) {
            existing.locked  = false;
            existing.visible = true;
            return existing;
        }
        existing.locked  = false;
        existing.visible = true;   // a hidden layer can't be removed
        existing.remove();
    }
    var layer = doc.layers.add();
    layer.name = name;
    layer.zOrder(ZOrderMethod.BRINGTOFRONT);
    return layer;
}

// Draws a filled dot centred at (cxPt, cyPt). Illustrator y is up, and ellipse()
// takes the TOP edge, so top = cy + radius. Stroke off; semi-transparent fill.
function qaDrawDot(layer, cxPt, cyPt, radiusPt, colorObj, opacity) {
    var dot = layer.pathItems.ellipse(
        cyPt + radiusPt, cxPt - radiusPt, radiusPt * 2, radiusPt * 2);
    dot.stroked   = false;
    dot.filled    = true;
    dot.fillColor = colorObj;
    dot.opacity   = (opacity === undefined) ? 100 : opacity;
    return dot;
}

// Draws an open 2-point line between (x1,y1) and (x2,y2) — the gap connector.
function qaDrawSegment(layer, x1, y1, x2, y2, colorObj, widthPt, opacity) {
    var seg = layer.pathItems.add();
    seg.setEntirePath([[x1, y1], [x2, y2]]);
    seg.closed      = false;
    seg.stroked     = true;
    seg.filled      = false;
    seg.strokeWidth = widthPt;
    seg.strokeColor = colorObj;
    seg.opacity     = (opacity === undefined) ? 100 : opacity;
    return seg;
}

// Duplicates a cutline outline onto the QA layer and FILLS it (no stroke) with a
// translucent colour — the element "halo" that glows over the whole sticker so a
// flagged element is spottable at full-sheet zoom regardless of how small the
// actual violation is. Same-document duplicate. Returns the duplicate, or null if
// the item can't be filled (e.g. a PlacedItem stamp — halo its bbox instead).
function qaHaloElement(layer, item, colorObj, opacity) {
    var tn = item.typename;
    if (tn !== "PathItem" && tn !== "CompoundPathItem" && tn !== "GroupItem") {
        return null;
    }
    var dup = item.duplicate(layer, ElementPlacement.PLACEATEND);
    _qaFillRecursive(dup, colorObj);
    dup.opacity = (opacity === undefined) ? 100 : opacity;
    return dup;
}

// Fills every leaf path of item (clearing stroke) — the fill counterpart of
// strokeRecursive, used by qaHaloElement. Shares the applyToPathTree walker.
function _qaFillRecursive(item, colorObj) {
    applyToPathTree(item, function (p) {
        p.filled = true; p.fillColor = colorObj; p.stroked = false;
    });
}

// Draws a filled triangular arrow (badge) centred at (cx,cy), pointing along the
// unit direction (dirX,dirY), with overall length sizePt. Used for the amber
// margin badge sitting in the gutter and pointing inward (which way to pull it in).
function qaDrawArrow(layer, cx, cy, dirX, dirY, sizePt, colorObj, opacity) {
    var hx = dirX * sizePt / 2, hy = dirY * sizePt / 2;   // half-vector along dir
    var px = -dirY, py = dirX;                            // perpendicular unit
    var bw = sizePt * 0.5;                                // half base width
    var t = layer.pathItems.add();
    t.setEntirePath([
        [cx + hx,            cy + hy],            // tip
        [cx - hx + px * bw,  cy - hy + py * bw],  // base corner 1
        [cx - hx - px * bw,  cy - hy - py * bw]   // base corner 2
    ]);
    t.closed    = true;
    t.stroked   = false;
    t.filled    = true;
    t.fillColor = colorObj;
    t.opacity   = (opacity === undefined) ? 100 : opacity;
    return t;
}

// Draws a filled (unstroked) polygon on the layer from an array of {x,y} points —
// used for the amber margin-overhang sliver. Skips degenerate (<3 point) input.
function qaFillPolygon(layer, poly, colorObj, opacity) {
    if (!poly || poly.length < 3) return null;
    var pts = [], i;
    for (i = 0; i < poly.length; i++) pts.push([poly[i].x, poly[i].y]);
    var p = layer.pathItems.add();
    p.setEntirePath(pts);
    p.closed    = true;
    p.stroked   = false;
    p.filled    = true;
    p.fillColor = colorObj;
    p.opacity   = (opacity === undefined) ? 100 : opacity;
    return p;
}

// Sutherland–Hodgman clip of a polygon ({x,y}[]) to one axis-aligned half-plane.
// axis "x" or "y"; keeps the portion on the value side selected by keepGreater
// (true → coord >= value, false → coord <= value). Returns the clipped polygon
// (possibly empty). Clipping a closed outline to the OUTSIDE half-plane of a margin
// edge yields exactly the overhang sliver beyond that edge — no boolean ops needed.
function clipPolygonToHalfPlane(poly, axis, value, keepGreater) {
    var out = [], n = poly.length, i;
    function coord(p) { return (axis === "x") ? p.x : p.y; }
    function inside(p) { return keepGreater ? (coord(p) >= value) : (coord(p) <= value); }
    function isect(a, b) {
        var ca = coord(a), cb = coord(b);
        var t = (cb === ca) ? 0 : (value - ca) / (cb - ca);
        return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    for (i = 0; i < n; i++) {
        var cur  = poly[i];
        var prev = poly[(i + n - 1) % n];
        var curIn = inside(cur), prevIn = inside(prev);
        if (curIn) {
            if (!prevIn) out.push(isect(prev, cur));
            out.push(cur);
        } else if (prevIn) {
            out.push(isect(prev, cur));
        }
    }
    return out;
}
