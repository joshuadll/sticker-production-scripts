#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step6_CreateCutlines.jsx"
#include "../illustrator/Step7A_DeepnestExport.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:         false,
    suppressAlerts: false,
    logPath:        "", // resolved below

    // ── Step 6: Create Cutlines ──────────────────────────────────────────────
    workingAreaWidthMm:  190,
    workingAreaHeightMm: 267,
    cutlineStrokePt:     0.25,
    cutlinesLayerName:   "Cutlines",
    stickersLayerName:   "Stickers",

    // ── Step 7A: Deepnest Export ─────────────────────────────────────────────
    // Extent ratio threshold: paths >= this are "regular" (90° rotation in Deepnest).
    // Tune on first real SKU run — every path's ratio is logged.
    deepnestRectThreshold: 0.82
};

var _root = $.fileName
    ? new File($.fileName).parent.parent.fsName
    : Folder.desktop.fsName;

CONFIG.logPath           = _root + "/pipelines/AI_BuildCutlines.log";
CONFIG.stampTemplatePath = _root + "/assets/Stamp Cutline Template.ai";

// ─── SHARED: Step 7A export ───────────────────────────────────────────────────

function _runExportForNesting(doc) {
    log("[pipeline] --- Step 7A: Deepnest export ---");
    log("[pipeline] threshold: " + CONFIG.deepnestRectThreshold);

    var result = runDeepnestExport(doc);

    if (!result) {
        scriptAlert("Step 7A failed — Cutlines layer not found.\n"
            + "Make sure Step 6 has been run on this document.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    log("[pipeline] === AI_BuildCutlines done ===");

    if (!CONFIG.dryRun) {
        var _prevUI = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        if (result.regularPath)   { app.open(new File(result.regularPath)); }
        if (result.irregularPath) { app.open(new File(result.irregularPath)); }
        app.userInteractionLevel = _prevUI;
    }

    scriptAlert("Done.\n\n"
        + "  Regular   (" + result.regular   + " paths): " + (result.regularPath   || "—") + "\n"
        + "  Irregular (" + result.irregular + " paths): " + (result.irregularPath || "—") + "\n\n"
        + "Review both SVGs now open in Illustrator.\n"
        + "Move any misclassified paths between files, then File > Save each.\n\n"
        + "Then import each SVG into Deepnest:\n"
        + "  Regular   → 90° increments, gap 1mm\n"
        + "  Irregular → free rotation, gap 1.5mm\n\n"
        + "Threshold used: " + CONFIG.deepnestRectThreshold
        + "  (see log for per-path ratios to calibrate)\n\n"
        + "Log: " + CONFIG.logPath);
}

// ─── ENTRY POINT: BridgeTalk from PSAI_BuildAndExportCutlines.jsx ───────────────────────

// Set by buildDocAndImport so main() knows not to double-fire Step 7A.
var _ranViaHandoff = false;

// Builds the working document from scratch (no template file) and runs Step 6.
function buildDocAndImport(silhPngPath, elementsFilePath) {
    _ranViaHandoff = true;

    log("[ai-pipeline] === AI_BuildCutlines start ===");
    log("[ai-pipeline] silhouette PNG: " + silhPngPath);
    log("[ai-pipeline] elements file:  " + elementsFilePath);

    var doc = buildWorkingDocument();
    log("[ai-pipeline] working document built: " + doc.name);

    var result;
    try {
        result = runCreateCutlines(doc, silhPngPath, elementsFilePath);
    } catch (e) {
        log("[ai-pipeline] ERROR | step 6 line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 6 (Create Cutlines).\nLine " + e.line + ": " + e.message
            + "\nLog: " + CONFIG.logPath);
        return;
    }

    if (!result) {
        log("[ai-pipeline] Step 6 returned null — aborted.");
        return;
    }

    log("[ai-pipeline] step 6 complete | named: " + result.named
        + " | stamps: " + result.stampsReplaced
        + " | unmatched: " + result.unmatched);

    if (result.unmatched > 0) {
        log("[ai-pipeline] HALT | " + result.unmatched
            + " unmatched path(s) — rename before export.");
        scriptAlert("Cut lines created — but " + result.unmatched
            + " path(s) could not be named automatically.\n\n"
            + "Rename them in the Cutlines layer (each name must match its element's display name exactly).\n\n"
            + "When done, re-run this script directly (File → Scripts → Browse → AI_BuildCutlines.jsx)"
            + " to export SVGs for Deepnest.\n\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    _runExportForNesting(doc);
}

// ─── MAIN: direct run after fixing unmatched paths ───────────────────────────

function main() {
    if (_ranViaHandoff) { return; }

    try {
        if (app.documents.length === 0) {
            scriptAlert("No document open.\nOpen the working .ai file first.");
            return;
        }

        var doc = app.activeDocument;

        log("[pipeline] === AI_BuildCutlines (nesting export) start ===");
        log("[pipeline] dryRun: " + CONFIG.dryRun);
        log("[pipeline] document: " + doc.name);

        _runExportForNesting(doc);

    } catch (e) {
        log("[pipeline] FATAL | line " + e.line + ": " + e.message);
        scriptAlert("AI_BuildCutlines failed.\nLine " + e.line + ": " + e.message
            + "\nLog: " + CONFIG.logPath);
    }
}

main();
