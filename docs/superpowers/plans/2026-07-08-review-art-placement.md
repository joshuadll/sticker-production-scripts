# Review-Art Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place each element's art on the Illustrator `Sticker` layer at the end of Pipeline 1 so the artist reviews captions against the real art, and make Step 7B *ride* that art to its nested pose instead of re-importing it.

**Architecture:** Step 6 embeds each element's art PNG on the `Sticker` layer (beneath the Cutlines layer, so cut + caption draw on top). A single shared `aiUtils` routine does the placement. Step 7B stops importing art — it finds the Step-6 art by name and transforms it in lockstep with its cutline (the same mechanism the native caption already rides), and hard-errors if the art is genuinely absent.

**Tech Stack:** ExtendScript (ES3) for Adobe Illustrator/Photoshop; bash + `osascript` integration test runners; Node.js for pure-function unit tests.

## Global Constraints

- ExtendScript is **ES3**: no `let`/`const`, no arrow functions, no template literals. Wrap any new `main()`-level work in try/catch (not needed for the step functions here).
- Step files export phase functions only; **no `#target`, no `CONFIG`, no `main()`**. All shared functions live in `utils/aiUtils.jsx`. Log prefix per file: `[step6]`, `[step-nest]`, `[aiutils]`.
- Art registration scale is the **absolute** `72 / sourceDPI` pt-per-px factor — the same factor Step 6 uses to place the silhouette. Never height-fit.
- **Hard-error over fallback; never silently drop.** Missing art at Step 7B is a hard error (no re-import). Missing art at Step 6 is a warn-and-continue (review aid, not a gate).
- Art must live on the `Sticker` layer (exact name, singular) — it is a separate deliverable Step 10/11 export from there. Do **not** make it a cutline-group member.
- Golden/log tests: never hand-author coordinates; regenerate by running the real entry point (run twice for determinism) and review the diff before committing.

---

## File Structure

- `utils/aiUtils.jsx` — **add** `artFactorFromData`, `findArtByName`, `placeArtEmbedded` (shared art helpers). Remove `_nestArtFactor` from Step 7B (superseded by `artFactorFromData`).
- `illustrator/Step6_CreateCutlines.jsx` — **add** an art-placement pass at the end of `runCreateCutlines` + a private `_artFolderFromElementsPath` helper.
- `illustrator/Step7B_NestingImport.jsx` — **modify** `runNestingImport` (remove the entry art-clear; add a pre-transform art-present verification) and `_nestProcessSingleSvg` (find art instead of importing it); **delete** `_nestPlaceArtUpright` and `_nestArtFactor`.
- `tests/integration/unit/test-art-factor.js` + `run-test-art-factor.sh` — **new** node unit test for `artFactorFromData`.
- `tests/integration/ps-build-elements/run.sh` — **add** a Phase-2 assertion that review art landed on `Sticker`.
- `tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting.ai` — **regenerate** (augment) so its `Sticker` layer carries the embedded art the new Step 7B expects.
- `tests/integration/ai-import-nesting/expected.txt` — **regenerate** golden after the Step 7B change.

---

## Task 1: Shared art helpers in aiUtils

**Files:**
- Modify: `utils/aiUtils.jsx` (add three functions near the other art/placement helpers)
- Create: `tests/integration/unit/test-art-factor.js`
- Create: `tests/integration/unit/run-test-art-factor.sh`

**Interfaces:**
- Produces:
  - `artFactorFromData(elementsData, fallbackDpi)` → Number (pt per PSD px; `0` when unusable). Pure — no `log`, so node-testable.
  - `findArtByName(stickersLayer, displayName)` → RasterItem|PlacedItem|`null` (direct children only).
  - `placeArtEmbedded(doc, stickersLayer, artFolder, displayName, registerItem, artFactor)` → embedded RasterItem|`null`. `registerItem` is any page item whose `geometricBounds` centre the art registers to.

