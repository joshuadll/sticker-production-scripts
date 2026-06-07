#target illustrator
#include "../utils/json2.jsx"
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step6_CreateCutlines.jsx"
#include "../illustrator/Step7A_DeepnestExport.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:         false,
    suppressAlerts: false,
    logPath:        "", // resolved below

    // ── Step 6: Create Cutlines ──────────────────────────────────────────────
    // Source PSD resolution. Step 6 places the silhouette at this DPI so PSD pixels
    // map 1:1 to real-world size (pt/px = 72/sourceDPI). THIS is the governing print
    // scale — not workingAreaWidthMm, which is now only a QA safe-area bound.
    sourceDPI:           300,
    workingAreaWidthMm:  190,
    workingAreaHeightMm: 267,
    cutlineStrokePt:     0.25,
    cutlinesLayerName:   "Cutlines",
    stickersLayerName:   "Sticker",

    // Trace-junk filters. Image Trace on the whole sheet can emit spurious paths
    // beyond the real elements: a whole-sheet background compound (frame + every
    // outline) and tiny stray fragments. Drop them before they get named/grouped,
    // else they become ghost cutline groups (see Step 6 _collectTracedPaths).
    traceBackgroundAreaFrac: 0.5,   // path bbox >= this x full-sheet bbox -> background, drop
    traceMinElementAreaFrac: 0.15,  // matched path bbox < this x element bbox -> fragment, drop

    // ── Step 7A: Deepnest Export ─────────────────────────────────────────────
    // Extent ratio threshold: paths >= this are "regular" (90° rotation in Deepnest).
    // Tune on first real SKU run — every path's ratio is logged.
    deepnestRectThreshold: 0.82
};

var _root = $.fileName
    ? new File($.fileName).parent.parent.fsName
    : Folder.desktop.fsName;

CONFIG.logPath = _root + "/pipelines/AI_BuildCutlines.log";

// ─── SHARED: Step 7A export ───────────────────────────────────────────────────

function _runExportForNesting(doc) {
    log("[pipeline] --- Step 7A: Deepnest export ---");
    log("[pipeline] threshold: " + CONFIG.deepnestRectThreshold);

    var result = runDeepnestExport(doc);

    if (!result) {
        scriptAlert("Step 7A failed — Cutlines layer not found.\n"
            + "Make sure Step 6 has been run on this document.\n"
            + "Log: " + CONFIG.logPath);
        return { ok: false, phase: "step7a", error: "Cutlines layer not found" };
    }

    var svgsOk = !!(result.regularPath && result.irregularPath);

    log("[pipeline] === AI_BuildCutlines done ===");

    if (!CONFIG.dryRun) {
        var _prevUI = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        if (result.regularPath)   { _reopenFresh(result.regularPath); }
        if (result.irregularPath) { _reopenFresh(result.irregularPath); }
        app.userInteractionLevel = _prevUI;
    }

    var baseHint = "{name}";
    try { if (doc.fullName) baseHint = doc.fullName.name.replace(/\.ai$/i, ""); } catch (eName) {}

    scriptAlert("Done.\n\n"
        + "  Regular   (" + result.regular   + " paths): " + (result.regularPath   || "—") + "\n"
        + "  Irregular (" + result.irregular + " paths): " + (result.irregularPath || "—") + "\n\n"
        + "Review both SVGs now open in Illustrator.\n"
        + "Move any misclassified paths between files, then File > Save each.\n\n"
        + "Then import each SVG into Deepnest:\n"
        + "  Regular   → 90° increments, gap 1mm\n"
        + "  Irregular → free rotation, gap 1.5mm\n\n"
        + "NEXT — after nesting:\n"
        + "  1. Save each Deepnest result next to this file, named ending in\n"
        + "     \"_nested.svg\"  (e.g. " + baseHint + "_regular_nested.svg).\n"
        + "  2. Bring the working .ai to the front and run AI_ImportNesting.jsx.\n\n"
        + "Threshold used: " + CONFIG.deepnestRectThreshold
        + "  (see log for per-path ratios to calibrate)\n\n"
        + "Log: " + CONFIG.logPath);

    return {
        ok:           svgsOk,
        phase:        "step7a",
        regular:      result.regular,
        irregular:    result.irregular,
        regularPath:  result.regularPath  || null,
        irregularPath: result.irregularPath || null,
        error:        svgsOk ? null : "SVG export failed (see log)"
    };
}

