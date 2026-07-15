// StepQA_NestingQuality.jsx — Phase function only.
// #included by AI_LayoutQA.jsx. Requires: aiUtils.jsx, CONFIG in scope.
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
    // Per-phase wall timing (ms via Date) so a slow run on the artist's machine
    // reveals WHICH phase is the bottleneck. ($.hiresTimer is unreliable in
    // Illustrator — returns nonsense deltas — so we use Date diffs.) These [timing]
    // lines are advisory and stripped by the golden-diff harness.
    var _tCollect = 0, _tRaster = 0, _tDilate = 0, _tMask = 0, _tPockets = 0, _tOverlay = 0;
    var _t = _newPhaseTimer();

    var grid = [];
    var k;
    for (k = 0; k < totalCells; k++) grid.push(0);

    var allPaths     = _qa_collectPaths(cutlinesLayer);
    _tCollect = _t.lap();
    var i;

    for (i = 0; i < allPaths.length; i++) {
        _qa_rasterizePath(allPaths[i], grid, gridW, gridH, artLeft, artTop, PT);
        log("[stepQA] rasterized | " + allPaths[i].name);
    }
    _tRaster = _t.lap();

    // Total art footprint = occupied cells, counted from the occupancy grid itself
    // BEFORE dilation + margin-mask. Deliberately NOT sum(item.area): CompoundPathItem.area
    // returns NaN in Illustrator ExtendScript (a united art+plate cut is frequently compound,
    // and one NaN poisons the whole sum → "total area: NaN"). The grid is a union, so it is
    // also correct for holes and for any overlapping/duplicate sub-paths — no double-count.
    var occupiedCells = 0;
    for (i = 0; i < totalCells; i++) if (grid[i]) occupiedCells++;
    var totalAreaMm2 = occupiedCells * CONFIG.cellSizeMm * CONFIG.cellSizeMm;

    log("[stepQA] paths: " + allPaths.length
        + " | total area: " + _qa_fmt(totalAreaMm2) + " mm2");

    // ── 4. Gap dilation (expand occupied region by gapMm on all sides) ────────
    var gapCells = Math.ceil(CONFIG.gapMm / CONFIG.cellSizeMm);
    _qa_dilate(grid, gridW, gridH, gapCells);
    _tDilate = _t.lap();

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
    // Pass the area gate so only recoverable pockets retain their per-cell list
    // (the overlay only tiles those; sub-threshold pockets keep cells = null).
    _tMask = _t.lap();
    var pockets = _qa_findPockets(grid, gridW, gridH, CONFIG.cellSizeMm,
                                  CONFIG.pocketMinAreaMm2, sheetW, sheetH);
    _tPockets = _t.lap();

    var recoverableCells = 0;
    var p;
    for (p = 0; p < pockets.length; p++) {
        if (pockets[p].areaMm2 >= CONFIG.pocketMinAreaMm2) {
            recoverableCells += pockets[p].cellCount;
            log("[stepQA] pocket | " + pockets[p].label
                + " | area=" + _qa_fmt(pockets[p].areaMm2) + " mm2"
                + " | center=(" + _qa_fmt(pockets[p].centX) + "," + _qa_fmt(pockets[p].centY) + ")mm"
                + " | bbox=[" + pockets[p].minX + "," + pockets[p].minY
                + " " + (pockets[p].maxX - pockets[p].minX + 1)
                + "x" + (pockets[p].maxY - pockets[p].minY + 1) + "]mm");
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
        _qa_drawOverlay(doc, pockets, artLeft, artTop, PT, gridW);
    }
    _tOverlay = _t.lap();

    log("[timing] stepQA | setup+collect=" + _tCollect
        + " raster=" + _tRaster + " dilate=" + _tDilate
        + " marginMask=" + _tMask + " pockets=" + _tPockets
        + " overlay=" + _tOverlay + " (ms)");

    return {
        nqi:         nqi,
        pass:        pass,
        pockets:     pockets,
        utilization: utilization
    };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Returns a flat array of the one fused cut path per sticker in a layer, recursing
// through GroupItems of any depth.
//
// Cutlines arrive in two shapes and this must handle both:
//   • pipeline elements: a group [Display Name] bundling the FUSED cut (a member also
//     named [Display Name]) + hidden outline + hidden plate + a caption-text member
//     (often expanded into many letter paths) + a buffer halo, and — for stamps — a
//     "tab fill". Only the fused cut is the sticker footprint; the rest are geometric
//     subsets of it (outline/plate/text/tab) or a transient aid (buffer). Collecting
//     them all would ~3x the path count and rasterize dozens of caption letter paths —
//     slow, and pointless since occupancy is a union.
//   • artist deliverables: a loose PathItem, or a single closed path in an UNNAMED
//     wrapper GroupItem.
// Rule: inside a NAMED group, collect only the member whose name equals the group's own
// name (the fused cut), resolving through a wrapper group to its leaf path; skip the
// siblings. A group with no self-named member (unnamed wrapper / artist deliverable) is
// recursed wholesale so nothing is dropped.
function _qa_endsWith(n, suffix) {
    return !!(n && n.length >= suffix.length
              && n.substring(n.length - suffix.length) === suffix);
}

// True for a spacing-buffer halo (aiUtils.syncSpacingBuffer, "{element} buffer") — a
// transient drag-time aid offset OUTSIDE the real cut. Any type (it's a GroupItem cloned
// from a group cutline); skipping it here also skips its unnamed descendants.
function _qa_isSpacingBuffer(item) {
    return _qa_endsWith(item.name, " buffer");
}

// The fused cut member of a pipeline element group: the child whose name equals the
// group's own name. Returns null for an unnamed group (artist deliverable) so the caller
// recurses it wholesale. Empty group name is treated as unnamed (avoids ""==="" matching
// an unnamed child).
function _qa_selfNamedMember(group) {
    var nm = group.name;
    if (!nm) return null;
    var kids = group.pageItems, i, t;
    for (i = 0; i < kids.length; i++) {
        t = kids[i].typename;
        if (kids[i].name === nm
            && (t === "GroupItem" || t === "PathItem" || t === "CompoundPathItem")) {
            return kids[i];
        }
    }
    return null;
}

function _qa_collectPaths(container) {
    var result = [];
    var i, j, inner;

    // Sublayers FIRST. A Layer can nest child Layers, and `pageItems` does NOT
    // include their contents (only this level's loose items + groups). Cutlines
    // are routinely tucked into a sublayer (e.g. stamps in a "Layer 1" sublayer),
    // so skipping these silently drops whole stickers from the occupancy grid —
    // their footprint then reads as a free pocket. GroupItems have no `.layers`,
    // so this branch only fires for Layer containers.
    if (container.layers) {
        for (i = 0; i < container.layers.length; i++) {
            inner = _qa_collectPaths(container.layers[i]);
            for (j = 0; j < inner.length; j++) result.push(inner[j]);
        }
    }

    var items = container.pageItems;
    var t, fused;
    for (i = 0; i < items.length; i++) {
        // Spacing-buffer halos are offset OUTSIDE the real cut — counting them inflates
        // occupancy and erases real pockets. (Also non-self-named, but guard explicitly so
        // the artist-deliverable recurse branch below can't pick one up either.)
        if (_qa_isSpacingBuffer(items[i])) continue;
        t = items[i].typename;
        if (t === "PathItem" || t === "CompoundPathItem") {
            result.push(items[i]);
        } else if (t === "GroupItem") {
            fused = _qa_selfNamedMember(items[i]);
            if (fused) {
                // Pipeline element group: take only the fused cut (recurse if it's a
                // wrapper group), dropping outline/plate/caption-text/tab-fill siblings.
                if (fused.typename === "GroupItem") {
                    inner = _qa_collectPaths(fused);
                    for (j = 0; j < inner.length; j++) result.push(inner[j]);
                } else {
                    result.push(fused);
                }
            } else {
                // Unnamed wrapper / artist deliverable: recurse wholesale.
                inner = _qa_collectPaths(items[i]);
                for (j = 0; j < inner.length; j++) result.push(inner[j]);
            }
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

    // Snapshot DOM PathPoints once — see _sampleSubPath in aiUtils. Identical
    // samples, far fewer ExtendScript↔host bridge crossings.
    var A = [], L = [], R = [], k, pp;
    for (k = 0; k < n; k++) {
        pp = pts[k];
        A[k] = pp.anchor;
        L[k] = pp.leftDirection;
        R[k] = pp.rightDirection;
    }

    for (i = 0; i < limit; i++) {
        var next = (i + 1) % n;
        var p0   = A[i];
        var p1   = R[i];
        var p2   = L[next];
        var p3   = A[next];

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
//
// Interior-cell skip: a cell whose four orthogonal neighbours are ALL occupied
// contributes nothing new — its radius-r disk is fully covered by those neighbours'
// disks (provable: for any cell at integer offset (dx,dy) inside the disk other than
// the centre, max(|dx|,|dy|) >= 1, so its distance² to the nearest ortho neighbour is
// dx²+dy²+1-2max(|dx|,|dy|) <= r²-1 < r²). So we only need to stamp BOUNDARY cells.
// For solid stickers that drops the work from area to perimeter (~order-of-magnitude
// fewer stamps) while producing a byte-identical occupancy grid.
function _qa_dilate(grid, gridW, gridH, radiusCells) {
    if (radiusCells <= 0) return;
    var r2   = radiusCells * radiusCells;
    var orig = [];
    var k;
    for (k = 0; k < grid.length; k++) orig.push(grid[k]);

    var x, y, dx, dy, nx, ny, idx;
    for (y = 0; y < gridH; y++) {
        for (x = 0; x < gridW; x++) {
            idx = y * gridW + x;
            if (orig[idx] !== 1) continue;
            // Skip interior cells (all 4 ortho neighbours occupied). Edge-of-grid
            // cells are never interior, so they always stamp.
            if (x > 0 && x < gridW - 1 && y > 0 && y < gridH - 1
                && orig[idx - 1] === 1 && orig[idx + 1] === 1
                && orig[idx - gridW] === 1 && orig[idx + gridW] === 1) continue;
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
// Returns pocket array sorted descending by area. Each pocket carries its area,
// centroid, and bounding box. The per-cell list (used only by the overlay to
// tile the fill) is retained ONLY on recoverable pockets, area >= minAreaMm2;
// smaller pockets get cells = null, since the overlay never tiles them.
function _qa_findPockets(grid, gridW, gridH, cellMm, minAreaMm2, sheetWmm, sheetHmm) {
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
                sumX: 0, sumY: 0,
                cells: []      // every free cell index in this pocket (for exact overlay)
            };

            var stack = [idx];
            visited[idx] = 1;

            while (stack.length > 0) {
                var ci = stack.pop();
                var cx = ci % gridW;
                var cy = Math.floor(ci / gridW);

                comp.cellCount++;
                comp.cells[comp.cells.length] = ci;
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

            var areaMm2 = comp.cellCount * cellMm * cellMm;
            var centX   = (comp.sumX / comp.cellCount + 0.5) * cellMm;
            var centY   = (comp.sumY / comp.cellCount + 0.5) * cellMm;

            pockets.push({
                cellCount:  comp.cellCount,
                areaMm2:    areaMm2,
                minX:       comp.minX,
                maxX:       comp.maxX,
                minY:       comp.minY,
                maxY:       comp.maxY,
                centX:      centX,
                centY:      centY,
                // Only recoverable pockets are tiled by the overlay, so only they
                // need their cell list — drop it for the rest.
                cells:      (areaMm2 >= minAreaMm2) ? comp.cells : null,
                // Quadrant label is computed against the MEASURED artboard size
                // (sheetW/sheetH from doc.artboards[0]), not a CONFIG constant —
                // so the label is always correct regardless of artboard dims.
                label: _qa_quadrantLabel(centX, centY, sheetWmm, sheetHmm)
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

// Fills the EXACT free cells of every recoverable pocket (areaMm2 >= the limit)
// with semi-transparent red, via greedy maximal-rectangle tiling (see
// _qa_tilePocket) so the fill traces the real (often concave) empty region and
// never covers a sticker. Smaller pockets are not drawn.
//
// Appends to the SHARED QA overlay layer (CONFIG.qaLayerName) — the same layer
// Step 8c drew its spacing/margin flags on. reset=false: Step 8c runs first and
// owns the reset, so this only appends (removing the layer here would wipe the
// flag markers). The artist toggles this one layer to show/hide all QA.
function _qa_drawOverlay(doc, pockets, artLeft, artTop, PT, gridW) {
    var overlayLayer = getOrCreateQALayer(doc, CONFIG.qaLayerName, false);

    var red    = redRgb();
    var cellMm = CONFIG.cellSizeMm;
    var i, pocket;
    var rectCount = 0;

    for (i = 0; i < pockets.length; i++) {
        pocket = pockets[i];
        if (pocket.areaMm2 < CONFIG.pocketMinAreaMm2) continue;
        rectCount += _qa_tilePocket(pocket, overlayLayer, red, artLeft, artTop, PT, cellMm, gridW);
    }

    log("[stepQA] overlay drawn on \"" + CONFIG.qaLayerName + "\" layer | "
        + rectCount + " rect(s)");
}

// Covers one pocket's free cells with as FEW rectangles as possible (greedy
// maximal-rectangle tiling), instead of one thin strip per row. A solid blob
// collapses from ~N strips into a handful of boxes → far fewer path items, much
// faster to draw/render, and no strip seams. Returns the rect count drawn.
function _qa_tilePocket(pocket, layer, red, artLeft, artTop, PT, cellMm, gridW) {
    // Local boolean grid over the pocket's bounding box.
    var bx0 = pocket.minX, by0 = pocket.minY;
    var bw  = pocket.maxX - pocket.minX + 1;
    var bh  = pocket.maxY - pocket.minY + 1;

    var present = [];   // cell belongs to this pocket
    var used    = [];   // cell already covered by an emitted rectangle
    var k, n = bw * bh;
    for (k = 0; k < n; k++) { present.push(false); used.push(false); }

    var cells = pocket.cells, c, ci, col, row;
    for (c = 0; c < cells.length; c++) {
        ci  = cells[c];
        col = ci % gridW;
        row = (ci - col) / gridW;
        present[(row - by0) * bw + (col - bx0)] = true;
    }

    var count = 0;
    var lx, ly, x1, y1, xx, canDown, ny;
    for (ly = 0; ly < bh; ly++) {
        for (lx = 0; lx < bw; lx++) {
            if (!present[ly * bw + lx] || used[ly * bw + lx]) continue;

            // Grow right along this row.
            x1 = lx;
            while (x1 + 1 < bw && present[ly * bw + (x1 + 1)] && !used[ly * bw + (x1 + 1)]) x1++;

            // Grow down while every column lx..x1 is present and free.
            y1 = ly;
            canDown = true;
            while (canDown && y1 + 1 < bh) {
                ny = y1 + 1;
                for (xx = lx; xx <= x1; xx++) {
                    if (!present[ny * bw + xx] || used[ny * bw + xx]) { canDown = false; break; }
                }
                if (canDown) y1++;
            }

            // Mark covered + emit one rectangle for the block.
            var yy;
            for (yy = ly; yy <= y1; yy++) for (xx = lx; xx <= x1; xx++) used[yy * bw + xx] = true;

            var gc0 = bx0 + lx, gr0 = by0 + ly;
            var rLeft   = artLeft + gc0 * cellMm * PT;
            var rTop    = artTop  - gr0 * cellMm * PT;
            var rWidth  = (x1 - lx + 1) * cellMm * PT;
            var rHeight = (y1 - ly + 1) * cellMm * PT;
            var rect = layer.pathItems.rectangle(rTop, rLeft, rWidth, rHeight);
            rect.stroked   = false;
            rect.filled    = true;
            rect.fillColor = red;
            rect.opacity   = 45;
            count++;
        }
    }
    return count;
}

// Formats a number to one decimal place (ES3-safe).
function _qa_fmt(n) {
    return Math.round(n * 10) / 10;
}
