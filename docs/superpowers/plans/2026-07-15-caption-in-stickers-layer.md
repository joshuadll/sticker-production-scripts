# Caption Artwork → Stickers Layer (shipped final file) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the shipped `{STK}_final.ai`, move the visible printed caption/tab artwork (white pill, text, GC raster, tab fill) out of the Cutlines groups and onto the Stickers layer, so the cutting machine (which cuts every visible path in Cutlines/Halfcut) no longer cuts it.

**Architecture:** A new private helper in `Step11_FinalFile.jsx` runs on the final-file copy after the layer strip and before the final save. For each Cutlines `GroupItem` it keeps the one member equal to `group.name` (the fused, stroked-&-unfilled cut path) plus hidden helpers, and moves every other visible child into a `{name} caption` group at the top of the Stickers layer. `move()` preserves absolute position, so each caption stays exactly inside the cut that traces it — no re-transform. Working file and all earlier steps are untouched.

**Tech Stack:** ExtendScript (ES3, `#target illustrator`). No headless test runner exists for ExtendScript; the test is the live `ai-export-final` integration runner (osascript → Illustrator) plus a golden log diff.

## Global Constraints

- Language: ExtendScript ES3 — no `let`/`const`, no arrow functions, no template literals. (`CLAUDE.md`)
- Step files export phase functions only; they assume `CONFIG` and utils are already in scope. No `#target`/`CONFIG`/`main()` in step files. (`CLAUDE.md`)
- Log prefix for Step 11 lines is `[step11]`. (`CLAUDE.md`)
- Hard-error over fallback; never silently drop — warn on all. (memory: working-preferences)
- Cutter rule (settled): the machine cuts **visible** paths in Cutlines/Halfcut and **ignores hidden** ones. Only visible printed items must move; hidden helpers stay. (spec)
- Scope (settled): **shipped `{STK}_final.ai` only**. Do NOT change the working file, Steps 6/7B/8b/10, or caption smoothing. (spec)
- Layer names in scope: `CONFIG.stickersLayerName = "Sticker"`, `CONFIG.cutlinesLayerName = "Cutlines"` (both defined in `pipelines/AI_ExportFinal.jsx`). (verified)
- Available utils (in scope via aiUtils `#include`): `findLayer(doc, name)`, `findGroupMember(group, suffix)`, `log(msg)`. (verified)
- Golden test discipline: NEVER hand-author golden content; regenerate live and run **2×** for determinism before committing. (memory: feedback-test-fixtures)

---

### Task 1: Add the runner assertion for the relocation (the failing test)

Write the test first: assert the export log contains the relocation line and does **not** contain the "printed item left in Cutlines" regression marker. Against current code this FAILS (the line does not exist yet).

**Files:**
- Modify: `tests/integration/ai-export-final/run.sh` (insert a new assertion block after the existing `[step11] done` check, before the golden diff section)

**Interfaces:**
- Consumes: the run log at `$LOG` (`/tmp/AI_ExportFinal.log`), already populated by the osascript run earlier in the script.
- Produces: nothing consumed by later tasks (shell assertions only).

- [ ] **Step 1: Add the assertion block**

In `tests/integration/ai-export-final/run.sh`, find the block that ends with:

```bash
if grep -q "\[step11\] done |" "$LOG"; then
    echo "PASS [$STEP]: reached Step 11 (final file)."
else
    echo "FAIL [$STEP]: pipeline did not reach '[step11] done' — export halted early."
    FAIL=1
fi
```

Immediately AFTER that `fi`, insert:

```bash
# ── Verify caption artwork was relocated OFF the Cutlines layer ────────────────
# The cutter cuts every VISIBLE path in Cutlines/Halfcut, so the printed caption
# (pill/text/GC raster/tab fill) must be moved to the Stickers layer in the final
# file. Step 11 logs a relocation summary and an advisory marker if any printed item
# was wrongly left behind.
if grep -q "\[step11\] captions relocated to Stickers |" "$LOG"; then
    echo "PASS [$STEP]: caption artwork relocated to Stickers layer."
else
    echo "FAIL [$STEP]: '[step11] captions relocated to Stickers |' not found in log."
    FAIL=1
fi

if grep -q "PRINTED ITEM LEFT IN CUTLINES" "$LOG"; then
    echo "FAIL [$STEP]: a printed item was left on the Cutlines layer (would be cut)."
    FAIL=1
fi
```

