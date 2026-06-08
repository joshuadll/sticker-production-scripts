// StepQA_NestingQuality.jsx — Phase function only.
// #included by AI_NestingQA.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Builds a 1-mm-resolution occupancy grid from the exact path outlines in the
// Cutlines layer (via de Casteljau bezier sampling + scanline fill), detects
// free pockets large enough to grow a sticker into, and returns a 0-100 NQI.
//
// High NQI = tight nesting, no rework needed.
// Low NQI  = a real pocket exists; artist should re-nest.
//
// Returns: { nqi, pass, pockets[], utilization }

function runNestingQA(doc) {

    // ── 1. Locate Cutlines layer ───────────────────────────────────────────────
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[stepQA] ERROR | layer not found: " + CONFIG.cutlinesLayerName);
        return null;
    }

    // ── 2. Artboard coordinate origin ─────────────────────────────────────────
    // artboardRect = [left, top, right, bottom] in document points.
    // Illustrator y-axis points upward, so artboardRect[1] > artboardRect[3].
    var aRect   = doc.artboards[0].artboardRect;
    var artLeft = aRect[0];
    var artTop  = aRect[1]; // highest y — top edge of artboard
    var PT      = 2.834645; // points per mm

    var sheetW = (aRect[2] - aRect[0]) / PT; // mm
    var sheetH = (aRect[1] - aRect[3]) / PT; // mm

    var gridW      = Math.ceil(sheetW / CONFIG.cellSizeMm);
    var gridH      = Math.ceil(sheetH / CONFIG.cellSizeMm);
    var totalCells = gridW * gridH;

    log("[stepQA] sheet: " + _qa_fmt(sheetW) + " x " + _qa_fmt(sheetH) + " mm"
        + " | grid: " + gridW + " x " + gridH + " cells");

    // ── 3. Build occupancy grid via scanline fill ──────────────────────────────
    var grid = [];
    var k;
    for (k = 0; k < totalCells; k++) grid.push(0);

    var allPaths     = _qa_collectPaths(cutlinesLayer);
    var totalAreaMm2 = 0;
    var i;

    for (i = 0; i < allPaths.length; i++) {
        _qa_rasterizePath(allPaths[i], grid, gridW, gridH, artLeft, artTop, PT);
        totalAreaMm2 += Math.abs(allPaths[i].area) / (PT * PT);
        log("[stepQA] rasterized | " + allPaths[i].name);
    }

    log("[stepQA] paths: " + allPaths.length
        + " | total area: " + _qa_fmt(totalAreaMm2) + " mm2");

    // ── 4. Gap dilation (expand occupied region by gapMm on all sides) ────────
    var gapCells = Math.ceil(CONFIG.gapMm / CONFIG.cellSizeMm);
    _qa_dilate(grid, gridW, gridH, gapCells);

    // ── 4b. Margin mask — score only the printable safe area ──────────────────
    // Cells outside the margin are marked occupied so the gutter never counts as a
    // free pocket, and the NQI denominator is the in-margin cell count. Keeps the
    // score about packing efficiency inside the printable region, not sheet bleed.
    var mR        = marginRect(doc); // [l, t, r, b] points (AI y-up)
    var mLeftMm   = (mR[0] - artLeft) / PT;
    var mRightMm  = (mR[2] - artLeft) / PT;
    var mTopMm    = (artTop - mR[1]) / PT;
    var mBottomMm = (artTop - mR[3]) / PT;

    // Denominators default to the whole sheet; the margin mask narrows them to the
    // printable area only when the margin rect is sane. A degenerate margin (zero/
    // inverted working area, or one that lands entirely off the grid) would make the
    // in-margin count 0 → NQI/utilization NaN, so fall back to full-sheet scoring.
    var denomCells   = totalCells;
    var denomAreaMm2 = sheetW * sheetH;

    var marginValid = (mRightMm > mLeftMm) && (mBottomMm > mTopMm)
        && (mRightMm > 0) && (mLeftMm < sheetW)
        && (mBottomMm > 0) && (mTopMm < sheetH);

    if (marginValid) {
        var inMarginCells = 0;
        var mr_row, mr_col, mr_cx, mr_cy, mr_idx;
        for (mr_row = 0; mr_row < gridH; mr_row++) {
            mr_cy = (mr_row + 0.5) * CONFIG.cellSizeMm;
            for (mr_col = 0; mr_col < gridW; mr_col++) {
                mr_cx  = (mr_col + 0.5) * CONFIG.cellSizeMm;
                mr_idx = mr_row * gridW + mr_col;
                if (mr_cx < mLeftMm || mr_cx > mRightMm
                    || mr_cy < mTopMm || mr_cy > mBottomMm) {
                    grid[mr_idx] = 1; // outside margin → never a pocket
                } else {
                    inMarginCells++;
                }
            }
        }
        if (inMarginCells > 0) {
            denomCells   = inMarginCells;
            denomAreaMm2 = (mRightMm - mLeftMm) * (mBottomMm - mTopMm);
        }
        log("[stepQA] margin: " + _qa_fmt(mRightMm - mLeftMm) + " x "
            + _qa_fmt(mBottomMm - mTopMm) + " mm | inMarginCells=" + inMarginCells);
    } else {
        log("[stepQA] WARN | degenerate margin rect — scoring against full sheet.");
    }

    // ── 5. Connected-component pocket detection ────────────────────────────────
    var pockets = _qa_findPockets(grid, gridW, gridH, CONFIG.cellSizeMm);

    var recoverableCells = 0;
    var p;
    for (p = 0; p < pockets.length; p++) {
        if (pockets[p].inscribedR >= CONFIG.pocketThresholdMm) {
            recoverableCells += pockets[p].cellCount;
            log("[stepQA] pocket | " + pockets[p].label
                + " | area=" + _qa_fmt(pockets[p].areaMm2) + " mm2"
                + " | r=" + _qa_fmt(pockets[p].inscribedR) + " mm");
        }
    }

    // ── 6. NQI ─────────────────────────────────────────────────────────────────
    // Denominator is the printable safe area (or the full sheet if the margin was
    // degenerate): NQI and utilization both measure packing within that region.
    var nqi          = Math.round(100 * (1 - recoverableCells / denomCells));
    var pass         = nqi >= CONFIG.passingNqi;
    var utilization  = Math.round(1000 * totalAreaMm2 / denomAreaMm2) / 10;

    log("[stepQA] NQI=" + nqi + " | pass=" + pass
        + " | utilization=" + utilization + "%"
        + " | recoverableCells=" + recoverableCells + "/" + denomCells);

    // ── 7. Visual overlay ─────────────────────────────────────────────────────
    if (CONFIG.showOverlay && !CONFIG.dryRun) {
        _qa_drawOverlay(doc, pockets, artLeft, artTop, PT);
    }

    return {
        nqi:         nqi,
        pass:        pass,
        pockets:     pockets,
        utilization: utilization
    };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Returns flat array of all PathItems and CompoundPathItems in a layer,
