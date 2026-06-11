#target photoshop
#include "../utils/json2.jsx"
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
    // whiteEdgeLayerName must match CONFIG.whiteEdgeLayerName in PS_BuildElements.jsx
    // so Step 3B can find the White Base_Cutline layers left by Step 3.
    whiteEdgeLayerName: "White Base_Cutline",

    whiteSliceStepPx:       12,  // px: slice width for sampling the text centreline (smaller = finer spine)
    whitePenPadPx:          20,  // px: added to text height → pen diameter (margin above+below text, split top/bottom)
                                 //     halved 40→20 to track captionSizePt 16→8 (deterministic true-scale placement);
                                 //     keeps the pill ~1.5x the printed 8pt text (~4.2mm). Confirm on a real render.
    whiteStraightSnapPx:    6,   // px: if the fitted spine stays within this of flat, force a perfectly straight pill
    whiteCurvedHeightPctile: 0.9,// quantile of per-slice heights used as curved-text line-height (accents included)
    captionBorderOverlapPx: 3,   // px: the White pill is re-seated so its real ink overlaps the element's
                                 //     white-border ink by this much at the worst (least-overlapping) column.
                                 //     Re-seats to EXACT overlap (closes gaps and pulls back over-overlaps).
    snapColumns:            9,   // # of strips sampled across the cross axis when matching the pill edge
                                 //     to the border edge (per-strip ink comparison; handles arced captions
                                 //     vs round art, any placement direction)
    plateWidthPadH:         20,  // px: GC-LM caption-plate horizontal padding (independent of pill padding)
    whiteHeightPlate:  118,  // px: plate-treatment White height (1 cm at 300 DPI, 1-line)
    whiteHeightPlate2: 189,  // px: plate-treatment White height (1.6 cm at 300 DPI, 2-line)
    platePaddingTop:   10,   // px: Caption plate sits this many px above text top
    whiteRectPadV:     6,    // px: vertical padding above Caption plate for White base

    // [styleCode, catCode] pairs that use the plate treatment.
    // Must match CONFIG.captionPlateCodes in PS_BuildElements.jsx.
    captionPlateCodes: [["GC", "LM"]],

    // ── BridgeTalk handoff ─────────────────────────────────────────────────────
    bridgeTalkTimeout: 20    // seconds to wait for Illustrator to respond
};

var _root = $.fileName
    ? new File($.fileName).parent.parent.fsName
    : Folder.desktop.fsName;

CONFIG.logPath        = _root + "/pipelines/PSAI_BuildAndExportCutlines.log";
CONFIG.aiPipelinePath = _root + "/pipelines/AI_BuildCutlines.jsx";

// ─── SILHOUETTE PNG EXPORT ────────────────────────────────────────────────────

