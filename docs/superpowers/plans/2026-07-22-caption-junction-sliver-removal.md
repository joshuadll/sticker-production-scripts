# Caption-Junction Sliver Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the tiny boolean "blob" subpaths the caption-plate Unite leaves at the plate∩art junction, inside `deriveCutline` so they never persist across regeneration.

**Architecture:** A pure, node-testable decision function (`_junctionSliverLeaves`) selects which fused-cut leaves are slivers — every non-largest leaf that does NOT echo a subpath of the art-alone `outline` (genuine art holes are preserved by the `Unite`, so they match; union-invented seam crumbs don't). An Illustrator wrapper (`removeCaptionJunctionSlivers`) enumerates the fused + outline leaf PathItems, computes their centroids/areas, calls the decision function, and removes the flagged leaves. It is called once inside `deriveCutline` after the Unite, so it re-applies at every caption regeneration (Step 6 / 7B / 8b-normalise).

**Tech Stack:** ExtendScript (ES3) for Illustrator; Node.js for pure-geometry unit tests; bash + osascript for the integration runner.

## Global Constraints

- **ES3 only** (`utils/aiUtils.jsx` is `#include`d into Illustrator pipelines): no `let`/`const`, no arrow functions, no template literals, no `Array.prototype` ES5 extras beyond what the file already uses. Copy the style of the surrounding functions.
- `utils/aiUtils.jsx` step/util files have **no `#target`, no `CONFIG`, no `main()`** — `CONFIG` and `log` are globals provided by the pipeline at run time. Guard `CONFIG` access with `typeof CONFIG !== "undefined"`.
- **No junction-distance / area-cap / CONFIG-gate tuning.** The discriminator is "does this leaf echo an outline subpath?" with wide-margin match thresholds (centroid ≤10 pt, area ±25%) that only need to separate real echoes (~0 pt / ~1.0) from slivers (≥20 pt / ~0).
- **Always-on**, **idempotent** (a single-leaf cut is a no-op).
- Log prefix for aiUtils-level lines: `[cutline]`.
- Reuse existing helper — do not reimplement: `boundsCenter`. (The decision needs no polygon sampling or point-in-polygon — it works on each leaf's centroid + bbox area.)
- Node unit-test pattern: read `utils/aiUtils.jsx` as text, regex-`extract` each needed function, `eval` it, test on plain `{x,y}` polygons. Model on `tests/integration/unit/test-halfcut-tail-dir.js`.

---

### Task 1: Pure sliver-selection function (`_junctionSliverLeaves`) — node TDD

**Files:**
- Modify: `utils/aiUtils.jsx` (replace `_junctionSliverLeaves`; add `_matchesAnOutlineLeaf` beside it, ~line 3303)
- Test: `tests/integration/unit/test-junction-slivers.js` (create)
- Test runner: `tests/integration/unit/run-test-junction-slivers.sh` (create)

**NOTE (redesign 2026-07-22):** an earlier version of this task shipped `_junctionSliverLeaves`
with an "overlap" signature `(leaves, platePolys, artPolys)`. Live testing proved that approach
matches zero real slivers (they straddle the seam, so centroids aren't inside both polygons).
This task now REPLACES that committed function with the "compare against the outline" design.
The implementer OVERWRITES the existing `_junctionSliverLeaves` and its test.

**Interfaces:**
- Consumes: nothing from aiUtils (pure — works on plain `{c:{x,y},area}` records).
- Produces:
  - `_junctionSliverLeaves(fusedLeaves, outlineLeaves) -> [Number]` — indices of `fusedLeaves`
    to delete: every index except the max-`area` index that has NO matching outline leaf.
  - `_matchesAnOutlineLeaf(f, outlineLeaves) -> Boolean` — true when `f` echoes some outline
    subpath (centroid within 10 pt AND area ratio within ±25%).
  - `fusedLeaves`/`outlineLeaves = [{ c:{x,y}, area:Number }, ...]`.

- [ ] **Step 1: Rewrite the test (replace the whole file)**

Overwrite `tests/integration/unit/test-junction-slivers.js` with:

```javascript
// Pure-geometry unit test for caption-junction sliver selection (_junctionSliverLeaves in
// aiUtils.jsx). A non-largest fused leaf is a SLIVER (delete) when NO outline subpath matches it
// (centroid within 10pt AND area within +/-25%); a leaf that DOES match an outline subpath is a
// genuine art hole (keep). The largest fused leaf is never deleted. Numbers mirror live data:
// real echoes coincide (dist~0, ratio~1.0); slivers miss (dist>>10, ratio~0).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_matchesAnOutlineLeaf'));
eval(extract('_junctionSliverLeaves'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }
function arrEq(a, b) { return a.length === b.length && a.join(',') === b.join(','); }

// the art-alone trace: main contour + a genuine art hole (like Tram's).
var OUTLINE = [
    { c:{x:365,y:338}, area:14696 },   // art main contour
    { c:{x:510,y:361}, area:299 }      // a genuine art hole
];

// fused: main + the real hole (echoes OUTLINE) + two junction slivers (no echo).
(function () {
    var fused = [
        { c:{x:365,y:332}, area:16145 },   // 0 main contour (largest)            -> keep
        { c:{x:510,y:361}, area:299 },     // 1 echoes the art hole (dist0, r1.0) -> keep
        { c:{x:386,y:287}, area:49 },      // 2 sliver (dist~56, ratio~0.003)     -> doomed
        { c:{x:332,y:286}, area:15 }       // 3 sliver (dist~61, ratio~0.001)     -> doomed
    ];
    var d = _junctionSliverLeaves(fused, OUTLINE);
    check(arrEq(d, [2, 3]), 'slivers doomed; main + real hole kept (got [' + d + '])');
})();

// the LARGEST fused leaf is never doomed, even with no outline match.
(function () {
    var fused = [
        { c:{x:0,y:0}, area:9999 },        // 0 largest, no outline match -> still kept
        { c:{x:400,y:300}, area:20 }       // 1 sliver                    -> doomed
    ];
    var d = _junctionSliverLeaves(fused, OUTLINE);
    check(arrEq(d, [1]), 'largest kept even with no match; sliver doomed (got [' + d + '])');
})();

// a clean cut (every non-largest leaf echoes an outline subpath) -> no-op.
(function () {
    var fused = [
        { c:{x:365,y:332}, area:16145 },   // main (largest)
        { c:{x:510,y:361}, area:299 }      // real hole, matches OUTLINE -> kept
    ];
    var d = _junctionSliverLeaves(fused, OUTLINE);
    check(arrEq(d, []), 'all non-largest leaves matched -> no-op (got [' + d + '])');
})();

// single leaf -> no-op.
(function () {
    var d = _junctionSliverLeaves([{ c:{x:0,y:0}, area:100 }], OUTLINE);
    check(arrEq(d, []), 'single leaf -> no-op (got [' + d + '])');
})();

if (fails === 0) { console.log('PASS: junction-sliver selection'); }
else { console.log(fails + ' FAIL'); process.exit(1); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/integration/unit/test-junction-slivers.js`
Expected: throws `Error: could not extract _matchesAnOutlineLeaf` (the new helper doesn't exist yet — the old `_junctionSliverLeaves` is still the committed overlap version).

- [ ] **Step 3: Replace the implementation**

In `utils/aiUtils.jsx`, DELETE the existing `function _junctionSliverLeaves(leaves, platePolys, artPolys) { ... }` (committed in the prior task, ~line 3303, just before `samplePathToPolygons`) and replace it with these TWO functions:

```javascript
// Selects the fused-cut leaf indices that are caption-junction slivers to delete. A fused leaf is
// REAL (keep) when it echoes a subpath already present in the art-alone `outline` — the plate
// Unite leaves genuine art holes untouched (same centroid, same area). A non-largest fused leaf
// with NO outline match was invented by the union at the pill∩art seam = a sliver (delete). The
// largest fused leaf (the real sticker contour) is never a candidate.
// fusedLeaves / outlineLeaves = [{ c:{x,y}, area:Number }, ...]. Pure; node-testable.
function _junctionSliverLeaves(fusedLeaves, outlineLeaves) {
    var doomed = [];
    if (!fusedLeaves || fusedLeaves.length < 2) return doomed;
    var maxI = 0, i;
    for (i = 1; i < fusedLeaves.length; i++) {
        if (fusedLeaves[i].area > fusedLeaves[maxI].area) maxI = i;
    }
    for (i = 0; i < fusedLeaves.length; i++) {
        if (i === maxI) continue;                               // never the real contour
        if (!_matchesAnOutlineLeaf(fusedLeaves[i], outlineLeaves)) doomed.push(i);
    }
    return doomed;
}

// True when fused leaf f echoes some outline subpath: centroids within 10pt AND areas within
// +/-25%. Wide margins by design — real echoes coincide (dist~0, ratio~1.0) while slivers miss
// (dist>=20pt, ratio<=0.007) on the live SKU, so nothing lands between the two clusters.
function _matchesAnOutlineLeaf(f, outlineLeaves) {
    if (!outlineLeaves) return false;
    var DIST2 = 10 * 10, i, o, dx, dy, ratio;
    for (i = 0; i < outlineLeaves.length; i++) {
        o = outlineLeaves[i];
        if (o.area <= 0) continue;
        dx = f.c.x - o.c.x; dy = f.c.y - o.c.y;
        if (dx * dx + dy * dy > DIST2) continue;
        ratio = f.area / o.area;
        if (ratio >= 0.75 && ratio <= 1.25) return true;
    }
    return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/integration/unit/test-junction-slivers.js`
Expected: `PASS: junction-sliver selection`

- [ ] **Step 5: Create the test runner**

Create `tests/integration/unit/run-test-junction-slivers.sh`:

```bash
#!/bin/bash
# Node unit test for _junctionSliverLeaves in aiUtils.jsx (pure geometry, no Adobe app required).
set -euo pipefail
STEP="junction-slivers-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running caption-junction sliver-selection unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found on PATH."; exit 0; fi
if node "$DIR/test-junction-slivers.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
```

Then: `chmod +x tests/integration/unit/run-test-junction-slivers.sh`
Run: `tests/integration/unit/run-test-junction-slivers.sh`
Expected: `PASS [junction-slivers-unit]`

- [ ] **Step 6: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-junction-slivers.js tests/integration/unit/run-test-junction-slivers.sh
git commit -m "feat(cutline): _junctionSliverLeaves — compare fused leaves to the outline

Pure, node-tested decision: keep the largest fused leaf + any leaf that echoes an
art-alone outline subpath (a genuine hole); delete the rest (union-invented slivers).
Replaces the earlier overlap test, which matched zero real slivers live."
```

---

### Task 2: Illustrator wrapper + wire into `deriveCutline`; verify live on normalise

**Files:**
- Modify: `utils/aiUtils.jsx` — add `removeCaptionJunctionSlivers` + `_fusedCutLeaves` (near `deriveCutline`, ~line 1484); add one call inside `deriveCutline` before its `return`.
- Modify: `tests/integration/ai-normalise-captions/run.sh` — add a leaf-count assertion after Run #1.
- Modify: `tests/integration/ai-normalise-captions/expected.txt` — regenerate (new `[cutline]` log lines).

**Interfaces:**
- Consumes: `_junctionSliverLeaves(fusedLeaves, outlineLeaves)` (Task 1); `boundsCenter(bounds)` (returns `{x,y}` from a `[left,top,right,bottom]` bounds array).
- Produces: `removeCaptionJunctionSlivers(cutline, outline) -> { removed:Number }`; `_fusedCutLeaves(item, acc) -> [PathItem]`; `_leafMetrics(items) -> [{c,area}]`.

- [ ] **Step 1: Confirm no name collisions**

Run: `grep -c "removeCaptionJunctionSlivers\|_fusedCutLeaves\|_leafMetrics" utils/aiUtils.jsx`
Expected: `0` (safe to add without redefining).

- [ ] **Step 2: Add the leaf-enumeration helper, metrics helper, and the wrapper**

In `utils/aiUtils.jsx`, immediately AFTER `function deriveCutline(...) { ... }` (ends ~line 1522, `return app.selection[0];` + closing brace), add:

```javascript
// Leaf PathItems of a fused cutline or an outline (PathItem / CompoundPathItem / GroupItem).
// deriveCutline's Unite result is usually a GroupItem wrapping several PathItems.
function _fusedCutLeaves(item, acc) {
    var t = item.typename, i;
    if (t === "PathItem") { acc.push(item); }
    else if (t === "CompoundPathItem") { for (i = 0; i < item.pathItems.length; i++) acc.push(item.pathItems[i]); }
    else if (t === "GroupItem") { for (i = 0; i < item.pageItems.length; i++) _fusedCutLeaves(item.pageItems[i], acc); }
    return acc;
}

// [{ c:{x,y}, area:Number }] for a list of leaf PathItems, from each leaf's geometricBounds.
function _leafMetrics(items) {
    var out = [], i, b;
    for (i = 0; i < items.length; i++) {
        b = items[i].geometricBounds;                          // [left, top, right, bottom]
        out.push({ c: boundsCenter(b), area: Math.abs((b[2] - b[0]) * (b[1] - b[3])) });
    }
    return out;
}

// Deletes caption-junction sliver subpaths from a freshly-Unite'd fused cutline: the boolean
// crumbs the plate∩art weld invents at the seam. Keeps the largest leaf (the real contour) and
// any leaf that echoes a subpath of the art-alone `outline` (a genuine art hole, like Tram's);
// drops the rest. Idempotent (a cut with no unmatched leaves is a no-op). Returns { removed:N }.
function removeCaptionJunctionSlivers(cutline, outline) {
    if (!cutline || !outline) return { removed: 0 };
    var fusedItems = _fusedCutLeaves(cutline, []);
    if (fusedItems.length < 2) return { removed: 0 };
    var outlineLeaves = _leafMetrics(_fusedCutLeaves(outline, []));
    var fusedLeaves   = _leafMetrics(fusedItems);
    var doomed = _junctionSliverLeaves(fusedLeaves, outlineLeaves);
    var i;
    for (i = 0; i < doomed.length; i++) {
        try { fusedItems[doomed[i]].remove(); } catch (e) {}
    }
    return { removed: doomed.length };
}
```

- [ ] **Step 3: Wire the call into `deriveCutline`**

In `utils/aiUtils.jsx`, `deriveCutline` currently ends with:

```javascript
    return app.selection[0];
}
```

Replace those two lines with:

```javascript
    var fused = app.selection[0];
    var sw = removeCaptionJunctionSlivers(fused, outline);
    if (sw.removed > 0) log("[cutline] junction slivers removed | " + sw.removed);
    return fused;
}
```

- [ ] **Step 4: Syntax-check**

`node --check` rejects a `.jsx` extension (treats it as ESM). `utils/aiUtils.jsx` has no
`#include`/`#target` directives, so copy it to a `.js` name and check that:
Run: `cp utils/aiUtils.jsx /tmp/aiUtils-check.js && node --check /tmp/aiUtils-check.js && echo OK`
Expected: `OK` (exit 0). A syntax error here means a typo in the added code.

- [ ] **Step 5: Add the sliver assertion to the normalise runner**

`deriveCutline` (hence the cleanup) runs only on captions normalise actually **re-derives** —
the ones it rescales. The committed fixture predates this fix, so its already-at-spec captions
and its stamps still carry pre-fix slivers that this run never touches; a whole-document leaf
check would wrongly flag those. So the robust automated guard is: **the cleanup fired**
(grep, deterministic) — and the **golden** captures the exact per-element `[cutline] junction
slivers removed | N` lines, which is the real regression guard (any geometry regression breaks
the golden). The detailed per-element `fused==outline` geometry (incl. the real-hole case) is
confirmed once, live, and recorded in the report — not re-derived on every CI run against a
frozen fixture.

In `tests/integration/ai-normalise-captions/run.sh`, find the block that ends the assertions (after the idempotency PASS/FAIL `if` and before the golden-diff section — search for `# ── Assertions` … the `RESET2`/`ATSPEC2` block). Immediately AFTER that idempotency `if/fi` block, insert:

```bash
# ── Sliver-removal assertion: the cleanup fired during a re-derive, and did NOT spuriously
#    re-fire on the idempotent second pass (nothing re-derived → nothing to remove). The exact
#    per-element counts are pinned by the golden below; this just guards the fire/no-refire shape.
FIRED1=$(grep -c "\[cutline\] junction slivers removed" "$RUN1" || true)
FIRED2=$(grep -c "\[cutline\] junction slivers removed" "$RUN2" || true)
if [ "${FIRED1:-0}" -gt 0 ]; then
    echo "PASS [$STEP]: sliver cleanup fired on $FIRED1 re-derived element(s) in run #1."
else
    echo "FAIL [$STEP]: run #1 logged no '[cutline] junction slivers removed' — cleanup never ran."; FAIL=1
fi
if [ "${FIRED2:-0}" -eq 0 ]; then
    echo "PASS [$STEP]: idempotent — run #2 re-derived nothing, removed no slivers."
else
    echo "FAIL [$STEP]: run #2 re-fired sliver removal ($FIRED2) — not idempotent."; FAIL=1
fi
```

- [ ] **Step 6: Run the normalise integration test (needs Illustrator)**

Run: `tests/integration/ai-normalise-captions/run.sh`
Expected: the existing `reset > 0` and idempotency PASS lines, PLUS `PASS [ai-normalise-captions]: sliver cleanup fired on N re-derived element(s)` and `PASS ... idempotent — run #2 ... removed no slivers`. The golden diff will FAIL here — that is expected (new `[cutline] junction slivers removed | N` lines). Confirm the diff shows ONLY added `[cutline] junction slivers removed` lines and no changed `[seat]`/`[step8b]`/count values.

- [ ] **Step 7: Regenerate the normalise golden**

Run:
```bash
cp /tmp/normalise-captions-run1.log tests/integration/ai-normalise-captions/expected.txt
```
Then re-run `tests/integration/ai-normalise-captions/run.sh` and confirm `PASS [ai-normalise-captions]: outputs OK + log matches golden` (or the runner's final PASS line) AND the leaf-count PASS.

- [ ] **Step 8: Live eyeball (manual, non-blocking)**

The runner leaves the normalised doc open. Visually confirm in Illustrator that the "Slovak Paradise National Park" caption junction no longer shows the two blob holes and the half-cut span is clean. (This is the artist's sign-off, not an automated gate.)

- [ ] **Step 9: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/ai-normalise-captions/run.sh tests/integration/ai-normalise-captions/expected.txt
git commit -m "feat(cutline): strip caption-junction slivers inside deriveCutline

removeCaptionJunctionSlivers runs after every Unite so the blobs never persist
across regeneration; keeps genuine art holes by matching against the outline.
Normalise runner asserts fused==outline leaf count; golden regenerated for the
new [cutline] log line."
```

---

### Task 3: Sweep other goldens affected by the new `deriveCutline` log line

**Files:**
- Possibly modify (regenerate): `tests/integration/ai-build-and-export-cutlines/expected.txt`, `tests/integration/ai-import-nesting/expected/*.txt` — ONLY if their diff is purely the added `[cutline]` lines.

**Why:** `deriveCutline` is a shared chokepoint. Any pipeline whose golden run re-Unites a caption cut will now emit `[cutline] junction slivers removed | N` lines. This task confirms the change altered nothing else and refreshes the affected goldens.

- [ ] **Step 1: Run the build-and-export test**

Run: `tests/integration/ai-build-and-export-cutlines/run.sh`
Expected: all functional PASS lines. If the golden diff fails, inspect it. **Allowed (benign, expected) differences:**
  - Added `[cutline] junction slivers removed | N` lines.
  - `[step7a]` **extent-ratio** shifts of ≤ ~0.01 (e.g. `ratio=0.944`→`0.94`). This is expected:
    `extentRatio = pathArea / bboxArea`, and removing sliver subpaths slightly changes the cut's
    area/bounds. VERIFY it is only the ratio number — the classification word (`regular`/`irregular`)
    on each line must be UNCHANGED, and the summary `[step7a] classified: R regular, I irregular`
    counts must be UNCHANGED.
**STOP (real bug — do not regenerate, investigate)** if: any element's classification FLIPS
regular↔irregular, the regular/irregular counts change, any `[seat]` value changes, or any caption/tab
COUNT changes.

- [ ] **Step 2: Regenerate the build-and-export golden IF the diff was benign**

Run (only if Step 1's diff was benign per the allowed list — added `[cutline]` lines and/or
≤0.01 `[step7a]` ratio shifts with NO classification/count change):
```bash
cp /tmp/AI_BuildAndExportCutlines.log tests/integration/ai-build-and-export-cutlines/expected.txt
```
Re-run the runner; confirm `PASS`.

- [ ] **Step 3: Run the import-nesting test and repeat the benign-diff check**

Run: `tests/integration/ai-import-nesting/run.sh`
- If it PASSES unchanged: nothing to do (Step 7B does not re-Unite → no new lines).
- If the golden diff fails with only benign differences (added `[cutline]` lines and/or ≤0.01
  extent-ratio shifts, no classification/count change): regenerate its golden the same way (copy
  its produced log over the expected file the runner diffs against — use the path the runner
  prints), re-run, confirm PASS.
- If any classification flips, count changes, or `[seat]`/geometry value changes: STOP and investigate.

- [ ] **Step 4: Full suite sanity**

Run: `tests/integration/run-all.sh` (runs unit tests first, then the AI runners).
Expected: all PASS / SKIP (SKIP only where an Adobe app is unavailable). No FAIL.

- [ ] **Step 5: Commit any regenerated goldens**

```bash
git add tests/integration/ai-build-and-export-cutlines/expected.txt tests/integration/ai-import-nesting/expected 2>/dev/null || true
git commit -m "test: regenerate goldens for deriveCutline junction-sliver log line

Diffs verified benign — only added [cutline] junction slivers removed lines;
no seat/halfcut/count values changed."
```
(If no goldens changed, skip the commit.)

---

## Self-Review

**Spec coverage:**
- Sliver removal only, no fillet → Task 2 wrapper (no fillet code). ✓
- Overlap test, parameter-free → Task 1 `_junctionSliverLeaves`. ✓
- Keep largest leaf always → Task 1 (max-area index excluded). ✓
- Wired inside `deriveCutline`, survives regeneration → Task 2 Step 3. ✓
- Idempotent → Task 1 single-leaf test + Task 2 `items.length < 2` guard + normalise Run #2. ✓
- Reuse existing helper → `boundsCenter`; decision is centroid+area only (no polygon sampling). ✓
- Protect genuine art holes (Tram) → compare-to-outline test; Task 1 test case "real hole kept" + Task 2 asserts fused==outline leaf count. ✓
- Real art hole preserved → Task 1 test case 1 (leaf 2 kept). ✓
- Testing: normalise runner one-leaf assertion + golden regen + live eyeball → Task 2. ✓
- Logging `[cutline]` → Task 2 Step 3. ✓ (name-less by design: `deriveCutline` is the DRY chokepoint and has no element name.)

**Placeholder scan:** none — all code and commands are literal.

**Type consistency:** `_junctionSliverLeaves(leaves, platePolys, artPolys)` signature identical in Task 1 definition, Task 1 test, and Task 2 wrapper. `removeCaptionJunctionSlivers` / `_fusedCutLeaves` names identical across Task 2. `boundsCenter` returns `{x,y}`; `leaves[i].c` is `{x,y}`; consistent.
