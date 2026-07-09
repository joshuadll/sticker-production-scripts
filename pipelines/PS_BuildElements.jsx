#target photoshop
#include "../utils/psUtils.jsx"
#include "../utils/json2.jsx"
#include "../photoshop/Step1_CombineElements.jsx"
#include "../photoshop/Step2A_AutoResize.jsx"
#include "../photoshop/Step2B_WhiteEdge.jsx"
#include "../photoshop/Step3B_CaptionWhite.jsx"
#include "../photoshop/Step5_Silhouette.jsx"
#include "../photoshop/Step5b_ExportHandoff.jsx"

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// All tuneable values live here. Step files contain functions only.

var CONFIG = {
    dryRun: false,

    templateWidthCm:  42,
    templateHeightCm: 59.4,
    templateDPI:      300,   // fallback when no source resolution can be detected
    sourceDPI:        0,     // resolved at runtime from the source PSDs / adopted doc

    // For automated testing only — leave empty ("") for normal interactive use.
    // When set, skips the folder-picker dialog.
    sourceFolderPath: "",

    // For automated testing only — suppresses alert() dialogs for headless runs.
    // All alerts are still written to the log regardless.
    suppressAlerts: false,

    // Top-level source-PSD layer names to treat as non-elements (case-insensitive).
    // Background is always ignored; add helper layers a source PSD legitimately keeps
    // at the top level (e.g. "Guides", "Colour Reference") so they don't warn as
    // failed imports. Every other un-importable top-level layer IS warned.
    ignoreTopLevelLayers: [],

    logPath: "", // resolved below — same folder as this script

    // FINISHED element size in INCHES (art + white edge). getTargetPx multiplies by
    // the working resolution, so these hold at any DPI. Append + / - to the category
    // code for the large / small end (e.g. "Eiffel Tower [WC-LM+]").
    sizeTable: {
        "TL": 3.0,  "LM": 2.05, "MP": 1.9, "TR": 1.9, "IC": 1.65, "FD": 1.75, "ST": 1.5
    },
    sizeTableLarge: { "LM": 2.3, "MP": 2.0, "TR": 2.0, "IC": 1.8, "FD": 2.0 },
    sizeTableSmall: { "LM": 1.8, "MP": 1.8, "TR": 1.8, "IC": 1.5, "FD": 1.5 },

    // ── Step 2A: Grid layout (after resize) ───────────────────────────────────
    // Padding on each side of a grid cell, in millimetres.
    // Cell size = largest category (TL) + 2 × gridPaddingMm.
    gridPaddingMm:            5.08,  // review-grid cell padding (= 60px @300 DPI)

    // ── Step 3: White edge ────────────────────────────────────────────────────
    // Default width confirmed by artist as the majority case, in millimetres.
    // To adjust a single element: delete its White Base_Cutline layer, change this
    // value, re-run — the re-run guard skips all elements that still have their layer.
    whiteEdgeMm:             1.7,    // white border width (= 20px @300 DPI)
    // Select>Modify>Smooth radius applied to the white-edge band's outer edge
    // (Step 2B, after expand, before fill). This is the contour Step 5
    // silhouettes and Step 6 traces, so smoothing it here yields clean cutlines
    // without an Illustrator-side RDP pass. ⚠️ Tune with artist on a real SKU:
    // too large relative to whiteEdgeMm rounds away genuine corners, and
    // because it acts after the expand it can marginally shift finished bounds
    // at sharp corners (relevant to Step 2A's 2×whiteEdgeMm size compensation).
    // 0 disables smoothing. Landed at 1.7mm on a real watercolor SKU (2026-06-12).
    whiteEdgeSmoothRadiusMm: 1.7,    // Smooth radius on the band (= 20px @300 DPI)
    whiteEdgeLayerName: "White Base_Cutline", // name given to the created layer

    // Captions are NO LONGER authored in Photoshop — they are placed + built natively in
    // Illustrator (Step 6 / Pipeline 2). Step 3A is gone; Step 3B is reduced to element
    // grouping. The font/size/tracking spec now lives in the AI CONFIG (AI_BuildCutlines).

    // ── BridgeTalk handoff → Illustrator ───────────────────────────────────────
    bridgeTalkTimeout: 20    // seconds to wait for Illustrator to respond
};

