# Caption-Junction Sliver Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the tiny boolean "blob" subpaths the caption-plate Unite leaves at the plate∩art junction, inside `deriveCutline` so they never persist across regeneration.

**Architecture:** A pure, node-testable decision function (`_junctionSliverLeaves`) selects which fused-cut leaves are slivers — every leaf except the largest whose centroid lies inside the plate∩art overlap. An Illustrator wrapper (`removeCaptionJunctionSlivers`) enumerates the leaf PathItems, computes their centroids, calls the decision function, and removes the flagged leaves. It is called once inside `deriveCutline` after the Unite, so it re-applies at every caption regeneration (Step 6 / 7B / 8b-normalise).

**Tech Stack:** ExtendScript (ES3) for Illustrator; Node.js for pure-geometry unit tests; bash + osascript for the integration runner.

## Global Constraints

- **ES3 only** (`utils/aiUtils.jsx` is `#include`d into Illustrator pipelines): no `let`/`const`, no arrow functions, no template literals, no `Array.prototype` ES5 extras beyond what the file already uses. Copy the style of the surrounding functions.
- `utils/aiUtils.jsx` step/util files have **no `#target`, no `CONFIG`, no `main()`** — `CONFIG` and `log` are globals provided by the pipeline at run time. Guard `CONFIG` access with `typeof CONFIG !== "undefined"`.
- **Parameter-free:** no `bandPt`, no area cap, no CONFIG gate. The overlap membership IS the test.
- **Always-on**, **idempotent** (a single-leaf cut is a no-op).
- Log prefix for aiUtils-level lines: `[cutline]`.
- Reuse existing helpers — do not reimplement: `samplePathToPolygons`, `_pointInPolysEO`, `pointInPolygon`, `boundsCenter`.
- Node unit-test pattern: read `utils/aiUtils.jsx` as text, regex-`extract` each needed function, `eval` it, test on plain `{x,y}` polygons. Model on `tests/integration/unit/test-halfcut-tail-dir.js`.

---

### Task 1: Pure sliver-selection function (`_junctionSliverLeaves`) — node TDD

**Files:**
- Modify: `utils/aiUtils.jsx` (add `_junctionSliverLeaves` near `samplePathToPolygons`, ~line 3300)
- Test: `tests/integration/unit/test-junction-slivers.js` (create)
- Test runner: `tests/integration/unit/run-test-junction-slivers.sh` (create)

