#target photoshop
#include "../utils/psUtils.jsx"
#include "../photoshop/Step1_CombineElements.jsx"
#include "../photoshop/Step2A_AutoResize.jsx"
#include "../photoshop/Step2B_WhiteEdge.jsx"
#include "../photoshop/Step3A_CaptionText.jsx"

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
    },

    // ── Step 3: White edge ────────────────────────────────────────────────────
    // Default 20px (≈ 1.7mm at 300 DPI) confirmed by artist as the majority case.
    // To adjust a single element: delete its White Base_Cutline layer, change this
    // value, re-run — the re-run guard skips all elements that still have their layer.
    whiteEdgePx:        20,
    whiteEdgeLayerName: "White Base_Cutline", // name given to the created layer

    // ── Step 3A: Caption text ──────────────────────────────────────────────────

    // ⚠️  Confirm PostScript font name on artist machine: run app.fonts in PS
    // to list installed fonts. "Kalam-Regular" is the expected value.
    captionFont:             "Kalam-Regular",

    // ⚠️  GC-LM caption font — confirm with artist whether:
    //   (a) a different font is used for plate captions, or
    //   (b) the caption is embedded in the plate artwork (no T layer needed).
    // Defaults to captionFont until confirmed.
    captionFontPlate:        "Kalam-Regular",

    captionSizePt:    16,   // pt — doubled from 8pt actual (double-A4 template)
    captionTracking:  -20,  // thousandths of an em
    captionGap:       10,   // px: gap between element bottom and text top

    // [styleCode, catCode] pairs that use the plate treatment.
    // Extend this array (no code change) when new plate-style categories are added.
    captionPlateCodes: [["GC", "LM"]]
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

    // ── Step 3: White edge ─────────────────────────────────────────
    log("[pipeline] --- Step 3: White edge ---");
    var snapshotC = doc.activeHistoryState;
    var whiteEdgeResult;

    try {
        whiteEdgeResult = runWhiteEdge(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotC;
        log("[pipeline] ERROR | step 3 line " + e.line + ": " + e.message
            + " — rolled back to post-resize state.");
        scriptAlert("ERROR in Step 3 (White edge).\nLine " + e.line + ": " + e.message
            + "\n\nRolled back to post-resize state.\n"
            + "Ensure White edges.atn is loaded, then re-run.\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 3 complete | " + whiteEdgeResult.processed + " element(s).");

    // ── Step 3A: Caption text ──────────────────────────────────────
    log("[pipeline] --- Step 3A: Caption text ---");
    var snapshotD = doc.activeHistoryState;
    var captionResult;

    try {
        captionResult = runCaptionText(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotD;
        log("[pipeline] ERROR | step 3A line " + e.line + ": " + e.message
            + " — rolled back to post-white-edge state. White edges preserved.");
        scriptAlert("ERROR in Step 3A (Caption text).\nLine " + e.line + ": " + e.message
            + "\n\nWhite edges preserved. Rolled back to post-white-edge state.\n"
            + "Fix the issue and re-run.\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 3A complete | " + captionResult.placed + " caption(s) placed.");

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === PS_ToCaption done ===");

    var msg = "Done.\n\n"
        + "  Combined:    " + combineResult.placed + " element(s) from "
        + combineResult.fileCount + " file(s).\n"
        + "  Resized:     " + resizeResult.resized + " element(s).\n"
        + "  White edge:  " + whiteEdgeResult.processed + " element(s).\n"
        + "  Captions:    " + captionResult.placed + " T layer(s) placed.";

    if (resizeResult.skipped.length > 0) {
        msg += "\n\n  Resize skipped (" + resizeResult.skipped.length + "):";
        for (var s = 0; s < resizeResult.skipped.length; s++) {
            msg += "\n    - " + resizeResult.skipped[s];
        }
    }

    if (captionResult.skipped.length > 0) {
        msg += "\n\n  Caption skipped (" + captionResult.skipped.length + "):";
        for (var c = 0; c < captionResult.skipped.length; c++) {
            msg += "\n    - " + captionResult.skipped[c];
        }
    }

    msg += "\n\nReview and adjust caption positions."
        + "\nWhen done, run PS_AfterCaption to add white bases and proceed.\n\n"
        + "Log: " + CONFIG.logPath;

    scriptAlert(msg);
}

main();
