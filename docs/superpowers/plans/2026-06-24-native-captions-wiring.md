# Native-Caption Pipeline Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-built `buildCaption(...)` into the live two-pipeline workflow so all captions (WC + GC-LM) are authored natively in Illustrator, delete the PS caption-reproduction code, and slim the handoff — preserving the artist's "Build Elements → Build and Export Cutlines" two-button flow.

**Architecture:** Pipeline 1 ("Build Elements", run from Photoshop) does the PS work, then BridgeTalks into Illustrator to trace the cut and place native caption text, leaving the artist in Illustrator to review. Pipeline 2 ("Build and Export Cutlines", run from Illustrator) builds each caption (pill → seat → unite → half-cut; GC also places a scaled plate raster), then exports for Deepnest. The caption is a rigid member of its cutline group (visible white pill + black text [+ GC plate]) that rides nesting and is gathered into the per-element export by Step 10.

**Tech Stack:** Adobe Illustrator 2026 + Photoshop 2026 ExtendScript (ES3); existing `utils/aiUtils.jsx` / `utils/psUtils.jsx` / `utils/json2.jsx`; BridgeTalk PS→AI handoff; node for unit-testing pure string/geometry helpers; osascript `do javascript file` for in-app integration runs.

**Spec:** `docs/superpowers/specs/2026-06-24-native-captions-wiring-design.md` (authoritative). **Builder (DONE):** `docs/superpowers/plans/2026-06-24-native-captions-builder.md`.

## Global Constraints

- **ES3 only:** no `let`/`const`, no arrow functions, no template literals. Wrap every pipeline `main()` in try/catch alerting `e.line`.
- **File roles:** pipeline scripts own `#target` + `CONFIG` + `main()`; step files export one phase function, no `#target`/`CONFIG`/`main()`; utils hold shared functions only. `#include` order: utils → steps → CONFIG → main().
- **Log prefix:** `[stepN]` in step files, `[pipeline]` / `[ai-pipeline]` in pipelines.
- **AI is y-up, PS is y-down.** Geometric bounds are `[left, top, right, bottom]` with `top > bottom` in AI.
- **Caption text spec:** Kalam-Regular, 8 pt, tracking −20, centered, black fill. Default content = element display name.
- **Caption seats INTO the white-edge contour** (the traced cut), submerged by `CONFIG.seatOverlapMm` (0.1) — the overlap IS the attachment. Never seat against raw art.
- **Single-style SKUs:** a SKU is a WC SKU or a GC SKU (stamps may accompany either). `styleCode` decides per-element behavior: `WC`/`GC` → caption; `ST` → none.
- **No headless test for DOM geometry.** Pure functions (string/number) get node tests. DOM-bound code is validated **in Illustrator** via an osascript run + an explicit inspection checklist, **run 2× for determinism**; goldens are **log lines (blind to pixels)**. This overrides default TDD per repo convention and `working_preferences`.
- **Headless AI run hygiene:** set `app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS` at the top of any osascript run (a modal dialog freezes AI and breaks later AppleEvents); use `do javascript file (POSIX file "/tmp/run.jsx")`, NOT a long inline string. `node --check` rejects `.jsx` — copy to a temp `.js` to syntax-check.
- **Existing reused functions (do not reinvent):** `buildCaption`, `buildCaptionPill`, `seatPlateToOutline`, `deriveCutline`, `reuniteCutline`, `assembleElementGroup`, `findGroupMember`, `syncHalfcut`, `buildPlate`, `buildCapsuleFromSpine`, `mmToPoints`, `blackCmyk`, `whiteCmyk`, `strokeRecursive`, `parseLayerName`, `findLayer`, `findLayerByName`, `boundsCenter`, `runDeepnestExport`, `buildWorkingDocument`, `runSilhouette`/`exportSilhouettePng`.

---

## File Structure

**Modify:**
- `utils/aiUtils.jsx` — `buildCaption` native-print upgrades (Task 1) + a pure note-format helper pair (Task 1) + `_placeCaptionText` could live here or in Step 6 (placed in Step 6 file).
- `illustrator/Step6_CreateCutlines.jsx` — replace the caption-rebuild branch with native-text placement; delete `_buildSeparableCutline` + `_psPointToAi`/`_psBoundsToAi` WC usage (Task 2, deletion in Task 8).
- `pipelines/AI_BuildCutlines.jsx` — BridgeTalk target's `buildDocAndImport` ends after trace + text (drops the 7A export call) (Task 2).
- `pipelines/PS_BuildElements.jsx` — absorb silhouette + per-element PNG export + slim sidecar + GC plate-PNG export + BridgeTalk; drop Step 3A (Task 4).
- `illustrator/Step8b_CaptionNormalise.jsx` — read in-group caption members + note `h<pt>` scale-ref (Task 5).
- `illustrator/Step7B_NestingImport.jsx` — drop caption-PNG placement + pair-binding (Task 6).
- `illustrator/Step10_AssetExport.jsx` — gather cut-group caption members into the per-element export (Task 7).
- `installer/` — Pipeline 2 menu entry moves to Illustrator (Task 8).

**Create:**
- `pipelines/AI_BuildAndExportCutlines.jsx` — Pipeline 2 (Illustrator-launched): per captioned element `buildCaption` → `runDeepnestExport` (Task 3).
- `tests/integration/test-caption-note.js` — node unit test for the note format/parse helpers (Task 1).

**Delete (Task 8, after the native path is proven):**
- `photoshop/Step3A_CaptionText.jsx`, the caption-authoring parts of `photoshop/Step3B_CaptionWhite.jsx`, `captionSpine()` + caption sidecar payload + `WC_CAPTION_SPINES`/`CAPTION_SEAT`, the WC caption-PNG export pass, and the dead `pipelines/PSAI_BuildAndExportCutlines.jsx` PS tail.

---

### Task 1: `buildCaption` native-print upgrades + note helpers (aiUtils)

Make `buildCaption` produce a *printable* caption that rides its cut group: visible white pill, text frame as a named group member, a spec-pill-height stamp in the note for Step 8b, and a raster-plate path for GC.

**Files:**
- Modify: `utils/aiUtils.jsx` (`buildCaption` ~654-685; add `_capNoteFormat`, `_capNoteParse`)
- Test: `tests/integration/test-caption-note.js` (node; pure note helpers)
- Validate: extend `tests/spike/ai_caption_build_spike.jsx` (in-app inspection)

