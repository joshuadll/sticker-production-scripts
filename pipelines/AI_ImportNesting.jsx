#target illustrator
#include "../utils/aiUtils.jsx"
#include "../illustrator/StepNest_ImportLayout.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun:   false,

    // For automated testing only — suppresses alert() dialogs for headless runs.
    suppressAlerts: false,

    logPath: "", // resolved below

    // ── Layer names ──────────────────────────────────────────────────────────
    cutlinesLayerName: "Cutlines",
    stickersLayerName: "Sticker",

    // ── Area-based fallback matching ─────────────────────────────────────────
    // Max area ratio for accepting a match when names don't agree.
    // 1.1 = within 10% area difference. Raise only if elements are extremely
    // similar in size. Lower to force more exact area agreement.
    areaMatchTolerance: 1.1
};

var _root = $.fileName
    ? new File($.fileName).parent.parent.fsName
    : Folder.desktop.fsName;

CONFIG.logPath = _root + "/pipelines/AI_ImportNesting.log";

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    try {

        // ── Validate document ──────────────────────────────────────────────
        if (app.documents.length === 0) {
            scriptAlert("No document open.\nOpen the working .ai file first.");
            return;
        }
        var doc = app.activeDocument;

        log("[pipeline] === AI_ImportNesting start ===");
        log("[pipeline] dryRun: " + CONFIG.dryRun);
        log("[pipeline] document: " + doc.name);

        // ── Select Deepnest SVG file(s) ────────────────────────────────────
        var svgFiles = _selectSvgFiles();
        if (!svgFiles || svgFiles.length === 0) {
            log("[pipeline] cancelled — no SVG file(s) selected.");
            return;
        }
        var f;
        for (f = 0; f < svgFiles.length; f++) {
            log("[pipeline] SVG: " + svgFiles[f].fsName);
        }

        // ── Select element art folder ──────────────────────────────────────
        var artFolder = _selectArtFolder();
        if (!artFolder) {
            log("[pipeline] cancelled — no art folder selected.");
            return;
        }
        log("[pipeline] art folder: " + artFolder.fsName);

        // ── Run import ─────────────────────────────────────────────────────
        log("[pipeline] --- importing Deepnest layout ---");
        var result = runImportNesting(doc, svgFiles, artFolder);

        if (!result) {
            scriptAlert("Import failed — Cutlines layer not found.\n"
                + "Make sure Step 6 has been run on this document.\n"
                + "Log: " + CONFIG.logPath);
            return;
        }

        // ── Completion ─────────────────────────────────────────────────────
        log("[pipeline] === AI_ImportNesting done ===");

        var msg = "Done.\n\n"
            + "  Placed:     " + result.matched   + " element(s) at nested positions\n"
            + "  Unmatched:  " + result.unmatched  + " element(s) — see log\n"
            + "  Art placed: " + result.artPlaced  + " PNG(s) in Stickers layer\n\n";

        if (result.unmatched > 0) {
            msg += "WARNING: " + result.unmatched + " element(s) could not be matched.\n"
                + "Check the log for their names and positions. If Deepnest\n"
                + "renamed them, either rename the SVG paths to match the\n"
                + "element display names, or position those cutlines manually.\n\n";
        }

        msg += "Review the layout, then run AI_RefineCutlines to continue.\n\n"
            + "Log: " + CONFIG.logPath;

        scriptAlert(msg);

    } catch (e) {
        log("[pipeline] FATAL | line " + e.line + ": " + e.message);
        scriptAlert("AI_ImportNesting failed.\nLine " + e.line + ": " + e.message
            + "\nLog: " + CONFIG.logPath);
    }
}

// ─── DIALOGS ──────────────────────────────────────────────────────────────────

function _selectSvgFiles() {
    // Illustrator's File.openDialog supports multi-select (shift-click) on most platforms.
    var files = File.openDialog(
        "Select Deepnest output SVG(s) — shift-click to select both regular and irregular",
        "SVG:*.svg",
        true
    );
    if (!files) return null;
    if (files instanceof File) return [files];
    return files;
}

function _selectArtFolder() {
    return Folder.selectDialog(
        "Select the element art folder — the '{SKU}_elements' folder next to your PSD"
    );
}

main();