// recursing through GroupItems of any depth.
//
// Cutlines arrive in two shapes and this must handle both:
//   • loose PathItems (stamps), and pipeline triads grouped as
//     [Display Name] fused + outline (hidden) + plate (hidden) — Step 6 output;
//   • single closed paths wrapped in unnamed GroupItems — real artist deliverables.
// Walking pageItems recursively collects the leaf paths by TYPE, so grouping,
// naming, and the hidden outline/plate sub-paths are all irrelevant: occupancy
// is a union, and hidden components are geometric subsets of the fused contour.
function _qa_collectPaths(container) {
    var result = [];
    var items  = container.pageItems;
    var i, t;
    for (i = 0; i < items.length; i++) {
        t = items[i].typename;
        if (t === "PathItem" || t === "CompoundPathItem") {
            result.push(items[i]);
        } else if (t === "GroupItem") {
            var inner = _qa_collectPaths(items[i]);
            var j;
            for (j = 0; j < inner.length; j++) result.push(inner[j]);
        }
    }
    return result;
}

// Evaluates a cubic bezier at parameter t.
// p0..p3 are Illustrator anchor/handle arrays [x, y].
function _qa_bezier(p0, p1, p2, p3, t) {
    var mt  = 1 - t;
    var q0x = mt * p0[0] + t * p1[0], q0y = mt * p0[1] + t * p1[1];
    var q1x = mt * p1[0] + t * p2[0], q1y = mt * p1[1] + t * p2[1];
    var q2x = mt * p2[0] + t * p3[0], q2y = mt * p2[1] + t * p3[1];
    var r0x = mt * q0x   + t * q1x,   r0y = mt * q0y   + t * q1y;
    var r1x = mt * q1x   + t * q2x,   r1y = mt * q1y   + t * q2y;
    return [mt * r0x + t * r1x, mt * r0y + t * r1y];
}

