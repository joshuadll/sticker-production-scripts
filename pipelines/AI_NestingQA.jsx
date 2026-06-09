#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/StepQA_NestingQuality.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:           false,
    suppressAlerts:   false,
    logPath:          "", // resolved below

    // Layer that holds the nested cutline paths after Deepnest import.
    cutlinesLayerName: "Cutlines",

    // Sheet working area — must match the Production File Template artboard.
    sheetWidthMm:  264.7,
    sheetHeightMm: 194.0,

    // Grid resolution: 1mm per cell gives pocket detection accurate to ~0.5 mm.
    cellSizeMm: 1,

    // Inter-sticker gap Deepnest enforces. Used to dilate occupied cells so the
    // required spacing around each sticker is treated as occupied space.
    // ⚠️ CONFIRM with artist before first run.
    gapMm: 2,

    // A free-space pocket whose inscribed circle radius >= this (mm) is flagged
    // as a reworkable opportunity. Smaller gaps are treated as irrecoverable
    // slivers and do not reduce the score.
    pocketThresholdMm: 4.5,

    // NQI >= this value is a PASS. Tune after calibration run on real sheets.
    passingNqi: 90,

    // When true, draws red rectangles over flagged pockets on an "NQI Pockets"
    // layer. Artist can delete this layer after reviewing.
    showOverlay: true
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_NestingQA.log";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    try {
        if (app.documents.length === 0) {
            scriptAlert("No document open.\nPlease open the working .ai file first.");
            return;
        }

        var doc = app.activeDocument;

        log("[pipeline] === AI_NestingQA start ===");
        log("[pipeline] document: " + doc.name);
        log("[pipeline] cellSizeMm=" + CONFIG.cellSizeMm
            + " | gapMm=" + CONFIG.gapMm
            + " | pocketThresholdMm=" + CONFIG.pocketThresholdMm
            + " | passingNqi=" + CONFIG.passingNqi);

        var result = runNestingQA(doc);

        if (!result) {
            scriptAlert("NQI check failed — Cutlines layer not found.\n"
                + "Import the Deepnest results and ensure paths are on the \""
                + CONFIG.cutlinesLayerName + "\" layer.\n"
                + "Log: " + CONFIG.logPath);
            return;
        }

        log("[pipeline] === AI_NestingQA done ===");

        // ── Format alert ─────────────────────────────────────────────────────

        var passStr     = result.pass ? "PASS" : "FAIL";
        var pocketLines = "";
        var flagged     = 0;
        var p;

        for (p = 0; p < result.pockets.length; p++) {
            var pk = result.pockets[p];
            if (pk.inscribedR < CONFIG.pocketThresholdMm) continue;
            flagged++;
            pocketLines += "  " + flagged + ". " + pk.label
                + "  — " + Math.round(pk.areaMm2) + " mm2"
                + "  (r ≈ " + (Math.round(pk.inscribedR * 10) / 10) + " mm)\n";
        }

        var msg = "NQI Score: " + result.nqi + " / 100  —  " + passStr
            + " (threshold: " + CONFIG.passingNqi + ")\n"
            + "Utilization: " + result.utilization + "%\n\n";

        if (flagged === 0) {
            msg += "No reworkable pockets detected.\n";
        } else {
            msg += flagged + " reworkable pocket(s):\n" + pocketLines;
        }

        if (!result.pass) {
            msg += "\nRework the nesting, then re-run this script.";
        } else {
            msg += "\nContinue with AI_RefineCutlines.";
        }

        if (CONFIG.showOverlay && !CONFIG.dryRun) {
            msg += "\n\n\"NQI Pockets\" layer added — delete when done.";
        }

        msg += "\n\nLog: " + CONFIG.logPath;

        scriptAlert(msg);

    } catch (e) {
        log("[pipeline] FATAL | line " + e.line + ": " + e.message);
        scriptAlert("AI_NestingQA failed.\nLine " + e.line + ": " + e.message
            + "\nLog: " + CONFIG.logPath);
    }
}

main();
