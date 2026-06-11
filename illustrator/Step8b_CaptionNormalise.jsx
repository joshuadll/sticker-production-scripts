// Step8b_CaptionNormalise.jsx — Phase function only.
// #included by AI_RefineCutlines.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Post-refinement pass (playbook §6): after the artist manually resizes elements to
// fit the artboard, this re-asserts caption spec. Two jobs per captioned group:
//   1. GC plate reset — resets each Gouache plate to its canonical absolute height
//      (0.5cm one-line / 0.8cm two-line) then re-Unites the cutline so the fused
//      contour follows the corrected caption. (WC spec is text-size (8pt), not plate
//      geometry, so its plate is left as-is.)
//   2. Caption re-anchor (GC + WC) — the printed caption is a decoupled PNG placed on
//      the Stickers layer by Step 7B, held at absolute spec size. Manual resizing
//      moves the art away from it; this re-centres the caption PNG on the (current)
//      plate region so it follows the art. The caption is NOT resized — only moved.
//
// Runs while the cutline = Unite(outline, plate) invariant still holds. Style + line
// count come from group.note ("styleCode|lines", stashed by Step 6
// _buildSeparableCutline). Missing note → skip + warn. ST/uncaptioned (no plate) skip.
//
// Returns: { normalized, skipped, anchored }

function runCaptionNormalise(doc) {

    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step8b] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { normalized: 0, skipped: 0 };
    }

    // Snapshot top-level GroupItems — re-Unite replaces a member mid-loop.
    var groups = [], i;
    for (i = 0; i < cutlinesLayer.groupItems.length; i++) {
        if (cutlinesLayer.groupItems[i].parent === cutlinesLayer) {
            groups.push(cutlinesLayer.groupItems[i]);
        }
    }

    // Stickers layer carries the decoupled caption PNGs (placed by Step 7B). Optional:
    // if the doc was opened without placed art, re-anchoring is skipped with a warning.
    var stickersLayer = CONFIG.stickersLayerName
        ? findLayer(doc, CONFIG.stickersLayerName) : null;
    if (CONFIG.stickersLayerName && !stickersLayer) {
        log("[step8b] WARN | Stickers layer not found (" + CONFIG.stickersLayerName
            + ") — caption PNGs will not be re-anchored.");
    }

    var normalized = 0, skipped = 0, anchored = 0;

    for (i = 0; i < groups.length; i++) {
        var group = groups[i];
        var note  = group.note;

        if (!note) {
            log("[step8b] SKIP | no caption metadata (note) | " + group.name);
            skipped++;
            continue;
        }

        var parts     = note.split("|");
        var styleCode = parts[0];
        var lines     = parseInt(parts[1], 10);
        if (isNaN(lines) || lines < 1) lines = 1;

        var plate = findGroupMember(group, " plate");
        if (!plate) {
            log("[step8b] SKIP | " + group.name + " — no caption plate (ST/uncaptioned).");
            skipped++;
            continue;
        }

        // ── GC only: reset the plate to its canonical spec height + re-Unite ──────
        // (WC spec is text-size, not plate geometry, so its plate is left as-is.)
        if (styleCode === "GC") {
            var outline = findGroupMember(group, " outline");
            if (!outline) {
                log("[step8b] SKIP plate reset | " + group.name + " — missing outline component.");
            } else {
                var heightCm = (lines >= 2) ? CONFIG.plateHeightTwoLineCm
                                            : CONFIG.plateHeightSingleLineCm;
                var heightPt = mmToPoints(heightCm * 10);
                if (CONFIG.dryRun) {
                    log("[step8b] [DRY RUN] would reset plate to " + heightCm + "cm + re-Unite | "
                        + group.name + " (lines=" + lines + ")");
                } else {
                    var newPlate = rebuildPlateToHeight(plate, heightPt);
                    reuniteCutline(group, outline, newPlate, CONFIG.cutlineStrokePt);
                    plate = newPlate;   // re-anchor below targets the spec-reset plate
                    log("[step8b] normalized | " + group.name
                        + " (GC, lines=" + lines + " -> " + heightCm + "cm plate)");
                    normalized++;
                }
            }
        }

        // ── GC + WC: re-anchor the decoupled caption PNG to the (current) plate ───
        // centre, so it follows the art after a manual resize. The caption is NOT
        // resized — it stays at absolute spec; only its position tracks the plate.
        if (stickersLayer) {
            if (CONFIG.dryRun) {
                log("[step8b] [DRY RUN] would re-anchor caption | " + group.name);
            } else if (_reanchorCaption(stickersLayer, group.name, plate)) {
                log("[step8b] caption re-anchored | " + group.name);
                anchored++;
            }
        }
    }

    log("[step8b] done | normalized=" + normalized + " anchored=" + anchored
        + " skipped=" + skipped);
    return { normalized: normalized, skipped: skipped, anchored: anchored };
}

// Re-positions the decoupled caption PNG ("{displayName} caption", placed on the
// Stickers layer by Step 7B) so its centre lands on the plate region's centre — the
// post-resize re-anchor. Does NOT resize the caption (it stays at absolute spec).
// Returns true if a matching caption item was found and moved.
function _reanchorCaption(stickersLayer, displayName, plate) {
    var want = displayName + " caption";
    var i, it;
    for (i = 0; i < stickersLayer.placedItems.length; i++) {
        it = stickersLayer.placedItems[i];
        if (it.name === want) {
            var pc = boundsCenter(plate.geometricBounds);
            it.translate(pc.x - (it.position[0] + it.width  / 2),
                         pc.y - (it.position[1] - it.height / 2));
            return true;
        }
    }
    return false;
}
