# Pipeline 1 — Hard-Stop on Failed Import + Quit Photoshop After Handoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halt Pipeline 1 immediately after Step 1 when any element fails to import, and quit Photoshop after a confirmed-successful Illustrator handoff.

**Architecture:** Two localized edits to `main()` in `pipelines/PS_BuildElements.jsx`. A guard after Step 1 returns early when `combineResult.notImported` is non-empty. A block at the end of `main()` quits the whole app when the handoff succeeded and the run is interactive. No step files or shared utils change.

**Tech Stack:** Adobe Photoshop ExtendScript (ES3 — no `let`/`const`, no arrow functions, no template literals).

## Global Constraints

- ES3 only: `var` declarations, function expressions, string concatenation with `+`. No `let`/`const`/arrow/template-literal.
- Log every branch with a `[pipeline]` prefix.
- Guard-and-log around any operation that can throw (`try/catch`), never let it abort `main()` uncleanly.
- `runCombine` / `photoshop/Step1_CombineElements.jsx` are **not** modified — they already produce `combineResult.notImported` (array of `{name, file, reason}`; reasons `folder` / `duplicate name` / `invalid name`).
- The integration test (`tests/integration/ps-build-elements/run.sh`) runs the PS phase with `suppressAlerts: true` and a blanked `CONFIG.aiPipelinePath`, so a clean fixture triggers neither new path — the golden `expected.txt` must remain byte-identical after this work.

---

### Task 1: Hard-stop after Step 1 on any failed import

**Files:**
- Modify: `pipelines/PS_BuildElements.jsx` — insert a guard between the Step 1 completion log and the Step 2 block (currently ~line 328), and remove the now-dead `notImportedWarning` prepend (currently ~line 447-448).

**Interfaces:**
- Consumes: `combineResult.notImported` (array), `notImportedWarning(notImported)` → string (both already defined in the file), `scriptAlert(msg)`, `log(msg)`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Insert the hard-stop guard**

In `main()`, find the Step 1 completion log immediately followed by the Step 2 header:

```javascript
    log("[pipeline] step 1 complete | " + combineResult.placed + " element(s) from "
        + combineResult.fileCount + " file(s).");

    // ── Step 2: Resize ─────────────────────────────────────────────
```

Insert the guard between them so it reads:

```javascript
    log("[pipeline] step 1 complete | " + combineResult.placed + " element(s) from "
        + combineResult.fileCount + " file(s).");

    // ── HARD STOP: any failed import aborts before Step 2 ──────────
    // A partial set is useless — the artist must fix the source PSD and re-run the whole
    // pipeline anyway, so there is no value in resizing / building / handing off the
    // survivors. Triggers on runCombine's recorded failures (folder / duplicate name /
    // invalid name). The rarer placement-time SKIP stays log-only by design.
    if (combineResult.notImported.length > 0) {
        log("[pipeline] HALT | " + combineResult.notImported.length
            + " element(s) failed to import — stopping before Step 2.");
        scriptAlert(notImportedWarning(combineResult.notImported)
            + "Pipeline stopped — nothing was handed to Illustrator.\n"
            + "Fix the source PSD and re-run Pipeline 1.");
        return;
    }

    // ── Step 2: Resize ─────────────────────────────────────────────
```

- [ ] **Step 2: Remove the now-dead `notImportedWarning` prepend**

Near the end of `main()`, find:

```javascript
    // Failed imports go at the TOP — most important, and the artist must fix + re-run.
    msg = notImportedWarning(combineResult.notImported) + msg;

    scriptAlert(msg);
```

The prepend is unreachable now (a non-empty `notImported` returns at the Step 1 guard; a clean import makes it an empty-string no-op). Delete the two prepend lines so it reads:

```javascript
    scriptAlert(msg);
```

- [ ] **Step 3: Verify ES3 + logic by reading the diff**

Run: `git -C /Users/joshuadelallana/sticker-production-scripts diff pipelines/PS_BuildElements.jsx`
Expected: only the guard insertion and the two-line prepend deletion appear; no `let`/`const`/arrow/template-literal introduced; the guard sits before the Step 2 header and uses `return;`.

- [ ] **Step 4: Commit**

