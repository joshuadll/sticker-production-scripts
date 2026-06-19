#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step8b_CaptionNormalise.jsx"

// AI_NormaliseCaptions — standalone, re-runnable caption/plate spec normalisation.
//
// The artist nests by hand, scaling each element (art + white edge + caption + cutline)
// as one unit to fit the artboard. That drags the caption and plate off their absolute
// spec. This pipeline re-asserts spec — caption PNG back to true size, plate back to
// canonical geometry, cutline re-United — and is meant to be run REPEATEDLY inside the
// nest loop (resize → normalise → resize → …), the same way AI_LayoutQA is. It is
// idempotent: re-running on an already-spec layout changes nothing.
//
// Run it BEFORE manual pencil refinements to the cutline — it re-derives the fused
// cutline from outline+plate, so it would discard hand edits to the contour.

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    // Layers + stroke — must match Step 6 / Step 7B output.
    cutlinesLayerName: "Cutlines",
    stickersLayerName: "Sticker",   // placed art + caption PNGs live here (Step 7B)
    cutlineStrokePt:   0.25,

    // Absolute PSD→AI scale: a caption/art PNG at spec sits at 72/sourceDPI pt per px
    // (the factor Step 7B placed it at). MUST match the import pipeline's sourceDPI.
    sourceDPI: 300,

    // ── Caption vector seat (aiUtils.seatPlateToOutline) ─────────────────────
    // After the spec rescale, re-seat the plate + caption against the TRACED outline (the
    // cut's own vector). Replaces the old contact-centroid "preserve the PS seat" scale.
    // MUST match AI_BuildCutlines so birth and resize seat identically.
    seatSampleSteps:     24,     // bezier→polygon density for the seat probe — keep == AI_BuildCutlines
    seatOverlapMm:       0.1,    // ⚠ KEY KNOB: submerged depth d into the art (mm) — keep == AI_BuildCutlines
    seatConform:         true,   // rotate the plate so its inner edge runs parallel to the outline
    seatRotationSign:    1,      // ⚠ flip to -1 if captions tilt the WRONG way (AI y-up; getRotationMatrix)
    maxSeatRotationDeg:  75,     // chord tilt beyond this skips rotation + flags
    seatShrinkFrac:      0.15,   // overhang/bulge rescue inset fraction (both inner-edge ends)
    seatBaselineEpsPt:   0.5,    // pt: shorter baselines (circular/1-char pill) skip rotation
    captionMidProtrudeFrac: 0.25,// convex midpoint-bulge guard (fraction of pill thickness 2·r); 0 = off

    // ── Half-cut (re-synced to the rescaled seam after each re-Unite) ─────────
    halfcutLayerName:  "Halfcut",
    halfcutStrokePt:   0.25,
    halfcutExtendMm:   1.0,
    halfcutSeamSteps:  16,

    // For automated testing only — suppresses alert() dialogs for headless runs.
    suppressAlerts: false,

    logPath: ""  // resolved below
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_NormaliseCaptions.log";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the production .ai file first.");
        return;
    }
    var doc = app.activeDocument;
    var filesFolder = null;
    try { filesFolder = doc.fullName.parent.fsName; } catch (eFolder) {}

    log("[pipeline] === AI_NormaliseCaptions start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    var result;
    try {
        result = runCaptionNormalise(doc);
    } catch (e) {
        log("[pipeline] ERROR | caption normalise line " + e.line + ": " + e.message);
        scriptAlert("❌ Couldn't normalise the captions.\n\n"
            + "Reason (line " + e.line + "): " + e.message + "\n\n"
            + "Stuck? Send this to Josh:\n"
            + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
        return;
    }

    log("[pipeline] caption normalise complete | " + result.reset + " reset to spec, "
        + result.atSpec + " already at spec, " + result.skipped + " skipped.");
    log("[pipeline] === AI_NormaliseCaptions done ===");

    scriptAlert("✅ Captions normalised.\n\n"
        + "  " + result.reset + " reset to spec, " + result.atSpec
        + " already on spec, " + result.skipped + " skipped (stamps / uncaptioned).\n\n"
        + "Re-run after each manual resize pass. When nesting is final, make pencil\n"
        + "refinements, then run AI_ExportFinal.");
}

main();
