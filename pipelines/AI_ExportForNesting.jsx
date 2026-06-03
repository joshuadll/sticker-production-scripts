#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step7A_DeepnestExport.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:         false,
    suppressAlerts: false,
    logPath:        "", // resolved below

    // Layer name — must match the Production File Template exactly.
    cutlinesLayerName: "Cutlines",

    // Extent ratio threshold: paths with ratio >= this are classified "regular"
    // and exported to _regular.svg for Deepnest's 90°-only rotation mode.
    // Tune this on the first real SKU run — every path's ratio is logged.
    deepnestRectThreshold: 0.82
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_ExportForNesting.log";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    try {
        if (app.documents.length === 0) {
            scriptAlert("No document open.\nPlease open the working .ai file first.");
            return;
        }

        var doc = app.activeDocument;

        log("[pipeline] === AI_ExportForNesting start ===");
        log("[pipeline] dryRun: " + CONFIG.dryRun);
        log("[pipeline] document: " + doc.name);
        log("[pipeline] threshold: " + CONFIG.deepnestRectThreshold);

        var result = runDeepnestExport(doc);

        if (!result) {
            scriptAlert("Step 7A failed — Cutlines layer not found.\n"
                + "Make sure Step 6 has been run on this document.\n"
                + "Log: " + CONFIG.logPath);
            return;
        }

        log("[pipeline] === AI_ExportForNesting done ===");

        var msg = "Done.\n\n"
            + "  Regular   (" + result.regular   + " paths): " + (result.regularPath   || "—") + "\n"
            + "  Irregular (" + result.irregular + " paths): " + (result.irregularPath || "—") + "\n\n"
            + "Import each SVG into Deepnest:\n"
            + "  Regular   → rotation: 90° increments\n"
            + "  Irregular → rotation: free\n\n"
            + "Threshold used: " + CONFIG.deepnestRectThreshold
            + "  (see log for per-path ratios to calibrate)\n\n"
            + "Log: " + CONFIG.logPath;

        scriptAlert(msg);

    } catch (e) {
        log("[pipeline] FATAL | line " + e.line + ": " + e.message);
        scriptAlert("AI_ExportForNesting failed.\nLine " + e.line + ": " + e.message
            + "\nLog: " + CONFIG.logPath);
    }
}

main();
