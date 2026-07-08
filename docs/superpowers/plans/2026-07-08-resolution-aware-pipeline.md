# Resolution-Aware Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the source PSD's resolution through the whole pipeline so a 300-DPI source produces 300-DPI output and a 600-DPI source produces 600-DPI output (native, lossless), instead of everything being normalized to 300.

**Architecture:** Replace the two places resolution is pinned to 300 — the Photoshop template build and the fixed-pixel size table — with physical units (inches / mm) multiplied by a single detected `sourceDPI`. Detect that DPI once in Pipeline 1 (highest resolution among the source PSDs, or an adopted doc's own resolution), stamp it into the `_elements.json` sidecar, and have the Illustrator placement (Step 6/7B) and export (Step 10) read it back.

**Tech Stack:** Adobe ExtendScript (ES3) for Photoshop + Illustrator. Tests run via `osascript` driving the live Adobe apps (no headless path — the executor runs them on a machine with Photoshop 2026 + Illustrator 2026).

## Global Constraints

- Language: ExtendScript ES3 — no `let`/`const`, no arrow functions, no template literals.
- **300-DPI round-trip is mandatory for geometry:** every element/geometry log line (resize px, white-edge px, counts, coordinates) must stay byte-identical at 300 DPI. The inch/mm values reproduce the current pixel targets exactly (`2.05 × 300 = 615`, `round(1.7/25.4 × 300) = 20`, `round(5.08/25.4 × 300) = 60`). Run each affected runner **2×** for determinism. **Pipeline-level *informational* log lines may legitimately change** (Task 2 reorders `main()` and adds DPI-detection lines) — those goldens are updated deliberately after reviewing the diff to confirm only informational lines moved and no geometry line changed.
- Warn-on-all: never silently drop or assume. Source-PSD resolution mismatch → log each file's DPI, use the **highest**. Missing/unreadable sidecar `sourceDPI` on the AI side → fall back to `300` **and log a warning**.
- `getTargetPx` and `mmToPx` resolve DPI as `CONFIG.sourceDPI || CONFIG.templateDPI || 300` so they are safe before detection runs.
- Adobe-dependent tests cannot run in this planning session; each test step says which app must be running.

---

### Task 1: DPI-relative sizing in `psUtils` + physical-unit PS config + consumers

Make element sizes and the white edge physical (inches/mm) and derive pixels from `sourceDPI`. All Pipeline-1 consumers of the old pixel config are updated in the same task so the pipeline stays runnable at the commit.

**Files:**
- Modify: `utils/psUtils.jsx` — `getTargetPx` (lines 36-49); add `mmToPx`.
- Modify: `pipelines/PS_BuildElements.jsx` — CONFIG `sizeTable`/`sizeTableLarge`/`sizeTableSmall` (lines 42-68), `whiteEdgePx` (line 79), `whiteEdgeSmoothRadiusPx` (line 88), `gridPaddingPx` (line 73); add `sourceDPI` field.
- Modify: `photoshop/Step2A_AutoResize.jsx` — white-edge px (lines 53-54), grid cell (lines 94-95).
- Modify: `photoshop/Step2B_WhiteEdge.jsx` — expand + smooth radius (lines 106, 113) and the smooth-radius log (line 28).
- Test: `tests/integration/unit/test-psUtils.jsx` (CONFIG lines 10-38) + runner `tests/integration/unit/run-test-psUtils.sh`.

**Interfaces:**
- Produces: `getTargetPx(parsed)` → finished-size **pixels** = `Math.round(inches × dpi)` (unchanged signature/return type; still `null` for unknown category). `mmToPx(mm)` → `Math.round(mm / 25.4 × dpi)`. Both resolve `dpi = CONFIG.sourceDPI || CONFIG.templateDPI || 300`.
- Consumes: `CONFIG.sizeTable` etc. now hold **inches**; `CONFIG.whiteEdgeMm`, `CONFIG.whiteEdgeSmoothRadiusMm`, `CONFIG.gridPaddingMm` hold **millimetres**.

- [ ] **Step 1: Update the unit test's CONFIG to inches + add 300/600 assertions (failing test first)**

In `tests/integration/unit/test-psUtils.jsx`, replace the CONFIG size tables (lines 11-37) with inch values and a `sourceDPI`, and add `whiteEdge*` mm fields:

```javascript
var CONFIG = {
    suppressAlerts: true,
    logPath:        Folder.desktop.fsName + "/test-psUtils.log",
    sourceDPI:      300,
    templateDPI:    300,
    whiteEdgeMm:            1.7,
    whiteEdgeSmoothRadiusMm: 1.7,
    gridPaddingMm:          5.08,
    sizeTable: {
        "TL": 3.0, "LM": 2.05, "MP": 1.9, "TR": 1.9, "IC": 1.65, "FD": 1.75, "ST": 1.5
    },
    sizeTableLarge: { "LM": 2.3, "MP": 2.0, "TR": 2.0, "IC": 1.8, "FD": 2.0 },
    sizeTableSmall: { "LM": 1.8, "MP": 1.8, "TR": 1.8, "IC": 1.5, "FD": 1.5 }
};
```

Then find the existing `getTargetPx` assertions and confirm they still expect the 300-DPI pixel values (e.g. `LM` → 615, `TL` → 900, `LM+` → 690, `IC-` → 450). Add a resolution-scaling block after them:

```javascript
// --- DPI scaling (resolution-aware pipeline) ---
CONFIG.sourceDPI = 600;
assert("getTargetPx LM @600", getTargetPx(parseLayerName("X [WC-LM]")), 1230);
assert("getTargetPx TL @600", getTargetPx(parseLayerName("X [WC-TL]")), 1800);
assert("getTargetPx LM+ @600", getTargetPx(parseLayerName("X [WC-LM+]")), 1380);
assert("mmToPx whiteEdge @600", mmToPx(CONFIG.whiteEdgeMm), 40);
CONFIG.sourceDPI = 300;
assert("getTargetPx LM @300", getTargetPx(parseLayerName("X [WC-LM]")), 615);
assert("mmToPx whiteEdge @300", mmToPx(CONFIG.whiteEdgeMm), 20);
```

- [ ] **Step 2: Run the unit test to verify it fails**

Requires **Photoshop 2026** running.
Run: `bash tests/integration/unit/run-test-psUtils.sh`
Expected: FAIL — `getTargetPx LM @600` etc. fail because `getTargetPx` still returns the raw table value (2.05) and `mmToPx` is undefined.

- [ ] **Step 3: Implement `getTargetPx` (inches × dpi) + `mmToPx` in `psUtils.jsx`**

Replace lines 33-49 of `utils/psUtils.jsx`:

```javascript
// Returns finished-size pixels for an element = inches (from CONFIG.sizeTable) ×
// working resolution. Resolution is CONFIG.sourceDPI, falling back to templateDPI/300
// so callers are safe before detection runs. null for an unrecognised category.
// Stamps use styleCode "ST" directly; sizeHint "+"/"-" pick the large/small table.
function getTargetPx(parsed) {
    if (!parsed) return null;
    var dpi = CONFIG.sourceDPI || CONFIG.templateDPI || 300;
    var inches = null;
    if (parsed.styleCode === "ST") {
        inches = CONFIG.sizeTable["ST"];
    } else if (parsed.catCode) {
        var cat = parsed.catCode;
        if (parsed.sizeHint === "+" && CONFIG.sizeTableLarge && CONFIG.sizeTableLarge[cat] !== undefined) {
            inches = CONFIG.sizeTableLarge[cat];
        } else if (parsed.sizeHint === "-" && CONFIG.sizeTableSmall && CONFIG.sizeTableSmall[cat] !== undefined) {
            inches = CONFIG.sizeTableSmall[cat];
        } else if (CONFIG.sizeTable[cat] !== undefined) {
            inches = CONFIG.sizeTable[cat];
        }
    }
    if (inches === null || inches === undefined) return null;
    return Math.round(inches * dpi);
}

// Physical millimetres → pixels at the working resolution. Used for the white edge
// and smooth radius so they stay a constant physical width at any source DPI.
function mmToPx(mm) {
    if (mm === null || mm === undefined) return 0;
    var dpi = CONFIG.sourceDPI || CONFIG.templateDPI || 300;
    return Math.round(mm / 25.4 * dpi);
}
```

- [ ] **Step 4: Convert the PS CONFIG to physical units**

In `pipelines/PS_BuildElements.jsx`, replace the size tables (lines 42-68) with inch values, and add a `sourceDPI` runtime field near `templateDPI` (line 19):

```javascript
    templateDPI:      300,   // fallback when no source resolution can be detected
    sourceDPI:        0,     // resolved at runtime from the source PSDs / adopted doc
```

```javascript
    // FINISHED element size in INCHES (art + white edge). getTargetPx multiplies by
    // the working resolution, so these hold at any DPI. Append + / - to the category
    // code for the large / small end (e.g. "Eiffel Tower [WC-LM+]").
    sizeTable: {
        "TL": 3.0,  "LM": 2.05, "MP": 1.9, "TR": 1.9, "IC": 1.65, "FD": 1.75, "ST": 1.5
    },
    sizeTableLarge: { "LM": 2.3, "MP": 2.0, "TR": 2.0, "IC": 1.8, "FD": 2.0 },
    sizeTableSmall: { "LM": 1.8, "MP": 1.8, "TR": 1.8, "IC": 1.5, "FD": 1.5 },
```

Replace `whiteEdgePx` (line 79) and `whiteEdgeSmoothRadiusPx` (line 88), and `gridPaddingPx` (line 73):

```javascript
    gridPaddingMm:            5.08,  // review-grid cell padding (= 60px @300 DPI)
```
```javascript
    whiteEdgeMm:             1.7,    // white border width (= 20px @300 DPI)
```
```javascript
    whiteEdgeSmoothRadiusMm: 1.7,    // Smooth radius on the band (= 20px @300 DPI)
```

- [ ] **Step 5: Update Step 2A consumers**

In `photoshop/Step2A_AutoResize.jsx`, replace lines 53-54:

```javascript
            var edgePx = (CONFIG.whiteEdgeMm !== undefined && parsed.styleCode !== "ST")
                ? mmToPx(CONFIG.whiteEdgeMm) : 0;
```

Replace the grid cell computation (lines 94-95):

```javascript
    var padding  = CONFIG.gridPaddingMm !== undefined ? mmToPx(CONFIG.gridPaddingMm) : 60;
    var cellSize = getTargetPx({ styleCode: "WC", catCode: "TL", sizeHint: null }) + padding * 2; // TL largest
```

- [ ] **Step 6: Update Step 2B consumers**

In `photoshop/Step2B_WhiteEdge.jsx`, replace line 106:

```javascript
    doc.selection.expand(mmToPx(CONFIG.whiteEdgeMm));
```

Replace line 113:

```javascript
    smoothSelection(mmToPx(CONFIG.whiteEdgeSmoothRadiusMm));
```

Replace the smooth-radius log (line 28) so it reports resolved px:

```javascript
    log("[step2B] smooth radius | " + mmToPx(CONFIG.whiteEdgeSmoothRadiusMm) + "px");
```

- [ ] **Step 7: Run the unit test to verify it passes**

Requires **Photoshop 2026** running.
Run: `bash tests/integration/unit/run-test-psUtils.sh`
Expected: PASS — all `getTargetPx`/`mmToPx` assertions pass at both 300 and 600.

- [ ] **Step 8: Commit**

```bash
git add utils/psUtils.jsx pipelines/PS_BuildElements.jsx photoshop/Step2A_AutoResize.jsx photoshop/Step2B_WhiteEdge.jsx tests/integration/unit/test-psUtils.jsx
git commit -m "feat(ps): DPI-relative sizing — size table in inches, white edge in mm

getTargetPx/mmToPx derive pixels from CONFIG.sourceDPI (fallback templateDPI/300).
Round-trips to the current px targets at 300 DPI.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Detect source DPI, build the template at it, carry it in the sidecar

**Files:**
- Modify: `pipelines/PS_BuildElements.jsx` — `createTemplateDoc` (lines 105-129), `main()` (lines 208-241); add `detectSourceDpi` helper.
- Modify: `photoshop/Step5b_ExportHandoff.jsx` — `writeElementsFile` (lines 85-107).
- Test: `tests/integration/ps-build-elements/run.sh` + `expected.txt` (regression, 300-DPI fixture).

**Interfaces:**
- Consumes: `getTargetPx` / `mmToPx` from Task 1 (they read `CONFIG.sourceDPI`).
- Produces: `CONFIG.sourceDPI` set at runtime before Step 1 runs. Sidecar JSON gains a top-level `sourceDPI` integer: `{ psdWidth, psdHeight, sourceDPI, elements: [...] }`.

- [ ] **Step 1: Add `detectSourceDpi` helper and make `createTemplateDoc` take a DPI**

In `pipelines/PS_BuildElements.jsx`, change `createTemplateDoc` (line 105) to accept a dpi and use it (line 108):

```javascript
function createTemplateDoc(dpi) {
    var w = new UnitValue(CONFIG.templateWidthCm, "cm");
    var h = new UnitValue(CONFIG.templateHeightCm, "cm");
    var doc = app.documents.add(w, h, dpi, "Production Template",
        NewDocumentMode.CMYK, DocumentFill.WHITE);
```

and update its log line (line 127) to report `dpi` instead of `CONFIG.templateDPI`:

```javascript
    log("[pipeline] created new template document ("
        + CONFIG.templateWidthCm + " x " + CONFIG.templateHeightCm + " cm, "
        + dpi + " DPI).");
```

Add this helper above `main()`:

```javascript
// Scans the source folder's PSDs and returns the HIGHEST resolution found (DPI),
// warning on any mismatch. Returns 0 when no PSD is readable (caller falls back to
// templateDPI). Opens + closes each file read-only.
function detectSourceDpi(folder) {
    var files = folder.getFiles("*.psd");
    if (!files || files.length === 0) return 0;
    var maxDpi = 0, seen = [], i, d, r;
    for (i = 0; i < files.length; i++) {
        try {
            d = app.open(files[i]);
            r = Math.round(d.resolution);
            d.close(SaveOptions.DONOTSAVECHANGES);
        } catch (e) {
            log("[pipeline] WARN | could not read resolution of " + files[i].name + ": " + e.message);
            continue;
        }
        seen.push(files[i].name + "=" + r + "dpi");
        if (r > maxDpi) maxDpi = r;
    }
    // Warn on any mismatch (warn-on-all); the highest wins.
    var mixed = false, j;
    for (j = 0; j < seen.length; j++) {
        if (seen[j].indexOf("=" + maxDpi + "dpi") === -1) { mixed = true; break; }
    }
    if (mixed) {
        log("[pipeline] WARN | source PSDs have mixed resolutions, using highest ("
            + maxDpi + " DPI): " + seen.join(", "));
    }
    log("[pipeline] detected source DPI: " + maxDpi + " (from " + seen.length + " PSD(s))");
    return maxDpi;
}
```

- [ ] **Step 2: Reorder `main()` — resolve folder, detect DPI, then build the template at it**

Replace `main()` lines 208-241 with this order (folder first, then doc + DPI):

```javascript
function main() {
    // ── Init log ───────────────────────────────────────────────────
    log("[pipeline] === PS_BuildElements start ===");
    log("[pipeline] dryRun: " + CONFIG.dryRun);

    // ── Resolve source folder (needed to detect source DPI) ────────
    var folder;
    if (CONFIG.sourceFolderPath) {
        folder = new Folder(CONFIG.sourceFolderPath);
        if (!folder.exists) {
            scriptAlert("Source folder not found:\n" + CONFIG.sourceFolderPath
                + "\n\nUpdate CONFIG.sourceFolderPath and try again.");
            return;
        }
    } else {
        folder = Folder.selectDialog("Select folder containing source PSD files");
        if (!folder) { log("[pipeline] cancelled."); return; }
    }
    log("[pipeline] source folder: " + folder.name);

    // ── Determine working resolution + document ────────────────────
    // Adopted doc's own resolution wins; otherwise the highest source-PSD resolution.
    var doc;
    if (app.documents.length > 0 && isValidTemplate(app.activeDocument)) {
        doc = app.activeDocument;
        CONFIG.sourceDPI = Math.round(doc.resolution) || CONFIG.templateDPI;
        log("[pipeline] adopted open template | resolution " + CONFIG.sourceDPI + " DPI");
    } else {
        var detected = detectSourceDpi(folder);
        CONFIG.sourceDPI = detected || CONFIG.templateDPI;
        doc = createTemplateDoc(CONFIG.sourceDPI);
    }
    log("[pipeline] template: " + doc.name + " | working DPI " + CONFIG.sourceDPI);
```

(The old `doc.resolution !== templateDPI` WARN block at lines 222-226 is removed — we now adopt the doc's actual resolution. The `dryRun` block and Step 1 onward that followed line 241 stay unchanged.)

- [ ] **Step 3: Add `sourceDPI` to the sidecar**

In `photoshop/Step5b_ExportHandoff.jsx`, `writeElementsFile`, replace the `data` initialisation (line 87):

```javascript
    var data = { psdWidth: psdW, psdHeight: psdH, sourceDPI: Math.round(doc.resolution), elements: [] };
```

- [ ] **Step 4: Run the PS integration golden and update it for the reordered pipeline lines**

Requires **Photoshop 2026** running. The fixture SKU is 300 DPI.
Run: `bash tests/integration/ps-build-elements/run.sh`
Expected: the diff shows ONLY pipeline-level informational changes — the early lines reorder (folder resolution now precedes template creation) and gain a `detected source DPI: 300 ...` line and a `template: Production Template | working DPI 300` line. **Every `[step1] ... -> resize to Npx` and `[step2] resized` line must be byte-identical** (still `690px`, `900px`, `615px`, `495px`, `525px`, `450px`, `540px`, `570px`). Review the diff to confirm exactly that, then regenerate the golden:

```bash
cp "$HOME/Desktop/PS_BuildElements.log" tests/integration/ps-build-elements/expected.txt   # or the log path run.sh prints
```

Re-run `run.sh` a second time and confirm it now PASSES and is deterministic. **If any `resize to` px value changed, STOP** — a physical-unit value didn't round-trip; do not update the golden, debug the rounding first.

- [ ] **Step 5: Inspect the sidecar to confirm `sourceDPI` is present**

Run: `grep -o '"sourceDPI":[0-9]*' /tmp/*_elements.json` (or the sidecar path the runner prints).
Expected: `"sourceDPI":300`.

- [ ] **Step 6: Commit**

```bash
git add pipelines/PS_BuildElements.jsx photoshop/Step5b_ExportHandoff.jsx
git commit -m "feat(ps): detect source PSD resolution, build template at it, carry in sidecar

Highest resolution among source PSDs (warn on mismatch), or an adopted doc's own
resolution. Stamped into _elements.json as sourceDPI. 300-DPI output unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Illustrator placement reads `sourceDPI` from the sidecar

The placement scale is already `72 / sourceDPI`; only the source of `sourceDPI` changes — from the hardcoded `CONFIG.sourceDPI: 300` to the sidecar value, with CONFIG as fallback.

**Files:**
- Modify: `illustrator/Step6_CreateCutlines.jsx` — `targetWidthPt` (line 61).
- Modify: `illustrator/Step7B_NestingImport.jsx` — `_nestArtFactor` (lines 862-867).
- Test: `tests/integration/ai-build-and-export-cutlines/run.sh`, `tests/integration/ai-import-nesting/run.sh` (regression, 300-DPI sidecars).

**Interfaces:**
- Consumes: sidecar `sourceDPI` (Task 2). Step 6 already holds `elementsData`; Step 7B's `_nestArtFactor` already receives `elementsData`.
- Produces: no signature changes — same physical placement size at any DPI.

- [ ] **Step 1: Step 6 — read `sourceDPI` from `elementsData`**

In `illustrator/Step6_CreateCutlines.jsx`, replace line 61:

```javascript
    var srcDpi = (elementsData.sourceDPI && elementsData.sourceDPI > 0)
        ? elementsData.sourceDPI : CONFIG.sourceDPI;
    if (!elementsData.sourceDPI) log("[step6] WARN | sidecar has no sourceDPI; falling back to " + srcDpi);
    var targetWidthPt = elementsData.psdWidth * (72.0 / srcDpi);
```

- [ ] **Step 2: Step 7B — read `sourceDPI` from `elementsData` in `_nestArtFactor`**

In `illustrator/Step7B_NestingImport.jsx`, replace the body of `_nestArtFactor` (lines 862-867):

```javascript
function _nestArtFactor(elementsData) {
    if (!elementsData || !elementsData.psdWidth) return 0;
    var dpi = (elementsData.sourceDPI && elementsData.sourceDPI > 0)
        ? elementsData.sourceDPI : CONFIG.sourceDPI;
    if (!dpi) return 0;
    if (!elementsData.sourceDPI) log("[step-nest] WARN | sidecar has no sourceDPI; falling back to " + dpi);
    var factor = 72.0 / dpi;
    return factor > 0 ? factor : 0;
}
```

- [ ] **Step 3: Patch the committed fixture sidecars to carry `sourceDPI`**

Post-Task-2, real PS output includes `sourceDPI`. The committed AI-side fixtures predate that, so add `"sourceDPI":300` to each so the tests exercise the real (non-fallback) path and no fallback WARN line appears:

```bash
for f in \
  tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting_elements.json \
  tests/integration/fixtures/import-nesting_elements.json \
  tests/integration/ai-build-and-export-cutlines/fixtures/traced-cutlines_elements.json ; do
  python3 - "$f" <<'PY'
import json,sys
p=sys.argv[1]
d=json.load(open(p))
d.setdefault("sourceDPI",300)
# preserve key order roughly: sourceDPI after psdWidth/psdHeight
open(p,"w").write(json.dumps(d))
print("patched",p)
PY
done
```

Verify: `grep -o '"sourceDPI":[0-9]*' tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting_elements.json` → `"sourceDPI":300`.

- [ ] **Step 4: Run the AI build + import goldens (regression) — geometry unchanged at 300**

Requires **Photoshop 2026 + Illustrator 2026** running (the build runner is two-phase).
Run: `bash tests/integration/ai-build-and-export-cutlines/run.sh`
Then: `bash tests/integration/ai-import-nesting/run.sh`
Expected: both PASS, unchanged vs their `expected.txt` (sidecar `sourceDPI:300` → factor `72/300`, identical geometry; no fallback WARN). Run each **2×**. If a WARN line appears, a fixture sidecar was missed in Step 3 — patch it, don't edit the golden.

- [ ] **Step 5: Commit**

```bash
git add illustrator/Step6_CreateCutlines.jsx illustrator/Step7B_NestingImport.jsx \
  tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting_elements.json \
  tests/integration/fixtures/import-nesting_elements.json \
  tests/integration/ai-build-and-export-cutlines/fixtures/traced-cutlines_elements.json
git commit -m "feat(ai): placement reads sourceDPI from the sidecar (fallback CONFIG/300)

Step 6 + Step 7B derive the 72/sourceDPI scale from _elements.json instead of a
hardcoded 300, so a 600-DPI source places at true physical size with 600-DPI art.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Illustrator export at the source DPI

Read `sourceDPI` from the sidecar beside the working `.ai` and export per-element PNGs at it. Folds in the two inline exporter edits already in the working tree (`jpegPreviewDpi`, `pngExportScale`).

**Files:**
- Modify: `pipelines/AI_ExportFinal.jsx` — CONFIG (lines 45-51, already edited in the working tree), `main()` (after line 79); add `_readSourceDpi` helper.
- Already-edited (uncommitted): `illustrator/Step10_AssetExport.jsx` (JPEG scale, lines 192-198). No further change — Step 10 already exports at `CONFIG.pngExportScale`.
- Test: `tests/integration/ai-export-final/run.sh` (regression).

**Interfaces:**
- Consumes: sidecar `sourceDPI` (Task 2), `CONFIG.pngExportScale` / `CONFIG.jpegPreviewDpi` (Step 10).
- Produces: `CONFIG.pngExportScale` set to `sourceDPI` at runtime before Step 10 runs.

- [ ] **Step 1: Add a `_readSourceDpi` helper**

In `pipelines/AI_ExportFinal.jsx`, add above `main()` (after line 64):

```javascript
// Reads sourceDPI from {base}_elements.json beside the working .ai. Returns 0 when the
// sidecar is absent/unreadable/lacks the field (caller falls back to the CONFIG default).
function _readSourceDpi(doc) {
    var base;
    try { base = doc.fullName.fsName.replace(/\.ai$/i, ""); } catch (e) { return 0; }
    if (!base) return 0;
    var f = new File(base + "_elements.json");
    if (!f.exists) return 0;
    f.encoding = "UTF-8";
    if (!f.open("r")) return 0;
    var text = f.read();
    f.close();
    if (!text) return 0;
    var data;
    try { data = JSON.parse(text); } catch (e) { return 0; }
    return (data && data.sourceDPI && data.sourceDPI > 0) ? data.sourceDPI : 0;
}
```

- [ ] **Step 2: Set `pngExportScale` from the sidecar in `main()`**

In `pipelines/AI_ExportFinal.jsx`, after the `log("[pipeline] document: " + doc.name);` line (line 79), insert:

```javascript
    // Export PNGs at the source resolution so a 600-DPI SKU stays native/lossless.
    var srcDpi = _readSourceDpi(doc);
    if (srcDpi > 0) {
        CONFIG.pngExportScale = srcDpi;
        log("[pipeline] per-element PNG export DPI = sourceDPI " + srcDpi + " (from sidecar)");
    } else {
        log("[pipeline] WARN | no sourceDPI in sidecar; per-element PNGs at CONFIG default "
            + CONFIG.pngExportScale + " DPI");
    }
```

- [ ] **Step 3: Run the export-final golden (regression)**

Requires **Illustrator 2026** running with the assembled fixture.
Run: `bash tests/integration/ai-export-final/run.sh`
Expected: PASS vs `expected.txt`. The log is geometry/count-based, so the DPI value does not change the golden; confirm the new `per-element PNG export DPI = sourceDPI 300` line does not break the comparison (if `expected.txt` is a strict full-log match, add that line to it as part of this step). Run **2×**.

- [ ] **Step 4: Commit (includes the working-tree exporter edits)**

```bash
git add pipelines/AI_ExportFinal.jsx illustrator/Step10_AssetExport.jsx tests/integration/ai-export-final/expected.txt
git commit -m "feat(ai): export per-element PNGs at the source DPI; JPEG preview at print density

AI_ExportFinal reads sourceDPI from the sidecar and sets pngExportScale; Step 10 JPEG
previews now render at jpegPreviewDpi (was the 72-DPI default). Fixes pixelated exports.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Documentation, memory, and manual 600-DPI validation

**Files:**
- Modify: `CLAUDE.md` — size-table / resolution notes.
- Modify: `pipelines/PS_BuildElements.jsx` — the size-table comment block already updated in Task 1; verify it reads correctly.
- Modify: memory `a3_resize_scaling.md` and `pending_artist.md` (paths under the memory dir).

- [ ] **Step 1: Update `CLAUDE.md`**

Under "Category resize targets", add a line noting sizes are stored in inches and multiplied by the detected source DPI; note the sidecar now carries `sourceDPI` and that Steps 6/7B/10 read it. Keep it to 3-4 lines in the existing style.

- [ ] **Step 2: Update memory**

In the memory dir, update `a3_resize_scaling.md` to record that `getTargetPx` is now `inches × sourceDPI` (was fixed px at 300) and that resolution flows end-to-end via the sidecar. Update `pending_artist.md` to drop `pngExportScale` from "pending confirmation" (now sidecar-driven). Add the one-line pointers to `MEMORY.md` if the summaries changed.

- [ ] **Step 3: Manual 600-DPI validation (cannot run headless — checklist)**

On a machine with both Adobe apps, run a **600-DPI source SKU** through Pipelines 1 → 3 and confirm, logging each result:
- Element physical sizes unchanged vs a 300-DPI run (measure a known element in mm).
- White edge physically unchanged (measure in mm).
- Sidecar `sourceDPI` = 600.
- Exported per-element PNGs are ~2× the pixel dimensions of the 300 case (`sips -g pixelWidth`), and visually crisp.
Record the outcome in the PR description. If anything is off, file it rather than adjusting silently.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: resolution-aware pipeline — inches-based sizing + sourceDPI flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the executor

- **No headless tests here.** Every `run.sh` needs the named Adobe app running; run them on the artist's machine. The `test-psUtils.jsx` unit runner (Task 1) is the fastest real-red/green loop.
- **Golden drift is the main risk.** If any 300-DPI golden changes, STOP — a physical-unit value doesn't round-trip. Do not "update the golden"; find the rounding error first (systematic-debugging).
- **Merge:** land the branch with a `--no-ff` merge into `main` and delete the branch (repo convention).
