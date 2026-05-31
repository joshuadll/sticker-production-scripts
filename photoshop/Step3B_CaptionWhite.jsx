// Step3B_CaptionWhite.jsx — Phase function only.
// #included by PS_AfterCaption.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Runs after the artist's manual caption review pass (Step 3A → artist adjusts →
// Step 3B). Finds each SO + T layer pair, creates a White pill base that follows
// the T layer's shape (handles straight and curved text), adds a Caption plate for
// GC-LM elements, then groups everything — including the White Base_Cutline added
// by Step 3 (white edge) — under the original element name.
//
// Expects at top level:
//   • SO layers (NAME_REGEX) — each followed immediately by White Base_Cutline
//   • T layers (display name, LayerKind.TEXT) — above the corresponding SO
//   • Optionally a "Caption plate" group for GC-LM SKUs
//
// Stamp elements ([ST]) are grouped with their White Base_Cutline only (no caption).
//
// Returns: { grouped, skipped[] }

function runCaptionWhite(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var grouped  = 0;
    var skipped  = [];
    var gcLmCount = 0;  // track how many GC-LM elements used the caption plate

    try {
        // Collect layer references upfront to avoid index-shift during grouping.
        var layerRefs = [];
        for (var i = 0; i < doc.layers.length; i++) {
            layerRefs.push(doc.layers[i]);
        }

        for (var i = 0; i < layerRefs.length; i++) {
            var soLayer = layerRefs[i];
            var name    = soLayer.name;

            if (name === CONFIG.skipLayerName) continue;
            if (name === "Caption plate")      continue;

            var parsed = parseLayerName(name);
            if (!parsed) continue;

            // ── Stamps: group SO + White Base_Cutline only, no caption ──────
            if (parsed.styleCode === "ST") {
                if (CONFIG.dryRun) {
                    log("[step3B] [DRY RUN] would group stamp | " + name);
                    grouped++;
                    continue;
                }
                try {
                    groupStamp(doc, soLayer, name);
                    log("[step3B] grouped stamp | " + name);
                    grouped++;
                } catch (e) {
                    log("[step3B] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                    skipped.push(name + " (error: " + e.message + ")");
                }
                continue;
            }

            if (!needsCaption(parsed)) continue;

            // Find matching T layer: a TEXT layer whose name equals the display name.
            var textLayer = findTextLayerByDisplayName(doc, parsed.displayName);
            if (!textLayer) {
                log("[step3B] SKIP | \"" + name + "\" — no T layer named \""
                    + parsed.displayName + "\" found. Run Step 3A first.");
                skipped.push(name + " (no T layer)");
                continue;
            }

            var isPlate = isCaptionPlate(parsed);

            if (CONFIG.dryRun) {
                var treatment = isPlate ? "plate" : "standard";
                log("[step3B] [DRY RUN] would group | " + name
                    + " (" + treatment + ") — T layer: \"" + textLayer.name + "\"");
                grouped++;
                continue;
            }

            try {
                if (isPlate) {
                    groupWithPlate(doc, soLayer, textLayer, name);
                    gcLmCount++;
                } else {
                    groupStandard(doc, soLayer, textLayer, name);
                }
                log("[step3B] grouped | " + name);
                grouped++;
            } catch (e) {
                log("[step3B] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                skipped.push(name + " (error: " + e.message + ")");
            }
        }

        // Remove the original Caption plate layer once all GC-LM elements are done.
        if (!CONFIG.dryRun && gcLmCount > 0) {
            var capPlate = findLayerByName(doc, "Caption plate");
            if (capPlate) {
                capPlate.remove();
                log("[step3B] removed original Caption plate layer (distributed into groups).");
            }
        }

    } finally {
        app.preferences.rulerUnits = origUnits;
    }

    return { grouped: grouped, skipped: skipped };
}

// ─── STAMP PATH ───────────────────────────────────────────────────────────────
// ST elements: SO + White Base_Cutline only (no caption layers).

function groupStamp(doc, soLayer, groupName) {
    var wbcLayer = findAdjacentCutline(doc, soLayer);
    var layers   = wbcLayer ? [soLayer, wbcLayer] : [soLayer];
    if (!wbcLayer) {
        log("[step3B] WARN | \"" + groupName
            + "\" — no White Base_Cutline found below SO. "
            + "Ensure Step 3 (white edge) ran before this step.");
    }
    selectAndGroup(doc, layers, groupName);
}

// ─── STANDARD PATH ────────────────────────────────────────────────────────────
// WC elements and GC non-LM: T + White pill + SO + White Base_Cutline.

function groupStandard(doc, soLayer, textLayer, groupName) {
    var wbcLayer   = findAdjacentCutline(doc, soLayer);
    var whiteLayer = createWhiteFromText(doc, textLayer);

    // Group in z-stack order: T (top/front), White pill, SO, White Base_Cutline (bottom/back).
    // Photoshop preserves relative positions, so passing [textLayer, whiteLayer, soLayer, wbcLayer]
    // would reorder them. Instead, pass all four and rely on their existing z-order.
    // selectAndGroup selects all four; Photoshop groups them preserving relative stack order.
    var layers = wbcLayer
        ? [textLayer, whiteLayer, soLayer, wbcLayer]
        : [textLayer, whiteLayer, soLayer];

    if (!wbcLayer) {
        log("[step3B] WARN | \"" + groupName
            + "\" — no White Base_Cutline below SO. "
            + "Ensure Step 3 (white edge) ran before this step.");
    }

    selectAndGroup(doc, layers, groupName);
}

// ─── PLATE PATH ───────────────────────────────────────────────────────────────
// GC-LM elements: SO + T + Caption plate (elongated) + White pill.

function groupWithPlate(doc, soLayer, textLayer, groupName) {
    var tBounds    = textLayer.bounds;
    var tLeft      = tBounds[0].as("px");
    var tRight     = tBounds[2].as("px");
    var tTop       = tBounds[1].as("px");
    var tCenterX   = (tLeft + tRight) / 2;
    var tWidth     = tRight - tLeft;
    var targetWidth = tWidth + CONFIG.whiteRectPadH * 2;

    // White base: pill sized to caption plate width, positioned below T.
    var whiteX1 = tCenterX - targetWidth / 2;
    var whiteY1 = tTop - CONFIG.platePaddingTop - CONFIG.whiteRectPadV;
    var whiteX2 = whiteX1 + targetWidth;
    var whiteY2 = whiteY1 + CONFIG.whiteHeightPlate;
    var whiteLayer = createPillFromRect(doc, whiteX1, whiteY1, whiteX2, whiteY2);

    // Caption plate: duplicate template, elongate, position.
    var plateLayer = null;
    var capPlateTemplate = findLayerByName(doc, "Caption plate");

    if (capPlateTemplate) {
        plateLayer = capPlateTemplate.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
        plateLayer.name = "Caption plate";

        elongateCaptionPlate(plateLayer, targetWidth);

        // Centre horizontally on element, align top with T top - platePaddingTop.
        var pBounds = plateLayer.bounds;
        var pCenterX = (pBounds[0].as("px") + pBounds[2].as("px")) / 2;
        var pTop     = pBounds[1].as("px");
        var targetPlateTop = tTop - CONFIG.platePaddingTop;

        plateLayer.translate(tCenterX - pCenterX, targetPlateTop - pTop);
    } else {
        log("[step3B] WARN | \"" + groupName
            + "\" — no Caption plate layer found in template. "
            + "Place a group named \"Caption plate\" in the source PSD before running.");
    }

    var wbcLayer = findAdjacentCutline(doc, soLayer);
    if (!wbcLayer) {
        log("[step3B] WARN | \"" + groupName
            + "\" — no White Base_Cutline below SO. "
            + "Ensure Step 3 (white edge) ran before this step.");
    }

    // Z-order (top → bottom): T, White pill, Caption plate, SO, White Base_Cutline.
    var layers = [];
    layers.push(textLayer);
    layers.push(whiteLayer);
    if (plateLayer) layers.push(plateLayer);
    layers.push(soLayer);
    if (wbcLayer)   layers.push(wbcLayer);

    selectAndGroup(doc, layers, groupName);
}

// ─── WHITE BASE HELPERS ───────────────────────────────────────────────────────

// Creates a White pill layer by loading the T layer's transparency as a
// selection, expanding (fills letter counter holes), contracting to net padding,
// then smoothing for rounded ends. Works for straight and curved text.
function createWhiteFromText(doc, textLayer) {
    loadLayerTransparency(textLayer);

    // Expand to fill letter counter holes (e.g. in 'o', 'e').
    doc.selection.expand(CONFIG.whiteExpandPx);

    // Contract to achieve target net padding around text.
    var contractAmt = CONFIG.whiteExpandPx - CONFIG.whiteRectPadH;
    if (contractAmt > 0) {
        doc.selection.contract(contractAmt);
    }

    // Smooth: rounds the ends of the selection naturally (pill effect).
    doc.selection.smooth(CONFIG.whiteSmoothPx);

    // Create White layer directly below the T layer, fill, deselect.
    var whiteLayer  = doc.artLayers.add();
    whiteLayer.name = "White";
    doc.selection.fill(solidWhite());
    doc.selection.deselect();

    whiteLayer.move(textLayer, ElementPlacement.PLACEAFTER);
    return whiteLayer;
}

// Creates a White pill layer from explicit pixel coordinates.
// Used for the plate treatment where White dimensions are fixed rather than
// derived from text bounds.
// Pill = centre rectangle + two semicircular end caps (three fills on one layer).
function createPillFromRect(doc, x1, y1, x2, y2) {
    var h = y2 - y1;
    var r = h / 2; // radius = half height → fully rounded ends

    doc.activeLayer = doc.layers[0]; // add new layer at top of stack so it's above textLayer
    var layer       = doc.artLayers.add();
    layer.name      = "White";
    var white       = solidWhite();

    // Centre rectangle body (between end caps).
    doc.selection.select([[x1+r, y1], [x2-r, y1], [x2-r, y2], [x1+r, y2]]);
    doc.selection.fill(white);

    // Left semicircular end cap.
    selectEllipse(doc, x1, y1, x1 + h, y2);
    doc.selection.fill(white);

    // Right semicircular end cap.
    selectEllipse(doc, x2 - h, y1, x2, y2);
    doc.selection.fill(white);

    doc.selection.deselect();
    return layer;
}

// loadLayerTransparency() is defined in psUtils.jsx.

// Sets an elliptical marquee selection (replaces current selection).
// Coordinates are in pixels; ruler must be set to PIXELS before calling.
function selectEllipse(doc, left, top, right, bottom) {
    var desc      = new ActionDescriptor();
    var selRef    = new ActionReference();
    selRef.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
    desc.putReference(charIDToTypeID("null"), selRef);
    var ellipDesc = new ActionDescriptor();
    ellipDesc.putUnitDouble(charIDToTypeID("Top "), charIDToTypeID("#Pxl"), top);
    ellipDesc.putUnitDouble(charIDToTypeID("Left"), charIDToTypeID("#Pxl"), left);
    ellipDesc.putUnitDouble(charIDToTypeID("Btom"), charIDToTypeID("#Pxl"), bottom);
    ellipDesc.putUnitDouble(charIDToTypeID("Rght"), charIDToTypeID("#Pxl"), right);
    desc.putObject(charIDToTypeID("T   "), charIDToTypeID("Elps"), ellipDesc);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
}

// ─── CAPTION PLATE HELPERS ────────────────────────────────────────────────────

// Elongates a Caption plate group using 3-piece (L/C/R) scaling.
// L and R end caps are never scaled; only C (the centre fill) is stretched.
// plateGroup must be a LayerSet with child layers named "L", "C", and "R".
function elongateCaptionPlate(plateGroup, targetWidth) {
    var lLayer = null, cLayer = null, rLayer = null;

    for (var i = 0; i < plateGroup.layers.length; i++) {
        var child = plateGroup.layers[i];
        if (child.name === "L")      lLayer = child;
        else if (child.name === "C") cLayer = child;
        else if (child.name === "R") rLayer = child;
    }

    if (!lLayer || !cLayer || !rLayer) {
        log("[step3B] WARN | Caption plate group is missing L/C/R child layers. "
            + "Expected layers named \"L\", \"C\", \"R\". Using plate as-is.");
        return;
    }

    var lWidth = lLayer.bounds[2].as("px") - lLayer.bounds[0].as("px");
    var rWidth = rLayer.bounds[2].as("px") - rLayer.bounds[0].as("px");
    var cCurrentWidth = cLayer.bounds[2].as("px") - cLayer.bounds[0].as("px");
    var cTargetWidth  = targetWidth - lWidth - rWidth;

    if (cTargetWidth <= 0) {
        log("[step3B] WARN | Caption plate targetWidth (" + targetWidth + "px) is narrower "
            + "than L+R end caps (" + (lWidth + rWidth) + "px). Using plate as-is.");
        return;
    }

    if (cCurrentWidth <= 0) {
        log("[step3B] WARN | Caption plate C layer has zero width. Using plate as-is.");
        return;
    }

    var scalePct = (cTargetWidth / cCurrentWidth) * 100;

    // Scale C horizontally from its left edge, keeping height unchanged.
    cLayer.resize(scalePct, 100, AnchorPosition.MIDDLELEFT);

    // Slide R layer to abut the right edge of the scaled C.
    var cRight = cLayer.bounds[2].as("px");
    var rLeft  = rLayer.bounds[0].as("px");
    rLayer.translate(cRight - rLeft, 0);
}

// ─── LAYER SELECTION AND GROUPING ─────────────────────────────────────────────

// Selects multiple layers and groups them into a new LayerSet.
// Renames the resulting group to groupName.
function selectAndGroup(doc, layers, groupName) {
    if (!layers || layers.length === 0) return;

    // Select first layer.
    selectLayerById(layers[0]);

    // Add remaining layers to the selection.
    for (var i = 1; i < layers.length; i++) {
        addLayerToSelectionById(layers[i]);
    }

    // Group the selected layers.
    executeAction(stringIDToTypeID("groupLayersEvent"),
                  new ActionDescriptor(), DialogModes.NO);

    // The new group becomes the active layer — rename it.
    doc.activeLayer.name = groupName;
}

// selectLayerById, addLayerToSelectionById, findTextLayerByDisplayName defined in psUtils.jsx.

// ─── UTILITY ──────────────────────────────────────────────────────────────────

// Finds the White Base_Cutline layer immediately below soLayer in the stack.
// Step 3 (white edge) always places it at soIndex + 1.
// Returns null if not found or if the next layer has a different name.
function findAdjacentCutline(doc, soLayer) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i] === soLayer) {
            var next = (i + 1 < doc.layers.length) ? doc.layers[i + 1] : null;
            if (next && next.name === CONFIG.whiteEdgeLayerName) {
                return next;
            }
            return null; // next layer exists but is not a WBC
        }
    }
    return null;
}