- [ ] **Step 2: Run the test to verify it fails**

Requires live Adobe Illustrator + the fixture at `tests/integration/ai-export-final/fixtures/step8c-cutlines.ai`.

Run: `tests/integration/ai-export-final/run.sh`
Expected: `FAIL [ai-export-final]: '[step11] captions relocated to Stickers |' not found in log.` (the relocation code does not exist yet)

If no Illustrator/fixture is available in this environment, mark this step as verified-by-inspection: the grep target string is emitted only by the code added in Task 2, so it cannot match current `main`.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ai-export-final/run.sh
git commit -m "test(step11): assert caption artwork relocated off Cutlines layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Implement the relocation helper + call site

**Files:**
- Modify: `illustrator/Step11_FinalFile.jsx` — add call in `runFinalFile` (after the layer-strip loop, before the final `fd.saveAs`), and add two private helpers in the "PRIVATE HELPERS" section.

**Interfaces:**
- Consumes: `findLayer`, `findGroupMember`, `log` (aiUtils); `CONFIG.stickersLayerName`, `CONFIG.cutlinesLayerName`.
- Produces:
  - `_s11MoveCaptionsToStickers(fd)` → `{ elements: N, items: M }`. Moves visible non-cut children of each Cutlines group into a `{name} caption` group on Stickers. Throws if the Stickers layer is missing.
  - `_s11AssertNoPrintedInCutlines(cutlinesLayer)` → `Number` (count of offenders). Logs a `PRINTED ITEM LEFT IN CUTLINES` marker if any visible non-cut child remains in a Cutlines group.

- [ ] **Step 1: Add the call site in `runFinalFile`**

In `illustrator/Step11_FinalFile.jsx`, the strip loop ends at:

```javascript
    var layerCount = fd.layers.length;
    if (layerCount !== 3) {
        log("[step11] WARN | expected 3 layers in final file, found " + layerCount
            + " — check final file manually.");
    }
```

Immediately BEFORE that `var layerCount` line, insert:

```javascript
    // Move VISIBLE printed caption/tab artwork out of the Cutlines groups onto the
    // Stickers layer. The cutter cuts every visible path in Cutlines/Halfcut, so the
    // printed pill/text/GC-raster/tab-fill must not live there. Final copy only; move()
    // preserves absolute position, so each caption stays exactly inside its cut.
    _s11MoveCaptionsToStickers(fd);

```

- [ ] **Step 2: Add the private helpers**

In `illustrator/Step11_FinalFile.jsx`, in the `// ─── PRIVATE HELPERS ───` section (after `_s11FindHalfcutLayer` / `_s11InList`), append:

