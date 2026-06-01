// Step8a_SimplifyCutlines.jsx — Phase function only.
// #included by AI_AfterDeepnest.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Reduces the jagged anchor count of Image-Trace cutlines (playbook §6 "Simplify"),
// run before the manual pencil pass. Native RDP + Catmull-Rom refit with corner
// preservation (Illustrator's Object>Path>Simplify is not scriptable without a
// dialog). See simplifyPathItem() in aiUtils.jsx.
//
// Per top-level item in the Cutlines layer:
//   GroupItem (separable bundle) → simplify the hidden `{name} outline`, then
//     re-Unite cutline = Unite(simplified outline, plate). The parametric plate
//     stays mathematically exact; only the traced art is simplified.
//   bare PathItem/CompoundPathItem → simplify in place.
//   PlacedItem (stamp) / other → skip.
//
// Returns: { simplified, skipped }

function runSimplify(doc) {

    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step8a] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { simplified: 0, skipped: 0 };
    }

    var tolPt     = mmToPoints(CONFIG.simplifyToleranceMm);
    var cornerDeg = CONFIG.simplifyCornerAngleDeg;

    // Snapshot the layer's direct children — we replace cutline members mid-loop,
    // which would invalidate live-collection indices.
    var items = [], i;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        if (cutlinesLayer.pageItems[i].parent === cutlinesLayer) {
            items.push(cutlinesLayer.pageItems[i]);
        }
    }

    var simplified = 0, skipped = 0;

    for (i = 0; i < items.length; i++) {
        var item = items[i];
        var tn   = item.typename;

        if (tn === "GroupItem") {
            var outline = findGroupMember(item, " outline");
            var plate   = findGroupMember(item, " plate");

            if (outline && plate) {
                if (CONFIG.dryRun) {
                    log("[step8a] [DRY RUN] would simplify outline + re-Unite | " + item.name);
                    continue;
                }
                var reduced = simplifyPathItem(outline, tolPt, cornerDeg);
                reuniteCutline(item, outline, plate, CONFIG.cutlineStrokePt);
                log("[step8a] simplified | " + item.name
                    + " (outline sub-paths reduced: " + reduced + ")");
                simplified++;

            } else {
                // Bundle without separable components — simplify the visible cutline.
                var cut = findGroupMember(item, "");
                if (cut && (cut.typename === "PathItem" || cut.typename === "CompoundPathItem")) {
                    if (CONFIG.dryRun) {
                        log("[step8a] [DRY RUN] would simplify cutline | " + item.name);
                        continue;
                    }
                    var r2 = simplifyPathItem(cut, tolPt, cornerDeg);
                    log("[step8a] simplified (no components) | " + item.name
                        + " (reduced: " + r2 + ")");
                    simplified++;
                } else {
                    log("[step8a] SKIP | group has no simplifiable cutline | " + item.name);
                    skipped++;
                }
            }

        } else if (tn === "PathItem" || tn === "CompoundPathItem") {
            if (CONFIG.dryRun) {
                log("[step8a] [DRY RUN] would simplify | " + item.name);
                continue;
            }
            var r3 = simplifyPathItem(item, tolPt, cornerDeg);
            if (r3 > 0) {
                log("[step8a] simplified | " + item.name + " (reduced: " + r3 + ")");
                simplified++;
            } else {
                log("[step8a] SKIP | already minimal | " + item.name);
                skipped++;
            }

        } else {
            // PlacedItem (stamp template), TextFrame, etc.
            log("[step8a] SKIP | " + tn + " | " + (item.name || "(unnamed)"));
            skipped++;
        }
    }

    log("[step8a] done | simplified=" + simplified + " skipped=" + skipped);
    return { simplified: simplified, skipped: skipped };
}
