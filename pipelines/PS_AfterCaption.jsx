#target photoshop
#include "../utils/psUtils.jsx"
#include "../photoshop/Step3B_CaptionWhite.jsx"
#include "../photoshop/Step5_Silhouette.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

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

// ─── SILHOUETTE PNG EXPORT ────────────────────────────────────────────────────

// Exports the Silhouette layer as a flat PNG sidecar next to the PSD.
// Returns the PNG file path, or null on failure.
function exportSilhouettePng(doc) {
    var silLayer = findLayerByName(doc, "Silhouette");
    if (!silLayer) {
        log("[pipeline] ERROR | Silhouette layer not found — cannot export PNG.");
        return null;
    }

    var pngPath = doc.fullName.fsName.replace(/\.psd$/i, "_silhouette.png");

    // Store and override layer visibility — only Silhouette visible during export.
    var i;
    var layers = doc.layers;
    var visibilities = [];
    for (i = 0; i < layers.length; i++) {
        visibilities[i] = layers[i].visible;
        layers[i].visible = false;
    }
    silLayer.visible = true;

    var opts = new PNGSaveOptions();
    opts.compression = 0;
    opts.interlaced  = false;
    doc.saveAs(new File(pngPath), opts, true); // true = asCopy

    // Restore visibility.
    for (i = 0; i < layers.length; i++) {
        layers[i].visible = visibilities[i];
    }

    log("[pipeline] exported silhouette PNG: " + pngPath);
    return pngPath;
}

// ─── CAPTION METADATA ────────────────────────────────────────────────────────

// Returns caption region info for one element group, or null if it has no
// caption sub-layers. Bounds are the union of the TEXT, "White" pill, and
// "Caption plate" layers, in pixels. lines = caption line count (from the TEXT
// layer's contents). Caller must have ruler units set to PIXELS.
function captionInfo(grp) {
    var left = null, top = null, right = null, bottom = null;
    var lines = 1;
    var found = false;

    function absorb(layer) {
        var b = layer.bounds;
        var l = b[0].as("px"), t = b[1].as("px"), r = b[2].as("px"), bo = b[3].as("px");
        if (left   === null || l  < left)   left   = l;
        if (top    === null || t  < top)    top    = t;
        if (right  === null || r  > right)  right  = r;
        if (bottom === null || bo > bottom) bottom = bo;
        found = true;
    }

    var a;
    for (a = 0; a < grp.artLayers.length; a++) {
        var al = grp.artLayers[a];
        if (al.kind === LayerKind.TEXT) {
            absorb(al);
            var contents = "";
            try { contents = al.textItem.contents; } catch (e) { contents = ""; }
            if (contents) {
                var parts = contents.split(/[\r\n]+/);
                if (parts.length > lines) lines = parts.length;
            }
        } else if (al.name === "White") {
            absorb(al);
        }
    }

    var s;
    for (s = 0; s < grp.layerSets.length; s++) {
        if (grp.layerSets[s].name === "Caption plate") {
            absorb(grp.layerSets[s]);
        }
    }

    if (!found) return null;
    return {
        lines:  lines,
        left:   Math.round(left),
        top:    Math.round(top),
        right:  Math.round(right),
        bottom: Math.round(bottom)
    };
}

// ─── ELEMENTS SIDECAR ────────────────────────────────────────────────────────

// Writes a text sidecar next to the PSD with PSD dimensions and element bounds.
// Used by AI_ToCutlines.jsx for positional path naming after Image Trace.
// Format:
//   width:{px}
//   height:{px}
//   {displayName}|{styleCode}|{left_px}|{top_px}|{right_px}|{bottom_px}
//
// Returns the sidecar file path, or null on failure.
function writeElementsFile(doc) {
    var elementsGroup = findLayerByName(doc, "Elements");
    if (!elementsGroup) {
        log("[pipeline] ERROR | Elements group not found — cannot write elements sidecar.");
        return null;
    }

    var prevUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var psdW = Math.round(doc.width.as("px"));
    var psdH = Math.round(doc.height.as("px"));

    var lines = ["width:" + psdW, "height:" + psdH];
    var i;
    for (i = 0; i < elementsGroup.layerSets.length; i++) {
        var grp    = elementsGroup.layerSets[i];
        var parsed = parseLayerName(grp.name);
        if (!parsed) continue;

        var b = grp.bounds; // [left, top, right, bottom] UnitValues
        var line =
            parsed.displayName + "|"
            + parsed.styleCode + "|"
            + Math.round(b[0].as("px")) + "|"
            + Math.round(b[1].as("px")) + "|"
            + Math.round(b[2].as("px")) + "|"
            + Math.round(b[3].as("px"));

        // Append caption metadata so Step 6 can build the plate parametrically.
        // Format: |capLines|capLeft|capTop|capRight|capBottom  (px; zeros if none).
        var cap = captionInfo(grp);
        if (cap) {
            line += "|" + cap.lines
                + "|" + cap.left + "|" + cap.top
                + "|" + cap.right + "|" + cap.bottom;
        } else {
            line += "|0|0|0|0|0";
        }

        lines.push(line);
    }

    app.preferences.rulerUnits = prevUnits;

    var txtPath = doc.fullName.fsName.replace(/\.psd$/i, "_elements.txt");
    var f = new File(txtPath);
    f.open("w");
    f.write(lines.join("\n"));
    f.close();

    log("[pipeline] wrote elements sidecar: " + txtPath
        + " (" + (lines.length - 2) + " element(s))");
    return txtPath;
}

// ─── BRIDGETALK HANDOFF ───────────────────────────────────────────────────────

function handOffToIllustrator(doc) {
    if (!CONFIG.aiPipelinePath) {
        log("[pipeline] WARN: aiPipelinePath not set — skipping BridgeTalk handoff.");
        scriptAlert("BridgeTalk handoff skipped: CONFIG.aiPipelinePath is empty.\n"
            + "Set the path to AI_ToCutlines.jsx and re-run.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    // Export silhouette PNG and elements sidecar — inputs for Step 6.
    var silhPngPath    = exportSilhouettePng(doc);
    var elementsPath   = writeElementsFile(doc);

    if (!silhPngPath || !elementsPath) {
        log("[pipeline] ERROR | export failed — BridgeTalk handoff aborted.");
        scriptAlert("BridgeTalk handoff aborted: could not export silhouette PNG or elements sidecar.\n"
            + "Check that the Silhouette and Elements layers exist.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    function esc(p) { return p.replace(/\\/g, "/").replace(/"/g, '\\"'); }

    var bt = new BridgeTalk();
    bt.target = "illustrator";
    bt.body = '$.evalFile(new File("' + esc(CONFIG.aiPipelinePath) + '"));'
        + 'openTemplateAndImport("'
        + esc(CONFIG.aiTemplatePath) + '","'
        + esc(silhPngPath)           + '","'
        + esc(elementsPath)          + '");';
    bt.onError = function(e) {
        log("[pipeline] BridgeTalk error: " + e.body);
    };
    bt.send(CONFIG.bridgeTalkTimeout);
    log("[pipeline] BridgeTalk: handed off to Illustrator | silh: " + silhPngPath);
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
        handOffToIllustrator(doc);
    } else {
        log("[pipeline] [DRY RUN] would export silhouette PNG + elements sidecar"
            + " and hand off to Illustrator: " + doc.fullName.fsName);
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
