// tests/spike/ai_caption_build_spike.jsx — THROWAWAY runner for Task 5 inspection.
// Traces a few white-edged silhouettes -> outline (the cut boundary), typesets a Kalam caption
// (straight point text, and one curved via path text), runs buildCaption, lays out the results.
#target illustrator
#include "../../utils/aiUtils.jsx"

// Minimal CONFIG the reused aiUtils functions read (seat + half-cut + layers).
var CONFIG = {
    cutlinesLayerName: "Cutlines",
    halfcutLayerName:  "Halfcut",
    halfcutExtendMm:   1,
    halfcutSeamSteps:  16,
    halfcutStrokePt:   0.25,
    seatConform:       true,
    seatOverlapMm:     0.1,
    seatSampleSteps:   24,
    seatShrinkFrac:    0.15,
    maxSeatRotationDeg: 75,
    seatRotationSign:  1,
    captionMidProtrudeFrac: 0.25,
    cutlineStrokePt:   0.25
};

var SPIKE = {
    inFolder: "~/Desktop/spine-spike-we",
    cellMm: 75, gapMm: 14, cols: 3,
    cases: [
        { file: "elem_02", text: "St Elizabeth's Cathedral", curve: false },  // building, straight
        { file: "elem_09", text: "Bryndzove halusky",        curve: true  },  // food, curved
        { file: "elem_23", text: "Bratislava Castle",         curve: false }   // castle, straight
    ]
};

function main() {
    var _uil = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;   // no blocking dialogs (headless)
    var inF = new Folder(SPIKE.inFolder);
    var doc = app.documents.add();
    var layer = doc.layers[0];
    layer.name = CONFIG.cutlinesLayerName;          // half-cut layer is created above this

    var cell = mmToPoints(SPIKE.cellMm), gap = mmToPoints(SPIKE.gapMm), m = mmToPoints(15);
    var built = 0, logLines = [], i;
    for (i = 0; i < SPIKE.cases.length; i++) {
        var c = SPIKE.cases[i];
        var sil = new File(inF.fsName + "/" + c.file + "_silhouette.png");
        if (!sil.exists) { logLines.push(c.file + " MISSING"); continue; }
        var col = built % SPIKE.cols, row = Math.floor(built / SPIKE.cols);
        var ox = m + col * (cell + gap), oy = -(m + row * (cell + gap));
        var msg;
        try { msg = buildCase(doc, layer, sil, c, ox, oy, cell); }
        catch (e) { msg = "ERR line " + e.line + ": " + e.message; }
        logLines.push(c.file + " | " + c.text + (c.curve ? " (curved)" : "") + " -> " + msg);
        built++;
    }
    app.redraw();
    app.userInteractionLevel = _uil;
    $.global.__msg = "caption build: " + built + " case(s)\n" + logLines.join("\n");
    alert($.global.__msg);
}

function buildCase(doc, layer, silFile, c, ox, oy, cell) {
    // Trace the white-edged silhouette -> the outline (cut boundary).
    var placed = layer.placedItems.add();
    placed.file = silFile;
    var sc = cell / Math.max(placed.width, placed.height) * 100;
    placed.resize(sc, sc);
    placed.position = [ox, oy];
    var pi = placed.trace();
    pi.tracing.tracingOptions.loadFromPreset("Silhouettes");
    app.redraw();
    var tg = pi.tracing.expandTracing();
    var outline = _largestPathOf(tg);
    if (!outline) return "no outline";
    // remove any non-outline leftovers from the traced group so only the outline remains
    _keepOnly(tg, outline);

    var ob = outline.geometricBounds;               // [l,t,r,b] y-up
    var ecx = (ob[0] + ob[2]) / 2;

    // Typeset the caption: straight point text, or curved path text.
    var tf;
    if (c.curve) {
        var w = (ob[2] - ob[0]) * 0.7, sag = mmToPoints(6);
        var bx = ecx - w / 2, by = ob[3] - mmToPoints(7);   // below the element
        var arc = layer.pathItems.add();
        arc.setEntirePath([[bx, by], [ecx, by + sag], [bx + w, by]]);  // gentle upward arc
        arc.stroked = false; arc.filled = false;
        tf = layer.textFrames.pathText(arc);
    } else {
        tf = layer.textFrames.add();
    }
    tf.contents = c.text;
    _style(tf);
    if (!c.curve) {
        var tb = tf.geometricBounds, tcx = (tb[0] + tb[2]) / 2;
        tf.translate(ecx - tcx, (ob[3] - mmToPoints(3)) - tb[1]);  // centre just below the element
    }

    var res = buildCaption(doc, layer, tf, outline, { name: c.text, styleCode: "WC" });
    var dbg = "";
    if (res.ok && res.group) {
        var cutM = findGroupMember(res.group, "");
        var olM  = findGroupMember(res.group, " outline");
        var plM  = findGroupMember(res.group, " plate");
        if (cutM) strokeRecursive(cutM, 0.6, blackCmyk());
        var subN = cutM ? (cutM.typename === "CompoundPathItem" ? cutM.pathItems.length : 1) : -1;
        if (olM && plM) {
            dbg = " | outlineBot=" + Math.round(olM.geometricBounds[3])
                + " pillTop=" + Math.round(plM.geometricBounds[1])
                + " pillBot=" + Math.round(plM.geometricBounds[3])
                + " cutSubpaths=" + subN + " moved=" + (res.moved != null ? Math.round(res.moved) : "?");
        }
    }
    return "ok=" + res.ok + " review=" + res.needsReview
         + " halfcut=" + res.halfcut + (res.reason ? (" (" + res.reason + ")") : "") + dbg;
}

function _style(tf) {
    try { tf.textRange.characterAttributes.size = 8; } catch (e) {}
    try { tf.textRange.characterAttributes.textFont = app.textFonts.getByName("Kalam-Regular"); } catch (e2) {}
    try { tf.textRange.characterAttributes.tracking = -20; } catch (e3) {}
}

function _largestPathOf(item) {
    var best = null, bestA = -1;
    function area(it) { var b = it.geometricBounds; return Math.abs((b[2] - b[0]) * (b[1] - b[3])); }
    function visit(it) {
        var t = it.typename;
        if (t === "PathItem" || t === "CompoundPathItem") { var a = area(it); if (a > bestA) { bestA = a; best = it; } }
        else if (t === "GroupItem") { for (var i = 0; i < it.pageItems.length; i++) visit(it.pageItems[i]); }
    }
    visit(item);
    return best;
}

// Remove every leaf except `keep` from a traced group, then return keep (un-grouped if needed).
function _keepOnly(group, keep) {
    var doomed = [], i;
    function collect(it) {
        var t = it.typename;
        if (it === keep) return;
        if (t === "PathItem" || t === "CompoundPathItem") doomed.push(it);
        else if (t === "GroupItem") { for (var k = 0; k < it.pageItems.length; k++) collect(it.pageItems[k]); }
    }
    collect(group);
    for (i = 0; i < doomed.length; i++) { try { doomed[i].remove(); } catch (e) {} }
}

try { main(); }
catch (e) { alert("Spike error line " + e.line + ": " + e.message); }
