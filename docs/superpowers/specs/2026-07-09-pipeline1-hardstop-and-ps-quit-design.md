# Pipeline 1 — hard-stop on failed import + quit Photoshop after handoff

Date: 2026-07-09
Scope: `pipelines/PS_BuildElements.jsx` (`main()` only)

## Problem

Two independent quality-of-life fixes to Pipeline 1 (`PS_BuildElements`):

1. **Partial imports are useless.** Today, when `runCombine` (Step 1) can't import one
   or more source-PSD element layers, it records them in `combineResult.notImported`,
   logs them, and the pipeline **keeps going** — resize, white edge, group, silhouette,
   PNG export, and the BridgeTalk handoff to Illustrator all run on the surviving
   elements. The failed-import list is only surfaced as a warning at the top of the
   final completion alert. Because the artist has to fix the source PSD and re-run the
   whole pipeline anyway, building + handing off a partial set is wasted work and a
   footgun (a partial sheet could be carried forward by mistake).

2. **Photoshop stays open after the work has moved to Illustrator.** Once the BridgeTalk
   handoff succeeds, the artist's next actions all happen in Illustrator, but Photoshop
   is left running.

## Solution

### A. Hard stop after Step 1 on any failed import

Add a guard in `main()` immediately after Step 1 completes (after the existing
`log("[pipeline] step 1 complete ...")`, before the Step 2 block):

- `combineResult.notImported.length === 0` → continue unchanged.
- `combineResult.notImported.length > 0` →
  - `log("[pipeline] HALT | " + N + " element(s) failed to import — stopping before Step 2.")`
  - `scriptAlert(notImportedWarning(combineResult.notImported) + "Pipeline stopped — nothing was handed to Illustrator.\nFix the source PSD and re-run Pipeline 1.")`
  - `return;`

Triggers are the three reasons `runCombine` already records: `folder`, `duplicate name`,
`invalid name`. The rarer placement-time SKIP (a layer that passed the pre-scan but
couldn't be re-found at duplication time) stays **log-only** — it is not recorded in
`notImported` and does not halt (explicit decision; keeps scope to the known-failure set).

Consequences:

- **No rollback.** The partially-placed template is left open. A re-run clears it via
  `clearElementLayers` at the start of Step 1, so rolling back to the pre-combine
  snapshot buys nothing.
- **Dead-code cleanup.** The failure path now `return`s before line ~448, where the
  success summary prepends `notImportedWarning(combineResult.notImported)`. That prepend
  is now unreachable on the failure path (and always a no-op on the success path, since a
  clean import means `notImported` is empty). Remove the prepend so the success alert is
  built without it.
- **Dry run unchanged.** The dry-run branch already `return`s early after reporting
  `notImportedWarning`; it does not reach the new guard, so it keeps only-report behavior.

### B. Quit Photoshop after a successful handoff

At the end of `main()`, after the completion `scriptAlert(msg)`:

Quit Photoshop only when **all** of these hold:
- not a dry run (`!CONFIG.dryRun`), and
- interactive (`!CONFIG.suppressAlerts`) — integration tests and any headless run set
  `suppressAlerts` and must **never** quit the app they are driving, and
- `aiStatus && aiStatus.ok` — Illustrator explicitly confirmed it received and traced the
  work.

Any other handoff outcome (null / timeout / error) leaves Photoshop open so the artist can
retry or inspect. In particular, the "success but slow" case — Illustrator takes longer
than the 20s BridgeTalk window, so `aiStatus` returns null and the pipeline shows the
"⏳ still tracing" message — intentionally does **not** auto-close.

Behavior when the conditions hold:

- The success alert text (`aiStatus.ok` branch of `msg`) gains a line such as
  *"Photoshop will now close — continue in Illustrator."* so the quit is not a surprise.
- After the artist dismisses the alert:
  - `doc.close(SaveOptions.DONOTSAVECHANGES)` — the working PSD was already saved to disk
    before the handoff (`saveWorkingDoc`); this discards only the transient "dirty" state
    the silhouette/PNG exports leave in memory, so the clean on-disk file is preserved.
  - `app.quit()` — quits the **whole** application. If the artist has other, unrelated
    documents open, Photoshop's normal quit flow prompts to save any that are dirty, so
    there is no silent data loss.

Wrap the `close` and `quit` in individual `try/catch` (guard-and-log) so a failure to
close a doc doesn't prevent the quit, and neither aborts `main()` uncleanly.

## Files touched

- `pipelines/PS_BuildElements.jsx` — `main()` only. Two edits (the Step-1 guard, the
  end-of-main quit block) plus the line-448 prepend removal. `runCombine` /
  `Step1_CombineElements.jsx` are **unchanged**.

## Testing

`tests/integration/ps-build-elements/` drives the real pipeline via the two-phase runner.

- **Hard stop:** run with a fixture that contains at least one un-importable layer (a
  grouped element, a duplicate name, or a bad name). Assert the log contains the
  `[pipeline] HALT |` line and that **no** `[step2]` lines follow it. Tests run with
  `suppressAlerts` true, so the alert is log-only and the pipeline returns without a
  modal.
- **Quit gating:** the existing clean-import test runs with `suppressAlerts` true, so the
  quit block is skipped (its `!CONFIG.suppressAlerts` guard) and the app stays up for the
  runner's post-run assertions / Phase 2. No test exercises `app.quit()` (it can't —
  quitting would kill the harness); the quit path is interactive-only and covered by the
  guard, documented here and validated manually.

## Out of scope

- Interactive proceed/stop dialog (considered, rejected in favor of a plain hard stop).
- Recording / halting on the placement-time SKIP.
- Any change to `runCombine`, the failure reasons, or the sidecar/handoff mechanics.
