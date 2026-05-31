#target photoshop
#include "../utils/psUtils.jsx"
#include "../photoshop/Step3B_CaptionWhite.jsx"
#include "../photoshop/Step5_Silhouette.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    skipLayerName:   "Guide",
    templateWidthCm: 42,
    templateDPI:     300,

    // For automated testing only — suppresses alert() dialogs for headless runs.
    suppressAlerts: false,

    logPath: "", // resolved below

    // ── Step 3B: Caption white base + grouping ─────────────────────────────────
    // whiteEdgeLayerName must match CONFIG.whiteEdgeLayerName in PS_ToCaption.jsx
    // so Step 3B can find the White Base_Cutline layers left by Step 3.
    whiteEdgeLayerName: "White Base_Cutline",

    whiteRectPadH:     20,   // net horizontal padding around text (after expand→contract)
    whiteExpandPx:     25,   // expand amount to fill letter counter holes (must be > ~20px)
    whiteSmoothPx:     8,    // smoothing radius for rounded pill ends
    whiteHeightPlate:  118,  // px: plate-treatment White height (1 cm at 300 DPI, 1-line)
    whiteHeightPlate2: 189,  // px: plate-treatment White height (1.6 cm at 300 DPI, 2-line)
    platePaddingTop:   10,   // px: Caption plate sits this many px above text top
    whiteRectPadV:     6,    // px: vertical padding above Caption plate for White base

    // [styleCode, catCode] pairs that use the plate treatment.
    // Must match CONFIG.captionPlateCodes in PS_ToCaption.jsx.
    captionPlateCodes: [["GC", "LM"]],

    // ── BridgeTalk handoff ─────────────────────────────────────────────────────

    // ⚠️  CONFIRM aiTemplatePath location with artist before first run.
    aiTemplatePath:    "",   // e.g. "/Volumes/Team Drive/.../Production_File_Template.ai"
    aiPipelinePath:    "",   // e.g. "/path/to/pipelines/AI_ToCutlines.jsx"
    bridgeTalkTimeout: 20    // seconds to wait for Illustrator to respond
};

CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/PS_AfterCaption.log";

// ─── BRIDGETALK HANDOFF ───────────────────────────────────────────────────────

function handOffToIllustrator(psdPath) {
    if (!CONFIG.aiPipelinePath) {
        log("[pipeline] WARN: aiPipelinePath not set — skipping BridgeTalk handoff.");
        scriptAlert("BridgeTalk handoff skipped: CONFIG.aiPipelinePath is empty.\n"
            + "Set the path to AI_ToCutlines.jsx and re-run.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    var bt = new BridgeTalk();
    bt.target = "illustrator";
    bt.body = '$.evalFile(new File("'
        + CONFIG.aiPipelinePath.replace(/\\/g, "/") + '"));'
        + 'openTemplateAndImport("'
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

    // ── Step 3B: Caption white base + grouping ─────────────────────
    log("[pipeline] --- Step 3B: Caption white + grouping ---");
    var snapshotA = doc.activeHistoryState;
    var captionWhiteResult;

    try {
        captionWhiteResult = runCaptionWhite(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotA;
        log("[pipeline] ERROR | step 3B line " + e.line + ": " + e.message
            + " — rolled back. Caption T layers are still present and untouched.");
        scriptAlert("ERROR in Step 3B (Caption white).\nLine " + e.line + ": " + e.message
            + "\n\nRolled back — caption T layers preserved.\n"
            + "Fix the issue and re-run.\nLog: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 3B complete | " + captionWhiteResult.grouped + " element(s) grouped.");

    // ── Step 5: Silhouette ─────────────────────────────────────────
    log("[pipeline] --- Step 5: Silhouette ---");
    var snapshotB = doc.activeHistoryState;
    var silhouetteResult;

    try {
        silhouetteResult = runSilhouette(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotB;
        log("[pipeline] ERROR | step 5 line " + e.line + ": " + e.message
            + " — rolled back to post-grouping state.");
        scriptAlert("ERROR in Step 5 (Silhouette).\nLine " + e.line + ": " + e.message
            + "\n\nRolled back to post-grouping state. Log: " + CONFIG.logPath);
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
        + "  Grouped:     " + captionWhiteResult.grouped + " element(s).\n"
        + "  Silhouette:  " + silhouetteResult.processed + " element(s).\n\n"
        + "Illustrator is opening the production template.\n"
        + "Wait for it to finish placing elements, then do Deepnest.\n\n"
        + "Log: " + CONFIG.logPath;

    if (captionWhiteResult.skipped.length > 0) {
        msg += "\n\nGrouping skipped (" + captionWhiteResult.skipped.length + "):";
        for (var s = 0; s < captionWhiteResult.skipped.length; s++) {
            msg += "\n  - " + captionWhiteResult.skipped[s];
        }
    }

    scriptAlert(msg);
}

main();