// Builds a transient flat-black silhouette layer, exports it as a PNG sidecar
// next to the PSD, then removes the layer (it is never saved into the working
// file). Returns the PNG file path, or null on failure.
function exportSilhouettePng(doc) {
    var silLayer = createSilhouetteLayer(doc); // transient; removed below
    if (!silLayer) {
        log("[pipeline] ERROR | could not build silhouette — cannot export PNG.");
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

    var opts = new ExportOptionsSaveForWeb();
    opts.format      = SaveDocumentType.PNG;
    opts.PNG8        = false;
    opts.transparency = false;
    opts.interlaced   = false;
    doc.exportDocument(new File(pngPath), ExportType.SAVEFORWEB, opts);

    // Restore visibility, then drop the transient layer.
    for (i = 0; i < layers.length; i++) {
        layers[i].visible = visibilities[i];
    }
    silLayer.remove();

    log("[pipeline] exported silhouette PNG (transient layer removed): " + pngPath);
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
    var whiteLeft = null, whiteTop = null;   // White pill's own bounds (spine re-anchor)

    function absorb(layer) {
        var b = layer.bounds;
        var l = b[0].as("px"), t = b[1].as("px"), r = b[2].as("px"), bo = b[3].as("px");
        if (left   === null || l  < left)   left   = l;
        if (top    === null || t  < top)    top    = t;
        if (right  === null || r  > right)  right  = r;
        if (bottom === null || bo > bottom) bottom = bo;
        found = true;
        return [l, t, r, bo];
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
            var wb = absorb(al);
            whiteLeft = wb[0]; whiteTop = wb[1];
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
        bottom: Math.round(bottom),
        whiteLeft: whiteLeft === null ? null : Math.round(whiteLeft),
        whiteTop:  whiteTop  === null ? null : Math.round(whiteTop)
    };
}

// Builds the sidecar spine suffix for one caption, or "" if no spine was stashed
// (non-WC, cold start, or no White pill found). Re-anchors the bbox-relative spine
// offsets captured in Step 3B to the White pill's FINAL position, then serialises
// as "|{radius}|x1,y1;x2,y2;..." (absolute px). Step 6 maps these PSD px to AI.
// Returns the WC caption's real fitted capsule as { radius, points: [{x,y}, ...] }
// (px, re-anchored to the White pill's current position), or null when there's no
// spine record or the White pill bounds are unknown (GC/stamps → parametric pill).
function captionSpine(displayName, cap) {
    if (typeof WC_CAPTION_SPINES === "undefined") return null;
    var rec = WC_CAPTION_SPINES[displayName];
    if (!rec || !rec.off || rec.off.length < 2) return null;
    if (cap.whiteLeft === null || cap.whiteTop === null) return null;

    var pts = [];
    for (var i = 0; i < rec.off.length; i++) {
        pts.push({
            x: Math.round(cap.whiteLeft + rec.off[i].dx),
            y: Math.round(cap.whiteTop  + rec.off[i].dy)
        });
    }
    return { radius: Math.round(rec.radius), points: pts };
}

// ─── ELEMENTS SIDECAR ────────────────────────────────────────────────────────

// Writes a JSON sidecar ({name}_elements.json) next to the PSD with PSD dimensions
// and per-element bounds + caption metadata. Read by AI_BuildCutlines/Step 6 for
// positional path naming and plate rebuild after Image Trace. Shape:
//   { psdWidth, psdHeight, elements: [
//       { displayName, styleCode, left, top, right, bottom,
//         caption: null | { lines, left, top, right, bottom,
//                           radius?, spine?: [{x,y}, ...] } } ] }
// caption is null for stamps/uncaptioned; radius+spine present only for WC captions
// (the real fitted capsule). JSON avoids delimiter collisions with caption text.
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

    var data = { psdWidth: psdW, psdHeight: psdH, elements: [] };
    var i;
    for (i = 0; i < elementsGroup.layerSets.length; i++) {
        var grp    = elementsGroup.layerSets[i];
        var parsed = parseLayerName(grp.name);
        if (!parsed) continue;

        var b = grp.bounds; // [left, top, right, bottom] UnitValues
        var el = {
            displayName: parsed.displayName,
            styleCode:   parsed.styleCode,
            left:   Math.round(b[0].as("px")),
            top:    Math.round(b[1].as("px")),
            right:  Math.round(b[2].as("px")),
            bottom: Math.round(b[3].as("px")),
            caption: null
        };

        // Caption metadata lets Step 6 build the plate. WC captions additionally
        // carry the real fitted capsule (radius + spine points, px) so Step 6
        // rebuilds the curved/tilted caption instead of an axis-aligned pill.
        var cap = captionInfo(grp);
        if (cap) {
            el.caption = {
                lines:  cap.lines,
                left:   cap.left,
                top:    cap.top,
                right:  cap.right,
                bottom: cap.bottom
            };
            var spine = captionSpine(parsed.displayName, cap);
            if (spine) {
                el.caption.radius = spine.radius;
                el.caption.spine  = spine.points;
            }
        }

        data.elements.push(el);
    }

    app.preferences.rulerUnits = prevUnits;

    var jsonPath = doc.fullName.fsName.replace(/\.psd$/i, "_elements.json");
    var f = new File(jsonPath);
    f.encoding = "UTF-8";
    if (!f.open("w")) {
        log("[pipeline] ERROR | could not open elements sidecar for writing: " + jsonPath);
        return null;
    }
    if (!f.write(JSON.stringify(data))) {
        log("[pipeline] ERROR | write failed for elements sidecar: " + jsonPath);
        f.close();
        return null;
    }
    f.close();

    log("[pipeline] wrote elements sidecar: " + jsonPath
        + " (" + data.elements.length + " element(s))");
    return jsonPath;
}

// ─── PER-ELEMENT PNG EXPORT ───────────────────────────────────────────────────

// True if layer is one of the caption sub-layers (TEXT, "White" pill, or the
// "Caption plate" group). Mirrors the classification in hideCaptionSublayers
// (Step5_Silhouette.jsx) so the art and caption passes stay in agreement.
function _isCaptionSublayer(layer) {
    if (layer.typename === "LayerSet") return layer.name === "Caption plate";
    return layer.kind === LayerKind.TEXT || layer.name === "White";
}