**Interfaces:**
- Consumes: `buildCaptionPill(layer,textFrame,opts)→{pill,spine,radius}`, `seatPlateToOutline`, `deriveCutline`, `assembleElementGroup`, `findGroupMember`, `syncHalfcut`, `strokeRecursive`, `blackCmyk`, `mmToPoints`, `_capIsMultiLine`.
- Produces: `buildCaption(doc, layer, textFrame, outline, opts) → { ok, group, needsReview, moved, halfcut, reason }` (unchanged shape). New `opts`: `name`, `styleCode` ("WC"|"GC"), `strokePt`, `plateRasterFile` (File|null), `plateHeightMm` (Number, default 4.0), `plateWidthPadMm` (Number, default 1.69). `_capNoteFormat(styleCode, lines, pillHeightPt, review)→String`; `_capNoteParse(note)→{styleCode, lines, pillHeightPt|null, review}`.

- [ ] **Step 1: Write the failing node test for the note helpers**

```javascript
// tests/integration/test-caption-note.js
// Pure string helpers — node-compatible (ES3). Eval the two _capNote* sources from aiUtils.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../utils/aiUtils.jsx', 'utf8');
eval(src.match(/function _capNoteFormat[\s\S]*?\n}\n/)[0]);
eval(src.match(/function _capNoteParse[\s\S]*?\n}\n/)[0]);

var fails = 0;
function ok(c, m){ if(!c){ console.log('FAIL: '+m); fails++; } }

// Round-trips.
ok(_capNoteFormat('WC',1,42,false) === 'WC|1|h42', 'WC no-review format');
ok(_capNoteFormat('GC',2,57,true)  === 'GC|2|h57|R', 'GC review format');

var a = _capNoteParse('WC|1|h42');
ok(a.styleCode==='WC' && a.lines===1 && a.pillHeightPt===42 && a.review===false, 'parse WC');
var b = _capNoteParse('GC|2|h57|R');
ok(b.styleCode==='GC' && b.lines===2 && b.pillHeightPt===57 && b.review===true, 'parse GC review');

// Back-compat: old note with no height -> pillHeightPt null, still parses style/lines/review.
var c = _capNoteParse('WC|1|R');
ok(c.styleCode==='WC' && c.lines===1 && c.pillHeightPt===null && c.review===true, 'parse legacy |R');
var d = _capNoteParse('GC|2');
ok(d.styleCode==='GC' && d.lines===2 && d.pillHeightPt===null && d.review===false, 'parse legacy bare');

console.log(fails===0 ? 'PASS caption-note' : ('FAIL caption-note ('+fails+')'));
process.exit(fails===0?0:1);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node tests/integration/test-caption-note.js`
Expected: throws (the `src.match(...)` returns null because the functions don't exist yet).

- [ ] **Step 3: Add the note helpers to aiUtils** (near the other `_cap*` helpers, ~line 620)

```javascript
// Caption note = "{style}|{lines}|h{pillHeightPt}" (+ "|R" when the seat flagged review).
// pillHeightPt is the SPEC pill height stamped at build, so Step 8b can recover the artist's
// nest-scale factor (current pill height / this). Tokens after [1] are order-independent.
function _capNoteFormat(styleCode, lines, pillHeightPt, review) {
    return styleCode + "|" + lines + "|h" + Math.round(pillHeightPt) + (review ? "|R" : "");
}

// Parses a caption note. Back-compatible with legacy "{style}|{lines}" and "{style}|{lines}|R".
function _capNoteParse(note) {
    var out = { styleCode: null, lines: 1, pillHeightPt: null, review: false };
    if (!note) return out;
    var t = String(note).split("|"), i;
    out.styleCode = t[0];
    if (t.length > 1 && t[1].length) out.lines = parseInt(t[1], 10) || 1;
    for (i = 2; i < t.length; i++) {
        if (t[i] === "R") out.review = true;
        else if (t[i].charAt(0) === "h") {
            var h = parseFloat(t[i].substring(1));
            if (!isNaN(h)) out.pillHeightPt = h;
        }
    }
    return out;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node tests/integration/test-caption-note.js`
Expected: `PASS caption-note`

- [ ] **Step 5: Upgrade `buildCaption`** (replace the body at `utils/aiUtils.jsx:654-685`)

```javascript
function buildCaption(doc, layer, textFrame, outline, opts) {
    opts = opts || {};
    var name      = opts.name || String(textFrame.contents || "(caption)");
    var styleCode = opts.styleCode || "WC";
    var built     = buildCaptionPill(layer, textFrame, opts);
    var pill      = built.pill;

    // Ride-along printed items move rigidly with the pill during the seat. The GC
    // decorative plate (a raster) is placed BEHIND the text and rides too.
    var plateRaster = null;
    if (opts.plateRasterFile) {
        plateRaster = _placeCaptionPlateRaster(layer, pill, opts.plateRasterFile,
            (opts.plateHeightMm != null ? opts.plateHeightMm : 4.0),
            (opts.plateWidthPadMm != null ? opts.plateWidthPadMm : 1.69));
    }

    var rideGroup = layer.groupItems.add();
    textFrame.move(rideGroup, ElementPlacement.PLACEATEND);
    if (plateRaster) plateRaster.move(rideGroup, ElementPlacement.PLACEATEND);
    var rideItem = rideGroup;

    // Seat into the white-edge outline (authoritative). The overlap IS the attachment.
    var seat = seatPlateToOutline(name, outline, pill, rideItem, { polyCache: {} });
    if (!seat.ok) {
        // Un-nest the ride items so a failed seat leaves clean inputs.
        try { textFrame.move(layer, ElementPlacement.PLACEATEND); } catch (e1) {}
        try { if (plateRaster) plateRaster.move(layer, ElementPlacement.PLACEATEND); } catch (e2) {}
        try { rideGroup.remove(); } catch (e3) {}
        return { ok: false, needsReview: !!seat.needsReview, reason: seat.reason };
    }

    // Unite outline + pill into the fused cut; bundle the separable members.
    var cut = deriveCutline(outline, pill);
    strokeRecursive(cut, (opts.strokePt != null ? opts.strokePt : 0.25), blackCmyk());
    var group = assembleElementGroup(layer, name, outline, pill, cut);

    // PRINTED caption rides the cut group: pill stays VISIBLE (white background), and the
    // text (+ GC plate raster) become named, visible members. assembleElementGroup hid the
    // plate (cut-shaper convention) — re-show it for native captions.
    var plateM = findGroupMember(group, " plate");
    if (plateM) plateM.hidden = false;

    var i, kids = [];
    for (i = 0; i < rideGroup.pageItems.length; i++) kids.push(rideGroup.pageItems[i]);
    for (i = 0; i < kids.length; i++) kids[i].move(group, ElementPlacement.PLACEATBEGINNING);
    try { rideGroup.remove(); } catch (eR) {}
    textFrame.name = name + " caption text";
    if (plateRaster) plateRaster.name = name + " caption plate";

    var lines    = _capIsMultiLine(textFrame) ? 2 : 1;
    var pillH    = plateM ? (plateM.geometricBounds[1] - plateM.geometricBounds[3]) : 0;
    group.note   = _capNoteFormat(styleCode, lines, pillH, !!seat.needsReview);

    // Derive the half-cut from the submerged pill arc.
    var hc = syncHalfcut(doc, group, { polyCache: {} });
    return { ok: true, group: group, needsReview: !!seat.needsReview, moved: seat.moved,
             halfcut: !!(hc && hc.ok), reason: hc ? hc.reason : null };
}

// Places a GC decorative plate raster behind the caption, scaled to span the pill width
// (+ pad each side) at a fixed spec bar height. Width-driven; non-uniform, so the L/R caps
// may distort slightly — accepted as cosmetic + tunable (plateHeightMm / plateWidthPadMm).
// The plate is PRINTED-INK only; it does NOT enter deriveCutline (the cut stays outline+pill).
function _placeCaptionPlateRaster(layer, pill, plateFile, heightMm, widthPadMm) {
    var pb = pill.geometricBounds;                 // [l,t,r,b] y-up
    var targetW = (pb[2] - pb[0]) + mmToPoints(widthPadMm) * 2;
    var targetH = mmToPoints(heightMm);
    var placed = layer.placedItems.add();
    placed.file = plateFile;
    placed.resize((targetW / placed.width) * 100, (targetH / placed.height) * 100);
    // Centre on the pill.
    var pcx = (pb[0] + pb[2]) / 2, pcy = (pb[1] + pb[3]) / 2;
    placed.translate(pcx - (placed.position[0] + placed.width / 2),
                     pcy - (placed.position[1] - placed.height / 2));
    return placed;
}
```

- [ ] **Step 6: Extend the spike runner to exercise the new behavior**

In `tests/spike/ai_caption_build_spike.jsx`, after the existing `buildCaption` call, assert the new members exist. Add to the per-case return string:

```javascript
// after `var res = buildCaption(...)`
if (res.ok && res.group) {
    var txtM = findGroupMember(res.group, " caption text");
    var pillVis = (function(){ var p = findGroupMember(res.group, " plate"); return p ? (!p.hidden) : false; })();
    dbg += " | textMember=" + (txtM ? "yes" : "NO") + " pillVisible=" + pillVis + " note=" + res.group.note;
}
```

- [ ] **Step 7: Run the spike in Illustrator + inspect** (the DOM test)

Write `/tmp/run_caption.jsx` (alert-override + `app.userInteractionLevel=DONTDISPLAYALERTS` + `$.evalFile` the spike + log results), then:
Run: `osascript -e 'tell application "Adobe Illustrator" to do javascript file (POSIX file "/tmp/run_caption.jsx")'`
**Run twice.** Inspection checklist (both runs identical):
- Per case logs `ok=true review=false halfcut=true ... textMember=yes pillVisible=true note=WC|1|h<pt>`.
- Visually: the white pill is **visible** (white fill) behind the text; the text is a member of the element group; the cut is one fused contour.
- (GC stub) if a `plateRasterFile` is passed, a scaled plate raster sits behind the text, named `"<name> caption plate"`, and the cut is unchanged (still outline+pill).

- [ ] **Step 8: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/test-caption-note.js tests/spike/ai_caption_build_spike.jsx
git commit -m "feat(captions): buildCaption native-print upgrades (visible pill, text member, note h-stamp, raster plate)"
```

---

### Task 2: Step 6 places native caption text (Pipeline 1's AI half)

Replace Step 6's caption-rebuild-from-sidecar with native text placement, and make the BridgeTalk target stop after trace + text (no pill build, no Deepnest export here).

**Files:**
- Modify: `illustrator/Step6_CreateCutlines.jsx` (match loop ~141-191; add `_placeCaptionText`)
- Modify: `pipelines/AI_BuildCutlines.jsx` (`buildDocAndImport` ~191-263: drop the `_runExportForNesting` call; update the artist stop message)
- Validate: in-app run of the existing PSAI→AI handoff (or a direct `buildDocAndImport` osascript run on the spike fixture)

**Interfaces:**
- Consumes: sidecar element `{displayName, styleCode}`; the matched traced `path` (= element outline); `cutlinesLayer`; CONFIG `captionFont`/`captionSizePt`/`captionTracking` (add these to AI CONFIG, see Step 2).
- Produces: per captioned element, the Cutlines layer holds a `PathItem` named `"<displayName> outline"` + a `TextFrame` named `"<displayName> caption text"`. `runCreateCutlines` return unchanged (`{named, unmatched, dropped, traceTuning}`). `_placeCaptionText(layer, displayName, outline, font, sizePt, tracking) → TextFrame`.

- [ ] **Step 1: Add caption-text CONFIG keys to `AI_BuildCutlines.jsx`** (in CONFIG, near the Step 6 block)

```javascript
    // ── Caption text (native authoring, placed at Step 6 for artist review) ──
    captionFont:     "Kalam-Regular",
    captionSizePt:   8,
    captionTracking: -20,
    captionTextGapMm: 3.0,   // text top sits this far below the element outline bottom (review pose)
```

- [ ] **Step 2: Add `_placeCaptionText` to `Step6_CreateCutlines.jsx`** (near `_buildSeparableCutline`)

```javascript
// Places a native caption text frame (the printed ink, vector) below an element's traced
// outline as the artist's review pose. Names it "{displayName} caption text" so Pipeline 2
// (AI_BuildAndExportCutlines) can re-find it. Kalam 8pt / tracking -20 / centred / black.
// try/catch each characterAttributes set — a stale attribute throws -609 (see gotchas memory).
function _placeCaptionText(layer, displayName, outline, font, sizePt, tracking, gapMm) {
    var tf = layer.textFrames.add();
    tf.contents = displayName;
    try { tf.textRange.characterAttributes.size     = sizePt; } catch (e1) {}
    try { tf.textRange.characterAttributes.textFont = app.textFonts.getByName(font); } catch (e2) {}
    try { tf.textRange.characterAttributes.tracking = tracking; } catch (e3) {}
    try { tf.textRange.characterAttributes.fillColor = blackCmyk(); } catch (e4) {}
    try { tf.textRange.paragraphAttributes.justification = Justification.CENTER; } catch (e5) {}

    var ob = outline.geometricBounds;                 // [l,t,r,b] y-up
    var ecx = (ob[0] + ob[2]) / 2;
    var tb = tf.geometricBounds, tcx = (tb[0] + tb[2]) / 2;
    tf.translate(ecx - tcx, (ob[3] - mmToPoints(gapMm)) - tb[1]);   // centre just below the element
    tf.name = displayName + " caption text";
    return tf;
}
```

- [ ] **Step 3: Rewire the match loop** in `runCreateCutlines` (`Step6_CreateCutlines.jsx` ~163-190)

Replace the `if (matched.styleCode === "ST") … else if (matched.caption) … else …` block with a style-code-driven block (the sidecar no longer carries `caption`; presence is by style):

```javascript
        if (matched.styleCode === "WC" || matched.styleCode === "GC") {
            // Native caption: name the outline + place review text. The PILL/PLATE/cut are
            // built in Pipeline 2 (AI_BuildAndExportCutlines) after the artist reviews the text.
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
            path.name = matched.displayName + " outline";
            _placeCaptionText(cutlinesLayer, matched.displayName, path,
                CONFIG.captionFont, CONFIG.captionSizePt, CONFIG.captionTracking, CONFIG.captionTextGapMm);
            log("[step6] caption text | " + matched.displayName);
            named++;
        } else {
            // ST and any uncaptioned element: bare named cutline path.
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
            path.name = matched.displayName;
            log("[step6] named | " + path.name);
            named++;
        }
```

(The Stage-B fragment filter above it still uses `_psBoundsToAi`; keep that helper. `_buildSeparableCutline` is now unreferenced — it is deleted in Task 8.)

- [ ] **Step 4: Make `buildDocAndImport` stop after trace + text** in `AI_BuildCutlines.jsx` (~258)

Replace the tail (the `_runExportForNesting` call + return) so Pipeline 1's AI half ENDS at the caption-review stop:

```javascript
    // Pipeline 1 ends here: cut traced + native caption text placed. The artist reviews/reshapes
    // the captions in Illustrator, then runs Pipeline 2 (AI_BuildAndExportCutlines) to build the
    // pills + cut + half-cut and export for Deepnest. (Deepnest export moved to Pipeline 2.)
    if (!CONFIG.suppressAlerts) {
        scriptAlert("✅ Cut traced + captions placed.\n\n"
            + "Processed " + result.named + " element(s).\n\n"
            + "Review/reshape the caption text in Illustrator (move, shorten, curve to follow the art),\n"
            + "then run Pipeline 2 (Build and Export Cutlines).");
    }
    return _status({ ok: true, phase: "step6", named: result.named,
                     unmatched: result.unmatched, traceTuning: result.traceTuning });
```

(The unmatched halt above this is unchanged. `_runExportForNesting` stays in the file — `main()`'s direct-run path still uses it; Pipeline 2 will call `runDeepnestExport` itself.)

- [ ] **Step 5: Validate in-app** — run the existing PSAI→AI handoff on the Slovakia WC fixture (or a direct `buildDocAndImport(silh, sidecar)` osascript run). **Run twice.** Checklist:
- Log shows `[step6] caption text | <name>` per WC element; no `caption capsule` / `buildPlate` lines.
- On the Cutlines layer: each WC element has a visible traced outline named `"<name> outline"` + a black Kalam text frame named `"<name> caption text"` below it. No pill/cut group yet.
- The run ends with the "captions placed — run Pipeline 2" alert; no SVGs exported.
- Unmatched elements still trigger the rename halt.

- [ ] **Step 6: Commit**

```bash
git add illustrator/Step6_CreateCutlines.jsx pipelines/AI_BuildCutlines.jsx
git commit -m "feat(captions): Step 6 places native caption text; Pipeline 1 stops at caption review"
```

---

### Task 3: Pipeline 2 — `AI_BuildAndExportCutlines.jsx` (build captions + Deepnest export)

New Illustrator-launched pipeline. After the artist reviews the placed text, it builds each caption via `buildCaption` and exports for Deepnest.

**Files:**
- Create: `pipelines/AI_BuildAndExportCutlines.jsx`
- Validate: in-app run after Task 2's run (the doc has outlines + text frames)

**Interfaces:**
- Consumes: the working `.ai` (resolved by its Cutlines layer) + the sidecar `.json` beside it (`{displayName, styleCode}`); per element the named `"<name> outline"` PathItem + `"<name> caption text"` TextFrame on the Cutlines layer; `buildCaption` (Task 1); `runDeepnestExport`; for GC, the plate PNG beside the sidecar.
- Produces: each WC/GC element fused into a cut group (`buildCaption`); SVGs exported (Deepnest). Returns nothing (artist-run; alerts on completion).

- [ ] **Step 1: Write the pipeline scaffold** (`pipelines/AI_BuildAndExportCutlines.jsx`)

```javascript
#target illustrator
#include "../utils/json2.jsx"
#include "../utils/aiUtils.jsx"
#include "../illustrator/Step7A_DeepnestExport.jsx"

var CONFIG = {
    dryRun:           false,
    suppressAlerts:   false,
    logPath:          "",
    cutlinesLayerName: "Cutlines",
    stickersLayerName: "Sticker",
    cutlineStrokePt:  0.25,
    seatOverlapMm:    0.1,
    seatSampleSteps:  24,
    seatConform:      true,
    seatRotationSign: 1,
    maxSeatRotationDeg: 75,
    seatShrinkFrac:   0.15,
    captionMidProtrudeFrac: 0.25,
    halfcutLayerName: "Halfcut",
    halfcutStrokePt:  0.25,
    halfcutExtendMm:  1.0,
    halfcutSeamSteps: 16,
    plateHeightMm:    4.0,    // GC decorative bar height (tunable; validate on a GC SKU)
    plateWidthPadMm:  1.69,
    deepnestRectThreshold: 0.82
};
var _root = $.fileName ? new File($.fileName).parent.parent.fsName : Folder.desktop.fsName;
CONFIG.logPath = _root + "/pipelines/AI_BuildAndExportCutlines.log";

main();
```

- [ ] **Step 2: Implement `main()`** (append to the file, before the `main();` call)

```javascript
// Resolve the working doc by its Cutlines layer (NOT activeDocument — Pipeline 1 may leave an
// SVG/other doc in front). Read the sidecar beside the saved .ai. For each WC/GC element, find
// its outline + caption-text by name and run buildCaption. Then export for Deepnest.
function main() {
    try {
        var doc = _resolveWorkingDoc();
        if (!doc) { scriptAlert("No working document with a Cutlines layer is open.\nRun Pipeline 1 first."); return; }
        var layer = findLayer(doc, CONFIG.cutlinesLayerName);

        log("[ai-pipeline] === AI_BuildAndExportCutlines start ===");
        var sidecar = _readSidecarBeside(doc);
        if (!sidecar) { scriptAlert("Couldn't find the *_elements.json sidecar beside this .ai."); return; }

        var folderFs = doc.fullName.parent.fsName;
        var plateFile = _findPlatePng(folderFs, doc);   // GC plate PNG, or null

        var built = 0, skipped = [], failed = [], i;
        for (i = 0; i < sidecar.elements.length; i++) {
            var el = sidecar.elements[i];
            if (el.styleCode !== "WC" && el.styleCode !== "GC") continue;   // ST / uncaptioned
            var outline = _findItemByName(layer, el.displayName + " outline");
            var textFrame = _findItemByName(layer, el.displayName + " caption text");
            if (!outline || !textFrame) {
                skipped.push(el.displayName + (outline ? "" : " [no outline]") + (textFrame ? "" : " [no text]"));
                continue;
            }
            var opts = { name: el.displayName, styleCode: el.styleCode,
                         strokePt: CONFIG.cutlineStrokePt };
            if (el.styleCode === "GC" && plateFile) {
                opts.plateRasterFile = plateFile;
                opts.plateHeightMm   = CONFIG.plateHeightMm;
                opts.plateWidthPadMm = CONFIG.plateWidthPadMm;
            }
            var res;
            try { res = buildCaption(doc, layer, textFrame, outline, opts); }
            catch (eB) { failed.push(el.displayName + " (line " + eB.line + ": " + eB.message + ")"); continue; }
            if (res && res.ok) { built++; log("[ai-pipeline] caption built | " + el.displayName
                + " halfcut=" + res.halfcut + (res.needsReview ? " REVIEW" : "")); }
            else { failed.push(el.displayName + (res ? " (" + res.reason + ")" : "")); }
        }

        log("[ai-pipeline] captions built: " + built + " | skipped: " + skipped.length + " | failed: " + failed.length);
        if (failed.length) {
            scriptAlert("⚠️ " + failed.length + " caption(s) couldn't be built:\n  • " + failed.join("\n  • ")
                + "\n\nFix the caption text/seating in Illustrator and re-run. (Built " + built + ".)");
            return;   // do NOT export a partial nest
        }

        if (!CONFIG.dryRun) { runDeepnestExport(doc); }
        log("[ai-pipeline] === AI_BuildAndExportCutlines done ===");
        scriptAlert("✅ Cut lines built (" + built + ") + SVGs exported.\n\n"
            + "Review both SVGs, run Deepnest, then run AI_ImportNesting.");
    } catch (e) {
        scriptAlert("ERROR (line " + e.line + "): " + e.message + "\nLog: " + CONFIG.logPath);
    }
}

function _resolveWorkingDoc() {
    var i;
    for (i = 0; i < app.documents.length; i++) {
        if (findLayer(app.documents[i], CONFIG.cutlinesLayerName)) return app.documents[i];
    }
    return null;
}
function _findItemByName(layer, want) {
    var i;
    for (i = 0; i < layer.pageItems.length; i++) { if (layer.pageItems[i].name === want) return layer.pageItems[i]; }
    return null;
}
function _readSidecarBeside(doc) {
    var base = doc.fullName.fsName.replace(/\.ai$/i, "");
    var f = new File(base + "_elements.json");
    if (!f.exists) return null;
    f.open("r"); var txt = f.read(); f.close();
    try { return JSON.parse(txt); } catch (e) { return null; }
}
function _findPlatePng(folderFs, doc) {
    var base = doc.fullName.name.replace(/\.ai$/i, "");
    var f = new File(folderFs + "/" + base + "_caption_plate.png");
    return f.exists ? f : null;
}
```

- [ ] **Step 3: Validate in-app** — after Task 2's run (outlines + text present), run this pipeline via osascript (`do javascript file`, alerts neutralised). **Run twice.** Checklist:
- Log: `caption built | <name> halfcut=true` per WC element; `captions built: N`.
- Each element is now a cut group (`<name>` GroupItem) with a **visible white pill**, **black text member** `"<name> caption text"`, hidden outline, visible fused cut, and a half-cut.
- Two SVGs (`_regular`, `_irregular`) are written + opened.
- (GC SKU) the decorative plate raster sits behind the text and the cut is unchanged.

- [ ] **Step 4: Commit**

```bash
git add pipelines/AI_BuildAndExportCutlines.jsx
git commit -m "feat(captions): Pipeline 2 (Illustrator) — buildCaption per element + Deepnest export"
```

---

### Task 4: Photoshop restructure — Pipeline 1 absorbs silhouette/export/handoff; slim sidecar; GC plate PNG; drop captions

`PS_BuildElements.jsx` becomes the full Pipeline 1: combine → resize → white edge → silhouette → export (art PNGs + slim sidecar + GC plate PNG) → BridgeTalk into Pipeline 1's AI half. No caption authoring in PS.

**Files:**
- Modify: `pipelines/PS_BuildElements.jsx` (`#include` list lines 1-6; `main()` 156-314; CONFIG; add `writeElementsFile`/`exportElementPngs`/`handOffToIllustrator`/silhouette helpers, ported from PSAI minus caption logic)
- Reference (porting source, not run): `pipelines/PSAI_BuildAndExportCutlines.jsx`

**Interfaces:**
- Consumes: `runCombine`, `runResize`, `runWhiteEdge`, `runSilhouette`/`exportSilhouettePng`; `parseLayerName`, `findLayerByName`; BridgeTalk → `AI_BuildCutlines.buildDocAndImport`.
- Produces beside the PSD: `{name}_silhouette.png`, `{name}_elements.json` (**slim** — no `caption`), `{name}_elements/` art PNGs, and (GC SKU) `{name}_caption_plate.png`. Sidecar shape: `{ psdWidth, psdHeight, elements: [{ displayName, styleCode, left, top, right, bottom }] }`.

- [ ] **Step 1: Update the `#include` list** (`PS_BuildElements.jsx` top) — drop Step 3A, add the silhouette step + json2:

```javascript
#target photoshop
#include "../utils/psUtils.jsx"
#include "../utils/json2.jsx"
#include "../photoshop/Step1_CombineElements.jsx"
#include "../photoshop/Step2A_AutoResize.jsx"
#include "../photoshop/Step2B_WhiteEdge.jsx"
#include "../photoshop/Step5_Silhouette.jsx"
```

- [ ] **Step 2: Add CONFIG keys** for export + handoff (port from PSAI): `aiPipelinePath`, `bridgeTalkTimeout`, `captionPlateCodes` (to know which SKUs export a plate PNG). After the CONFIG block:

```javascript
CONFIG.aiPipelinePath = _root + "/pipelines/AI_BuildCutlines.jsx";   // _root resolved as in PSAI
CONFIG.bridgeTalkTimeout = 20;
```
(Keep `captionPlateCodes: [["GC","LM"]]` in CONFIG. Remove `captionFont`/`captionSizePt`/`captionTracking`/`captionGap` — captions are no longer authored in PS; they move to the AI CONFIG, Task 2.)

- [ ] **Step 3: Port `writeElementsFile` (SLIM), `exportElementPngs` (ART-ONLY), `exportSilhouettePng`, `handOffToIllustrator`, and `exportCaptionPlatePng`** from PSAI into `PS_BuildElements.jsx`, with these changes:
  - `writeElementsFile`: drop the entire `caption` assembly (`captionInfo`/`captionSpine`/`CAPTION_SEAT`). Each element = `{displayName, styleCode, left, top, right, bottom}` only. Delete `captionInfo`/`captionSpine` (do not port).
  - `exportElementPngs`: keep **Pass 1 (art)** only; delete Pass 2 (caption) + `hideCaptionSublayers`/`hideNonCaptionSublayers` caption logic. Art naming `{displayName}.png` unchanged.
  - New `exportCaptionPlatePng(doc)`: if the SKU is GC (any element's `[styleCode,catCode]` ∈ `captionPlateCodes`), export the `Caption_Plate.psd`-derived "Caption plate" layer (imported by Step 1) to `{name}_caption_plate.png` (transparent). Return the path or null. (If `Caption_Plate.psd` was not present, return null and log.)
  - `handOffToIllustrator`: unchanged BridgeTalk body (it already calls `buildDocAndImport(silh, sidecar)` on `AI_BuildCutlines`).

- [ ] **Step 4: Rewrite `main()`'s phase chain** (`PS_BuildElements.jsx` ~203-312) to: Step 1 combine → Step 2 resize → Step 2B white edge → **Step 5 silhouette finalize** → save → `exportElementPngs` + `writeElementsFile` + `exportCaptionPlatePng` → `handOffToIllustrator` → completion alert. Each phase keeps the snapshot/try-catch pattern. **Remove the Step 3A phase.** The final alert becomes:

```javascript
    msg += "\n\nIllustrator is tracing the cut + placing caption text.\n"
        + "Review/reshape the captions in Illustrator, then run Pipeline 2 (Build and Export Cutlines).";
```

- [ ] **Step 5: Validate in-app** — run `PS_BuildElements` on the Slovakia WC fixture folder. **Run twice.** Checklist:
- `{name}_elements.json` contains NO `caption` field on any element (grep the file).
- `{name}_elements/` has art PNGs only (no `*_caption.png`).
- (GC fixture) `{name}_caption_plate.png` exists; (WC fixture) it does not.
- BridgeTalk fires → Illustrator opens, traces, places caption text (Task 2 behavior), ends at the review alert.
- No Step 3A caption-text layers are created in the PSD.

- [ ] **Step 6: Commit**

```bash
git add pipelines/PS_BuildElements.jsx
git commit -m "feat(captions): Pipeline 1 absorbs silhouette/export/handoff; slim sidecar; GC plate PNG; drop PS captions"
```

---

### Task 5: Step 8b normalise — in-group caption members + note `h<pt>` scale-ref

Caption members now live inside the cut group (not as a Stickers PNG). Re-target Step 8b and switch its scale reference to the note-stamped spec pill height.

**Files:**
- Modify: `illustrator/Step8b_CaptionNormalise.jsx` (`runCaptionNormalise` 40-170; `_findCaption` usage; `_matrixScale` usage 98-110, 184-187)

**Interfaces:**
- Consumes: `_capNoteParse` (Task 1); `findGroupMember(group," plate")` (visible pill) + `(group," caption text")` + `(group," caption plate")`; `seatPlateToOutline`, `reuniteCutline`, `boundsCenter`.
- Produces: `runCaptionNormalise(doc)` return unchanged (`{reset, atSpec, skipped}`).

- [ ] **Step 1: Replace the per-element scale logic.** In `runCaptionNormalise`'s loop, replace `_findCaption` + `_matrixScale` with the in-group members + note height:

```javascript
        var parsed = _capNoteParse(group.note);
        if (!parsed.styleCode) { log("[step8b] SKIP | no caption note | " + group.name); skipped++; continue; }
        if (parsed.styleCode !== "WC" && parsed.styleCode !== "GC") { skipped++; continue; }

        var outline = findGroupMember(group, " outline");
        var pill    = findGroupMember(group, " plate");
        var text    = findGroupMember(group, " caption text");
        var plateR  = findGroupMember(group, " caption plate");   // GC only, may be null
        if (!outline || !pill || !text) { log("[step8b] SKIP | " + group.name + " — missing member."); skipped++; continue; }

        if (parsed.pillHeightPt == null) { log("[step8b] SKIP | " + group.name + " — note has no spec height (rebuild via Pipeline 2)."); skipped++; continue; }
        var curPillH = pill.geometricBounds[1] - pill.geometricBounds[3];
        if (curPillH <= 0) { skipped++; continue; }
        var unscale = parsed.pillHeightPt / curPillH;
        if (Math.abs(unscale - 1.0) < 0.005) { log("[step8b] at spec | " + group.name); atSpec++; continue; }

        var pivot = boundsCenter(pill.geometricBounds);
        _scaleAboutPoint(pill, unscale, pivot);
        _scaleAboutPoint(text, unscale, pivot);
        if (plateR) _scaleAboutPoint(plateR, unscale, pivot);

        var seat = seatPlateToOutline(group.name, outline, pill, text, { polyCache: {} });
        if (seat.needsReview && group.note && String(group.note).indexOf("|R") < 0) group.note = group.note + "|R";
        reuniteCutline(group, outline, pill, CONFIG.cutlineStrokePt);
        reset++;
```

(`_scaleAboutPoint` already exists in this file. `_findCaption` becomes unused → delete in Task 8. The pill is rescaled about its own centre so the seat re-derives the overlap. `specFactor`/`72/sourceDPI` is no longer the reference.)

- [ ] **Step 2: Validate in-app** — after a Pipeline-2 run, manually scale one element group by ~130% (Selection tool), then run `AI_NormaliseCaptions` (which calls `runCaptionNormalise`). **Run twice.** Checklist:
- Log: `at spec | …` for untouched elements; `reset` count = 1 (the scaled one) on the first run, then `at spec` on the second (idempotent).
- The scaled element's caption returns to the same printed size as its neighbours; the cut re-unites with no gap; the half-cut stays attached.

- [ ] **Step 3: Commit**

```bash
git add illustrator/Step8b_CaptionNormalise.jsx
git commit -m "feat(captions): Step 8b normalises in-group caption members via note spec-height"
```

---

### Task 6: Step 7B — drop caption-PNG placement + pair-binding

The caption now rides its cut group, so Step 7B no longer places or transforms a separate caption.

**Files:**
- Modify: `illustrator/Step7B_NestingImport.jsx` (`_nestPlaceCaptionUpright` call ~316; `_nestApplyPairTransform` call ~320 + signature 461-477)

**Interfaces:**
- Produces: nesting transform applied to `{cut group, art PNG}` only; the caption rides the cut group automatically.

- [ ] **Step 1: Remove the caption placement + binding.** Delete the `captionItem = _nestPlaceCaptionUpright(...)` call (~316) and change the pair-transform call (~320) to pass no caption:

```javascript
        _nestApplyPairTransform(cutlineItem, artItem, rotation, svgItem.center);
```

And simplify `_nestApplyPairTransform` (461-477) to two operands:

```javascript
function _nestApplyPairTransform(cut, art, rotation, target) {
    if (CONFIG.dryRun) return;
    if (Math.abs(rotation) > 0.01) {
        var ctr = boundsCenter(cut.geometricBounds);
        var m = _nestPivotMatrix(rotation, ctr.x, ctr.y);
        cut.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
        if (art) art.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
    }
    var oc = boundsCenter(cut.geometricBounds);
    var dx = target.x - oc.x, dy = target.y - oc.y;
    cut.translate(dx, dy);
    if (art) art.translate(dx, dy);
}
```

(`_nestPlaceCaptionUpright` becomes unused → delete in Task 8. `cut` is the cut GroupItem, so transforming it carries the in-group caption members.)

- [ ] **Step 2: Validate in-app** — run `AI_ImportNesting` on a nested SVG after Pipeline 2. **Run twice.** Checklist:
- Each placed element shows art + caption together at the nested position/rotation; the caption stays attached to its cut (it rode the group transform).
- No `caption PNG not found` warnings; no caption left at the origin.

- [ ] **Step 3: Commit**

```bash
git add illustrator/Step7B_NestingImport.jsx
git commit -m "feat(captions): Step 7B drops caption-PNG placement (caption rides the cut group)"
```

---

### Task 7: Step 10 — gather cut-group caption members into the per-element export

Include each element's visible caption members (pill + text + GC plate) in its export, since they live in the Cutlines group, not Stickers.

**Files:**
- Modify: `illustrator/Step10_AssetExport.jsx` (`_s10BuildClipData` 71-105; the per-element clip-group build ~121-193; the on-Stickers count assertion 254-265)

**Interfaces:**
- Consumes: each cutline `GroupItem`'s visible members `" plate"` (pill), `" caption text"`, `" caption plate"`; the Stickers art PlacedItem.
- Produces: per-element clip group = art (clipped to cut) + the caption members (added, already shaped). Export unchanged otherwise.

- [ ] **Step 1: Collect caption members per element.** In `_s10BuildClipData`, alongside each element's `cutline` group, gather its visible printed caption members into the `clipData` entry:

```javascript
        // Native caption: the printed members live INSIDE the cut group (not Stickers).
        // Collect the visible ones so the per-element export includes them.
        var capMembers = [];
        if (cutline.typename === "GroupItem") {
            var want = [displayName + " plate", displayName + " caption text", displayName + " caption plate"];
            var gi, gm;
            for (gi = 0; gi < cutline.pageItems.length; gi++) {
                gm = cutline.pageItems[gi];
                for (var wj = 0; wj < want.length; wj++) {
                    if (gm.name === want[wj] && !gm.hidden) { capMembers.push(gm); break; }
                }
            }
        }
        clipData.push({
            element:     item,
            cutline:     cutline,
            displayName: displayName,
            captionMembers: capMembers,
            isStamp:     (cutline.typename === "PlacedItem")
        });
```

- [ ] **Step 2: Include the caption members in the clip group.** In the per-element clip-group build (JPEG ~121-138 and PNG ~177-193), after the art is clipped to the cut, **duplicate** each `captionMembers` item into the temp clip group (they are already shaped — add, do not clip). Use the established temp-group pattern in that function; for each member: `var dup = member.duplicate(tempGroup, ElementPlacement.PLACEATBEGINNING);` so it renders above the clipped art. (The originals stay in the Cutlines group; Step 10's temp groups are discarded after export per the file's existing convention.)

- [ ] **Step 3: Update the on-Stickers count assertion** (254-265). Captions are no longer placed on Stickers, so `expectedOnStickers = totalArtPlaced` (drop `+ totalCaptionPlaced`). Remove `totalCaptionPlaced` tracking.

- [ ] **Step 4: Validate in-app** — run `AI_ExportFinal` (or Step 10 directly) after a nested+normalised doc. **Run twice.** Checklist:
- Each exported per-element PNG/JPEG shows the **art + the white caption pill + black caption text** (+ GC plate) clipped to the sticker shape — the printed caption is present.
- The white preview + green preview both render the caption.
- No "ITEM ON WRONG LAYER" warning.

- [ ] **Step 5: Commit**

```bash
git add illustrator/Step10_AssetExport.jsx
git commit -m "feat(captions): Step 10 gathers cut-group caption members into per-element export"
```

---

### Task 8: Delete dead caption code + move Pipeline 2's installer entry

Remove the PS caption authoring, the sidecar caption payload remnants, and the now-unused AI rebuild code; point the installer's Pipeline 2 entry at Illustrator.

**Files:**
- Delete: `photoshop/Step3A_CaptionText.jsx`
- Modify: `photoshop/Step3B_CaptionWhite.jsx` (delete caption authoring — see below)
- Modify: `illustrator/Step6_CreateCutlines.jsx` (delete `_buildSeparableCutline`, `_psPointToAi`; keep `_psBoundsToAi` if still used by the fragment filter — verify)
- Modify: `illustrator/Step8b_CaptionNormalise.jsx` (delete `_findCaption`, `_matrixScale`)
- Modify: `illustrator/Step7B_NestingImport.jsx` (delete `_nestPlaceCaptionUpright`)
- Delete or retire: `pipelines/PSAI_BuildAndExportCutlines.jsx` (its work now lives in Pipeline 1 + Pipeline 2)
- Modify: `installer/` config (Pipeline 2 = `AI_BuildAndExportCutlines.jsx`, registered in Illustrator's Scripts menu)

- [ ] **Step 1: Decide Step 3B's fate.** Step 3B (`runCaptionWhite`) only did caption authoring + the final element grouping/`selectAndGroup`. The element grouping (folding caption-less elements into the Elements group) is now redundant because PS no longer adds caption sub-layers — **verify** whether Step 5 (`runSilhouette`) already finalizes the Elements group without it. If yes, delete `Step3B_CaptionWhite.jsx` and remove its `#include`/call from the (retired) PSAI. If Step 5 depends on Step 3B's grouping, keep only `selectAndGroup` and delete `createWhiteFromText`/`seatCaptionConform`/`groupStandard`/`groupWithPlate`/`elongateCaptionPlate`/`_stashCaptionSpine`/`_stashCaptionSeat`. Record the decision in the commit message.

- [ ] **Step 2: Delete the unused AI functions** confirmed dead by Tasks 2/5/6: `_buildSeparableCutline` + `_psPointToAi` (Step 6), `_findCaption` + `_matrixScale` (Step 8b), `_nestPlaceCaptionUpright` (Step 7B). Grep each name across the repo first to confirm zero remaining references:

```bash
grep -rn "_buildSeparableCutline\|_psPointToAi\|_findCaption\|_matrixScale\|_nestPlaceCaptionUpright\|captionSpine\|WC_CAPTION_SPINES\|CAPTION_SEAT" illustrator/ pipelines/ photoshop/
```
Expected after edits: no references except the definitions being deleted.

- [ ] **Step 3: Retire `PSAI_BuildAndExportCutlines.jsx`.** Its PS tail (silhouette/export/handoff) moved to `PS_BuildElements` (Task 4) and its caption work is deleted. Remove the file (or stub it with an alert pointing to the new two-pipeline flow). Update `CLAUDE.md`'s pipeline map + `docs/` references.

- [ ] **Step 4: Update the installer.** Point the second artist menu entry at `pipelines/AI_BuildAndExportCutlines.jsx` registered in **Illustrator**'s `File > Scripts` (it was a Photoshop script). Follow the existing installer convention (one entry per pipeline; see the `artist_installer` memory). Pipeline 1 (`PS_BuildElements`) stays in Photoshop.

- [ ] **Step 5: Syntax-check + commit.** Copy each edited `.jsx` to a temp `.js` and `node --check` it (catches ES3 typos; node rejects the `.jsx` extension directly).

```bash
git add -A
git commit -m "refactor(captions): delete PS caption authoring + dead AI rebuild code; move Pipeline 2 to Illustrator"
```

---

### Task 9: End-to-end validation (WC + GC SKUs) + goldens

**Files:**
- Modify/add: `tests/integration/run-*.sh` runners for the two-pipeline flow (port the existing combined runner)
- Update: affected golden logs

- [ ] **Step 1: WC SKU end-to-end.** On the Slovakia WC fixture: run Pipeline 1 (PS → AI trace + text), simulate the artist review (the placed text is already a valid pose), run Pipeline 2 (build + export). **Run the whole flow 2×.** Checklist (log + visual):
  - 22/22 cut groups, unmatched=0, both SVGs written.
  - Per element: visible white pill, black Kalam caption member, fused single-contour cut, half-cut attached at both ends.
  - The slim sidecar has no `caption` field; no `*_caption.png` exported.
- [ ] **Step 2: GC SKU end-to-end.** On a GC fixture (with `Caption_Plate.psd`): same flow. Additionally: `{name}_caption_plate.png` is exported; each GC caption shows the scaled decorative plate behind the text; the cut is unchanged (outline+pill only). Tune `CONFIG.plateHeightMm`/`plateWidthPadMm` if the bar reads too thick/thin.
- [ ] **Step 3: Normalise + nest + export passes.** Manually scale a couple elements, run `AI_NormaliseCaptions` (Task 5), then `AI_ImportNesting` (Task 6) on a nested SVG, then `AI_ExportFinal`/Step 10 (Task 7). Confirm the printed caption survives each stage in the per-element exports.
- [ ] **Step 4: Regenerate goldens.** Re-run the relevant integration runners 2× (determinism), diff the log goldens (caption build lines, sidecar shape, half-cut, Step 8b), **review each diff before committing**. Never hand-author golden coordinates.
- [ ] **Step 5: Commit**

```bash
git add tests/ docs/
git commit -m "test(captions): end-to-end WC+GC native-caption validation + regenerated goldens"
```

---

## Self-Review

- **Spec coverage:** §1 scope → Tasks 2/3 gate on `styleCode`; §2 two-pipeline flow → Tasks 2 (Pipeline 1 AI half stops) + 3 (Pipeline 2) + 4 (Pipeline 1 PS half); §3 caption rides cut group + visible pill → Task 1; §4 slim sidecar + GC plate PNG + drop PS captions → Task 4; §5 Step 6 text / Step 8b / Step 7B / Step 10 → Tasks 2/5/6/7; §6 builder raster path + visible pill + note stamp → Task 1; §7 deletion → Task 8; §8 validation → Task 9; §9 ordering → task order matches.
- **Placeholder scan:** the only deferred specifics are DOM-bound bodies validated in-app (Step 10 temp-group duplication detail; Step 3B fate) — explicitly flagged with the inspection step, per repo convention (no headless DOM test). Pure helpers (Task 1 note format/parse) have complete code + a node test.
- **Type consistency:** `_capNoteFormat`/`_capNoteParse` (Task 1) consumed by Task 5; `buildCaption` opts (`name`, `styleCode`, `strokePt`, `plateRasterFile`, `plateHeightMm`, `plateWidthPadMm`) defined in Task 1, used in Task 3; member-name conventions (`" outline"`, `" plate"`, `" caption text"`, `" caption plate"`) consistent across Tasks 1/3/5/7; `_nestApplyPairTransform` 2-operand signature (Task 6) matches its single call site.

## Outcome

All captions are authored, shaped, pilled, seated, cut, and half-cut entirely in Illustrator, riding their cut group through nesting and exported by Step 10. The artist keeps the two-button flow (Build Elements → Build and Export Cutlines). Photoshop no longer touches captions; the handoff sidecar carries no caption payload; the reproduction code is gone. WC and GC share one native path, GC differing only by a scaled decorative plate raster.