var _root = $.fileName ? new File($.fileName).parent.parent.fsName : Folder.desktop.fsName;
CONFIG.logPath        = _root + "/pipelines/PS_BuildElements.log";
CONFIG.aiPipelinePath = _root + "/pipelines/AI_BuildCutlines.jsx";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function createTemplateDoc(dpi) {
    var w = new UnitValue(CONFIG.templateWidthCm, "cm");
    var h = new UnitValue(CONFIG.templateHeightCm, "cm");
    // RGB (sRGB) — source art is RGB and the target is an RGB inkjet with a custom ICC
    // profile applied at print time. A CMYK template would clip the art's gamut before
    // it ever reaches Illustrator; keeping RGB preserves full saturation end-to-end.
    var doc = app.documents.add(w, h, dpi, "Production Template",
        NewDocumentMode.RGB, DocumentFill.WHITE);

    // Fill Background with 50% gray so white edges are visible during review.
    var bgLayer = doc.backgroundLayer;
    bgLayer.isBackgroundLayer = false;
    doc.activeLayer = bgLayer;
    var gray = new SolidColor();
    gray.rgb.red   = 128;
    gray.rgb.green = 128;
    gray.rgb.blue  = 128;
    doc.selection.selectAll();
    doc.selection.fill(gray);
    doc.selection.deselect();
    bgLayer.isBackgroundLayer = true;

    log("[pipeline] created new template document ("
        + CONFIG.templateWidthCm + " x " + CONFIG.templateHeightCm + " cm, "
        + dpi + " DPI).");
    return doc;
}

// Scans the source folder's ELEMENT PSDs and returns the HIGHEST resolution found (DPI),
// warning on any mismatch. Returns 0 when no PSD is readable (caller falls back to
// templateDPI). Opens + closes each file read-only.
// Caption_Plate.psd is EXCLUDED: it's a separately-supplied caption backing asset (Step 1
// imports it by name), not element art, so its resolution must not drive element sizing.
function detectSourceDpi(folder) {
    var allFiles = folder.getFiles("*.psd"), files = [], fi;
    for (fi = 0; fi < allFiles.length; fi++) {
        if (String(allFiles[fi].name).toLowerCase() === "caption_plate.psd") continue;
        files.push(allFiles[fi]);
    }
    if (files.length === 0) return 0;
    var maxDpi = 0, seen = [], i, d, r;
    for (i = 0; i < files.length; i++) {
        d = null;
        try {
            d = app.open(files[i]);
            r = Math.round(d.resolution);
        } catch (e) {
            log("[pipeline] WARN | could not read resolution of " + files[i].name + ": " + e.message);
            if (d) { try { d.close(SaveOptions.DONOTSAVECHANGES); } catch (eC) {} }  // don't leak an open doc
            continue;
        }
        try { d.close(SaveOptions.DONOTSAVECHANGES); } catch (eC2) {}
        seen.push(files[i].name + "=" + r + "dpi");
        if (r > maxDpi) maxDpi = r;
    }
    // Warn on any mismatch (warn-on-all); the highest wins.
    var mixed = false, j;
    for (j = 0; j < seen.length; j++) {
        if (seen[j].indexOf("=" + maxDpi + "dpi") === -1) { mixed = true; break; }
    }
    if (mixed) {
        log("[pipeline] WARN | source PSDs have mixed resolutions, using highest ("
            + maxDpi + " DPI): " + seen.join(", "));
    }
    log("[pipeline] detected source DPI: " + maxDpi + " (from " + seen.length + " readable PSD(s) of " + files.length + ")");
    return maxDpi;
}

// Builds the "N element(s) NOT imported" warning block for the completion alert
// (empty string when nothing failed). Shared by the dry-run and normal-run paths so
// both surface the same failed-import list.
function notImportedWarning(notImported) {
    var ni = notImported || [];
    if (ni.length === 0) return "";
    var out = "⚠️ " + ni.length + " element" + (ni.length === 1 ? " was" : "s were") + " NOT imported:\n";
    for (var n = 0; n < ni.length; n++) {
        out += "   • \"" + ni[n].name + "\"  — " + (ni[n].reason || "invalid name")
            + "  (in " + decodeURI(ni[n].file) + ")\n";
    }
    out += "\nFix these in the source PSD (rename, ungroup folders, remove duplicates),\n"
        + "then re-run Pipeline 1.\n\n"
        + "──────────────────────────────\n\n";
    return out;
}