// Samples one PathItem's bezier curves into a closed polyline.
// Returns array of { xMm, yMm } in sheet-relative mm (y=0 at top of artboard).
function _qa_sampleSubPath(subPath, artLeft, artTop, PT) {
    var pts = subPath.pathPoints;
    if (!pts || pts.length < 2) return [];

    var STEPS   = 20; // samples per bezier segment — ~1 sample per mm of arc
    var samples = [];
    var n       = pts.length;
    var limit   = subPath.closed ? n : n - 1;
    var i, j, t, pt;

    for (i = 0; i < limit; i++) {
        var next = (i + 1) % n;
        var p0   = pts[i].anchor;
        var p1   = pts[i].rightDirection;
        var p2   = pts[next].leftDirection;
        var p3   = pts[next].anchor;

        for (j = 0; j < STEPS; j++) {
            t  = j / STEPS;
            pt = _qa_bezier(p0, p1, p2, p3, t);
            samples.push({
                xMm: (pt[0] - artLeft) / PT,
                yMm: (artTop - pt[1]) / PT  // flip y: row 0 = top of artboard
            });
        }
    }

    // Close the polyline for scanline fill.
    if (samples.length > 0) {
        samples.push({ xMm: samples[0].xMm, yMm: samples[0].yMm });
    }

    return samples;
}

// Returns x-mm values where polyline crosses the horizontal line at yMm.
function _qa_xCrossings(poly, yMm) {
    var result = [];
    var i, y0, y1, t;
    for (i = 0; i < poly.length - 1; i++) {
        y0 = poly[i].yMm;
        y1 = poly[i + 1].yMm;
        if ((y0 <= yMm && y1 > yMm) || (y1 <= yMm && y0 > yMm)) {
            t = (yMm - y0) / (y1 - y0);
            result.push(poly[i].xMm + t * (poly[i + 1].xMm - poly[i].xMm));
        }
    }
    return result;
}