```bash
git add pipelines/PS_BuildElements.jsx
git commit -m "$(cat <<'EOF'
feat(pipeline1): hard-stop after Step 1 on any failed element import

A partial import is useless — the artist fixes the source and re-runs the whole
pipeline anyway, so abort before Step 2 instead of building + handing off the
survivors. Removes the now-unreachable failed-import prepend on the success alert.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Quit Photoshop after a confirmed-successful handoff

**Files:**
- Modify: `pipelines/PS_BuildElements.jsx` — append a quit block at the end of `main()` after the completion `scriptAlert(msg)`, and add one line to the `aiStatus.ok` success-message branch.

**Interfaces:**
- Consumes: `aiStatus` (parsed JSON status object or null, from `handOffToIllustrator`), `CONFIG.dryRun`, `CONFIG.suppressAlerts`, `doc` (the working document), `app`, `SaveOptions`, `log`.
- Produces: nothing for later tasks (terminal behavior).

- [ ] **Step 1: Announce the impending quit in the success message**

Find the `aiStatus.ok` branch that builds `msg`:

```javascript
    if (aiStatus && aiStatus.ok) {
        msg = "✅ Elements built + cut traced.\n\n  " + summary + "\n\n"
            + "Illustrator has traced the cut and placed native caption text.\n"
            + "Review/reshape the captions in Illustrator, then run Pipeline 2 (Build and Export Cutlines).";
    } else if (aiStatus && aiStatus.error) {
```

Add the close notice to that branch (interactive quit happens below; in headless/test runs the quit is skipped, but the extra line is harmless in the log-only alert):

```javascript
    if (aiStatus && aiStatus.ok) {
        msg = "✅ Elements built + cut traced.\n\n  " + summary + "\n\n"
            + "Illustrator has traced the cut and placed native caption text.\n"
            + "Review/reshape the captions in Illustrator, then run Pipeline 2 (Build and Export Cutlines).\n\n"
            + "Photoshop will now close — continue in Illustrator.";
    } else if (aiStatus && aiStatus.error) {
```

- [ ] **Step 2: Append the quit block at the end of `main()`**

Find the end of `main()`:

```javascript
    scriptAlert(msg);
}
```

Insert the quit block between the alert and the closing brace so it reads:

```javascript
    scriptAlert(msg);

    // ── Work has moved to Illustrator — quit Photoshop ─────────────
    // Only when the handoff EXPLICITLY succeeded (aiStatus.ok), the run is interactive
    // (suppressAlerts false — tests/headless never quit the app they drive), and it is not
    // a dry run. A null/timeout/error handoff leaves PS open so the artist can retry. The
    // working PSD was already saved to disk before the handoff (saveWorkingDoc); closing it
    // DONOTSAVECHANGES discards only the transient dirtiness from the PNG/silhouette exports.
    if (!CONFIG.dryRun && !CONFIG.suppressAlerts && aiStatus && aiStatus.ok) {
        log("[pipeline] handoff confirmed OK — closing Photoshop.");
        try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (eClose) {
            log("[pipeline] WARN | could not close working doc: " + eClose.message);
        }
        try { app.quit(); } catch (eQuit) {
            log("[pipeline] WARN | app.quit() failed: " + eQuit.message);
        }
    }
}
```

- [ ] **Step 3: Verify ES3 + gating by reading the diff**

Run: `git -C /Users/joshuadelallana/sticker-production-scripts diff pipelines/PS_BuildElements.jsx`
Expected: the success-branch gains the "Photoshop will now close" line; the quit block appears after `scriptAlert(msg)`, guarded by `!CONFIG.dryRun && !CONFIG.suppressAlerts && aiStatus && aiStatus.ok`, with both `doc.close` and `app.quit` in their own `try/catch`; no ES5+ syntax.

- [ ] **Step 4: Commit**

```bash
git add pipelines/PS_BuildElements.jsx
git commit -m "$(cat <<'EOF'
feat(pipeline1): quit Photoshop after a confirmed-successful handoff

Once Illustrator confirms it received + traced the work (aiStatus.ok), the artist's
next actions are all in Illustrator, so close the working doc (already saved to disk)
and quit the app. Gated to interactive, non-dry runs only — tests/headless never quit
the app they drive; null/timeout/error handoffs leave PS open to retry.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Regression-check the golden integration test (Adobe required)

**Files:**
- No source changes. Runs `tests/integration/ps-build-elements/run.sh` against the clean `source-psds` fixture.

**Interfaces:**
- Consumes: the edits from Tasks 1–2.
- Produces: confirmation the happy path is byte-identical.

- [ ] **Step 1: Run the integration test (only if Adobe Photoshop 2026 + Illustrator are available)**

Run: `tests/integration/ps-build-elements/run.sh`
Expected: PASS. The clean fixture imports every element (no failures → no `[pipeline] HALT` line) and runs with `suppressAlerts: true` + blank `aiPipelinePath` (→ `aiStatus` null → quit block skipped), so the PS log still diffs clean against `expected.txt`. If Adobe is not installed, the runner prints `SKIP` and exits 0 — record that it was not run.

- [ ] **Step 2: Manual interactive validation checklist (owed; cannot be automated — quitting PS would kill any harness)**

Perform once in a real interactive Photoshop session and note the outcome:
- **Hard stop:** point Pipeline 1 at a source folder with one bad element (e.g. a top-level *group*, a duplicate name, or an invalid `[XX-YY]` name). Confirm the alert lists the failed element(s) and Photoshop does **not** proceed to resize / hand off; the log shows `[pipeline] HALT | ...` and no `[step2]` lines follow.
- **Quit on success:** run a clean SKU end-to-end with Illustrator open. Confirm that after the "✅ Elements built + cut traced … Photoshop will now close" alert is dismissed, the working PSD is saved on disk and Photoshop quits.
- **No quit on slow/failed handoff:** confirm that when Illustrator errors or exceeds the BridgeTalk timeout (`aiStatus` null), Photoshop stays open.

---

## Self-Review

- **Spec coverage:** §A hard stop → Task 1 (guard + dead-prepend removal, no-rollback, dry-run untouched). §B quit → Task 2 (interactive+ok+non-dry gating, DONOTSAVECHANGES close, `app.quit()`, close notice). Testing §→ Task 3 (golden regression + manual checklist). Out-of-scope items (dialog, placement-SKIP, runCombine changes) are respected — no task touches them.
- **Placeholder scan:** none — every code step shows the exact before/after.
- **Type consistency:** `combineResult.notImported` (array with `.length`), `notImportedWarning(...)` → string, `aiStatus` (object with `.ok`), `SaveOptions.DONOTSAVECHANGES`, `app.quit()` — all match existing usage in the file.
