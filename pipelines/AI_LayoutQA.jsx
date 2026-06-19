#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step8c_OffsetPathQA.jsx"
#include "../illustrator/StepQA_NestingQuality.jsx"

// AI_LayoutQA — independent, on-demand layout QA.
//
// QA is a lens the artist points at the CURRENT layout, not a stage passed
// through once. The real workflow loops nest ⇄ pencil (back and forth), so this
// pipeline is standalone and fully re-runnable: run it whenever, in any order
// relative to the pencil pass, as many times as needed. It mutates nothing
// structural — it only (re)applies QA flags and the pocket overlay, both of
// which are idempotent.
//
// Two phases, neither halts the other (the artist wants to see all of it at once):
//   1. Spacing + Margin QA  — runOffsetPathQA  → { checked, flagged }
//      Cut lines closer than 2mm or outside the safe area are flagged.
//   2. Nesting Quality (NQI) — runNestingQA    → { nqi, pass, pockets, utilization }
//      Advisory packing score; reworkable pockets drawn as fills.
//
// Both phases draw onto ONE shared "Layout QA" overlay layer (CONFIG.qaLayerName):
// spacing/margin flag markers + NQI pocket fills. The artist toggles a single layer
// to show/hide all QA; the cut lines themselves are never recoloured.
//
// Spacing/margin is the manufacturability gate that AI_ExportFinal re-runs before
// export. NQI is advisory only — it never blocks export.

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:         false,
    suppressAlerts: false,
    logPath:        "", // resolved below

    // Layer that holds the cutline paths (shared by both phases).
    cutlinesLayerName: "Cutlines",
    marginLayerName:   "Margin",

    // Single overlay layer holding ALL QA visuals — spacing/margin flag markers
    // (Step 8c) AND NQI pocket fills (StepQA). The artist toggles this one layer to
    // show/hide everything; cut lines themselves are never recoloured. Step 11
    // strips it by name, so it never reaches the print file.
    qaLayerName:       QA_LAYER_NAME,  // shared constant in aiUtils; Step 11 strips it

    // ── Phase 1: Spacing + Margin QA ─────────────────────────────────────────
    spacingThresholdMm:   2,
    qaSpacingSampleSteps: 12,
    flagStrokePt:         1.0,    // red flag stroke weight (echo outline + connector)
    cutlineStrokePt:      0.25,   // canonical cut-line stroke (reset target on re-run)
    showFlagMarkers:      true,   // draw spacing/margin flags on the QA layer

    // Margin spec — single source of truth in aiUtils.MARGIN_SPEC (avoids drift).
    workingAreaWidthMm:  MARGIN_SPEC.workingAreaWidthMm,
    workingAreaHeightMm: MARGIN_SPEC.workingAreaHeightMm,
    marginTopMm:         MARGIN_SPEC.marginTopMm,
    marginLeftMm:        MARGIN_SPEC.marginLeftMm,

    // ── Phase 2: Nesting Quality (NQI) ───────────────────────────────────────
    // (Pocket quadrant labels use the measured artboard size, not a CONFIG dim.)
    // cellSizeMm MUST divide gapMm evenly (gapCells = ceil(gapMm/cellSizeMm) is an
    // integer count of cells, so the dilation band is only the true gapMm when the
    // division is exact). 1 and 2 both work (band = 2.0mm); 1.5 does NOT — it makes
    // gapCells=2 → a 3.0mm band, over-shrinking pockets (NQI reads ~3pts high, half
    // the pockets vanish). 2mm runs the NQI grid ~12x faster than 1mm (4x fewer
    // cells + a smaller dilation kernel) for only NQI +1 and the loss of pockets
    // sitting right on the 90mm^2 gate. See docs/step8c — benchmarked 2026-06-12.
    cellSizeMm:       2,    // grid resolution; must divide gapMm exactly (see note)
    gapMm:            2,    // inter-sticker spacing band (same constant as spacingThresholdMm)
    pocketMinAreaMm2: 90,   // a free pocket this large (mm^2) is a reworkable opportunity
    passingNqi:       90,   // NQI >= this is a PASS
    showOverlay:      true  // draw red rects over flagged pockets on "NQI Pockets" layer
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_LayoutQA.log";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the working .ai file first.");
        return;
    }
    var doc = app.activeDocument;
    var filesFolder = null;
    try { filesFolder = doc.fullName.parent.fsName; } catch (eFolder) {}

    log("[pipeline] === AI_LayoutQA start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    // ── Phase 1: Spacing + Margin QA ───────────────────────────────────────────
    log("[pipeline] --- Spacing + Margin QA ---");
    var qaResult;
    try {
        qaResult = runOffsetPathQA(doc);
    } catch (e) {
        log("[pipeline] ERROR | spacing/margin QA line " + e.line + ": " + e.message);
        scriptAlert("❌ Couldn't run Spacing + Margin QA.\n\n"
            + "Reason (line " + e.line + "): " + e.message + "\n\n"
            + "Stuck? Send this to Josh:\n"
            + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] spacing/margin complete | " + qaResult.checked + " checked, "
        + qaResult.flagged + " flagged.");

    // ── Phase 2: Nesting Quality (NQI) ─────────────────────────────────────────
    log("[pipeline] --- Nesting Quality (NQI) ---");
    var nqiResult;
    try {
        nqiResult = runNestingQA(doc);
    } catch (e) {
        log("[pipeline] ERROR | NQI line " + e.line + ": " + e.message);
        scriptAlert("❌ Couldn't run Nesting Quality (NQI).\n\n"
            + "Reason (line " + e.line + "): " + e.message + "\n\n"
            + "Stuck? Send this to Josh:\n"
            + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
        return;
    }

    if (!nqiResult) {
        scriptAlert("❌ NQI check failed — Cutlines layer not found.\n\n"
            + "Ensure nested paths are on the \"" + CONFIG.cutlinesLayerName + "\" layer.\n\n"
            + "Stuck? Send this to Josh:\n"
            + copyLogBeside(filesFolder, "Noteworthie_ERROR.log"));
        return;
    }

    log("[pipeline] === AI_LayoutQA done ===");

    // ── Combined alert ─────────────────────────────────────────────────────────
    var msg = "Layout QA\n\n";

    // Spacing + margin.
    if (qaResult.flagged > 0) {
        msg += "Spacing/Margin: " + qaResult.flagged + " of " + qaResult.checked
            + " cut line(s) FLAGGED (red).\n"
            + "  Fix before exporting — AI_ExportFinal will halt on these.\n\n";
    } else {
        msg += "Spacing/Margin: all " + qaResult.checked + " cut line(s) OK.\n\n";
    }

    // NQI.
    var passStr = nqiResult.pass ? "PASS" : "FAIL";
    msg += "NQI Score: " + nqiResult.nqi + " / 100  —  " + passStr
        + " (threshold: " + CONFIG.passingNqi + ")\n"
        + "Utilization: " + nqiResult.utilization + "%\n";

    var flagged = 0, pocketLines = "", p;
    for (p = 0; p < nqiResult.pockets.length; p++) {
        var pk = nqiResult.pockets[p];
        if (pk.areaMm2 < CONFIG.pocketMinAreaMm2) continue;
        flagged++;
        pocketLines += "  " + flagged + ". " + pk.label
            + "  — " + Math.round(pk.areaMm2) + " mm2\n";
    }
    if (flagged === 0) {
        msg += "No reworkable pockets detected.\n";
    } else {
        msg += flagged + " reworkable pocket(s):\n" + pocketLines;
    }
    if (!CONFIG.dryRun) {
        msg += "All flags + pockets are on the \"" + CONFIG.qaLayerName
            + "\" layer — toggle it to show/hide; it's stripped at export.\n";
    }

    // Guidance.
    if (qaResult.flagged > 0 || !nqiResult.pass) {
        msg += "\nAdjust the nesting / pencil, then re-run this script.";
    } else {
        msg += "\nLayout looks good — continue with AI_ExportFinal.";
    }

    scriptAlert(msg);
}

// Buffer Layout QA's many per-path/per-pocket log lines and flush in ONE write (a
// file open/write/close per line is measurable on a slow disk). The try/finally
// guarantees flushLog() runs on ANY exit from main — normal return, early return,
// or an uncaught throw — so buffered diagnostics are never lost (each scriptAlert
// also flushes; flushLog is idempotent). beginLogBuffer/flushLog are no-ops for
// every other pipeline (default is immediate logging).
beginLogBuffer();
try {
    main();
} finally {
    flushLog();
}
