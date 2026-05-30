#target photoshop
#include "../utils/psUtils.jsx"
#include "../photoshop/Step1_CombineElements.jsx"
#include "../photoshop/Step2_AutoResize.jsx"
// #include "../photoshop/Step3_AutoCaption.jsx"  — uncomment when implemented

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// All tuneable values live here. Step files contain functions only.

var CONFIG = {
    dryRun: false,

    // ⚠️  CONFIRM WITH ARTIST before first run:
    // Exact name of the sheet-boundary / guide layer in the Resize Area Template.
    // This layer is preserved when the template is cleared on re-run.
    // All other top-level layers are removed. Wrong name = that layer gets deleted.
    skipLayerName:   "Guide",

    templateWidthCm: 42,
    templateDPI:     300,

    // For automated testing only — leave empty ("") for normal interactive use.
    // When set, skips the folder-picker dialog.
    sourceFolderPath: "",

    // For automated testing only — suppresses alert() dialogs for headless runs.
    // All alerts are still written to the log regardless.
    suppressAlerts: false,

    logPath: "", // resolved below — same folder as this script

    // Pixel targets at 300 DPI (longest edge).
    sizeTable: {
        "TL": 900,  // Title / location name        3 in
        "LM": 690,  // Landmark / attraction         2.3 in
        "MP": 570,  // Map / subway / station sign   1.9 in (midpoint 1.8–2)
        "TR": 570,  // Transportation                1.9 in (midpoint 1.8–2)
        "IC": 540,  // Cultural icon / symbol        1.8 in
        "FD": 525,  // Food / local cuisine          1.75 in (midpoint 1.5–2)
        "ST": 450   // Stamp (style code, no cat)    1.5 in
    }
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/PS_ToCaption.log";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {

    // ── Validate document ──────────────────────────────────────────
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the Resize Area Template first.");
        return;
    }
    var doc = app.activeDocument;

    if (!isValidTemplate(doc)) {
        scriptAlert("Active document does not look like the Resize Area Template.\n"
            + "Expected: " + CONFIG.templateWidthCm + " cm wide. "
            + "Got: " + Math.round(doc.width.as("cm")) + " cm.\n\n"
            + "Please activate the Resize Area Template and try again.");
        return;
    }

    // ── Init log ───────────────────────────────────────────────────
    log("[pipeline] === PS_ToCaption start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] template: " + doc.name);

    if (doc.resolution !== CONFIG.templateDPI) {
        log("[pipeline] WARN: resolution is " + doc.resolution
            + " DPI, expected " + CONFIG.templateDPI
            + ". Pixel targets may be inaccurate.");
    }

    // ── Resolve source folder ──────────────────────────────────────
    var folder;
    if (CONFIG.sourceFolderPath) {
        folder = new Folder(CONFIG.sourceFolderPath);
        if (!folder.exists) {
            scriptAlert("Source folder not found:\n" + CONFIG.sourceFolderPath
                + "\n\nUpdate CONFIG.sourceFolderPath and try again.");
            return;
        }
    } else {
        folder = Folder.selectDialog("Select folder containing source PSD files");
        if (!folder) { log("[pipeline] cancelled."); return; }
    }
    log("[pipeline] source folder: " + folder.name);

    // ── Dry run: inspect only, no changes ─────────────────────────
    if (CONFIG.dryRun) {
        var dryResult = runCombine(doc, folder);
        log("[pipeline] [DRY RUN] complete. Would place " + dryResult.placed
            + " element(s) from " + dryResult.fileCount + " file(s). No changes made.");
        scriptAlert("[DRY RUN] Complete.\n\n"
            + "Would place:  " + dryResult.placed + " element(s)\n"
            + "From:         " + dryResult.fileCount + " file(s)\n\n"
            + "No changes made. Log: " + CONFIG.logPath);
        return;
    }

    // ── Step 1: Combine ────────────────────────────────────────────
    log("[pipeline] --- Step 1: Combine ---");
    var snapshotA = doc.activeHistoryState;
    var combineResult;

    try {
        combineResult = runCombine(doc, folder);
    } catch (e) {
        doc.activeHistoryState = snapshotA;
        log("[pipeline] ERROR | step 1 line " + e.line + ": " + e.message
            + " — rolled back to initial template state.");
        scriptAlert("ERROR in Step 1 (Combine).\nLine " + e.line + ": " + e.message
            + "\n\nTemplate rolled back to its initial state.\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 1 complete | " + combineResult.placed + " element(s) from "
        + combineResult.fileCount + " file(s).");

    // ── Step 2: Resize ─────────────────────────────────────────────
    log("[pipeline] --- Step 2: Resize ---");
    var snapshotB = doc.activeHistoryState;
    var resizeResult;

    try {
        resizeResult = runResize(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotB;
        log("[pipeline] ERROR | step 2 line " + e.line + ": " + e.message
            + " — rolled back to post-combine state. All elements preserved.");
        scriptAlert("ERROR in Step 2 (Resize).\nLine " + e.line + ": " + e.message
            + "\n\nAll elements preserved. Resize rolled back to start of Step 2.\n"
            + "Fix the issue and re-run.\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 2 complete | " + resizeResult.resized + " element(s) resized.");

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === PS_ToCaption done ===");

    var msg = "Done.\n\n"
        + "  Combined:  " + combineResult.placed + " element(s) from "
        + combineResult.fileCount + " file(s).\n"
        + "  Resized:   " + resizeResult.resized + " element(s).";

    if (resizeResult.skipped.length > 0) {
        msg += "\n  Skipped (" + resizeResult.skipped.length + "):";
        for (var s = 0; s < resizeResult.skipped.length; s++) {
            msg += "\n    - " + resizeResult.skipped[s];
        }
    }

    msg += "\n\nLog: " + CONFIG.logPath
        + "\n\nReview elements, then run Step 3 (auto-caption).";

    scriptAlert(msg);
}

main();