- [ ] **Step 1: Write the failing unit test**

Create `tests/integration/unit/test-art-factor.js`:

```javascript
// Pure unit test for artFactorFromData (aiUtils.jsx): AI points per PSD pixel = 72/sourceDPI,
// with a fallback DPI when the sidecar omits sourceDPI, and 0 when the data is unusable.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name);
    return m[0];
}
eval(extract('artFactorFromData'));

var fails = 0;
function near(a, b) { return Math.abs(a - b) < 1e-9; }
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

check(near(artFactorFromData({ psdWidth: 1000, sourceDPI: 300 }, 300), 0.24), '300 DPI -> 0.24');
check(near(artFactorFromData({ psdWidth: 1000, sourceDPI: 600 }, 300), 0.12), 'sidecar 600 DPI wins over fallback');
check(near(artFactorFromData({ psdWidth: 1000 }, 72), 1.0), 'fallback DPI used when sidecar omits sourceDPI');
check(artFactorFromData({ sourceDPI: 300 }, 300) === 0, 'no psdWidth -> 0');
check(artFactorFromData(null, 300) === 0, 'null data -> 0');
check(artFactorFromData({ psdWidth: 1000, sourceDPI: 0 }, 0) === 0, 'no usable DPI -> 0');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
```

Create `tests/integration/unit/run-test-art-factor.sh`:

```bash
#!/bin/bash
set -euo pipefail
STEP="art-factor-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "SKIP [$STEP]: node not found."; exit 0; }
if node "$DIR/test-art-factor.js"; then echo "PASS [$STEP]"; else echo "FAIL [$STEP]"; exit 1; fi
```

- [ ] **Step 2: Run it to verify it fails**

Run: `chmod +x tests/integration/unit/run-test-art-factor.sh && tests/integration/unit/run-test-art-factor.sh`
Expected: FAIL — `could not extract artFactorFromData` (function not added yet).

- [ ] **Step 3: Add the three helpers to `utils/aiUtils.jsx`**

Add near the other placement helpers (e.g. just before `buildCaptionPill` or alongside `boundsCenter`):