// Marks grid cells as occupied for one PathItem or CompoundPathItem.
// Uses scanline fill with even-odd rule — correctly handles compound paths
// with holes (inner sub-paths are treated as transparent).
function _qa_rasterizePath(pathItem, grid, gridW, gridH, artLeft, artTop, PT) {
    var polys = [];
    var i, subPoly;

    if (pathItem.typename === "CompoundPathItem") {
        for (i = 0; i < pathItem.pathItems.length; i++) {
            subPoly = _qa_sampleSubPath(pathItem.pathItems[i], artLeft, artTop, PT);
            if (subPoly.length >= 3) polys.push(subPoly);
        }
    } else {
        subPoly = _qa_sampleSubPath(pathItem, artLeft, artTop, PT);
        if (subPoly.length >= 3) polys.push(subPoly);
    }

    if (polys.length === 0) return;

    // Determine row range across all sub-path polylines.
    var cellMm = CONFIG.cellSizeMm;
    var minRow = gridH, maxRow = 0, cy;

    for (i = 0; i < polys.length; i++) {
        var j;
        for (j = 0; j < polys[i].length; j++) {
            cy = Math.floor(polys[i][j].yMm / cellMm);
            if (cy < minRow) minRow = cy;
            if (cy > maxRow) maxRow = cy;
        }
    }
    minRow = Math.max(0, minRow);
    maxRow = Math.min(gridH - 1, maxRow);

    // Scanline fill — gather crossings from all sub-paths, sort, fill pairs.
    var row, yMm, xCross, ci, x0, x1, cx, sub;
    for (row = minRow; row <= maxRow; row++) {
        yMm    = (row + 0.5) * cellMm;
        xCross = [];

        for (i = 0; i < polys.length; i++) {
            sub = _qa_xCrossings(polys[i], yMm);
            for (ci = 0; ci < sub.length; ci++) xCross.push(sub[ci]);
        }

        xCross.sort(function(a, b) { return a - b; });

        // Fill between pairs (even-odd: 1st→2nd=in, 2nd→3rd=out, …).
        for (ci = 0; ci + 1 < xCross.length; ci += 2) {
            x0 = Math.max(0,          Math.floor(xCross[ci]     / cellMm));
            x1 = Math.min(gridW - 1,  Math.floor(xCross[ci + 1] / cellMm));
            for (cx = x0; cx <= x1; cx++) {
                grid[row * gridW + cx] = 1;
            }
        }
    }
}

// Morphological dilation — expands every occupied cell outward by radiusCells.
// Reads from a snapshot so dilation does not cascade.
function _qa_dilate(grid, gridW, gridH, radiusCells) {
    if (radiusCells <= 0) return;
    var r2   = radiusCells * radiusCells;
    var orig = [];
    var k;
    for (k = 0; k < grid.length; k++) orig.push(grid[k]);

    var x, y, dx, dy, nx, ny;
    for (y = 0; y < gridH; y++) {
        for (x = 0; x < gridW; x++) {
            if (orig[y * gridW + x] !== 1) continue;
            for (dy = -radiusCells; dy <= radiusCells; dy++) {
                for (dx = -radiusCells; dx <= radiusCells; dx++) {
                    if (dx * dx + dy * dy > r2) continue;
                    nx = x + dx; ny = y + dy;
                    if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                        grid[ny * gridW + nx] = 1;
                    }
                }
            }
        }
    }
}

