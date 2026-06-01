#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step8c_OffsetPathQA.jsx"
#include "../illustrator/Step9A_Halfcut.jsx"
#include "../illustrator/Step9B_PeelingTab.jsx"
#include "../illustrator/Step10_AssetExport.jsx"
#include "../illustrator/Step11_FinalFile.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    // Shared assets — update if location changes.
    // ⚠️  CONFIRM paths with artist before first run.
    assetsFolder:        "",  // e.g. "/Volumes/Team Drive/Production Assets"
    peelingTabAssetPath: "",  // resolved from assetsFolder below

    // ── Step 8c: Spacing + Margin QA ─────────────────────────────────────────
    cutlinesLayerName:    "Cutlines",
    marginLayerName:      "Margin",

    spacingThresholdMm:   2,
    qaSpacingSampleSteps: 12,
    flagStrokePt:         1.0,

    workingAreaWidthMm:  190,
    workingAreaHeightMm: 267,
    marginTopMm:         10,
    marginLeftMm:        10,

    // ── Step 9A: Half-cut ─────────────────────────────────────────────────────
    // Layer names — case-insensitive search; created as halfcutLayerName if absent.
    halfcutLayerName:    "Halfcut",
    halfcutStrokePt:     0.25,  // matches cut-line stroke weight
    halfcutExtendMm:     0.5,   // half-cut extends past each end of the edge

    // ── Step 9B: Peeling Tab ──────────────────────────────────────────────────
    // Minimum straight-edge length for preferring PEEL HERE over half-circle tab.
    peelingTabMinLengthMm:  15,

    // Group names inside Peeling Tab Asset.ai.
    // ⚠️  CONFIRM exact names with artist before first run.
    peelingTabGroupName:    "PEEL HERE",
    halfCircleGroupName:    "Half Circle",

    // ── Step 10: Asset Export ─────────────────────────────────────────────────
    colorBlockLayerName:   "Color Block",  // case-insensitive search
    jpegQuality:           8,              // 0-100
    // ⚠️  pngExportScale: pending artist confirmation — assumed 150 DPI for now.
    pngExportScale:        150,            // DPI

    // ── Step 11: Final File ───────────────────────────────────────────────────
    finalHalfcutLayerName: "Halfcut/Peeling Tab",  // standardised output name

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

    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the production .ai file first.");
        return;
    }
    var doc = app.activeDocument;

    log("[pipeline] === AI_AfterPencil start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    // ── Step 8c: Offset Path QA ────────────────────────────────────────────────
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

    // ── Step 9A: Half-cut lines ────────────────────────────────────────────────
    log("[pipeline] --- Step 9A: Half-cut ---");
    var halfcutResult;

    try {
        halfcutResult = runHalfcut(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 9a line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 9A (Half-cut).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 9a complete | " + halfcutResult.placed + " half-cut(s) placed.");

    // ── Step 9B: Peeling Tab ───────────────────────────────────────────────────
    log("[pipeline] --- Step 9B: Peeling Tab ---");
    var tabResult;

    try {
        tabResult = runPeelingTab(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 9b line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 9B (Peeling Tab).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 9b complete | " + tabResult.placed + " peeling tab(s) placed.");

    // ── Step 10: Asset Export ──────────────────────────────────────────────────
    log("[pipeline] --- Step 10: Asset Export ---");
    var assetResult;

    try {
        assetResult = runAssetExport(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 10 line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 10 (Asset Export).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 10 complete | " + assetResult.pngCount + " PNG(s) exported.");

    // ── Step 11: Final File ────────────────────────────────────────────────────
    log("[pipeline] --- Step 11: Final File ---");
    var finalResult;

    try {
        finalResult = runFinalFile(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 11 line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 11 (Final File).\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 11 complete | " + finalResult.outputPath);

    // ── Completion summary ─────────────────────────────────────────────────────
    log("[pipeline] === AI_AfterPencil done ===");

    var summaryMsg = "Done.\n\n"
        + "  QA:           " + qaResult.checked + " path(s) checked.\n"
        + "  Half-cuts:    " + halfcutResult.placed + " placed.\n"
        + "  Peeling tabs: " + tabResult.placed + " placed.\n"
        + "  PNGs:         " + assetResult.pngCount + " exported.\n"
        + "  Final file:   " + finalResult.outputPath + "\n";
    if (finalResult.layerCount !== 3) {
        summaryMsg += "  WARNING: final file has " + finalResult.layerCount
            + " layer(s) — expected 3. Check manually.\n";
    }

    var allFlags = halfcutResult.flags.concat(tabResult.flags).concat(assetResult.flags);
    if (allFlags.length > 0) {
        summaryMsg += "\n  Flagged for manual review (" + allFlags.length + "):\n";
        var fi;
        for (fi = 0; fi < allFlags.length; fi++) {
            summaryMsg += "    - " + allFlags[fi].name
                + ": " + allFlags[fi].reason + "\n";
        }
    }

    summaryMsg += "\nLog: " + CONFIG.logPath;
    scriptAlert(summaryMsg);
}

main();