// Complement of hideCaptionSublayers: hides every NON-caption layer (the art
// Smart Object + "White Base_Cutline" white edge) in each element group, leaving
// only the caption visible. Used for the caption-only export pass. Returns the
// list of layers it actually hid, for restoration.
// PRECONDITION: every element group must be visible when this runs. layer.visible
// reflects EFFECTIVE (parent-inherited) visibility in PS 2026, so a child inside a
// hidden group reads visible=false and would be wrongly skipped. The caller resets
// group visibility before calling this.
function hideNonCaptionSublayers(elementsGroup) {
    var hidden = [];
    var g, a, s;
    for (g = 0; g < elementsGroup.layerSets.length; g++) {
        var grp = elementsGroup.layerSets[g];
        for (a = 0; a < grp.artLayers.length; a++) {
            var al = grp.artLayers[a];
            if (!_isCaptionSublayer(al) && al.visible) {
                al.visible = false;
                hidden.push(al);
            }
        }
        for (s = 0; s < grp.layerSets.length; s++) {
            var ls = grp.layerSets[s];
            if (!_isCaptionSublayer(ls) && ls.visible) {
                ls.visible = false;
                hidden.push(ls);
            }
        }
    }
    return hidden;
}

// True if the element group contains any caption sub-layer (regardless of
// visibility). Stamps / uncaptioned elements return false and are skipped by the
// caption-only pass (they would otherwise export an empty PNG).
function groupHasCaption(grp) {
    var a, s;
    for (a = 0; a < grp.artLayers.length; a++) {
        if (_isCaptionSublayer(grp.artLayers[a])) return true;
    }
    for (s = 0; s < grp.layerSets.length; s++) {
        if (_isCaptionSublayer(grp.layerSets[s])) return true;
    }
    return false;
}

// Duplicate → trim to visible (transparent) bounds → export PNG → rename. The
// temp-name + rename dance works around two PS 2026 Save-For-Web quirks (see the
// inline notes). Returns true on success. Shared by the art and caption passes.
function _exportTrimmedPng(doc, folderPath, fileBase) {
    var dup = null;
    var ok  = false;
    try {
        dup = doc.duplicate();
        dup.trim(TrimType.TRANSPARENT, true, true, true, true);
        var pngOpts          = new ExportOptionsSaveForWeb();
        pngOpts.format       = SaveDocumentType.PNG;
        pngOpts.PNG8         = false;
        pngOpts.transparency = true;
        pngOpts.interlaced   = false;
        // 1. SFW silently NO-OPs over an existing file → remove target first.
        // 2. SFW sanitises spaces/punctuation in the filename → write a space-free
        //    temp name verbatim, then rename to the real (spaced/unicode) name.
        var tmpFile = new File(folderPath + "/__export_tmp.png");
        if (tmpFile.exists) tmpFile.remove();
        dup.exportDocument(tmpFile, ExportType.SAVEFORWEB, pngOpts);
        var outFile = new File(folderPath + "/" + fileBase + ".png");
        if (outFile.exists) outFile.remove();
        tmpFile.rename(fileBase + ".png");
        ok = true;
    } catch (e) {
        log("[pipeline] WARN | failed to export " + fileBase + ": " + e.message);
    }
    if (dup) dup.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
    return ok;
}