```javascript
// AI points per PSD pixel = 72 / sourceDPI — the SAME scale Step 6 uses to place the
// silhouette at its source DPI, so art and cutlines are twins at true physical size.
// Reads elementsData.sourceDPI; falls back to fallbackDpi (CONFIG.sourceDPI) when the
// sidecar omits it. Returns 0 when unusable (no psdWidth / no positive DPI). Pure — no
// logging — so it is node-unit-testable.
function artFactorFromData(elementsData, fallbackDpi) {
    if (!elementsData || !elementsData.psdWidth) return 0;
    var dpi = (elementsData.sourceDPI && elementsData.sourceDPI > 0)
        ? elementsData.sourceDPI : fallbackDpi;
    if (!dpi || dpi <= 0) return 0;
    var factor = 72.0 / dpi;
    return factor > 0 ? factor : 0;
}

// Returns the art item on the Stickers layer whose name === displayName, or null.
// Art is EMBEDDED at Step 6 (a RasterItem); a stray linked item (PlacedItem) from an
// older run is matched too. Direct children only — never reaches into a nested group.
function findArtByName(stickersLayer, displayName) {
    if (!stickersLayer) return null;
    var i, it;
    for (i = 0; i < stickersLayer.rasterItems.length; i++) {
        it = stickersLayer.rasterItems[i];
        if (it.parent === stickersLayer && it.name === displayName) return it;
    }
    for (i = 0; i < stickersLayer.placedItems.length; i++) {
        it = stickersLayer.placedItems[i];
        if (it.parent === stickersLayer && it.name === displayName) return it;
    }
    return null;
}

// Places {displayName}.png from artFolder onto the Stickers layer, sized to true physical
// size (artFactor × 100 %), centred on registerItem's geometricBounds, then EMBEDDED so it
// survives the save -> close -> Deepnest -> reopen gap independent of the PNG folder. Names
// it displayName. Returns the embedded RasterItem, or null (logged) when the PNG is missing
// or placement throws. registerItem is the element-art bounds reference (Step 6: the
// "{name} outline" path; Step 7B fallback would use the group's " outline" member).
function placeArtEmbedded(doc, stickersLayer, artFolder, displayName, registerItem, artFactor) {
    var safeName = displayName.replace(/[\/\\:*?"<>|]/g, "_");
    var pngFile  = new File(artFolder.fsName + "/" + safeName + ".png");
    if (!pngFile.exists) {
        log("[aiutils] WARN | art PNG not found for: " + displayName + " (" + pngFile.fsName + ")");
        return null;
    }

    var prevLayer = doc.activeLayer;
    doc.activeLayer = stickersLayer;
    var placed = null;
    try {
        // Layer-scoped add (NOT doc.placedItems.add(), which targets the locked Margin band).
        placed = stickersLayer.placedItems.add();
        placed.file = pngFile;
        placed.name = displayName;
        if (placed.layer !== stickersLayer) {
            placed.move(stickersLayer, ElementPlacement.PLACEATBEGINNING);
        }

        // Size to true AI size = element_px × factor (for a 72-dpi PNG this is a flat
        // factor×100 resize since placed.width == element_px). Centre on the reference bounds.
        placed.resize(artFactor * 100, artFactor * 100);
        var rb = registerItem.geometricBounds;
        var rc = boundsCenter(rb);
        placed.translate(rc.x - (placed.position[0] + placed.width  / 2),
                         rc.y - (placed.position[1] - placed.height / 2));

        var agb = placed.geometricBounds;
        var aW = Math.abs(agb[2] - agb[0]), aH = Math.abs(agb[1] - agb[3]);
        var rW = Math.abs(rb[2] - rb[0]),   rH = Math.abs(rb[1] - rb[3]);
        log("[aiutils] ART-FIT | " + displayName
            + " art=" + Math.round(aW) + "x" + Math.round(aH)
            + " ref=" + Math.round(rW) + "x" + Math.round(rH)
            + " dW=" + Math.round(aW - rW) + " dH=" + Math.round(aH - rH));

        // Embed now: at Step 6 nothing transforms this item afterwards, so the phantom-ref
        // hazard (embed() detaches the PlacedItem ref) does not apply — we do not reuse `placed`.
        placed.embed();
        doc.activeLayer = prevLayer;
        return findArtByName(stickersLayer, displayName);   // the embedded RasterItem
    } catch (e) {
        if (placed) { try { placed.remove(); } catch (e2) {} }
        doc.activeLayer = prevLayer;
        log("[aiutils] WARN | art placement failed for: " + displayName
            + " — line " + e.line + ": " + e.message);
        return null;
    }
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `tests/integration/unit/run-test-art-factor.sh`
Expected: `PASS [art-factor-unit]`

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-art-factor.js tests/integration/unit/run-test-art-factor.sh
git commit -m "feat(ai): shared art helpers — artFactorFromData / findArtByName / placeArtEmbedded

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Step 6 places review art on the Sticker layer

**Files:**
- Modify: `illustrator/Step6_CreateCutlines.jsx` (`runCreateCutlines` naming loop + a new final pass + a private helper)
- Modify: `tests/integration/ps-build-elements/run.sh` (add a Phase-2 assertion)

**Interfaces:**
- Consumes: `artFactorFromData`, `placeArtEmbedded`, `findLayer` (aiUtils); `elementsData` (already read at top of `runCreateCutlines`); `elementsFilePath` (existing param); `CONFIG.sourceDPI`, `CONFIG.stickersLayerName`.
- Produces: `runCreateCutlines` result gains `artPlaced` (Number). Log line `"[step6] review art | placed N / M element(s)"`.

- [ ] **Step 1: Collect art targets in the naming loop**

In `illustrator/Step6_CreateCutlines.jsx`, inside `runCreateCutlines`, declare a collector next to `var named = 0;` (≈ line 139):

```javascript
    var named     = 0;
    var unmatched = 0;
    var droppedFragment = 0;
    var artTargets = [];   // {name, register} per matched element — placed after the loop
    var pi;
