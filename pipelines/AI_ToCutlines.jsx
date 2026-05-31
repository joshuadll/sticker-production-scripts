#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step6_CreateCutlines.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:         false,
    suppressAlerts: false,
    logPath:        "", // resolved below

    // Working area dimensions — A4 minus margins (top/right/left: 10mm, bottom: 20mm).
    workingAreaWidthMm:  190,
    workingAreaHeightMm: 267,

    // Cut line stroke weight (pt).
    cutlineStrokePt: 0.25,

    // Layer names — must match the Production File Template exactly.
    cutlinesLayerName: "Cutlines",
    stickersLayerName: "Stickers",

    // ⚠️  CONFIRM with artist before first run.
    stampTemplatePath: ""  // e.g. "/Volumes/Team Drive/.../Stamp Cutline Template.ai"
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/AI_ToCutlines.log";

// ─── ENTRY POINT (called by BridgeTalk from PS_AfterCaption.jsx) ──────────────

// templatePath     — full path to Production_File_Template.ai
// silhPngPath      — flat black PNG exported from the Silhouette layer by PS_AfterCaption
// elementsFilePath — elements sidecar .txt written by PS_AfterCaption
function openTemplateAndImport(templatePath, silhPngPath, elementsFilePath) {

    log("[ai-pipeline] === AI_ToCutlines start ===");
    log("[ai-pipeline] template:       " + templatePath);
    log("[ai-pipeline] silhouette PNG: " + silhPngPath);
    log("[ai-pipeline] elements file:  " + elementsFilePath);

    if (!templatePath) {
        log("[ai-pipeline] ERROR | templatePath is empty.");
        scriptAlert("AI_ToCutlines: CONFIG.aiTemplatePath is not set in PS_AfterCaption.jsx.\n"
            + "Set it to the full path of Production_File_Template.ai and re-run.");
        return;
    }

    var templateFile = new File(templatePath);
    if (!templateFile.exists) {
        log("[ai-pipeline] ERROR | template not found: " + templatePath);
        scriptAlert("AI_ToCutlines: template file not found:\n" + templatePath
            + "\nLog: " + CONFIG.logPath);
        return;
    }

    // Open template document.
    var doc;
    try {
        doc = app.open(templateFile);
    } catch (e) {
        log("[ai-pipeline] ERROR | could not open template: " + e.message);
        scriptAlert("AI_ToCutlines: failed to open template.\n" + e.message
            + "\nLog: " + CONFIG.logPath);
        return;
    }
    log("[ai-pipeline] template opened: " + doc.name);

    // Run Step 6.
    var result;
    try {
        result = runCreateCutlines(doc, silhPngPath, elementsFilePath);
    } catch (e) {
        log("[ai-pipeline] ERROR | step 6 line " + e.line + ": " + e.message);
        scriptAlert("ERROR in Step 6 (Create Cutlines).\nLine " + e.line + ": " + e.message
            + "\nLog: " + CONFIG.logPath);
        return;
    }

    if (!result) {
        log("[ai-pipeline] Step 6 returned null — aborted.");
        return;
    }

    log("[ai-pipeline] === AI_ToCutlines done ===");

    var msg = "Done — cut lines created.\n\n"
        + "  Named:           " + result.named + " path(s)\n"
        + "  Stamps replaced: " + result.stampsReplaced + "\n"
        + "  Unmatched:       " + result.unmatched + "\n\n"
        + "Review paths in the Cutlines layer, then proceed to Deepnest.\n"
        + "Log: " + CONFIG.logPath;

    if (result.unmatched > 0) {
        msg += "\n\n⚠️  " + result.unmatched + " unmatched path(s) found."
            + "\nRename them manually in the Cutlines layer.";
    }
    if (!CONFIG.stampTemplatePath && result.stampsReplaced === 0) {
        msg += "\n\nNOTE: stampTemplatePath is not set — stamp elements kept as traced paths.";
    }

    scriptAlert(msg);
}
