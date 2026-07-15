#target illustrator
#include "../utils/aiUtils.jsx"
#include "../utils/json2.jsx"
#include "../illustrator/Step8c_OffsetPathQA.jsx"
#include "../illustrator/Step9A_Halfcut.jsx"
#include "../illustrator/Step10_AssetExport.jsx"
#include "../illustrator/Step11_FinalFile.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    // ── Spacing + Margin QA guard (shared with AI_LayoutQA) ──────────────────
    // Not a workflow step — a final manufacturability guard. The artist runs
    // AI_LayoutQA iteratively; export re-runs the same idempotent check and halts
    // if anything is still too close / out of margin, so an un-cuttable file can't
    // be exported. The check resets stale red flags first, so a fixed cut line
    // clears on the re-run.
    cutlinesLayerName:    "Cutlines",
    marginLayerName:      "Margin",
    qaLayerName:          QA_LAYER_NAME,  // shared constant in aiUtils; stripped by Step 11

    spacingThresholdMm:   1.9,    // hard-error gate (relaxed from 2mm per artist request); the
                                  // spacing-buffer halo still aims at 2mm (spacingBufferBasisMm)
    qaSpacingSampleSteps: 12,
    flagStrokePt:         1.0,
    cutlineStrokePt:      0.25,   // reset target for the idempotent QA guard
    showFlagMarkers:      true,   // draw flags on the QA layer (Step 11 strips it)

    // Margin spec — single source of truth in aiUtils.MARGIN_SPEC (avoids drift).
    workingAreaWidthMm:  MARGIN_SPEC.workingAreaWidthMm,
    workingAreaHeightMm: MARGIN_SPEC.workingAreaHeightMm,
    marginTopMm:         MARGIN_SPEC.marginTopMm,
    marginLeftMm:        MARGIN_SPEC.marginLeftMm,

    // ── Step 9A: Half-cut ─────────────────────────────────────────────────────
    // Layer names — case-insensitive search; created as halfcutLayerName if absent.
    halfcutLayerName:    "Halfcut",
    halfcutStrokePt:     0.25,  // matches cut-line stroke weight
    halfcutExtendMm:     1.0,   // half-cut extends 1mm past each end of the edge (playbook spec)
    halfcutSeamSteps:    16,    // bezier→polygon sampling density for the seam trace

    // ── Step 10: Asset Export ─────────────────────────────────────────────────
    stickersLayerName:     "Sticker",      // exact (built in code by buildWorkingDocument)
    colorBlockLayerName:   "Color Block",  // exact (built in code by buildWorkingDocument)
    jpegQuality:           8,              // 0-100
    jpegPreviewDpi:        300,            // sheet-preview raster DPI (ExportOptionsJPEG defaults
                                           // to 72 → pixelated; scale = dpi/72*100 applied in Step 10)
    // pngExportScale — per-element PNG raster DPI. Set to the HIGHEST source DPI you use:
    // exporting BELOW the source downsamples (loses detail), exporting above just upsamples
    // (larger files, no gain). 300 = print standard; bump to 600 for a 600-DPI-source SKU.
    pngExportScale:        300,            // DPI

    // ── Step 11: Final File ───────────────────────────────────────────────────
    finalHalfcutLayerName: "Halfcut/Peeling Tab",  // standardised output name

    // For automated testing only — suppresses alert() dialogs for headless runs.
    suppressAlerts: false,

    logPath: ""  // resolved below
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_ExportFinal.log";

