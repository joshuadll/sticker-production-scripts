#target photoshop
#include "../utils/psUtils.jsx"
#include "../photoshop/Step4_WhiteEdge.jsx"
#include "../photoshop/Step5_Silhouette.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    skipLayerName:   "Guide",
    templateWidthCm: 42,
    templateDPI:     300,

    // BridgeTalk handoff — paths for the AI pipeline.
    // ⚠️  CONFIRM aiTemplatePath location with artist before first run.
    aiTemplatePath:     "",  // e.g. "/Volumes/Team Drive/Production Assets/Production_File_Template.ai"
    bridgeTalkTimeout:  20,  // seconds to wait for Illustrator to respond

    // For automated testing only — leave empty ("") for normal interactive use.
    suppressAlerts: false,

    logPath: ""  // resolved below
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/PS_AfterCaption.log";

// ─── BRIDGETALK HANDOFF ───────────────────────────────────────────────────────

function handOffToIllustrator(psdPath) {
    if (!CONFIG.aiTemplatePath) {
        log("[pipeline] WARN: aiTemplatePath not set — skipping BridgeTalk handoff.");
        scriptAlert("BridgeTalk handoff skipped: CONFIG.aiTemplatePath is empty.\n"
            + "Set the path to Production_File_Template.ai and re-run.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    var bt = new BridgeTalk();
    bt.target = "illustrator";
    bt.body = 'openTemplateAndImport("'
        + CONFIG.aiTemplatePath.replace(/\\/g, "/") + '","'
        + psdPath.replace(/\\/g, "/") + '");';
    bt.onError = function(e) {
        log("[pipeline] BridgeTalk error: " + e.body);
    };
    bt.send(CONFIG.bridgeTalkTimeout);
    log("[pipeline] BridgeTalk: handed off to Illustrator | psd: " + psdPath);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {

    // ── Validate document ──────────────────────────────────────────
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the Resize Area PSD first.");
        return;
    }
    var doc = app.activeDocument;

    if (!isValidTemplate(doc)) {
        scriptAlert("Active document does not look like the Resize Area PSD.\n"
            + "Expected: " + CONFIG.templateWidthCm + " cm wide. "
            + "Got: " + Math.round(doc.width.as("cm")) + " cm.\n\n"
            + "Please activate the correct document and try again.");
        return;
    }

    // ── Init log ───────────────────────────────────────────────────
    log("[pipeline] === PS_AfterCaption start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    // ── Step 4: White Edge ─────────────────────────────────────────
    log("[pipeline] --- Step 4: White Edge ---");
    var snapshotA = doc.activeHistoryState;
    var whiteEdgeResult;

    try {
        whiteEdgeResult = runWhiteEdge(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotA;
        log("[pipeline] ERROR | step 4 line " + e.line + ": " + e.message
            + " — rolled back.");
        scriptAlert("ERROR in Step 4 (White Edge).\nLine " + e.line + ": " + e.message
            + "\n\nRolled back. Log: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 4 complete | " + whiteEdgeResult.processed + " element(s).");

    // ── Step 5: Silhouette ─────────────────────────────────────────
    log("[pipeline] --- Step 5: Silhouette ---");
    var snapshotB = doc.activeHistoryState;
    var silhouetteResult;

    try {
        silhouetteResult = runSilhouette(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotB;
        log("[pipeline] ERROR | step 5 line " + e.line + ": " + e.message
            + " — rolled back to post-white-edge state.");
        scriptAlert("ERROR in Step 5 (Silhouette).\nLine " + e.line + ": " + e.message
            + "\n\nRolled back to post-white-edge state. Log: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 5 complete | " + silhouetteResult.processed + " element(s).");

    // ── Save PSD ───────────────────────────────────────────────────
    if (!CONFIG.dryRun) {
        doc.save();
        log("[pipeline] saved: " + doc.fullName.fsName);
    }

    // ── BridgeTalk → Illustrator ───────────────────────────────────
    log("[pipeline] --- BridgeTalk handoff → Illustrator (Step 6) ---");
    if (!CONFIG.dryRun) {
        handOffToIllustrator(doc.fullName.fsName);
    } else {
        log("[pipeline] [DRY RUN] would hand off to Illustrator: " + doc.fullName.fsName);
    }

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === PS_AfterCaption done ===");

    var msg = "Done.\n\n"
        + "  White Edge:  " + whiteEdgeResult.processed + " element(s).\n"
        + "  Silhouette:  " + silhouetteResult.processed + " element(s).\n\n"
        + "Illustrator is opening the production template.\n"
        + "Wait for it to finish placing elements, then do Deepnest.\n\n"
        + "Log: " + CONFIG.logPath;

    scriptAlert(msg);
}

main();