// DFS connected-component labelling of free cells.
// Returns pocket array sorted descending by area.
function _qa_findPockets(grid, gridW, gridH, cellMm) {
    var visited = [];
    var k;
    for (k = 0; k < grid.length; k++) visited.push(0);

    var pockets = [];
    var x, y, idx;

    for (y = 0; y < gridH; y++) {
        for (x = 0; x < gridW; x++) {
            idx = y * gridW + x;
            if (grid[idx] !== 0 || visited[idx]) continue;

            var comp = {
                cellCount: 0,
                minX: x, maxX: x,
                minY: y, maxY: y,
                sumX: 0, sumY: 0
            };

            var stack = [idx];
            visited[idx] = 1;

            while (stack.length > 0) {
                var ci = stack.pop();
                var cx = ci % gridW;
                var cy = Math.floor(ci / gridW);

                comp.cellCount++;
                comp.sumX += cx;
                comp.sumY += cy;
                if (cx < comp.minX) comp.minX = cx;
                if (cx > comp.maxX) comp.maxX = cx;
                if (cy < comp.minY) comp.minY = cy;
                if (cy > comp.maxY) comp.maxY = cy;

                // 4-connected neighbours — guard against row wrapping.
                var ni;
                if (cx > 0) {
                    ni = ci - 1;
                    if (!visited[ni] && grid[ni] === 0) { visited[ni] = 1; stack.push(ni); }
                }
                if (cx < gridW - 1) {
                    ni = ci + 1;
                    if (!visited[ni] && grid[ni] === 0) { visited[ni] = 1; stack.push(ni); }
                }
                if (cy > 0) {
                    ni = ci - gridW;
                    if (!visited[ni] && grid[ni] === 0) { visited[ni] = 1; stack.push(ni); }
                }
                if (cy < gridH - 1) {
                    ni = ci + gridW;
                    if (!visited[ni] && grid[ni] === 0) { visited[ni] = 1; stack.push(ni); }
                }
            }

            var bbW      = (comp.maxX - comp.minX + 1) * cellMm;
            var bbH      = (comp.maxY - comp.minY + 1) * cellMm;
            var inscribedR = Math.min(bbW, bbH) / 2;
            var centX    = (comp.sumX / comp.cellCount + 0.5) * cellMm;
            var centY    = (comp.sumY / comp.cellCount + 0.5) * cellMm;

            pockets.push({
                cellCount:  comp.cellCount,
                areaMm2:    comp.cellCount * cellMm * cellMm,
                inscribedR: inscribedR,
                minX:       comp.minX,
                maxX:       comp.maxX,
                minY:       comp.minY,
                maxY:       comp.maxY,
                centX:      centX,
                centY:      centY,
                label: _qa_quadrantLabel(centX, centY,
                            CONFIG.sheetWidthMm, CONFIG.sheetHeightMm)
            });
        }
    }

    pockets.sort(function(a, b) { return b.areaMm2 - a.areaMm2; });
    return pockets;
}

// Returns a human-readable location label for a point in mm within the sheet.
function _qa_quadrantLabel(xMm, yMm, sheetW, sheetH) {
    var edgeFrac = 0.15;
    if (xMm < sheetW * edgeFrac)           return "Left edge";
    if (xMm > sheetW * (1 - edgeFrac))     return "Right edge";
    if (yMm < sheetH * edgeFrac)           return "Top edge";
    if (yMm > sheetH * (1 - edgeFrac))     return "Bottom edge";
    var h = xMm < sheetW / 2 ? "left" : "right";
    var v = yMm < sheetH / 2 ? "Upper-" : "Lower-";
    return v + h;
}

// Draws red rectangles over all recoverable pockets on a temporary layer.
function _qa_drawOverlay(doc, pockets, artLeft, artTop, PT) {
    var LAYER_NAME = "NQI Pockets";

    var existing = findLayer(doc, LAYER_NAME);
    if (existing) existing.remove();

    var overlayLayer = doc.layers.add();
    overlayLayer.name = LAYER_NAME;
    overlayLayer.zOrder(ZOrderMethod.BRINGTOFRONT);

    var red    = redCmyk();
    var cellMm = CONFIG.cellSizeMm;
    var i, pocket, rTop, rLeft, rWidth, rHeight, rect;

    for (i = 0; i < pockets.length; i++) {
        pocket = pockets[i];
        if (pocket.inscribedR < CONFIG.pocketThresholdMm) continue;

        rLeft   = artLeft + pocket.minX * cellMm * PT;
        rTop    = artTop  - pocket.minY * cellMm * PT;
        rWidth  = (pocket.maxX - pocket.minX + 1) * cellMm * PT;
        rHeight = (pocket.maxY - pocket.minY + 1) * cellMm * PT;

        rect = overlayLayer.pathItems.rectangle(rTop, rLeft, rWidth, rHeight);
        setStrokeStyle(rect, 0.5, red);
    }

    log("[stepQA] overlay drawn on \"" + LAYER_NAME + "\" layer");
}

// Formats a number to one decimal place (ES3-safe).
function _qa_fmt(n) {
    return Math.round(n * 10) / 10;
}
