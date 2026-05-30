// Step3B_CaptionWhite.jsx — Phase function only.
// #included by PS_AfterCaption.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Runs after the artist's manual caption review pass (Step 3A → artist adjusts →
// Step 3B). Finds each SO + T layer pair, creates a White pill base that follows
// the T layer's shape (handles straight and curved text), adds a Caption plate for
// GC-LM elements, then groups everything under the original element name.
//
// Expects at top level: SO layers (NAME_REGEX), T layers (display name, LayerKind.TEXT),
// and optionally a "Caption plate" group for GC-LM SKUs.
//
// Returns: { grouped, skipped[] }

function runCaptionWhite(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var grouped  = 0;
    var skipped  = [];
    var gcLmCount = 0;  // track how many GC-LM elements used the caption plate

    try {
        // First pass: collect SO layer names.
        var layerNames = [];
        for (var i = 0; i < doc.layers.length; i++) {
            layerNames.push(doc.layers[i].name);
        }

        for (var i = 0; i < layerNames.length; i++) {
            var name = layerNames[i];

            if (name === CONFIG.skipLayerName) continue;
            if (name === "Caption plate")      continue; // handled separately

            var parsed = parseLayerName(name);
            if (!parsed) continue;
            if (!needsCaption(parsed)) continue; // ST skipped

            var soLayer = findLayerByName(doc, name);
            if (!soLayer) {
                log("[step3B] SKIP | \"" + name + "\" — SO not found.");
                skipped.push(name + " (SO not found)");
                continue;
            }

            // Find matching T layer: a TEXT layer whose name equals the display name.
            var textLayer = findTextLayerByName(doc, parsed.displayName);
            if (!textLayer) {
                log("[step3B] SKIP | \"" + name + "\" — no T layer named \""
                    + parsed.displayName + "\" found. Run Step 3A first.");
                skipped.push(name + " (no T layer)");
                continue;
            }

            if (CONFIG.dryRun) {
                var treatment = isCaptionPlate(parsed) ? "plate" : "standard";
                log("[step3B] [DRY RUN] would group | " + name
                    + " (" + treatment + ") — T layer: \"" + textLayer.name + "\"");
                grouped++;
                continue;
            }

            try {
                if (isCaptionPlate(parsed)) {
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

// ─── STANDARD PATH ────────────────────────────────────────────────────────────
// WC elements and GC non-LM: SO + T + White pill.

function groupStandard(doc, soLayer, textLayer, groupName) {
    var whiteLayer = createWhiteFromText(doc, textLayer);
    selectAndGroup(doc, [soLayer, textLayer, whiteLayer], groupName);
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

    var layers = plateLayer
        ? [soLayer, textLayer, plateLayer, whiteLayer]
        : [soLayer, textLayer, whiteLayer];

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
    doc.activeLayer = textLayer;
    var whiteLayer  = doc.artLayers.add();
    whiteLayer.name = "White";

    var white = new SolidColor();
    white.rgb.red   = 255;
    white.rgb.green = 255;
    white.rgb.blue  = 255;
    doc.selection.fill(white);
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

    doc.activeLayer = doc.layers[0]; // add new layer at top of stack
    var layer       = doc.artLayers.add();
    layer.name      = "White";

    var white = new SolidColor();
    white.rgb.red   = 255;
    white.rgb.green = 255;
    white.rgb.blue  = 255;

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

// Loads a layer's transparency channel as the active selection (non-destructive;
// does not rasterise the layer). Equivalent to Ctrl+clicking the layer thumbnail.
function loadLayerTransparency(layer) {
    app.activeDocument.activeLayer = layer;
    var desc    = new ActionDescriptor();
    var selRef  = new ActionReference();
    selRef.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
    desc.putReference(charIDToTypeID("null"), selRef);
    var lyrRef  = new ActionReference();
    lyrRef.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("Trsp"));
    lyrRef.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    desc.putReference(charIDToTypeID("T   "), lyrRef);
    desc.putBoolean(charIDToTypeID("Invr"), false);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
}

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

function selectLayerById(layer) {
    var desc = new ActionDescriptor();
    var ref  = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(stringIDToTypeID("makeVisible"), false);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
}

function addLayerToSelectionById(layer) {
    var desc = new ActionDescriptor();
    var ref  = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(stringIDToTypeID("makeVisible"), false);
    desc.putEnumerated(
        stringIDToTypeID("selectionModifier"),
        stringIDToTypeID("selectionModifierType"),
        stringIDToTypeID("addToSelection")
    );
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────

// Finds the first top-level TEXT layer whose name matches displayName.
// Returns null if not found.
function findTextLayerByName(doc, displayName) {
    for (var i = 0; i < doc.layers.length; i++) {
        var layer = doc.layers[i];
        if (layer.kind === LayerKind.TEXT && layer.name === displayName) {
            return layer;
        }
    }
    return null;
}