```

In the **captioned** branch, immediately after `path.name = matched.displayName + " outline";` (≈ line 181) add:

```javascript
            artTargets.push({ name: matched.displayName, register: path });
```

In the **uncaptioned** branch, immediately after `path.name = matched.displayName + " outline";` (≈ line 205) add:

```javascript
            artTargets.push({ name: matched.displayName, register: path });
```

- [ ] **Step 2: Add the placement pass + folder helper**

Still in `runCreateCutlines`, replace the final block:

```javascript
    var droppedJunk = droppedBackground + droppedFragment;
    log("[step6] done | named=" + named + " unmatched=" + unmatched
        + " dropped=" + droppedJunk);
    return { named: named, unmatched: unmatched, dropped: droppedJunk,
             traceTuning: traceTuning };
```

with:

```javascript
    // ── 7. Place review art on the Stickers layer ─────────────────────────────
    // Show each element's art beneath the cutlines so the artist reviews captions
    // against the real sticker. Art is EMBEDDED here (survives the save -> Deepnest ->
    // reopen gap) and Step 7B rides these same items to their nested pose — it does NOT
    // re-import. Missing PNG is a warn (review aid), not a gate — the element still has
    // its cutline + caption.
    var artPlaced = 0;
    if (!CONFIG.dryRun) {
        var artFolder     = _artFolderFromElementsPath(elementsFilePath);
        var stickersLayer = findLayer(doc, CONFIG.stickersLayerName);
        var artFactor     = artFactorFromData(elementsData, CONFIG.sourceDPI);
        if (!stickersLayer) {
            log("[step6] WARN | Stickers layer not found — review art not placed.");
        } else if (!artFolder || !artFolder.exists) {
            log("[step6] WARN | art folder not found ("
                + (artFolder ? artFolder.fsName : "null") + ") — review art not placed.");
        } else if (artFactor <= 0) {
            log("[step6] WARN | unusable art factor — review art not placed.");
        } else {
            var at;
            for (at = 0; at < artTargets.length; at++) {
                if (placeArtEmbedded(doc, stickersLayer, artFolder,
                        artTargets[at].name, artTargets[at].register, artFactor)) {
                    artPlaced++;
                }
            }
        }
        log("[step6] review art | placed " + artPlaced + " / " + artTargets.length + " element(s)");
    }

    var droppedJunk = droppedBackground + droppedFragment;
    log("[step6] done | named=" + named + " unmatched=" + unmatched
        + " dropped=" + droppedJunk);
    return { named: named, unmatched: unmatched, dropped: droppedJunk,
             artPlaced: artPlaced, traceTuning: traceTuning };
```

Add the private helper near the other private helpers at the bottom of the file (e.g. after `_readElementsFile`):

```javascript
// Derives the per-element art PNG folder ({base}_elements) that sits beside the sidecar
// (written by PS exportElementPngs). Returns a Folder (may not exist — caller checks).
function _artFolderFromElementsPath(elementsFilePath) {
    var f    = new File(elementsFilePath);
    var base = f.name.replace(/_elements\.json$/i, "").replace(/\.json$/i, "");
    return new Folder(f.parent.fsName + "/" + base + "_elements");
}
```

- [ ] **Step 3: Add the Phase-2 assertion to the ps-build-elements runner**

In `tests/integration/ps-build-elements/run.sh`, find the block that asserts the working `.ai` was saved:

```bash
# Handoff saved the working doc (regression guard for the Untitled bug).
if grep -q "working document saved:" "$LOG_AI" && [ -f "$WORKING_AI" ]; then
    echo "  PASS: working .ai saved ($(basename "$WORKING_AI"))."
