#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step8a_SimplifyCutlines.jsx"
#include "../illustrator/Step8b_CaptionNormalise.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    // Layer + stroke — must match the Production File Template / Step 6 output.
    cutlinesLayerName: "Cutlines",
    cutlineStrokePt:   0.25,

    // Step 8a — Simplify. ⚠️ CONFIRM tuning with artist on a real trace.
    simplifyToleranceMm:   0.2,   // RDP epsilon — higher = fewer anchors
    simplifyCornerAngleDeg: 90,   // turns sharper than this stay hard corners

    // Step 8b — Caption Normalisation (GC plates). Canonical plate heights.
    plateHeightSingleLineCm: 0.5,
    plateHeightTwoLineCm:    0.8,

    // For automated testing only — suppresses alert() dialogs for headless runs.
    suppressAlerts: false,

    logPath: ""  // resolved below
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_RefineCutlines.log";

// ─── ENTRY POINT (called by BridgeTalk from previous pipeline if chained) ────
// Not used in this pipeline — artist opens this script manually after Deepnest.

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {

    // ── Validate document ──────────────────────────────────────────
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the production .ai file first.");
        return;
    }
    var doc = app.activeDocument;

    // ── Init log ───────────────────────────────────────────────────
    log("[pipeline] === AI_RefineCutlines start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    // ── Step 8a: Simplify Cutlines ─────────────────────────────────
    log("[pipeline] --- Step 8a: Simplify Cutlines ---");
    var simplifyResult;

    try {
        simplifyResult = runSimplify(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 8a line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 8a (Simplify Cutlines).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 8a complete | " + simplifyResult.simplified + " path(s) simplified, "
        + simplifyResult.skipped + " skipped.");

    // ── Step 8b: Caption Normalisation ─────────────────────────────
    log("[pipeline] --- Step 8b: Caption Normalisation ---");
    var captionResult;

    try {
        captionResult = runCaptionNormalise(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 8b line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 8b (Caption Normalisation).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 8b complete | " + captionResult.normalized + " plate(s) normalised, "
        + captionResult.skipped + " skipped.");

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === AI_RefineCutlines done ===");

    scriptAlert("Done.\n\n"
        + "  Simplified:  " + simplifyResult.simplified + " cutline(s).\n"
        + "  Normalised:  " + captionResult.normalized + " GC plate(s).\n\n"
        + "Review cutlines, make pencil refinements, then run AI_ExportFinal.\n\n"
        + "Log: " + CONFIG.logPath);
}

main();