// Runs one export pass over every element group. captionOnly=false → art PNG
// "{displayName}.png"; captionOnly=true → caption PNG "{displayName}_caption.png"
// (groups without a caption are skipped). Assumes the caller has already set the
// art/caption layer visibility for the pass. Returns the count exported.
function _exportElementPass(doc, elementsGroup, folderPath, captionOnly) {
    var count = 0;
    var j, k, grp, parsed, safeName, fileBase;
    for (j = 0; j < elementsGroup.layerSets.length; j++) {
        grp    = elementsGroup.layerSets[j];
        parsed = parseLayerName(grp.name);
        if (!parsed) continue;
        if (captionOnly && !groupHasCaption(grp)) {
            log("[pipeline] caption PNG SKIP | " + grp.name + " — no caption.");
            continue;
        }

        // Show only this element group.
        for (k = 0; k < elementsGroup.layerSets.length; k++) {
            elementsGroup.layerSets[k].visible = false;
        }
        grp.visible = true;

        safeName = parsed.displayName.replace(/[\/\\:*?"<>|]/g, "_");
        fileBase = captionOnly ? (safeName + "_caption") : safeName;

        if (CONFIG.dryRun) {
            log("[pipeline] [DRY RUN] would export " + (captionOnly ? "caption" : "element")
                + " PNG: " + fileBase);
            continue;
        }

        if (_exportTrimmedPng(doc, folderPath, fileBase)) {
            count++;
            log("[pipeline] exported " + (captionOnly ? "caption" : "element")
                + " PNG: " + fileBase);
        }
    }
    return count;
}

// Exports each element group as a separate PNG into {baseName}_elements/.
// Two passes per element so the printed caption is decoupled from the art:
//   {displayName}.png          art + white base only (caption hidden)
//   {displayName}_caption.png  caption (pill + text) only — placed as its own
//                              object on the AI side so it stays at absolute spec
//                              when the artist resizes the art during nest refinement
// Each PNG is trimmed to its bounding box on a transparent background, so
// AI_ImportNesting can place it at the correct scale.
// Returns the folder path string, or null on failure.
function exportElementPngs(doc) {
    var elementsGroup = findLayerByName(doc, "Elements");
    if (!elementsGroup) {
        log("[pipeline] WARN | Elements group not found — skipping element PNG export.");
        return null;
    }

    var baseName   = doc.fullName.fsName.replace(/\.psd$/i, "");
    var folderPath = baseName + "_elements";
    var folder     = new Folder(folderPath);
    if (!folder.exists) folder.create();

    var prevUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    // Hide all top-level layers; show only the Elements group.
    var topLayers = doc.layers;
    var topVis    = [];
    var i;
    for (i = 0; i < topLayers.length; i++) {
        topVis[i]            = topLayers[i].visible;
        topLayers[i].visible = false;
    }
    elementsGroup.visible = true;

    // Snapshot element sub-group visibility — the isolation loop below hides
    // siblings to export each element alone, and these must be restored after
    // (the silhouette builder downstream merges the whole Elements group and
    // depends on every element group being visible).
    var subVis = [];
    var sv;
    for (sv = 0; sv < elementsGroup.layerSets.length; sv++) {
        subVis[sv] = elementsGroup.layerSets[sv].visible;
    }

    // (main() ran doc.revealAll() before Step 3B, so all caption pixels are
    // on-canvas — each trim captures full bounds with no off-canvas clipping.)

    // ── Pass 1: art (caption-free) ──────────────────────────────────────────
    // Hide caption sub-layers so each art PNG carries art + white base only.
    var hiddenCaptionLayers = hideCaptionSublayers(elementsGroup);
    var artCount = _exportElementPass(doc, elementsGroup, folderPath, false);
    restoreVisibility(hiddenCaptionLayers);

    // ── Pass 2: caption-only (pill + text as one unit) ──────────────────────
    // Hide art + white base so each caption PNG carries the caption only. Placed
    // as its own object on the Illustrator side so it stays at absolute spec when
    // the artist resizes the art during manual nest refinement.
    //
    // Pass 1's per-element isolation left most groups hidden. Because layer.visible
    // reports EFFECTIVE (parent-inherited) visibility in PS 2026, hideNonCaptionSublayers
    // would read every child as visible=false and skip it. Reset all element groups to
    // visible first so child own-flags read correctly. (The final restore below puts the
    // original sub-group visibility back.)
    for (sv = 0; sv < elementsGroup.layerSets.length; sv++) {
        elementsGroup.layerSets[sv].visible = true;
    }
    var hiddenArtLayers = hideNonCaptionSublayers(elementsGroup);
    var capCount = _exportElementPass(doc, elementsGroup, folderPath, true);
    restoreVisibility(hiddenArtLayers);

    // Restore element sub-group visibility (hidden during per-element isolation).
    for (sv = 0; sv < elementsGroup.layerSets.length; sv++) {
        elementsGroup.layerSets[sv].visible = subVis[sv];
    }

    // Restore top-level layer visibilities.
    for (i = 0; i < topLayers.length; i++) {
        topLayers[i].visible = topVis[i];
    }

    app.preferences.rulerUnits = prevUnits;

    log("[pipeline] element PNGs: " + artCount + " art + " + capCount
        + " caption file(s) → " + folderPath);
    return folderPath;
}

// ─── BRIDGETALK HANDOFF ───────────────────────────────────────────────────────

function handOffToIllustrator(doc) {
    // Export silhouette PNG and elements sidecar — inputs for Step 6. These are
    // written regardless of BridgeTalk so the artist can run Illustrator manually
    // if the handoff is disabled or fails.
    var silhPngPath    = exportSilhouettePng(doc);
    var elementsPath   = writeElementsFile(doc);

    if (!silhPngPath || !elementsPath) {
        log("[pipeline] ERROR | export failed — BridgeTalk handoff aborted.");
        scriptAlert("BridgeTalk handoff aborted: could not export silhouette PNG or elements sidecar.\n"
            + "Check that the Elements group exists.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    if (!CONFIG.aiPipelinePath) {
        log("[pipeline] WARN: aiPipelinePath not set — sidecars written, skipping BridgeTalk handoff.");
        scriptAlert("Sidecars exported (silhouette PNG + elements sidecar).\n"
            + "BridgeTalk skipped: CONFIG.aiPipelinePath is empty.\n"
            + "Set CONFIG.aiPipelinePath to AI_BuildCutlines.jsx and re-run to auto-hand off.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    function esc(p) { return p.replace(/\\/g, "/").replace(/"/g, '\\"'); }

    var aiStatus = null;   // JSON status string returned by the Illustrator half

    var bt = new BridgeTalk();
    bt.target = "illustrator";
    // Set the handoff flag first so AI_BuildCutlines' bottom dispatch does NOT auto-run
    // its direct-run main(); end the body with buildDocAndImport(...) so its returned
    // JSON status string becomes this message's result (captured in onResult below).
    bt.body = '$.global.__aiBuildCutlinesHandoff = true;'
        + '$.evalFile(new File("' + esc(CONFIG.aiPipelinePath) + '"));'
        + 'buildDocAndImport("'
        + esc(silhPngPath)  + '","'
        + esc(elementsPath) + '");';
    bt.onResult = function(resultMsg) {
        aiStatus = resultMsg.body;
        log("[pipeline] BridgeTalk result: " + aiStatus);
    };
    bt.onError = function(e) {
        log("[pipeline] BridgeTalk error: " + e.body);
    };
    bt.send(CONFIG.bridgeTalkTimeout);
    log("[pipeline] BridgeTalk: handed off to Illustrator | silh: " + silhPngPath);

    // Parse the Illustrator-half status so main()'s completion alert reflects the real
    // outcome. null when the AI side didn't respond within bridgeTalkTimeout.
    if (!aiStatus) return null;
    try { return JSON.parse(aiStatus); } catch (e) { return null; }
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
    log("[pipeline] === PSAI_BuildAndExportCutlines start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);
    log("[pipeline] document: " + doc.name);

    // ── Reveal off-canvas content BEFORE Step 3B ───────────────────
    // The working canvas (A2, set in PS_BuildElements) anchors the PSD→AI SCALE via its
    // WIDTH, but its fixed HEIGHT clips captions on the bottom row. That clip causes two
    // distinct failures downstream: (a) the exported element art is cropped, and (b) the
    // Step 3B white-pill / caption-spine fit is skewed against the canvas edge, so Step 6
    // rebuilds a plate that no longer matches the text and the cut line crosses the
    // caption. Expanding the canvas to contain ALL content here — before Step 3B fits the
    // pill — fixes both at the root. A bottom/right reveal leaves the top-left origin (and
    // therefore every layer's coordinates) unchanged, and width is the only scale-bearing
    // dimension, so calibration is preserved. isValidTemplate already ran above.
    if (!CONFIG.dryRun) {
        var _preW = Math.round(doc.width.as("px")), _preH = Math.round(doc.height.as("px"));
        doc.revealAll();
        log("[pipeline] revealAll | canvas " + _preW + "x" + _preH + " -> "
            + Math.round(doc.width.as("px")) + "x" + Math.round(doc.height.as("px")));
    }

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

    // ── Step 5: Finalize Elements group ────────────────────────────
    // (The silhouette raster is built transiently at export time — see
    //  exportSilhouettePng / createSilhouetteLayer — and never saved.)
    log("[pipeline] --- Step 5: Finalize Elements group ---");
    var snapshotB = doc.activeHistoryState;
    var silhouetteResult;

    try {
        silhouetteResult = runSilhouette(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotB;
        log("[pipeline] ERROR | step 5 line " + e.line + ": " + e.message
            + " — rolled back to post-grouping state.");
        scriptAlert("ERROR in Step 5 (Finalize Elements).\nLine " + e.line + ": " + e.message
            + "\n\nRolled back to post-grouping state. Log: " + CONFIG.logPath);
        return;
    }
    log("[pipeline] step 5 complete | Elements finalized.");

    // ── Reveal again AFTER Step 3B built the pills ─────────────────
    // The pre-Step-3B revealAll above sized the canvas to the caption TEXT (so the pill
    // fit isn't skewed against the edge). But Step 3B then grows each caption downward by
    // the white pill (~whitePenPadPx below the text), which can spill past that canvas
    // again. Reveal once more here so every pill is on-canvas before export — otherwise
    // the per-element trim would clip the pill bottom (cropped art). Together the two
    // reveals fix BOTH the spine fit (before) and the art completeness (after) with plain
    // document-wide calls — no per-element canvas math at export time.
    if (!CONFIG.dryRun) {
        var _pre2W = Math.round(doc.width.as("px")), _pre2H = Math.round(doc.height.as("px"));
        doc.revealAll();
        log("[pipeline] revealAll (post-Step-3B) | canvas " + _pre2W + "x" + _pre2H + " -> "
            + Math.round(doc.width.as("px")) + "x" + Math.round(doc.height.as("px")));
    }

    // ── Save PSD ───────────────────────────────────────────────────
    if (!CONFIG.dryRun) {
        doc.save();
        log("[pipeline] saved: " + doc.fullName.fsName);
    }

    // ── Per-element PNG export ─────────────────────────────────────
    log("[pipeline] --- Exporting per-element PNGs ---");
    var elemArtFolder = exportElementPngs(doc);
    if (elemArtFolder) {
        log("[pipeline] element PNGs folder: " + elemArtFolder);
    }

    // ── BridgeTalk → Illustrator ───────────────────────────────────
    log("[pipeline] --- BridgeTalk handoff → Illustrator (Step 6) ---");
    var aiStatus = null;
    if (!CONFIG.dryRun) {
        aiStatus = handOffToIllustrator(doc);
    } else {
        log("[pipeline] [DRY RUN] would export silhouette PNG + elements sidecar"
            + " and hand off to Illustrator: " + doc.fullName.fsName);
    }

    // ── Completion summary ─────────────────────────────────────────
    log("[pipeline] === PSAI_BuildAndExportCutlines done ===");

    // Report the Illustrator half's real outcome (from the BridgeTalk result) instead
    // of optimistically saying "Done." aiStatus is null on dry-run or no/late response.
    var cutlineLine;
    if (aiStatus && aiStatus.ok) {
        cutlineLine = "Cut lines + SVGs done in Illustrator ("
            + aiStatus.regular + " regular, " + aiStatus.irregular + " irregular).\n"
            + "Both SVGs are open in Illustrator, ready for Deepnest.\n\n";
    } else if (aiStatus) {
        cutlineLine = "WARNING: the Illustrator half did NOT finish cleanly"
            + (aiStatus.phase ? " (" + aiStatus.phase + ")" : "") + ":\n  "
            + (aiStatus.error || "unknown error") + "\n"
            + "Check Illustrator and the log before continuing.\n\n";
    } else {
        cutlineLine = "Illustrator is running cut lines automatically.\n"
            + "Wait for it to finish — it will alert you when SVGs are ready for Deepnest.\n\n";
    }

    // Surface an Illustrator-side trace-tuning no-op (from the AI status) in the PS alert.
    var tuneWarn = "";
    if (aiStatus && aiStatus.traceTuning && aiStatus.traceTuning.requested > 0
            && aiStatus.traceTuning.failed && aiStatus.traceTuning.failed.length > 0) {
        tuneWarn = "WARNING — trace tuning: only " + aiStatus.traceTuning.applied + "/"
            + aiStatus.traceTuning.requested + " knob(s) took effect — cutlines may be looser"
            + " than intended (not honored: " + aiStatus.traceTuning.failed.join(", ") + "). See log.\n\n";
    }

    var msg = "Done.\n\n"
        + "  Grouped:     " + captionWhiteResult.grouped + " element(s).\n"
        + "  Art PNGs:    " + (elemArtFolder ? elemArtFolder : "skipped") + "\n\n"
        + cutlineLine
        + tuneWarn
        + "After Deepnest: run AI_ImportNesting.jsx, selecting the Deepnest SVG(s)\n"
        + "and the '_elements' folder shown above.\n\n"
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