else
    echo "FAIL [$STEP]: working .ai not saved ($WORKING_AI)."; FAIL=1
fi
```

Immediately **after** it, add:

```bash
# Review art: Step 6 embeds each element's art on the Sticker layer so the artist reviews
# captions against the real art (Step 7B later rides these same items — it no longer imports).
if grep -qE "\[step6\] review art \| placed [1-9][0-9]* / [0-9]+ element" "$LOG_AI"; then
    echo "  PASS: review art placed on Sticker ($(grep -oE 'review art \| placed [0-9]+ / [0-9]+ element' "$LOG_AI" | head -1))."
else
    echo "FAIL [$STEP]: review art not placed on Sticker."
    grep "review art" "$LOG_AI" || true; FAIL=1
fi
```

- [ ] **Step 4: Run the ps-build-elements integration test (requires Photoshop + Illustrator)**

Run: `tests/integration/ps-build-elements/run.sh`
Expected: all existing PASS lines **plus** `PASS: review art placed on Sticker (review art | placed 27 / 27 element(s))` (count = the fixture's element count; any count ≥ 1 with `placed == total` passes). The PS-log golden (`expected.txt`) is unaffected — the new logging is on the **AI** side.

If the runner prints the golden NOTE/skip for Phase 1, that is the pre-existing PS-golden workflow and is unrelated to this change.

- [ ] **Step 5: Commit**

```bash
git add illustrator/Step6_CreateCutlines.jsx tests/integration/ps-build-elements/run.sh
git commit -m "feat(ai): Step 6 embeds per-element review art on the Sticker layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Augment the ai-import-nesting fixture with embedded art

The committed fixture `.ai` predates this change: its `Sticker` layer is empty (art used to be
placed by Step 7B). The new Step 7B requires the art to be present, so the fixture must carry it.
Rather than fully regenerate (which would invalidate the committed `_nested.svg` layouts), open the
existing fixture and add the embedded art with the shared helper — preserving every cutline and SVG.

**Files:**
- Create (temporary, not committed): `/tmp/augment-import-fixture.jsx`
- Modify (regenerate): `tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting.ai`

**Interfaces:**
- Consumes: `placeArtEmbedded`, `findGroupMember`, `findLayer` (aiUtils, from Task 1).

- [ ] **Step 1: Write the one-off augmentation script**

Create `/tmp/augment-import-fixture.jsx`:

```javascript
#target illustrator
#include "REPO_ROOT/utils/aiUtils.jsx"
// Adds embedded art to the ai-import-nesting fixture's Sticker layer — mimicking what the
// new Step 6 produces — without touching cutlines or SVGs. Registers each art to its
// cutline group's " outline" member (the fixture cutlines are assembled Pipeline-2 groups).
var CONFIG = { stickersLayerName: "Sticker", cutlinesLayerName: "Cutlines", sourceDPI: 300 };
(function () {
    var FIX = "REPO_ROOT/tests/integration/ai-import-nesting/fixtures/import-nesting";
    var doc = app.open(new File(FIX + "/import-nesting.ai"));
    var elemFile = new File(FIX + "/import-nesting_elements.json");
    elemFile.encoding = "UTF-8"; elemFile.open("r");
    var data = JSON.parse(elemFile.read()); elemFile.close();
    var factor = artFactorFromData(data, CONFIG.sourceDPI);
    var artFolder  = new Folder(FIX + "/import-nesting_elements");
    var cut = findLayer(doc, CONFIG.cutlinesLayerName);
    var stk = findLayer(doc, CONFIG.stickersLayerName);
    // Clear any stray Sticker items first (idempotent re-run of this augmentation).
    var pi;
    for (pi = stk.placedItems.length - 1; pi >= 0; pi--) stk.placedItems[pi].remove();
    for (pi = stk.rasterItems.length - 1; pi >= 0; pi--) stk.rasterItems[pi].remove();
    var placed = 0, i, item, reg;
    for (i = 0; i < cut.groupItems.length; i++) {
        item = cut.groupItems[i];
        if (item.parent !== cut) continue;
        reg = findGroupMember(item, " outline") || item;
        if (placeArtEmbedded(doc, stk, artFolder, item.name, reg, factor)) placed++;
    }
    for (i = 0; i < cut.pathItems.length; i++) {            // stamps: bare paths
        item = cut.pathItems[i];
        if (item.parent !== cut) continue;
        if (placeArtEmbedded(doc, stk, artFolder, item.name, item, factor)) placed++;
    }
    doc.saveAs(new File(FIX + "/import-nesting.ai"), new IllustratorSaveOptions());
    $.writeln("augmented: placed " + placed + " art item(s)");
})();
```