```javascript
// Relocates each element's VISIBLE printed caption/tab artwork (white pill, text, GC
// raster, default-tab fill) out of the Cutlines groups and onto the Stickers layer, so
// the cutter (which cuts every VISIBLE path in Cutlines/Halfcut) never cuts it. Runs on
// the FINAL-FILE copy only, after all transforms — move() preserves absolute artwork
// coordinates, so each caption stays exactly inside the cut that traces it. The fused
// cut path (the one member named === group.name) and hidden helpers stay in Cutlines.
// Returns { elements: N, items: M }.
function _s11MoveCaptionsToStickers(fd) {
    var stickersLayer = findLayer(fd, CONFIG.stickersLayerName);
    if (!stickersLayer) {
        // Hard error, no fallback: printed art needs a home layer that isn't cut.
        throw new Error("Stickers layer '" + CONFIG.stickersLayerName
            + "' not found — cannot relocate printed caption artwork.");
    }
    var cutlinesLayer = findLayer(fd, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step11] WARN | Cutlines layer '" + CONFIG.cutlinesLayerName
            + "' not found — no caption relocation.");
        return { elements: 0, items: 0 };
    }

    // Snapshot groups first — moving items mutates the live pageItems collection.
    var groups = [], i;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        if (cutlinesLayer.pageItems[i].typename === "GroupItem") {
            groups.push(cutlinesLayer.pageItems[i]);
        }
    }

    var elementsMoved = 0, itemsMoved = 0, g, c;
    for (g = 0; g < groups.length; g++) {
        var group   = groups[g];
        var cutPath = findGroupMember(group, "");   // member named exactly group.name

        // Collect VISIBLE, non-cut children (front-to-back). Hidden helpers stay put.
        var movers = [];
        for (c = 0; c < group.pageItems.length; c++) {
            var child = group.pageItems[c];
            if (child === cutPath) continue;
            if (child.hidden) continue;
            movers.push(child);
        }
        if (!movers.length) continue;

        // Wrap in a "{name} caption" group at the TOP of Stickers (above all art),
        // preserving the movers' relative z-order.
        var capGroup = stickersLayer.groupItems.add();
        capGroup.name = group.name + " caption";
        capGroup.move(stickersLayer, ElementPlacement.PLACEATBEGINNING);
        // Iterate back-to-front, each move to the FRONT, so the original front-most item
        // ends up front-most (moving front-to-back to the end would reverse the order).
        for (c = movers.length - 1; c >= 0; c--) {
            movers[c].move(capGroup, ElementPlacement.PLACEATBEGINNING);
            itemsMoved++;
        }
        elementsMoved++;
    }

    // Advisory post-move check (warn-on-all): every remaining visible item in a Cutlines
    // group must be its cut path. A leftover visible non-cut child is a printed item the
    // cutter would cut — surface it (does not abort).
    _s11AssertNoPrintedInCutlines(cutlinesLayer);

    log("[step11] captions relocated to Stickers | " + elementsMoved
        + " element(s), " + itemsMoved + " item(s)");
    return { elements: elementsMoved, items: itemsMoved };
}

// Walks each Cutlines GroupItem and logs any VISIBLE child that is not the group's cut
// path (the member named === group.name). Advisory — logs a marker, does not throw.
// Returns the offender count.
function _s11AssertNoPrintedInCutlines(cutlinesLayer) {
    var offenders = [], i, c;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        var it = cutlinesLayer.pageItems[i];
        if (it.typename !== "GroupItem") continue;
        var cutPath = findGroupMember(it, "");
        for (c = 0; c < it.pageItems.length; c++) {
            var m = it.pageItems[c];
            if (m === cutPath) continue;
            if (!m.hidden) {
                offenders.push((it.name || "(group)") + "/" + (m.name || "(unnamed)"));
            }
        }
    }
    if (offenders.length) {
        log("[step11] *** PRINTED ITEM LEFT IN CUTLINES *** | " + offenders.join(", "));
    }
    return offenders.length;
}
```

- [ ] **Step 3: Verify ES3 + scope by inspection**

Confirm by reading the diff:
- No `let`/`const`/arrow/template-literal used (all `var`, string `+` concatenation). ✓ required by Global Constraints.
- `findLayer`, `findGroupMember`, `log`, `CONFIG.stickersLayerName`, `CONFIG.cutlinesLayerName`, `ElementPlacement` are all in scope (aiUtils `#include` + AI_ExportFinal CONFIG + Illustrator global enum).
- The call site sits after the strip loop and before `var layerCount` (so it runs on the stripped 3-layer final copy) and before the final `fd.saveAs`.

