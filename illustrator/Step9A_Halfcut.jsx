// Step9A_Halfcut.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Draws the half-cut line for every named GC/WC element (Phase 1 of Step 9) — the
// export-time CANONICAL pass. The half-cut itself is derived by the shared
// syncHalfcut() (aiUtils), which the earlier caption-touching steps (6 birth, 7B
// nest-import, 8b normalise) also call so the cut tracks the caption live; this
// pass guarantees every GC/WC element ends with a correct half-cut before export.
//
// The cut follows the real seam — the arc of the caption plate submerged in the art —
// so it is straight for a flat seat and curved for an arc/tilted seat (it is derived
// from geometry, never assumed flat). See aiUtils.syncHalfcut / plateSeamPath.
//
// Returns: { placed: N, flagged: M, flags: [{name, reason}, ...] }

function runHalfcut(doc) {

    if (CONFIG.dryRun) {
        log("[step9a] [DRY RUN] would draw half-cut lines for GC/WC elements.");
        return { placed: 0, flagged: 0, flags: [] };
    }

    var halfcutLayer = getOrCreateHalfcutLayer(doc);
    if (!halfcutLayer) {
        log("[step9a] ERROR | could not get or create halfcut layer.");
        return { placed: 0, flagged: 0, flags: [] };
    }

    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step9a] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { placed: 0, flagged: 0, flags: [] };
    }

    var items = _collectHalfcutItems(cutlinesLayer);
    log("[step9a] found " + items.length + " GC/WC/tab item(s) for half-cut.");

    var placed = 0, flags = [], i;

    for (i = 0; i < items.length; i++) {
        var entry = items[i];
        log("[step9a] processing | " + entry.name);
        var result = syncHalfcut(doc, entry.group, {});
        if (result.ok) {
            placed++;
            log("[step9a] placed | " + entry.name
                + (result.curved ? " (curved seam)" : " (straight)"));
        } else {
            flags.push({ name: entry.name, reason: result.reason });
            log("[step9a] FLAG | " + entry.name + " | " + result.reason);
        }
    }

    log("[step9a] done | placed=" + placed + " flagged=" + flags.length);
    return { placed: placed, flagged: flags.length, flags: flags };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Returns all top-level GroupItems in the Cutlines layer whose note identifies
// them as GC or WC (the elements that have a caption plate seam).
function _collectHalfcutItems(cutlinesLayer) {
    var out = [], i, item, note;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        item = cutlinesLayer.pageItems[i];
        if (item.parent !== cutlinesLayer) continue;
        if (item.typename !== "GroupItem") continue;
        note = parseNote(item.note);
        var isCapStyle = note && (note.styleCode === "GC" || note.styleCode === "WC");
        var isTab = note && note.styleCode === "ST" && findGroupMember(item, " plate") !== null;
        if (isCapStyle || isTab) {
            out.push({ name: item.name, group: item });
        }
    }
    return out;
}
