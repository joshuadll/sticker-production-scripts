#target illustrator
#include "../utils/json2.jsx"
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step7A_DeepnestExport.jsx"

// Pipeline 2 — "Build and Export Cutlines" (launched from Illustrator).
// After the artist reviews the native caption text placed by Pipeline 1, this builds each
// caption (white pill -> seat into the traced cut -> unite -> bundle -> half-cut; GC also
// places a scaled decorative plate raster), then exports SVGs for Deepnest (Step 7A).

var CONFIG = {
    dryRun:           false,
    suppressAlerts:   false,
    logPath:          "",

    cutlinesLayerName: "Cutlines",
    stickersLayerName: "Sticker",
    cutlineStrokePt:  0.25,

    // Caption vector seat (aiUtils.seatPlateToOutline) — same knobs as AI_BuildCutlines.
    seatOverlapMm:       0.1,
    seatSampleSteps:     24,
    seatConform:         true,
    seatRotationSign:    1,
    maxSeatRotationDeg:  75,
    seatBaselineEpsPt:   0.5,
    seatShrinkFrac:      0.15,
    captionMidProtrudeFrac: 0.25,
    seatDebug:           false,

    // Half-cut (shared aiUtils helpers).
    halfcutLayerName: "Halfcut",
    halfcutStrokePt:  0.25,
    halfcutExtendMm:  1.0,
    halfcutSeamSteps: 16,

    // GC decorative plate raster (placed behind the caption; tunable, validate on a GC SKU).
    plateHeightMm:    4.0,
    plateWidthPadMm:  1.69,

    // Step 7A Deepnest export.
    deepnestRectThreshold: 0.82
};
var _root = $.fileName ? new File($.fileName).parent.parent.fsName : Folder.desktop.fsName;
CONFIG.logPath = _root + "/pipelines/AI_BuildAndExportCutlines.log";

// ── Doc work (callable directly by tests/handoff with CONFIG pre-set) ────────────
// Builds every WC/GC caption on `doc` from the named outline + caption-text members that
// Pipeline 1 placed, then runs the Deepnest export. Returns a summary object.
function runBuildAndExport(doc) {
    var layer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!layer) return { ok: false, error: "no Cutlines layer" };

    var sidecar = _readSidecarBeside(doc);
    if (!sidecar) return { ok: false, error: "no *_elements.json sidecar beside the .ai" };

    var folderFs = doc.fullName.parent.fsName;
    var plateFile = _findPlatePng(folderFs, doc);   // GC plate PNG, or null

    var built = 0, skipped = [], failed = [], i;
    for (i = 0; i < sidecar.elements.length; i++) {
        var el = sidecar.elements[i];
        if (el.styleCode !== "WC" && el.styleCode !== "GC") continue;   // ST / uncaptioned
        var outline   = _findItemByName(layer, el.displayName + " outline");
        var textFrame = _findItemByName(layer, el.displayName + " caption text");
        if (!outline || !textFrame) {
            skipped.push(el.displayName + (outline ? "" : " [no outline]") + (textFrame ? "" : " [no text]"));
            continue;
        }
        var opts = { name: el.displayName, styleCode: el.styleCode, strokePt: CONFIG.cutlineStrokePt };
        if (el.styleCode === "GC" && plateFile) {
            opts.plateRasterFile = plateFile;
            opts.plateHeightMm   = CONFIG.plateHeightMm;
            opts.plateWidthPadMm = CONFIG.plateWidthPadMm;
        }
        var res;
        try { res = buildCaption(doc, layer, textFrame, outline, opts); }
        catch (eB) { failed.push(el.displayName + " (line " + eB.line + ": " + eB.message + ")"); continue; }
        if (res && res.ok) {
            built++;
            log("[ai-pipeline] caption built | " + el.displayName + " halfcut=" + res.halfcut
                + (res.needsReview ? " REVIEW" : ""));
        } else {
            failed.push(el.displayName + (res ? " (" + res.reason + ")" : ""));
        }
    }
    log("[ai-pipeline] captions built: " + built + " | skipped: " + skipped.length
        + " | failed: " + failed.length);

    if (failed.length) return { ok: false, built: built, skipped: skipped, failed: failed };

    var exp = null;
    if (!CONFIG.dryRun) { exp = runDeepnestExport(doc); }
    return { ok: true, built: built, skipped: skipped, failed: failed, exportResult: exp };
}

// ── main(): resolve the working doc, run the build, surface the outcome ──────────
function main() {
    try {
        log("[ai-pipeline] === AI_BuildAndExportCutlines start ===");
        var doc = _resolveWorkingDoc();
        if (!doc) { scriptAlert("No working document with a Cutlines layer is open.\nRun Pipeline 1 (Build Elements) first."); return; }

        var r = runBuildAndExport(doc);
        if (!r.ok && r.error) { scriptAlert("Couldn't build cut lines:\n" + r.error + "\nLog: " + CONFIG.logPath); return; }
        if (!r.ok && r.failed && r.failed.length) {
            scriptAlert("⚠️ " + r.failed.length + " caption(s) couldn't be built:\n  • " + r.failed.join("\n  • ")
                + "\n\nFix the caption text/seating in Illustrator and re-run. (Built " + r.built + ".)");
            return;   // do NOT export a partial nest
        }
        log("[ai-pipeline] === AI_BuildAndExportCutlines done ===");
        var svgs = (r.exportResult && r.exportResult.regularPath) ? "both SVGs exported" : "SVG export — see log";
        scriptAlert("✅ Cut lines built (" + r.built + ") + " + svgs + ".\n\n"
            + "Review both SVGs, run Deepnest, then run AI_ImportNesting.");
    } catch (e) {
        scriptAlert("ERROR (line " + e.line + "): " + e.message + "\nLog: " + CONFIG.logPath);
    }
}

function _resolveWorkingDoc() {
    var i;
    for (i = 0; i < app.documents.length; i++) {
        if (findLayer(app.documents[i], CONFIG.cutlinesLayerName)) return app.documents[i];
    }
    return null;
}
function _findItemByName(layer, want) {
    var i;
    for (i = 0; i < layer.pageItems.length; i++) { if (layer.pageItems[i].name === want) return layer.pageItems[i]; }
    return null;
}
function _readSidecarBeside(doc) {
    var base = doc.fullName.fsName.replace(/\.ai$/i, "");
    var f = new File(base + "_elements.json");
    if (!f.exists) return null;
    f.open("r"); var txt = f.read(); f.close();
    try { return JSON.parse(txt); } catch (e) { return null; }
}
function _findPlatePng(folderFs, doc) {
    var base = doc.fullName.name.replace(/\.ai$/i, "");
    var f = new File(folderFs + "/" + base + "_caption_plate.png");
    return f.exists ? f : null;
}

// Dispatch: artist double-click runs main(); a test/handoff sets $.global.__p2Handoff = true
// BEFORE evaluating this file, then calls runBuildAndExport() itself (with CONFIG pre-set).
var _p2Handoff = $.global.__p2Handoff;
$.global.__p2Handoff = false;
if (!_p2Handoff) { main(); }
