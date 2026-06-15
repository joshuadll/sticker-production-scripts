#target illustrator
#include "../utils/aiUtils.jsx"
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

    spacingThresholdMm:   2,
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
    : Folder.desktop.fsName) + "/AI_ExportFinal.log";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the production .ai file first.");
        return;
    }
    var doc = app.activeDocument;

    log("[pipeline] === AI_ExportFinal start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    // ── Spacing + Margin QA guard (shared idempotent check; see AI_LayoutQA) ────
    log("[pipeline] --- Spacing + Margin QA guard ---");
    var qaResult;

    try {
        qaResult = runOffsetPathQA(doc);
    } catch (e) {
        log("[pipeline] ERROR | spacing/margin guard line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Spacing + Margin QA.\nLine " + e.line + ": " + e.message
            + "\n\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] spacing/margin guard complete | " + qaResult.checked + " path(s) checked, "
        + qaResult.flagged + " flagged.");

    if (qaResult.flagged > 0) {
        scriptAlert("Spacing/Margin QA: " + qaResult.flagged + " path(s) flagged for review.\n"
            + "Flagged paths are highlighted in red.\n"
            + "Fix them (or re-run AI_LayoutQA), then re-run this script.\n\n"
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
            + "Photoshop, then re-run.\nNo final file was written.\n\nLog: " + CONFIG.logPath;
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
    log("[pipeline] === AI_ExportFinal done ===");

    var summaryMsg = "Done.\n\n"
        + "  QA:         " + qaResult.checked + " path(s) checked.\n"
        + "  Half-cuts:  " + halfcutResult.placed + " placed.\n"
        + "  PNGs:       " + assetResult.pngCount + " exported.\n"
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

    summaryMsg += "\nLog: " + CONFIG.logPath;
    scriptAlert(summaryMsg);
}

main();