Replace `REPO_ROOT` with the absolute repo path before running (the augmentation is a throwaway, so an inline sed is fine):

```bash
REPO_ROOT="$(pwd)"
sed "s|REPO_ROOT|$REPO_ROOT|g" /tmp/augment-import-fixture.jsx > /tmp/augment-import-fixture.run.jsx
```

- [ ] **Step 2: Run it (requires Illustrator) and verify art landed**

```bash
osascript -e 'tell application "Adobe Illustrator" to do javascript file (POSIX file "/tmp/augment-import-fixture.run.jsx")'
```

Then verify the fixture now has embedded art on `Sticker` — run this probe and confirm a non-zero count:

```bash
cat > /tmp/probe-fixture-art.jsx <<'JS'
var d = app.open(new File("REPO_ROOT/tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting.ai"));
var s = null, i; for (i=0;i<d.layers.length;i++) if (d.layers[i].name==="Sticker") s=d.layers[i];
var res = "Sticker rasterItems=" + s.rasterItems.length + " placedItems=" + s.placedItems.length;
d.close(SaveOptions.DONOTSAVECHANGES); res;
JS
sed -i '' "s|REPO_ROOT|$REPO_ROOT|g" /tmp/probe-fixture-art.jsx
osascript -e 'tell application "Adobe Illustrator" to do javascript file (POSIX file "/tmp/probe-fixture-art.jsx")'
```

Expected: `Sticker rasterItems=<N>` where N equals the number of cutlines in the fixture (all embedded, `placedItems=0`).

- [ ] **Step 3: Commit the regenerated fixture**

```bash
git add tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting.ai
git commit -m "test(fixture): embed per-element art on the import-nesting fixture Sticker layer

Matches the new Pipeline 1 output (Step 6 places art); required by the Step 7B
ride-the-art change. Cutlines and nested SVGs are unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Step 7B rides the Step-6 art instead of importing it

**Files:**
- Modify: `illustrator/Step7B_NestingImport.jsx` (`runNestingImport`, `_nestProcessSingleSvg`; delete `_nestPlaceArtUpright` and `_nestArtFactor`)
- Regenerate: `tests/integration/ai-import-nesting/expected.txt`

**Interfaces:**
- Consumes: `artFactorFromData`, `findArtByName`, `scriptAlert`, `log` (aiUtils). The fixture from Task 3 (art present on `Sticker`).
- Produces: unchanged `runNestingImport` return contract (`{ matched, unmatched, artPlaced, ... }`); `artPlaced` now counts art *found + ridden* rather than imported. Same `"art placed: N"` result string (test-compatible).

- [ ] **Step 1: Repoint the art factor to the shared helper**

In `runNestingImport` (≈ line 57), replace:

```javascript
    var artFactor = _nestArtFactor(elementsData);
```

with:

```javascript
    var artFactor = artFactorFromData(elementsData, CONFIG.sourceDPI);