// Reads sourceDPI from {base}_elements.json beside the working .ai. Returns 0 when the
// sidecar is absent/unreadable/lacks the field (caller falls back to the CONFIG default).
function _readSourceDpi(doc) {
    var base;
    try { base = doc.fullName.fsName.replace(/\.ai$/i, ""); } catch (e) { return 0; }
    if (!base) return 0;
    var f = new File(base + "_elements.json");
    if (!f.exists) return 0;
    f.encoding = "UTF-8";
    if (!f.open("r")) return 0;
    var text = f.read();
    f.close();
    if (!text) return 0;
    var data;
    try { data = JSON.parse(text); } catch (e) { return 0; }
    return (data && data.sourceDPI && data.sourceDPI > 0) ? data.sourceDPI : 0;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the production .ai file first.");
        return;
    }
    var doc = app.activeDocument;
    var filesFolder = null;
    try { filesFolder = doc.fullName.parent.fsName; } catch (eFolder) {}

    log("[pipeline] === AI_ExportFinal start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    // Export PNGs at the source resolution so a 600-DPI SKU stays native/lossless.
    var srcDpi = _readSourceDpi(doc);
    if (srcDpi > 0) {
        CONFIG.pngExportScale = srcDpi;
        log("[pipeline] per-element PNG export DPI = sourceDPI " + srcDpi + " (from sidecar)");
    } else {
        log("[pipeline] WARN | no sourceDPI in sidecar; per-element PNGs at CONFIG default "
            + CONFIG.pngExportScale + " DPI");
    }

    // Tear down the working-phase spacing aid before any export step runs (Step 10 clips
    // per-element art, Step 11 ships the file): drop the spacing-buffer sublayer.
    if (!CONFIG.dryRun) {
        try { removeAllSpacingBuffers(doc); } catch (eBuf) {}
    }

    // ── Spacing + Margin QA guard (shared idempotent check; see AI_LayoutQA) ────
    log("[pipeline] --- Spacing + Margin QA guard ---");
    var qaResult;

    try {
        qaResult = runOffsetPathQA(doc);
    } catch (e) {
        log("[pipeline] ERROR | spacing/margin guard line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Spacing + Margin QA.\nLine " + e.line + ": " + e.message
            + "\n\nSend this to Josh:\n" + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] spacing/margin guard complete | " + qaResult.checked + " path(s) checked, "
        + qaResult.flagged + " flagged.");

    if (qaResult.flagged > 0) {
        scriptAlert("Spacing/Margin QA: " + qaResult.flagged + " path(s) flagged for review.\n"
            + "Flagged paths are highlighted in red.\n"
            + "Fix them (or re-run AI_LayoutQA), then re-run this script.\n\n"
            + "Details: " + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
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
            + "\n\nSend this to Josh:\n" + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] step 9a complete | " + halfcutResult.placed + " half-cut(s) placed.");

    // Half-cut is a hard gate: a flagged element means a caption could not produce a half-cut
    // (not seated into the art — not connected, or fully inside it). Abort BEFORE Steps 10/11
    // so no final file ships with a missing/broken peel tab; the artist fixes the seat and re-runs.
    if (halfcutResult.flagged > 0) {
        var hcMsg = "Half-cut ERROR — export halted.\n\n"
            + halfcutResult.flagged + " caption(s) could not produce a half-cut:\n";
        var hi;
        for (hi = 0; hi < halfcutResult.flags.length; hi++) {
            hcMsg += "  - " + halfcutResult.flags[hi].name
                + ": " + halfcutResult.flags[hi].reason + "\n";
        }
        hcMsg += "\nThe caption plate must overlap the element art. Fix the seating in "
            + "Photoshop, then re-run.\nNo final file was written.\n\nSend this to Josh:\n"
            + copyLogBeside(filesFolder, "Noteworthie_ERROR.log");
        log("[pipeline] HALT | step 9a flagged " + halfcutResult.flagged + " element(s) — aborting before export.");
        scriptAlert(hcMsg);
        return;
    }

    // ── Step 10: Asset Export ──────────────────────────────────────────────────
    log("[pipeline] --- Step 10: Asset Export ---");
    var assetResult;

    try {
        assetResult = runAssetExport(doc);
    } catch (e) {
        log("[pipeline] ERROR | step 10 line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 10 (Asset Export).\nLine " + e.line + ": " + e.message
            + "\n\nSend this to Josh:\n" + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
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
            + "\n\nSend this to Josh:\n" + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] step 11 complete | " + finalResult.outputPath);

    // ── Completion summary ─────────────────────────────────────────────────────
    log("[pipeline] === AI_ExportFinal done ===");

    var summaryMsg = "✅ Final file ready.\n\n"
        + "  " + qaResult.checked + " path(s) checked · " + halfcutResult.placed
        + " half-cut(s) · " + assetResult.pngCount + " PNG(s) exported.\n"
        + "  Final file: " + finalResult.outputPath + "\n";
    if (finalResult.layerCount !== 3) {
        summaryMsg += "  WARNING: final file has " + finalResult.layerCount
            + " layer(s) — expected 3. Check manually.\n";
    }

    var allFlags = halfcutResult.flags.concat(assetResult.flags);
    if (allFlags.length > 0) {
        summaryMsg += "\n  Flagged for manual review (" + allFlags.length + "):\n";
        var fi;
        for (fi = 0; fi < allFlags.length; fi++) {
            summaryMsg += "    - " + allFlags[fi].name
                + ": " + allFlags[fi].reason + "\n";
        }
    }

    scriptAlert(summaryMsg);
}

main();