(ExtendScript has no headless runner — `node --check` rejects `.jsx`. Correctness is verified by the live integration run in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add illustrator/Step11_FinalFile.jsx
git commit -m "feat(step11): relocate caption artwork to Stickers layer in final file

The cutter cuts every visible path in Cutlines/Halfcut; the native caption
(pill/text/GC raster) and default-tab fill lived in the Cutlines groups and
were being cut. Move every visible non-cut child of each Cutlines group into a
'{name} caption' group on Stickers, preserving absolute position and z-order.
Fused cut path and hidden helpers stay. Shipped final file only.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Live validation + golden regen (requires Adobe Illustrator)

This runs only against live Illustrator with the fixture. Do NOT hand-edit `expected.txt`.

**Files:**
- Modify: `tests/integration/ai-export-final/expected.txt` (regenerated, not hand-authored)

**Interfaces:**
- Consumes: the code from Task 2 and the assertion from Task 1.
- Produces: an updated golden log the runner diffs against.

- [ ] **Step 1: Run the integration test (first pass)**

Run: `tests/integration/ai-export-final/run.sh`
Expected: the new `PASS [ai-export-final]: caption artwork relocated to Stickers layer.` line appears; the run reaches `[step11] done`; the golden diff FAILS because `expected.txt` lacks the new `[step11] captions relocated to Stickers | …` line.

- [ ] **Step 2: Manually verify the produced final file**

Open `$HOME/.ai-export-final-test/ai-export-final-fixture_export/ai-export-final-fixture_final.ai` and confirm:
1. The **Cutlines** layer's element groups contain only the cut contour (+ hidden helpers) — no visible pill/text/raster/tab-fill.
2. The **Sticker** layer gained one `{name} caption` group per captioned element, each visually unchanged (pill behind raster behind text, sitting above the art).
3. The fused cut still traces the pill (peel tab intact); the Halfcut layer is unchanged.

- [ ] **Step 3: Run a second time to confirm determinism**

Run: `tests/integration/ai-export-final/run.sh`
Expected: same relocation counts in the log as the first pass (element/item counts identical). If they differ, STOP and investigate before regenerating the golden.

- [ ] **Step 4: Regenerate the golden**

Run (uses the runner's own normalization of the `$HOME` workdir path to `<out>/`):

```bash
sed "s#$HOME/.ai-export-final-test/#<out>/#g" /tmp/AI_ExportFinal.log > tests/integration/ai-export-final/expected.txt
```

- [ ] **Step 5: Verify the test now passes against the new golden**

Run: `tests/integration/ai-export-final/run.sh`
Expected: `PASS [ai-export-final]` (golden diff clean).

- [ ] **Step 6: Commit**

```bash
git add tests/integration/ai-export-final/expected.txt
git commit -m "test(step11): regenerate ai-export-final golden for caption relocation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Helper `_s11MoveCaptionsToStickers(fd)` in Step 11, called after strip / before final save → Task 2 (call site + helper). ✓
- Keep cut path + hidden helpers; move visible non-cut children → Task 2 `movers` loop. ✓
- Wrap in `{name} caption` group at top of Stickers, preserve z-order → Task 2 (back-to-front PLACEATBEGINNING). ✓
- Alignment via position-preserving `move()` → Task 2 (no transform applied). ✓
- Post-move advisory assertion (warn-on-all) → Task 2 `_s11AssertNoPrintedInCutlines`. ✓
- Edge cases: no captions (no-op — `movers.length` guard); default tabs (`tab fill` visible → moved; hidden plate stays); bare stamps (not GroupItems — skipped); missing Stickers layer (hard error). All in Task 2. ✓
- Testing: golden log update + runner assertion, live regen 2× → Tasks 1 + 3. ✓
- Out of scope (smoothing, working-file structure, Steps 6/7B/8b/10) — no task touches them. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". All code shown in full. ✓

**3. Type consistency:** `_s11MoveCaptionsToStickers` and `_s11AssertNoPrintedInCutlines` named identically at definition and call site; `findGroupMember(group, "")` matches aiUtils signature (`findGroupMember(group, suffix)`); `CONFIG.stickersLayerName`/`cutlinesLayerName` match `AI_ExportFinal.jsx`. Runner grep string `"[step11] captions relocated to Stickers |"` matches the `log(...)` output exactly. ✓
