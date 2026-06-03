// Step8b_CaptionNormalise.jsx — Phase function only.
// #included by AI_RefineCutlines.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Caption check (playbook §6): after nesting resized the stickers, the caption
// plate drifted off spec. Resets each Gouache plate to its canonical absolute
// height (0.5cm one-line / 0.8cm two-line) then re-Unites the cutline so the
// fused contour follows the corrected caption. Runs before the manual pencil pass
// while the cutline = Unite(outline, plate) invariant still holds.
//
// Scope: GC caption groups only. Watercolor spec is text-size (8pt), not plate
// geometry, and its caption barely moves the cutline — WC/ST/uncaptioned groups
// are skipped. Style + line count come from group.note ("styleCode|lines",
// stashed by Step 6 _buildSeparableCutline). Missing note → skip + warn.
//
// Returns: { normalized, skipped }

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

    var normalized = 0, skipped = 0;

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

        if (styleCode !== "GC") {
            log("[step8b] SKIP | " + styleCode + " (plate normalisation is GC-only) | " + group.name);
            skipped++;
            continue;
        }

        var outline = findGroupMember(group, " outline");
        var plate   = findGroupMember(group, " plate");
        if (!outline || !plate) {
            log("[step8b] SKIP | missing outline/plate component | " + group.name);
            skipped++;
            continue;
        }

        var heightCm = (lines >= 2) ? CONFIG.plateHeightTwoLineCm
                                    : CONFIG.plateHeightSingleLineCm;
        var heightPt = mmToPoints(heightCm * 10);

        if (CONFIG.dryRun) {
            log("[step8b] [DRY RUN] would reset plate to " + heightCm + "cm + re-Unite | "
                + group.name + " (lines=" + lines + ")");
            continue;
        }

        var newPlate = rebuildPlateToHeight(plate, heightPt);
        reuniteCutline(group, outline, newPlate, CONFIG.cutlineStrokePt);
        log("[step8b] normalized | " + group.name
            + " (GC, lines=" + lines + " -> " + heightCm + "cm plate)");
        normalized++;
    }

    log("[step8b] done | normalized=" + normalized + " skipped=" + skipped);
    return { normalized: normalized, skipped: skipped };
}