```

- [ ] **Step 2: Remove the entry art-clear (the art we ride lives on Sticker)**

Delete the whole re-run art-clear block (≈ lines 69–88):

```javascript
    // Re-run safety: clear any previously placed artwork so it doesn't stack. Art is now
    // EMBEDDED at placement (rasterItems) for a portable handoff, so the clear must sweep
    // BOTH collections: rasterItems (embedded art, the norm) AND placedItems (a stray
    // linked item from an older run or a partial embed). Clearing only placedItems would
    // let embedded art DUPLICATE on every re-run.
    if (stickersLayer && !CONFIG.dryRun) {
        var cleared = 0;
        var pi;
        for (pi = stickersLayer.placedItems.length - 1; pi >= 0; pi--) {
            stickersLayer.placedItems[pi].remove();
            cleared++;
        }
        for (pi = stickersLayer.rasterItems.length - 1; pi >= 0; pi--) {
            stickersLayer.rasterItems[pi].remove();
            cleared++;
        }
        if (cleared > 0) {
            log("[step-nest] cleared " + cleared + " previously placed art item(s) (re-run).");
        }
    }
```

Replace it with a comment (no clearing — the art is the thing we transform):

```javascript
    // Art is placed + embedded once at Step 6; Step 7B RIDES it to the nested pose (it does
    // NOT clear or re-import). Re-run safety comes from the transform being convergent — the
    // rotation is a delta from the cutline's current orientation (see _nestComputeRotation)
    // and the same matrix is applied to cut and art, so a second run leaves both in place.
```

- [ ] **Step 3: Add a pre-transform art-present check (hard error, no fallback)**

In `runNestingImport`, right after the cutline map is built and counted (after the
`log("[step-nest] found " + totalCutlines + " cutline(s) ...")` line, ≈ line 100), add:

```javascript
    // Precondition: Step 6 embedded each element's art on the Stickers layer. Verify every
    // cutline has its art BEFORE any transform runs, so a missing item is a clean hard error
    // rather than a half-nested sheet. No fallback re-import (see the review-art design).
    if (!CONFIG.dryRun && stickersLayer) {
        var missingArt = [], mk;
        for (mk in cutlineMap) {
            if (!findArtByName(stickersLayer, mk)) missingArt.push(mk);
        }
        if (missingArt.length > 0) {
            log("[step-nest] ERROR | art missing on Stickers for: " + missingArt.join(", "));
            scriptAlert("❌ Nesting import aborted — art is missing for "
                + missingArt.length + " element(s):\n\n  • " + missingArt.join("\n  • ")
                + "\n\nThese should have been placed in Pipeline 1 (Step 6). Re-run Pipeline 1"
                + " to regenerate the art, then try again.");
            return null;
        }
    }
```

- [ ] **Step 4: Find the art instead of importing it**

In `_nestProcessSingleSvg`, replace the art-binding block (≈ lines 448–455):

```javascript
        artItem = null;
        if (stickersLayer && artFolder) {
            artItem = _nestPlaceArtUpright(doc, stickersLayer, artFolder, cutlineItem, artFactor);
            if (artItem) artPlaced++;
            // The native caption (white pill + text + GC plate) is a MEMBER of the cutline
            // group now, so it rides every nest transform automatically with the cut — no
            // separate placement/binding needed (Pipeline 2 built it into the group).
        }
```

with:

```javascript
        // Art was placed + embedded at Step 6 and verified present above. Find it and pair it
        // AS-IS: it is already in the correct relative position to the cut (registered at Step 6,
        // moved only WITH the cut since), so the shared transform matrix keeps them aligned and
        // re-run-convergent — no re-import, no upright reset. (The native caption is a cutline-
        // group member, so it rides the cut automatically.)
        artItem = null;
        if (stickersLayer) {
            artItem = findArtByName(stickersLayer, cutlineItem.name);
            if (artItem) artPlaced++;
        }