**Interfaces:**
- Consumes: `_pointInPolysEO(pt, polys)` and `pointInPolygon(pt, poly)` — both already in `aiUtils.jsx`, both operate on `{x,y}` points and polygons that are arrays of `{x,y}`.
- Produces: `_junctionSliverLeaves(leaves, platePolys, artPolys) -> [Number]` where `leaves = [{ c:{x,y}, area:Number }, ...]`, `platePolys`/`artPolys` are `samplePathToPolygons`-style arrays of polygons. Returns the indices of leaves to delete: every index except the max-`area` index whose centroid `c` is inside BOTH `platePolys` and `artPolys`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-junction-slivers.js`:

```javascript
// Pure-geometry unit test for caption-junction sliver selection (_junctionSliverLeaves in
// aiUtils.jsx). A fused-cut leaf is a sliver iff it is NOT the largest AND its centroid lies
// inside BOTH the plate and the art (the plate∩art overlap). No band, no area cap. y-UP coords.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('pointInPolygon'));
eval(extract('_pointInPolysEO'));
eval(extract('_junctionSliverLeaves'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }
function arrEq(a, b) { return a.length === b.length && a.join(',') === b.join(','); }

// art = 100x100 square; plate = pill straddling the bottom edge -> overlap = x[20,80], y[0,20].
var ART   = [[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]];
var PLATE = [[{x:20,y:-10},{x:80,y:-10},{x:80,y:20},{x:20,y:20}]];

// contour (largest) + two blobs in the overlap + one real hole up in the art body.
(function () {
    var leaves = [
        { c:{x:50,y:50}, area:10000 },   // 0 real contour (largest, art body)
        { c:{x:50,y:10}, area:50 },      // 1 blob in overlap        -> doomed
        { c:{x:50,y:70}, area:40 },      // 2 real hole (art only)   -> keep
        { c:{x:40,y:5},  area:30 }       // 3 blob in overlap        -> doomed
    ];
    var d = _junctionSliverLeaves(leaves, PLATE, ART);
    check(arrEq(d, [1, 3]), 'two overlap blobs doomed, real hole + contour kept (got [' + d + '])');
})();

// the LARGEST leaf is never doomed, even if its centroid is in the overlap.
(function () {
    var leaves = [
        { c:{x:50,y:10}, area:10000 },   // 0 largest, centroid in overlap -> still kept
        { c:{x:50,y:12}, area:50 }       // 1 blob                          -> doomed
    ];
    var d = _junctionSliverLeaves(leaves, PLATE, ART);
    check(arrEq(d, [1]), 'largest kept even if in overlap; blob doomed (got [' + d + '])');
})();

// a single leaf (already clean) -> nothing doomed (idempotent no-op).
(function () {
    var d = _junctionSliverLeaves([{ c:{x:50,y:50}, area:10000 }], PLATE, ART);
    check(arrEq(d, []), 'single leaf -> no-op (got [' + d + '])');
})();

if (fails === 0) { console.log('PASS: junction-sliver selection'); }
else { console.log(fails + ' FAIL'); process.exit(1); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/integration/unit/test-junction-slivers.js`
Expected: throws `Error: could not extract _junctionSliverLeaves` (function not defined yet).

- [ ] **Step 3: Write minimal implementation**

In `utils/aiUtils.jsx`, immediately BEFORE `function samplePathToPolygons(` (~line 3300), add:

```javascript
// Selects the fused-cut leaf indices that are caption-junction slivers to delete: every leaf
// EXCEPT the largest whose centroid lies inside the plate∩art overlap (inside BOTH the pill and
// the art). leaves = [{ c:{x,y}, area:Number }, ...]; platePolys/artPolys = samplePathToPolygons
// outputs. Parameter-free — overlap membership IS the test (no band, no area cap). The largest
// leaf (the real sticker contour) is never a candidate. Pure; node-testable.
function _junctionSliverLeaves(leaves, platePolys, artPolys) {
    var doomed = [];
    if (!leaves || leaves.length < 2) return doomed;
    var maxI = 0, i;
    for (i = 1; i < leaves.length; i++) {
        if (leaves[i].area > leaves[maxI].area) maxI = i;
    }
    for (i = 0; i < leaves.length; i++) {
        if (i === maxI) continue;                               // never the real contour
        var c = leaves[i].c;
        if (_pointInPolysEO(c, platePolys) && _pointInPolysEO(c, artPolys)) {
            doomed.push(i);
        }
    }
    return doomed;
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
git commit -m "feat(cutline): _junctionSliverLeaves — select overlap slivers to delete

Pure, node-tested decision: every fused-cut leaf except the largest whose
centroid is inside the plate∩art overlap. Parameter-free."
```

---

### Task 2: Illustrator wrapper + wire into `deriveCutline`; verify live on normalise

**Files:**
- Modify: `utils/aiUtils.jsx` — add `removeCaptionJunctionSlivers` + `_fusedCutLeaves` (near `deriveCutline`, ~line 1484); add one call inside `deriveCutline` before its `return`.
- Modify: `tests/integration/ai-normalise-captions/run.sh` — add a leaf-count assertion after Run #1.
- Modify: `tests/integration/ai-normalise-captions/expected.txt` — regenerate (new `[cutline]` log lines).

**Interfaces:**
- Consumes: `_junctionSliverLeaves` (Task 1); `samplePathToPolygons(item, steps)`, `boundsCenter(bounds)` (return `{x,y}` from a `[left,top,right,bottom]` bounds array).
- Produces: `removeCaptionJunctionSlivers(cutline, outline, plate) -> { removed:Number }`; `_fusedCutLeaves(item, acc) -> [PathItem]`.

- [ ] **Step 1: Confirm no name collisions**

Run: `grep -c "removeCaptionJunctionSlivers\|_fusedCutLeaves" utils/aiUtils.jsx`
Expected: `0` (safe to add without redefining).

- [ ] **Step 2: Add the leaf-enumeration helper and the wrapper**

In `utils/aiUtils.jsx`, immediately AFTER `function deriveCutline(...) { ... }` (ends ~line 1522, `return app.selection[0];` + closing brace), add:

```javascript
// Leaf PathItems of a fused cutline (PathItem / CompoundPathItem / GroupItem). deriveCutline's
// Unite result is usually a GroupItem wrapping several PathItems.
function _fusedCutLeaves(item, acc) {
    var t = item.typename, i;
    if (t === "PathItem") { acc.push(item); }
    else if (t === "CompoundPathItem") { for (i = 0; i < item.pathItems.length; i++) acc.push(item.pathItems[i]); }
    else if (t === "GroupItem") { for (i = 0; i < item.pageItems.length; i++) _fusedCutLeaves(item.pageItems[i], acc); }
    return acc;
}

// Deletes caption-junction sliver subpaths from a freshly-Unite'd fused cutline: the tiny
// boolean crumbs that form in the plate∩art overlap where the pill grazes the art edge. Keeps
// the largest leaf (the real contour) always; drops every other leaf whose centroid lies inside
// BOTH the plate and the art. Idempotent (a single-leaf cut is a no-op). Returns { removed:N }.
function removeCaptionJunctionSlivers(cutline, outline, plate) {
    if (!cutline || !outline || !plate) return { removed: 0 };
    var steps = (typeof CONFIG !== "undefined" && CONFIG.halfcutSeamSteps)
              ? CONFIG.halfcutSeamSteps : 16;
    var items = _fusedCutLeaves(cutline, []);
    if (items.length < 2) return { removed: 0 };

    var platePolys = samplePathToPolygons(plate, steps);
    var artPolys   = samplePathToPolygons(outline, steps);
    if (platePolys.length === 0 || artPolys.length === 0) return { removed: 0 };

    var leaves = [], i, b;
    for (i = 0; i < items.length; i++) {
        b = items[i].geometricBounds;                          // [left, top, right, bottom]
        leaves.push({
            c: boundsCenter(b),
            area: Math.abs((b[2] - b[0]) * (b[1] - b[3]))
        });
    }
    var doomed = _junctionSliverLeaves(leaves, platePolys, artPolys);
    for (i = 0; i < doomed.length; i++) {
        try { items[doomed[i]].remove(); } catch (e) {}
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
    var sw = removeCaptionJunctionSlivers(fused, outline, plate);
    if (sw.removed > 0) log("[cutline] junction slivers removed | " + sw.removed);
    return fused;
}
```

- [ ] **Step 4: Syntax-check**

Run: `node --check utils/aiUtils.jsx`
Expected: no output, exit 0. (ES3 is a subset of what `node --check` parses; a syntax error here means a typo.)

- [ ] **Step 5: Add the leaf-count assertion to the normalise runner**

In `tests/integration/ai-normalise-captions/run.sh`, find the block that ends the assertions (after the idempotency PASS/FAIL `if` and before the golden-diff section — search for `# ── Assertions` … the `RESET2`/`ATSPEC2` block). Immediately AFTER that idempotency `if/fi` block, insert:

```bash
# ── Leaf-count assertion: every captioned fused cut must be a single contour ──
# After sliver removal the fused cut = one closed leaf. >1 leaf ⇒ a junction blob survived.
# (The Slovakia WC fixture's art has no genuine interior holes, so 1 leaf is the correct
#  target for every captioned element here.)
LEAFCHK="/tmp/${STEP}-leafcheck.jsx"
LEAFLOG="/tmp/${STEP}-leafcount.txt"
rm -f "$LEAFLOG"
cat > "$LEAFCHK" <<'JSX'
#target illustrator
function leaves(item,acc){var t=item.typename,i;
  if(t=="PathItem"){acc.push(item);}
  else if(t=="CompoundPathItem"){for(i=0;i<item.pathItems.length;i++)acc.push(item.pathItems[i]);}
  else if(t=="GroupItem"){for(i=0;i<item.pageItems.length;i++)leaves(item.pageItems[i],acc);}
  return acc;}
var doc=app.activeDocument, out=[], ci=-1, L;
for(L=0;L<doc.layers.length;L++){ if(doc.layers[L].name=="Cutlines") ci=L; }
if(ci>=0){
  var n=doc.layers[ci].pageItems.length, g, m;
  for(g=0;g<n;g++){
    var grp=doc.layers[ci].pageItems[g];
    if(grp.typename!="GroupItem") continue;                 // stamps are bare paths
    var hasPlate=false, fused=null;
    for(m=0;m<grp.pageItems.length;m++){
      var it=grp.pageItems[m];
      if(it.name==grp.name+" plate") hasPlate=true;
      if(it.name==grp.name) fused=it;
    }
    if(!hasPlate || !fused) continue;                       // captioned groups only
    out.push("LEAF\t"+leaves(fused,[]).length+"\t"+grp.name);
  }
}
var f=new File("__LEAFLOG__"); f.open("w"); f.write(out.join("\n")); f.close();
out.join("\n");
JSX
sed -i '' "s#__LEAFLOG__#$LEAFLOG#" "$LEAFCHK"
osascript -e "tell application \"$APP\" to do javascript file (POSIX file \"$LEAFCHK\")" >/dev/null 2>&1 || true
if [ -f "$LEAFLOG" ] && grep -q '^LEAF' "$LEAFLOG" \
   && awk -F'\t' '$1=="LEAF" && $2!="1"{bad=1} END{exit bad?1:0}' "$LEAFLOG"; then
    echo "PASS [$STEP]: every captioned fused cut is a single contour (no junction slivers)."
else
    echo "FAIL [$STEP]: a captioned fused cut has >1 leaf (junction sliver present), or no cuts found."
    cat "$LEAFLOG" 2>/dev/null || true
    FAIL=1
fi
```

- [ ] **Step 6: Run the normalise integration test (needs Illustrator)**

Run: `tests/integration/ai-normalise-captions/run.sh`
Expected: the existing `reset > 0` and idempotency PASS lines, PLUS `PASS [ai-normalise-captions]: every captioned fused cut is a single contour`. The golden diff will FAIL here — that is expected (new `[cutline] junction slivers removed | N` lines). Confirm the diff shows ONLY added `[cutline] junction slivers removed` lines and no changed `[seat]`/`[step8b]`/count values.

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
across regeneration. Normalise runner asserts one leaf per captioned cut; golden
regenerated for the new [cutline] log line."
```

---

### Task 3: Sweep other goldens affected by the new `deriveCutline` log line

**Files:**
- Possibly modify (regenerate): `tests/integration/ai-build-and-export-cutlines/expected.txt`, `tests/integration/ai-import-nesting/expected/*.txt` — ONLY if their diff is purely the added `[cutline]` lines.

**Why:** `deriveCutline` is a shared chokepoint. Any pipeline whose golden run re-Unites a caption cut will now emit `[cutline] junction slivers removed | N` lines. This task confirms the change altered nothing else and refreshes the affected goldens.

- [ ] **Step 1: Run the build-and-export test**

Run: `tests/integration/ai-build-and-export-cutlines/run.sh`
Expected: all functional PASS lines. If the golden diff fails, inspect it: the ONLY differences must be added `[cutline] junction slivers removed` lines. If any `[seat]`, `[step7a]`, or count value changed, STOP — that means sliver removal altered real geometry (a bug); do not regenerate, investigate instead.

- [ ] **Step 2: Regenerate the build-and-export golden IF the diff was benign**

Run (only if Step 1's diff was purely the new `[cutline]` lines):
```bash
cp /tmp/AI_BuildAndExportCutlines.log tests/integration/ai-build-and-export-cutlines/expected.txt
```
Re-run the runner; confirm `PASS`.

- [ ] **Step 3: Run the import-nesting test and repeat the benign-diff check**

Run: `tests/integration/ai-import-nesting/run.sh`
- If it PASSES unchanged: nothing to do (Step 7B does not re-Unite → no new lines).
- If the golden diff fails with ONLY added `[cutline]` lines: regenerate its golden the same way (copy its produced log over `tests/integration/ai-import-nesting/expected/<name>.txt` — use the path the runner prints), re-run, confirm PASS.
- If any other value changed: STOP and investigate.

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
- Reuse existing helpers → `samplePathToPolygons`/`_pointInPolysEO`/`pointInPolygon`/`boundsCenter`. ✓
- Real art hole preserved → Task 1 test case 1 (leaf 2 kept). ✓
- Testing: normalise runner one-leaf assertion + golden regen + live eyeball → Task 2. ✓
- Logging `[cutline]` → Task 2 Step 3. ✓ (name-less by design: `deriveCutline` is the DRY chokepoint and has no element name.)

**Placeholder scan:** none — all code and commands are literal.

**Type consistency:** `_junctionSliverLeaves(leaves, platePolys, artPolys)` signature identical in Task 1 definition, Task 1 test, and Task 2 wrapper. `removeCaptionJunctionSlivers` / `_fusedCutLeaves` names identical across Task 2. `boundsCenter` returns `{x,y}`; `leaves[i].c` is `{x,y}`; consistent.
