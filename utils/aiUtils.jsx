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

// Applies stroke style to a PathItem/CompoundPathItem, or recurses into a
// GroupItem (Pathfinder results are sometimes wrapped in a group). Used so the
// derived cutline gets a stroke regardless of how the boolean op nests it.
function strokeRecursive(item, weightPt, colorObj) {
    if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
        setStrokeStyle(item, weightPt, colorObj);
        return;
    }
    if (item.typename === "GroupItem") {
        var i;
        for (i = 0; i < item.pathItems.length; i++) {
            setStrokeStyle(item.pathItems[i], weightPt, colorObj);
        }
        for (i = 0; i < item.compoundPathItems.length; i++) {
            setStrokeStyle(item.compoundPathItems[i], weightPt, colorObj);
        }
        for (i = 0; i < item.groupItems.length; i++) {
            strokeRecursive(item.groupItems[i], weightPt, colorObj);
        }
    }
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

// Derives the fused cutline = boolean union of element_outline and plate.
// Duplicates both inputs so the originals survive as separable components.
// Returns the resulting item (PathItem, CompoundPathItem, or wrapping GroupItem).
// If the junction doesn't match expectations, swap this body — callers only
// depend on the return value. See docs/caption-separability-architecture.md.
function deriveCutline(outline, plate) {
    var dupOutline = outline.duplicate();
    var dupPlate   = plate.duplicate();

    app.selection = null;
    dupOutline.selected = true;
    dupPlate.selected   = true;

    // Non-destructive Pathfinder "Add", then expand to a concrete path.
    app.executeMenuCommand("Live Pathfinder Add");
    app.executeMenuCommand("expandStyle");

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
    strokeRecursive(newCutline, strokePt, blackCmyk());

    if (oldCutline) oldCutline.remove();
    newCutline.name = group.name;
    newCutline.move(group, ElementPlacement.PLACEATBEGINNING);

    outline.hidden = outlineHidden;
    plate.hidden   = plateHidden;
    return newCutline;
}

// ─── PLATE RESET (Step 8b) ────────────────────────────────────────────────────

// Rebuilds a caption plate to a canonical absolute height (specHeightPt), anchored
// at its top-centre (the junction with the element art) and preserving aspect so
// the pill's corner radius stays proportional. Replaces the old plate in place,
// keeping its name and hidden state. Returns the new plate PathItem.
function rebuildPlateToHeight(plate, specHeightPt) {
    var gb = plate.geometricBounds;          // [left, top, right, bottom] (AI y-up)
    var left = gb[0], top = gb[1], right = gb[2], bottom = gb[3];
    var curH = top - bottom;
    if (curH <= 0) return plate;             // degenerate — leave untouched

    var scale = specHeightPt / curH;
    var newW  = (right - left) * scale;
    var cx    = (left + right) / 2;

    var newPlate = buildPlate(plate.parent,
        [cx - newW / 2, top, cx + newW / 2, top - specHeightPt]);

    newPlate.name   = plate.name;
    newPlate.hidden = plate.hidden;
    plate.remove();
    return newPlate;
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
