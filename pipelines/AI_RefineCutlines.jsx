#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step8a_SimplifyCutlines.jsx"

// AI_RefineCutlines — Step 8a (Simplify Cutlines), a one-time post-import cleanup.
//
// Caption/plate spec normalisation (former Step 8b) is now its own re-runnable
// pipeline, AI_NormaliseCaptions, which the artist loops on during manual nesting.

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    // Layer + stroke — must match the Production File Template / Step 6 output.
    cutlinesLayerName: "Cutlines",
    stickersLayerName: "Sticker",   // where placed art + caption PNGs live (Step 7B)
    cutlineStrokePt:   0.25,

    // Step 8a — Simplify. ⚠️ CONFIRM tuning with artist on a real trace.
    simplifyToleranceMm:   0.2,   // RDP epsilon — higher = fewer anchors
    simplifyCornerAngleDeg: 90,   // turns sharper than this stay hard corners

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

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === AI_RefineCutlines done ===");

    scriptAlert("Done.\n\n"
        + "  Simplified:  " + simplifyResult.simplified + " cutline(s).\n\n"
        + "Nest the elements (AI_NormaliseCaptions keeps captions at spec during the\n"
        + "resize loop), make pencil refinements, then run AI_ExportFinal.\n\n"
        + "Log: " + CONFIG.logPath);
}

main();