```

- [ ] **Step 5: Delete the now-dead helpers**

Delete `_nestArtFactor` (≈ lines 862–870) — superseded by `artFactorFromData`.

Delete `_nestPlaceArtUpright` in full (≈ lines 1372–1449) — the only caller is gone, and there is no fallback by design. Verify no other references remain:

Run: `grep -n "_nestPlaceArtUpright\|_nestArtFactor" illustrator/Step7B_NestingImport.jsx`
Expected: no output.

- [ ] **Step 6: Run the ai-import-nesting integration test to regenerate the golden (requires Illustrator)**

Run: `tests/integration/ai-import-nesting/run.sh`
Expected on this first post-change run: it prints the golden NOTE and skips the diff. The log changed in exactly these ways — the `cleared … art (re-run)` line is **gone** (no entry clear); Step 7B's per-element `ART-FIT` lines are **gone** (placement moved to Step 6); the `embed | N embedded` line now reads `embed | 0 embedded / 0 failed` (art already embedded → `placedItems` empty). Everything else remains: `art placed: N`, `unmatched: 0`, `art-layer-check … ok`, `art-pos-check … ok`, `art-rot-reconcile …`, and per-element rotation `VERIFY`. Confirm the live PASS lines:
- `PASS [ai-import-nesting]: no unmatched parts.`
- `PASS [ai-import-nesting]: <N> artwork PNG(s) placed.` (N = element count)
- `PASS [ai-import-nesting]: all rotations verified ...`
- `PASS [ai-import-nesting]: artwork on Stickers layer.`
- `PASS [ai-import-nesting]: art co-located with cutlines.`

- [ ] **Step 7: Run a second time for determinism, then accept the golden**

Run: `tests/integration/ai-import-nesting/run.sh`
Compare the two `/tmp/AI_ImportNesting.log` normalised outputs are identical (the runner does this against `expected.txt`; on the first run it wrote a candidate). Once stable, accept:

```bash
cp /tmp/AI_ImportNesting.log tests/integration/ai-import-nesting/expected.txt   # only if the runner does not auto-write; otherwise follow its printed cp hint
```

Re-run once more:
Run: `tests/integration/ai-import-nesting/run.sh`
Expected: `PASS [ai-import-nesting]: log matches golden.` (or the runner's equivalent diff-pass line).

- [ ] **Step 8: Commit**

```bash
git add illustrator/Step7B_NestingImport.jsx tests/integration/ai-import-nesting/expected.txt
git commit -m "refactor(ai): Step 7B rides Step-6 art instead of re-importing it

Finds the embedded art by name and transforms it in lockstep with the cutline
(same mechanism the native caption uses); hard-errors if art is absent. Removes the
entry art-clear, _nestPlaceArtUpright, and _nestArtFactor. Golden regenerated.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manual validation checklist (cannot be verified headless)

Run on a real SKU in Illustrator and confirm:

- [ ] At the end of Pipeline 1 the artist sees **art beneath the cutlines and caption text** on the review sheet (art on `Sticker`, over the green Color Block).
- [ ] After Pipeline 2 + Deepnest + `AI_ImportNesting`, art is at the **nested position + rotation** for every element, co-located with its cutline (no detachment, no upright-under-rotated-cut).
- [ ] Re-running `AI_ImportNesting` on the already-nested doc leaves art in place (converges) — no drift, no duplication.
- [ ] **Hard-error path:** delete one art item from the `Sticker` layer, then run `AI_ImportNesting` — confirm it aborts before any transform, the alert names that element, and the log shows `[step-nest] ERROR | art missing on Stickers for: <name>`.
- [ ] **Manual nest/scale loop:** if the artist hand-*scales* an element, confirm whether the `Sticker` art needs to be selected with the cut to scale together (art now lives on `Sticker` from Step 6). If this is a problem in practice, file a follow-up — the automated Deepnest path (rotate+translate only) is unaffected.
- [ ] Step 10/11 export still finds art on `Sticker` and ships the final file correctly (embedded art, not linked).