// Opens an exported SVG, first closing any already-open document with the same
// path. Without this, a re-run finds the file already open from the previous run
// and app.open() just re-activates the STALE in-memory tab instead of reloading
// the regenerated file from disk — the artist sees old geometry.
function _reopenFresh(svgPath) {
    var target = new File(svgPath);
    var i;
    for (i = app.documents.length - 1; i >= 0; i--) {
        var d = app.documents[i];
        try {
            if (d.fullName && d.fullName.fsName === target.fsName) {
                d.close(SaveOptions.DONOTSAVECHANGES);
            }
        } catch (e) { /* untitled/no fullName — ignore */ }
    }
    app.open(target);
}

// ─── ENTRY POINT: BridgeTalk from PSAI_BuildAndExportCutlines.jsx ───────────────────────

// Serialises a status object to a JSON string for return across the BridgeTalk
// boundary. PSAI's bt.onResult parses this so its completion alert reflects the
// real outcome of the Illustrator half (instead of always saying "Done").
function _status(obj) { return JSON.stringify(obj); }

// Builds the working document from scratch (no template file), runs Step 6, saves,
// and (when fully matched) runs Step 7A. Returns a JSON status string describing the
// outcome — see _status. Also alerts in Illustrator for the artist looking at that app.
function buildDocAndImport(silhPngPath, elementsFilePath) {
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
        return _status({ ok: false, phase: "step6", error: "line " + e.line + ": " + e.message });
    }

    if (!result) {
        log("[ai-pipeline] Step 6 returned null — aborted.");
        return _status({ ok: false, phase: "step6", error: "Step 6 returned null" });
    }

    log("[ai-pipeline] step 6 complete | named: " + result.named
        + " | unmatched: " + result.unmatched);

    // Save the working document next to the incoming sidecars. buildWorkingDocument()
    // returns an unsaved "Untitled" doc; without a real fullName, Step 7A resolves its
    // SVG output path to "/Untitled-1_regular.svg" (filesystem root) and the export is
    // cancelled. Saving as {name}.ai beside {name}_elements.json lets Step 7A export
    // {name}_regular.svg / {name}_irregular.svg next to the PSD, where AI_ImportNesting
    // expects them. Done before the unmatched halt so the re-run path also has a saved doc.
    if (!CONFIG.dryRun) {
        var elemFile      = new File(elementsFilePath);
        var baseName      = elemFile.name.replace(/_elements\.json$/i, "").replace(/\.json$/i, "");
        var workingAiPath = elemFile.parent.fsName + "/" + baseName + ".ai";
        var _prevSaveUI   = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        doc.saveAs(new File(workingAiPath), new IllustratorSaveOptions());
        app.userInteractionLevel = _prevSaveUI;
        log("[ai-pipeline] working document saved: " + workingAiPath);
    }

    if (result.unmatched > 0) {
        log("[ai-pipeline] HALT | " + result.unmatched
            + " unmatched path(s) — rename before export.");
        scriptAlert("Cut lines created — but " + result.unmatched
            + " path(s) could not be named automatically.\n\n"
            + "Rename them in the Cutlines layer (each name must match its element's display name exactly).\n\n"
            + "When done, re-run this script directly (File → Scripts → Browse → AI_BuildCutlines.jsx)"
            + " to export SVGs for Deepnest.\n\n"
            + "Log: " + CONFIG.logPath);
        return _status({ ok: false, phase: "step6", named: result.named,
                         unmatched: result.unmatched, error: result.unmatched + " unmatched path(s)" });
    }

    var exportResult = _runExportForNesting(doc);
    exportResult.named = result.named;
    exportResult.unmatched = result.unmatched;
    return _status(exportResult);
}

// ─── MAIN: direct run after fixing unmatched paths ───────────────────────────

function main() {
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

// Dispatch. When invoked through the BridgeTalk handoff (or the integration test),
// the caller sets $.global.__aiBuildCutlinesHandoff = true BEFORE evaluating this
// file, then calls buildDocAndImport() itself — so main() (the direct re-run path)
// must NOT auto-fire. Read-and-clear makes it a one-shot signal: $.global persists
// for the whole Illustrator session, so without clearing it a later direct
// double-click re-run would be wrongly suppressed.
var _viaHandoff = $.global.__aiBuildCutlinesHandoff;
$.global.__aiBuildCutlinesHandoff = false;
if (!_viaHandoff) { main(); }
