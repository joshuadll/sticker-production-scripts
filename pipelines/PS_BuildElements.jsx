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

    templateWidthCm:  42,
    templateHeightCm: 59.4,
    templateDPI:      300,

    // For automated testing only — leave empty ("") for normal interactive use.
    // When set, skips the folder-picker dialog.
    sourceFolderPath: "",

    // For automated testing only — suppresses alert() dialogs for headless runs.
    // All alerts are still written to the log regardless.
    suppressAlerts: false,

    logPath: "", // resolved below — same folder as this script

    // Pixel targets at 300 DPI (longest edge) — midpoints for range categories.
    // These are the FINISHED element size (art + white edge). Step 2A resizes the
    // art smaller by 2×whiteEdgePx so that after Step 2B adds the edge, the element
    // measures to the target. Append + to the category code in the layer name for
    // the large end, - for the small end: e.g. "Eiffel Tower [WC-LM+]", "Small Snack [WC-FD-]"
    sizeTable: {
        "TL": 900,  // Location names              3 in     (fixed)
        "LM": 615,  // Landmarks & attractions     2.05 in  (midpoint 1.8–2.3)
        "MP": 570,  // Maps / station signs        1.9 in   (midpoint 1.8–2)
        "TR": 570,  // Transportation              1.9 in   (midpoint 1.8–2)
        "IC": 495,  // Cultural symbols & icons    1.65 in  (midpoint 1.5–1.8)
        "FD": 525,  // Food & local cuisine        1.75 in  (midpoint 1.5–2)
        "ST": 450   // Stamps                      1.5 in   (fixed)
    },

    // Large-end targets — used when category code has + suffix.
    sizeTableLarge: {
        "LM": 690,  // 2.3 in
        "MP": 600,  // 2.0 in
        "TR": 600,  // 2.0 in
        "IC": 540,  // 1.8 in
        "FD": 600   // 2.0 in
    },

    // Small-end targets — used when category code has - suffix.
    sizeTableSmall: {
        "LM": 540,  // 1.8 in
        "MP": 540,  // 1.8 in
        "TR": 540,  // 1.8 in
        "IC": 450,  // 1.5 in
        "FD": 450   // 1.5 in
    },

    // ── Step 2A: Grid layout (after resize) ───────────────────────────────────
    // Padding on each side of a grid cell, in pixels.
    // Cell size = largest category (TL = 900px) + 2 × gridPaddingPx.
    gridPaddingPx: 60,

    // ── Step 3: White edge ────────────────────────────────────────────────────
    // Default 20px (≈ 1.7mm at 300 DPI) confirmed by artist as the majority case.
    // To adjust a single element: delete its White Base_Cutline layer, change this
    // value, re-run — the re-run guard skips all elements that still have their layer.
    whiteEdgePx:        20,
    // Select>Modify>Smooth radius applied to the white-edge band's outer edge
    // (Step 2B, after expand, before fill). This is the contour Step 5
    // silhouettes and Step 6 traces, so smoothing it here yields clean cutlines
    // without an Illustrator-side RDP pass. ⚠️ Tune with artist on a real SKU:
    // too large relative to whiteEdgePx (20) rounds away genuine corners, and
    // because it acts after the expand it can marginally shift finished bounds
    // at sharp corners (relevant to Step 2A's 2×whiteEdgePx size compensation).
    // 0 disables smoothing. Landed at 20 on a real watercolor SKU (2026-06-12).
    whiteEdgeSmoothRadiusPx: 20,
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

    captionSizePt:    8,    // pt — real caption size; Step 6 places the silhouette at
                            // source DPI so 8pt renders at a true 8pt on the printed sticker.
    captionTracking:  -20,  // thousandths of an em
    captionGap:        5,   // px: text top below white border bottom (WBC bounds[3]) — this is only
                            //     the REVIEW position the artist sees after Step 3A. Final placement is
                            //     re-seated in Step 3B (snapCaptionToBorder, CONFIG.captionBorderOverlapPx),
                            //     which slides text+pill along the pill→art centre line to an exact overlap.
    captionMaxGapFrac: 0.5, // caption↔element positional matching ceiling: reject a caption farther
                            //     than this × the element's smaller side. Element-relative → DPI/scale-free.
                            //     Stops a genuinely-uncaptioned element from absorbing a far stray text
                            //     layer. Used by Step 3A's re-run guard (buildCaptionAssignment).

    // [styleCode, catCode] pairs that use the plate treatment.
    // Extend this array (no code change) when new plate-style categories are added.
    captionPlateCodes: [["GC", "LM"]]
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/PS_BuildElements.log";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function createTemplateDoc() {
    var w = new UnitValue(CONFIG.templateWidthCm, "cm");
    var h = new UnitValue(CONFIG.templateHeightCm, "cm");
    var doc = app.documents.add(w, h, CONFIG.templateDPI, "Production Template",
        NewDocumentMode.CMYK, DocumentFill.WHITE);

    // Fill Background with 50% gray so white edges are visible during review.
    var bgLayer = doc.backgroundLayer;
    bgLayer.isBackgroundLayer = false;
    doc.activeLayer = bgLayer;
    var gray = new SolidColor();
    gray.cmyk.cyan    = 0;
    gray.cmyk.magenta = 0;
    gray.cmyk.yellow  = 0;
    gray.cmyk.black   = 50;
    doc.selection.selectAll();
    doc.selection.fill(gray);
    doc.selection.deselect();
    bgLayer.isBackgroundLayer = true;

    log("[pipeline] created new template document ("
        + CONFIG.templateWidthCm + " x " + CONFIG.templateHeightCm + " cm, "
        + CONFIG.templateDPI + " DPI).");
    return doc;
}

function saveWorkingDoc(doc, folder) {
    var savePath = folder.fsName + "/" + folder.name + ".psd";
    var saveFile = new File(savePath);
    var opts = new PhotoshopSaveOptions();
    opts.layers = true;
    opts.embedColorProfile = true;
    doc.saveAs(saveFile, opts, false);
    log("[pipeline] saved | " + savePath);
    return savePath;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    // ── Get or create template document ───────────────────────────
    var doc;
    if (app.documents.length > 0 && isValidTemplate(app.activeDocument)) {
        doc = app.activeDocument;
    } else {
        doc = createTemplateDoc();
    }

    // ── Init log ───────────────────────────────────────────────────
    log("[pipeline] === PS_BuildElements start ===");
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

    // ── Save working document ──────────────────────────────────────
    var savedPath = null;
    try {
        savedPath = saveWorkingDoc(doc, folder);
    } catch (e) {
        log("[pipeline] WARN | auto-save failed line " + e.line + ": " + e.message
            + " — save the document manually before running PSAI_BuildAndExportCutlines.");
    }

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === PS_BuildElements done ===");

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
        + "\nWhen done, run PSAI_BuildAndExportCutlines to add white bases and proceed.\n\n"
        + (savedPath ? "Saved: " + savedPath : "WARN: auto-save failed — save manually.")
        + "\nLog: " + CONFIG.logPath;

    scriptAlert(msg);
}

main();
