// Step9A_Halfcut.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// VERIFIES the half-cut line for every named GC/WC/tab element (Phase 1 of Step 9) —
// the export-time CANONICAL gate. The half-cut itself is a LIVE, derived feature
// maintained by the shared syncHalfcut() (aiUtils) at every caption-touching step
// (6 birth, 7B nest-import, 8b normalise); this pass does NOT re-derive it — it only
// checks (via validateHalfcut) that a half-cut exists and both ends reach the cut
// line, so a manually-drawn or hand-fixed half-cut is never clobbered at export.
//
// Returns: { checked: N, flagged: M, flags: [{name, reason}, ...] }

function runHalfcut(doc) {
    if (CONFIG.dryRun) {
        log("[step9a] [DRY RUN] would verify half-cut lines for GC/WC/tab elements.");
        return { checked: 0, flagged: 0, flags: [] };
    }
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step9a] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { checked: 0, flagged: 0, flags: [] };
    }
    var items = _collectHalfcutItems(cutlinesLayer);
    log("[step9a] verifying " + items.length + " GC/WC/tab half-cut(s) — no re-derive.");

    var flags = [], i;
    for (i = 0; i < items.length; i++) {
        var res = validateHalfcut(doc, items[i].group);
        if (res.ok) {
            log("[step9a] ok | " + items[i].name);
        } else {
            flags.push({ name: items[i].name, reason: res.reason });
            log("[step9a] FLAG | " + items[i].name + " | " + res.reason);
        }
    }
    log("[step9a] done | checked=" + items.length + " flagged=" + flags.length);
    return { checked: items.length, flagged: flags.length, flags: flags };
}