function saveWorkingDoc(doc, folder) {
    var savePath = folder.fsName + "/" + folder.name + ".psd";
    var saveFile = new File(savePath);
    var opts = new PhotoshopSaveOptions();
    opts.layers = true;
    opts.embedColorProfile = true;
    doc.saveAs(saveFile, opts, false);
    log("[pipeline] saved | " + savePath);
    return savePath;
}

// Exports the silhouette PNG + slim sidecar, then BridgeTalks to Illustrator to trace the cut
// and place native caption text (AI_BuildCutlines.buildDocAndImport). Returns the parsed JSON
// status from the Illustrator half, or null if it didn't respond. (Ported from the retired
// PSAI pipeline; the export helpers now live in Step5b_ExportHandoff.jsx.)
function handOffToIllustrator(doc) {
    var silhPngPath  = exportSilhouettePng(doc);
    var elementsPath = writeElementsFile(doc);

    if (!silhPngPath || !elementsPath) {
        log("[pipeline] ERROR | export failed — BridgeTalk handoff aborted.");
        var abortFolder = null;
        try { abortFolder = doc.fullName.parent.fsName; } catch (eAb) {}
        scriptAlert("❌ Couldn't export the silhouette / elements sidecar.\n\n"
            + "Check that the Elements group exists.\n\n"
            + "Send this to Josh:\n" + copyLogBeside(abortFolder, "Noteworthie_ERROR.log"));
        return null;
    }

    if (!CONFIG.aiPipelinePath) {
        log("[pipeline] WARN: aiPipelinePath not set — sidecars written, skipping BridgeTalk.");
        return null;
    }

    function esc(p) { return p.replace(/\\/g, "/").replace(/"/g, '\\"'); }

    var aiStatus = null;
    var bt = new BridgeTalk();
    bt.target = "illustrator";
    // Set the handoff flag first so AI_BuildCutlines' bottom dispatch does NOT auto-run main();
    // end the body with buildDocAndImport(...) so its returned JSON status is this message's result.
    bt.body = '$.global.__aiBuildCutlinesHandoff = true;'
        + '$.evalFile(new File("' + esc(CONFIG.aiPipelinePath) + '"));'
        + 'buildDocAndImport("' + esc(silhPngPath) + '","' + esc(elementsPath) + '");';
    bt.onResult = function(resultMsg) {
        aiStatus = resultMsg.body;
        log("[pipeline] BridgeTalk result: " + aiStatus);
    };
    bt.onError = function(e) { log("[pipeline] BridgeTalk error: " + e.body); };
    bt.send(CONFIG.bridgeTalkTimeout);
    log("[pipeline] BridgeTalk: handed off to Illustrator | silh: " + silhPngPath);

    if (!aiStatus) return null;
    try { return JSON.parse(aiStatus); } catch (e) { return null; }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
    // ── Init log ───────────────────────────────────────────────────
    log("[pipeline] === PS_BuildElements start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);

    // ── Resolve source folder (needed to detect source DPI) ────────
    var folder;
    if (CONFIG.sourceFolderPath) {
        folder = new Folder(CONFIG.sourceFolderPath);
        if (!folder.exists) {
            scriptAlert("Source folder not found:\n" + CONFIG.sourceFolderPath
                + "\n\nUpdate CONFIG.sourceFolderPath and try again.");
            return;
        }
    } else {
        folder = Folder.selectDialog("Select folder containing source PSD files");
        if (!folder) { log("[pipeline] cancelled."); return; }
    }
    log("[pipeline] source folder: " + folder.name);

    // ── Config sanity: size tables are in INCHES ───────────────────
    // A stale px-scale value (e.g. 570 instead of 1.9) would compute a 300x target silently.
    // Fail loudly — no real sticker is > 20 inches on its longest edge.
    var _tbls = [CONFIG.sizeTable, CONFIG.sizeTableLarge, CONFIG.sizeTableSmall], _ti, _k;
    for (_ti = 0; _ti < _tbls.length; _ti++) {
        for (_k in _tbls[_ti]) {
            if (_tbls[_ti].hasOwnProperty(_k) && _tbls[_ti][_k] > 20) {
                scriptAlert("Config error: size table value \"" + _k + "\" = " + _tbls[_ti][_k]
                    + " looks like PIXELS, not inches.\nThe size tables must be in INCHES"
                    + " (e.g. LM = 2.05). Fix CONFIG and re-run.");
                return;
            }
        }
    }

    // ── Determine working resolution + document ────────────────────
    // Adopted doc's own resolution wins; otherwise the highest source-PSD resolution.
    var doc;
    if (app.documents.length > 0 && isValidTemplate(app.activeDocument)) {
        doc = app.activeDocument;
        CONFIG.sourceDPI = Math.round(doc.resolution) || CONFIG.templateDPI;
        log("[pipeline] adopted open template | resolution " + CONFIG.sourceDPI + " DPI");
        // Cross-check the adopted doc against the actual source PSDs: if the sources are a
        // DIFFERENT resolution, the adopted doc's DPI silently governs sizing (higher-res
        // source art gets downsampled). Warn/alert instead of silently defeating the feature.
        var adoptedSrc = detectSourceDpi(folder);
        if (adoptedSrc > 0 && adoptedSrc !== CONFIG.sourceDPI) {
            var mm = "Open template is " + CONFIG.sourceDPI + " DPI but the source PSDs are "
                + adoptedSrc + " DPI";
            log("[pipeline] WARN | " + mm + " — the template's DPI governs sizing.");
            if (adoptedSrc > CONFIG.sourceDPI) {
                scriptAlert("⚠️ Resolution mismatch\n\n" + mm
                    + ".\n\nThe higher-resolution source art will be DOWNSAMPLED to the "
                    + "template's DPI.\nClose the open template and re-run to author at the "
                    + "source resolution,\nor continue if the template DPI is intended.");
            }
        }
    } else {
        var detected = detectSourceDpi(folder);
        if (detected === 0) {
            log("[pipeline] WARN | could not detect source resolution; falling back to "
                + CONFIG.templateDPI + " DPI.");
            scriptAlert("⚠️ Couldn't read the source PSD resolution\n\n"
                + "Falling back to " + CONFIG.templateDPI + " DPI. If your source art is a "
                + "different resolution,\nthe exported element sizes may be wrong.\n\n"
                + "Check the source folder is accessible (not iCloud-offline) and that the "
                + "PSDs open cleanly, then re-run.");
        }
        CONFIG.sourceDPI = detected || CONFIG.templateDPI;
        doc = createTemplateDoc(CONFIG.sourceDPI);
    }
    log("[pipeline] template: " + doc.name + " | working DPI " + CONFIG.sourceDPI);

    // ── Dry run: inspect only, no changes ─────────────────────────
    if (CONFIG.dryRun) {
        var dryResult = runCombine(doc, folder);
        log("[pipeline] [DRY RUN] complete. Would place " + dryResult.placed
            + " element(s) from " + dryResult.fileCount + " file(s). No changes made.");
        scriptAlert(notImportedWarning(dryResult.notImported)
            + "[DRY RUN] Complete.\n\n"
            + "Would place:  " + dryResult.placed + " element(s)\n"
            + "From:         " + dryResult.fileCount + " file(s)\n\n"
            + "No changes made. Log: " + CONFIG.logPath);
        return;
    }

    // ── Step 1: Combine ────────────────────────────────────────────
    log("[pipeline] --- Step 1: Combine ---");
    var snapshotA = doc.activeHistoryState;
    var combineResult;

    try {
        combineResult = runCombine(doc, folder);
    } catch (e) {
        doc.activeHistoryState = snapshotA;
        log("[pipeline] ERROR | step 1 line " + e.line + ": " + e.message
            + " — rolled back to initial template state.");
        scriptAlert("ERROR in Step 1 (Combine).\nLine " + e.line + ": " + e.message
            + "\n\nTemplate rolled back to its initial state.\n\nSend this to Josh:\n" + copyLogBeside(folder.fsName, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] step 1 complete | " + combineResult.placed + " element(s) from "
        + combineResult.fileCount + " file(s).");

    // ── HARD STOP: any failed import aborts before Step 2 ──────────
    // A partial set is useless — the artist must fix the source PSD and re-run the whole
    // pipeline anyway, so there is no value in resizing / building / handing off the
    // survivors. Triggers on runCombine's recorded failures (folder / duplicate name /
    // invalid name). The rarer placement-time SKIP stays log-only by design.
    if (combineResult.notImported.length > 0) {
        log("[pipeline] HALT | " + combineResult.notImported.length
            + " element(s) failed to import — stopping before Step 2.");
        scriptAlert(notImportedWarning(combineResult.notImported)
            + "Pipeline stopped — nothing was handed to Illustrator.\n"
            + "Fix the source PSD and re-run Pipeline 1.");
        return;
    }

    // ── Step 2: Resize ─────────────────────────────────────────────
    log("[pipeline] --- Step 2: Resize ---");
    var snapshotB = doc.activeHistoryState;
    var resizeResult;

    try {
        resizeResult = runResize(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotB;
        log("[pipeline] ERROR | step 2 line " + e.line + ": " + e.message
            + " — rolled back to post-combine state. All elements preserved.");
        scriptAlert("ERROR in Step 2 (Resize).\nLine " + e.line + ": " + e.message
            + "\n\nAll elements preserved. Resize rolled back to start of Step 2.\n"
            + "Fix the issue and re-run.\n\nSend this to Josh:\n" + copyLogBeside(folder.fsName, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] step 2 complete | " + resizeResult.resized + " element(s) resized.");

    // ── Step 3: White edge ─────────────────────────────────────────
    log("[pipeline] --- Step 3: White edge ---");
    var snapshotC = doc.activeHistoryState;
    var whiteEdgeResult;

    try {
        whiteEdgeResult = runWhiteEdge(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotC;
        log("[pipeline] ERROR | step 3 line " + e.line + ": " + e.message
            + " — rolled back to post-resize state.");
        scriptAlert("ERROR in Step 3 (White edge).\nLine " + e.line + ": " + e.message
            + "\n\nRolled back to post-resize state.\n"
            + "Ensure White edges.atn is loaded, then re-run.\n\nSend this to Josh:\n" + copyLogBeside(folder.fsName, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] step 3 complete | " + whiteEdgeResult.processed + " element(s).");

    // ── Step 3B: Group elements (no captions — those are native in Illustrator) ──
    log("[pipeline] --- Step 3B: Group elements ---");
    var snapshotD = doc.activeHistoryState;
    var groupResult;
    try {
        groupResult = runCaptionWhite(doc);   // slimmed: groups SO + white edge per element
    } catch (e) {
        doc.activeHistoryState = snapshotD;
        log("[pipeline] ERROR | step 3B line " + e.line + ": " + e.message + " — rolled back.");
        scriptAlert("ERROR in Step 3B (Group elements).\nLine " + e.line + ": " + e.message
            + "\n\nRolled back to post-white-edge state.\n\nSend this to Josh:\n"
            + copyLogBeside(folder.fsName, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] step 3B complete | " + groupResult.grouped + " element(s) grouped.");

    // ── Step 5: Finalize Elements group ──────────────────────────────
    log("[pipeline] --- Step 5: Finalize Elements group ---");
    var snapshotE = doc.activeHistoryState;
    try {
        runSilhouette(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotE;
        log("[pipeline] ERROR | step 5 line " + e.line + ": " + e.message + " — rolled back.");
        scriptAlert("ERROR in Step 5 (Finalize Elements).\nLine " + e.line + ": " + e.message
            + "\n\nSend this to Josh:\n" + copyLogBeside(folder.fsName, "Noteworthie_ERROR.log"));
        return;
    }
    log("[pipeline] step 5 complete | Elements finalized.");

    // Reveal any off-canvas element pixels so each trim / silhouette captures full bounds.
    if (!CONFIG.dryRun) { doc.revealAll(); }

    // ── Save working document ──────────────────────────────────────
    var savedPath = null;
    try {
        savedPath = saveWorkingDoc(doc, folder);
    } catch (e) {
        log("[pipeline] WARN | auto-save failed line " + e.line + ": " + e.message + ".");
    }

    // ── Export per-element art PNGs + GC plate PNG, then BridgeTalk → Illustrator ──
    var aiStatus = null;
    if (!CONFIG.dryRun) {
        exportElementPngs(doc);
        exportCaptionPlatePng(doc);          // GC SKUs only; null (no-op) for WC
        log("[pipeline] --- BridgeTalk handoff → Illustrator (trace cut + place caption text) ---");
        aiStatus = handOffToIllustrator(doc);
    } else {
        log("[pipeline] [DRY RUN] would export PNGs + sidecar and hand off to Illustrator.");
    }

    log("[pipeline] === PS_BuildElements done ===");

    // ── Completion summary ─────────────────────────────────────────
    var summary = "Combined " + combineResult.placed + " element(s) from " + combineResult.fileCount
        + " file(s) → resized " + resizeResult.resized + ", white-edged " + whiteEdgeResult.processed
        + ", grouped " + groupResult.grouped + ".";
    var msg;
    if (aiStatus && aiStatus.ok) {
        msg = "✅ Elements built + cut traced.\n\n  " + summary + "\n\n"
            + "Illustrator has traced the cut and placed native caption text.\n"
            + "Review/reshape the captions in Illustrator, then run Pipeline 2 (Build and Export Cutlines)."
            + (savedPath
                ? "\n\nPhotoshop will now close — continue in Illustrator."
                : "\n\n⚠️ Auto-save failed — save this file manually. Photoshop will stay open.");
    } else if (aiStatus && aiStatus.error) {
        var errLog = aiStatus.errorLog || copyLogBeside(folder.fsName, "Noteworthie_ERROR.log");
        msg = "❌ Couldn't finish tracing the cut in Illustrator.\n\n"
            + "Reason: " + aiStatus.error + "\n\n  " + summary + "\n\n"
            + "Send this file to Josh:\n" + errLog;
    } else {
        msg = "⏳ Illustrator is tracing the cut + placing captions.\n\n  " + summary + "\n\n"
            + "When it finishes, review the captions there, then run Pipeline 2 (Build and Export Cutlines)."
            + (savedPath ? "\n\nSaved: " + savedPath : "\n\n⚠️ Auto-save failed — save manually.");
    }
    if (resizeResult.skipped.length > 0) {
        msg += "\n\n⚠️ Resize skipped (" + resizeResult.skipped.length + "):";
        for (var s = 0; s < resizeResult.skipped.length; s++) msg += "\n   • " + resizeResult.skipped[s];
    }
    if (groupResult.skipped.length > 0) {
        msg += "\n\n⚠️ Couldn't group " + groupResult.skipped.length + " element(s):";
        for (var c = 0; c < groupResult.skipped.length; c++) msg += "\n   • " + groupResult.skipped[c];
    }

    scriptAlert(msg);

    // ── Work has moved to Illustrator — quit Photoshop ─────────────
    // Only when the working PSD was actually persisted this run (savedPath — its save is
    // WARN-only, so a failed save must NOT trigger a discard-and-quit), the handoff
    // EXPLICITLY succeeded (aiStatus.ok), the run is interactive (suppressAlerts false —
    // tests/headless never quit the app they drive), and it is not a dry run. A
    // null/timeout/error handoff, or an unsaved doc, leaves PS open so the artist can save /
    // retry. Because the PSD is saved, closing it DONOTSAVECHANGES discards only the
    // transient dirtiness from the PNG/silhouette exports.
    if (savedPath && !CONFIG.dryRun && !CONFIG.suppressAlerts && aiStatus && aiStatus.ok) {
        log("[pipeline] handoff confirmed OK — closing Photoshop.");
        try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (eClose) {
            log("[pipeline] WARN | could not close working doc: " + eClose.message);
        }
        try { app.quit(); } catch (eQuit) {
            log("[pipeline] WARN | app.quit() failed: " + eQuit.message);
        }
    }
}

// Dispatch: artist double-click runs main(). A test sets $.global.__psBuildElementsNoAuto = true
// BEFORE evaluating this file to load the functions (incl. handOffToIllustrator) without firing
// the full combine, then drives the phases itself.
if (!$.global.__psBuildElementsNoAuto) { main(); }
