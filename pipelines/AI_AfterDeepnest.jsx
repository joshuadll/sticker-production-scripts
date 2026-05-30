#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step8a_SimplifyCutlines.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    // For automated testing only — suppresses alert() dialogs for headless runs.
    suppressAlerts: false,

    logPath: ""  // resolved below
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_AfterDeepnest.log";

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
    log("[pipeline] === AI_AfterDeepnest start ===");
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
            + "\n\nNo changes committed. Log: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 8a complete | " + simplifyResult.simplified + " path(s) simplified.");

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === AI_AfterDeepnest done ===");

    scriptAlert("Done.\n\n"
        + "  Simplified:  " + simplifyResult.simplified + " path(s).\n\n"
        + "Review cutlines, make pencil refinements, then run AI_AfterPencil.\n\n"
        + "Log: " + CONFIG.logPath);
}

main();
