#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step8c_OffsetPathQA.jsx"
#include "../illustrator/Step9_PeelingTabHalfcut.jsx"
#include "../illustrator/Step10_AssetExportFinalFile.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    // Shared assets — update if location changes.
    // ⚠️  CONFIRM paths with artist before first run.
    assetsFolder:        "",  // e.g. "/Volumes/Team Drive/Production Assets"
    peelingTabAssetPath: "",  // resolved from assetsFolder below

    // For automated testing only — suppresses alert() dialogs for headless runs.
    suppressAlerts: false,

    logPath: ""  // resolved below
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_AfterPencil.log";

CONFIG.peelingTabAssetPath = CONFIG.assetsFolder + "/Peeling Tab Asset.ai";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {

    // ── Validate document ──────────────────────────────────────────
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the production .ai file first.");
        return;
    }
    var doc = app.activeDocument;

    // ── Init log ───────────────────────────────────────────────────
    log("[pipeline] === AI_AfterPencil start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    // ── Step 8c: Offset Path QA ────────────────────────────────────
    log("[pipeline] --- Step 8c: Offset Path QA ---");
    var qaResult;

    try {
        qaResult = runOffsetPathQA(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 8c line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 8c (Offset Path QA).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 8c complete | " + qaResult.checked + " path(s) checked, "
        + qaResult.flagged + " flagged.");

    if (qaResult.flagged > 0) {
        scriptAlert("Step 8c: " + qaResult.flagged + " path(s) flagged for review.\n"
            + "Flagged paths are highlighted in red.\n"
            + "Fix them before continuing, then re-run this script.\n\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    // ── Step 9: Peeling Tab + Halfcut ─────────────────────────────
    log("[pipeline] --- Step 9: Peeling Tab + Halfcut ---");
    var peelingResult;

    try {
        peelingResult = runPeelingTab(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 9 line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 9 (Peeling Tab).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 9 complete | " + peelingResult.placed + " peeling tab(s) placed.");

    // ── Step 10: Export Final File ─────────────────────────────────
    log("[pipeline] --- Step 10: Export Final File ---");
    var exportResult;

    try {
        exportResult = runExport(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 10 line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 10 (Export).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 10 complete | exported: " + exportResult.outputPath);

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === AI_AfterPencil done ===");

    scriptAlert("Done.\n\n"
        + "  QA:           " + qaResult.checked + " path(s) checked.\n"
        + "  Peeling tabs: " + peelingResult.placed + " placed.\n"
        + "  Final file:   " + exportResult.outputPath + "\n\n"
        + "Log: " + CONFIG.logPath);
}

main();
