# Version Visibility & Update Signal — Design

**Date:** 2026-07-15
**Status:** Design — pending review

## Problem

When debugging with the remote artist, the developer cannot tell **which version of
the pipeline scripts the artist is actually running**. Asking the artist to "run the
update" is not verifiable — there is no way to confirm the update took effect, so a
debugging session can be spent on code the artist doesn't have.

**Objective:** the artist's scripts self-report their version, so (1) the developer can
identify the exact code that ran, and (2) both parties can see whether that code is
current.

## How distribution actually works (the constraints this design must respect)

Investigated in the repo — three facts shape the whole design:

1. **Scripts are not CI-built.** `update.sh` (run by a macOS LaunchAgent at login)
   downloads the raw `main` branch zip and `rsync`s it into
   `~/Library/Application Support/Noteworthie/scripts/`. CI
   (`publish-installer.yml`) builds only the installer, never the scripts. So there is
   **no release step to bake a version constant into**.

2. **Running version = last-synced version.** The File > Scripts menu items are thin
   wrappers that `$.evalFile` the real pipeline **fresh from disk on every run**. So
   Adobe's launch-time script cache does not stale the pipeline code — the code that
   runs is exactly what `update.sh` last wrote to disk. Consequently, **"quit and
   reopen the app" does nothing** to update code; only `update.sh` running does.

3. **The pipeline cannot query GitHub.** ExtendScript has no HTTPS (its `Socket` is
   plain TCP, no TLS) and Illustrator has no `app.system()` to shell out. Only
   `update.sh` (bash) can reach GitHub. Therefore the up-to-date signal **must be
   sourced from files that `update.sh` writes** — the pipeline only reads local files.

## Design overview

Three cooperating pieces:

1. **`update.sh`** becomes version-aware: cheap SHA precheck, syncs only when changed,
   and writes a status file recording installed SHA, latest SHA, and check time.
2. **A LaunchAgent timer** (add `StartInterval` = 3600s) keeps the artist current
   passively — on login *and* every 60 minutes while logged in.
3. **A shared read-only helper** in both util files reads the status file and formats a
   one-line signal that every pipeline prints in its **completion alert** and **log
   banner**.

Plus an on-demand **`Update Noteworthie.command`** (Desktop, bash) for the "I just
pushed a fix, pull it now" moment — because no timer interval is short enough for a live
debug session, and Illustrator can't force the update from ExtendScript.

## Component 1 — `update.sh` (version-aware sync)

Location of state: `~/Library/Application Support/Noteworthie/` (the SUPPORT_DIR,
**parent** of the synced `scripts/` folder). This is deliberate — `rsync --delete`
manages only `scripts/`, so a status file in the parent survives every sync.

On each run:

1. Fetch the latest `main` commit SHA cheaply:
   `git ls-remote https://github.com/joshuadll/sticker-production-scripts.git main`
   (~1 KB; no full download). Capture success/failure.
2. Read the currently-installed SHA from `update-status.txt` if present.
3. **If the fetch failed** (offline): leave scripts untouched, write `ok=0` + a fresh
   `checked` timestamp, keep the existing `installed` value. Exit.
4. **If latest == installed**: no download. Refresh `checked` + `latest` + `ok=1`.
5. **If latest != installed (or no installed yet)**: `curl` the full `main.zip`, `rsync`
   as today, then write `installed=<latest>`.

Status file `update-status.txt` (plain `key=value`, one per line — trivial for
ExtendScript to parse):

```
installed=<full 40-char sha>
latest=<full 40-char sha>
checked=<epoch seconds>
ok=1
```

`checked` is epoch seconds (`date +%s`) so the ExtendScript helper can compute an age by
subtraction without fragile date parsing. The legacy `last-synced.txt` timestamp is
superseded by `checked` and can be retired.

## Component 2 — LaunchAgent timer

In `install.command`, add one key to the generated plist (alongside the existing
`RunAtLoad`):

```xml
<key>StartInterval</key><integer>3600</integer>   <!-- every 60 min while logged in -->
```

Behavior (standard launchd): runs at login and hourly thereafter, independent of whether
Photoshop/Illustrator is open. macOS coalesces missed ticks (sleep/off → one catch-up run
after wake), never starts overlapping runs, and may stretch the interval on battery. The
SHA precheck makes an idle tick ~1 KB, so hourly is cheap. Chosen at 60 min (faster than
Sparkle's daily default) because the driver is a live debug loop, not passive currency.

Because sync lands on disk regardless of Adobe, and each run re-reads from disk, an
already-open app picks up new code on its **next run — no restart**.

## Component 3 — shared version helper (both util files)

`psUtils.jsx` and `aiUtils.jsx` are separate and already duplicate small helpers
(`log`, `scriptAlert`). Add the same two functions to both:

- `readVersionStatus(rootPath)` → resolves SUPPORT_DIR as `File(rootPath).parent`, reads
  `update-status.txt`, returns
  `{ installedSha, latestSha, checkedEpoch, ok, state }` where `state` is one of
  `upToDate | updateAvailable | stale | unknown`.
- `formatVersionStatus(status, appName)` → returns the one-line string to print.

State logic (`STALE_SECONDS = 3 * 3600`):

| Condition | state | line |
|---|---|---|
| file missing / `installed` empty | `unknown` | *(omitted from alert; log `version: unknown`)* |
| `ok=0` **or** `now − checked > STALE_SECONDS` | `stale` | `⚠ Update check is stale — reconnect to the internet  ·  version <short>` |
| `installed != latest` | `updateAvailable` | `⚠ Update available — double-click "Update Noteworthie" on your Desktop, then re-run  ·  version <short>` |
| otherwise | `upToDate` | `✓ Up to date  ·  version <short>` |

`<short>` = `installedSha.substring(0,7)` — always the **installed** SHA (the code that
actually ran), which is what the developer diffs against `main`. Fail-safe: any missing
data degrades to `unknown` (a bare version if we have one, else nothing) — never a false
✓ or ⚠.

## Component 4 — `Update Noteworthie.command` (on-demand force-update)

`install.command` drops a double-clickable `Update Noteworthie.command` on the Desktop
that runs `update.sh` and prints the result in its Terminal window. This is bash (so it
works for both apps, sidestepping constraint #3) and is the "pull my fix now" action for
a live debug session — the artist double-clicks it, then re-runs their step (no app
restart needed). Forcing via a `.command` is preferred over "log out and back in"
(disruptive) and over an ExtendScript menu entry (Illustrator can't invoke bash).

## Integration into the pipelines

Each of the 6 pipeline `main()` functions gets a minimal edit:

- **Log banner:** include the version in the existing start line, e.g.
  `[pipeline] === PS_BuildElements start (version a1b2c3d) ===`.
- **Completion alert:** append the `formatVersionStatus(...)` line to the **success**
  alert (and to error alerts too — version is useful when reporting a failure).
- **`Log:` path line:** unchanged — stays on **error/warning** alerts only (current
  behavior). We do not add it to success alerts.

App name passed to `formatVersionStatus` comes from what each pipeline already targets
("Photoshop" for `PS_BuildElements`, "Illustrator" for the AI pipelines) — the only
per-app difference in any message.

## Message examples (final wording)

```
Build & Export — Done
28 elements, 0 unmatched.
✓ Up to date  ·  version a1b2c3d
```
```
Build Elements — Done
…
⚠ Update available — double-click "Update Noteworthie" on your Desktop, then re-run  ·  version 9f8e7d6
```
```
…
⚠ Update check is stale — reconnect to the internet  ·  version 9f8e7d6
```

## Error handling / fail-safe

- No `update-status.txt` (dev machine, or never synced): helper returns `unknown`; alert
  shows no status line, log records `version: unknown`. Never a false claim.
- Offline / GitHub unreachable at check time: `ok=0` → `stale` message; scripts untouched.
- Corrupt/partial status file: any parse failure → `unknown`.
- Mid-run sync: the running pipeline finishes on already-loaded code (`evalFile` read it
  at invocation); next run gets the new code. `rsync` writes temp-then-rename, so no
  half-written-file read.

## Testing

- **`update.sh` (bash):** unit test in a staged temp SUPPORT_DIR with a stubbed
  `git ls-remote`/`curl` — assert: unchanged SHA → no download + refreshed `checked`;
  changed SHA → download path + `installed` updated; fetch failure → `ok=0`, scripts
  untouched. Assert `update-status.txt` shape.
- **Helper state mapping:** exercise `readVersionStatus`/`formatVersionStatus` against
  staged `update-status.txt` fixtures covering all four states (upToDate,
  updateAvailable, stale, unknown), asserting the exact line.
- **Pipeline integration:** in the existing per-pipeline integration runners, stage a
  known `update-status.txt` and assert the log banner contains `version <sha>` and the
  success path renders the expected status line.

## Scope / out of scope

- **In:** version-aware `update.sh`, hourly timer, shared read helper, the four-state
  signal in every pipeline's alert + log, the Desktop force-update command.
- **Out:** CI-side release builds for the scripts (distribution stays raw-`main`);
  semver/CalVer naming (the SHA is the identifier); any change to the menu-set install
  flow; auto-applying updates without the artist re-running the step.

## Files touched

- `installer/update.sh` — SHA precheck, conditional sync, write `update-status.txt`.
- `installer/install.command` — add `StartInterval` to the plist; drop
  `Update Noteworthie.command` on the Desktop.
- `utils/psUtils.jsx`, `utils/aiUtils.jsx` — add `readVersionStatus` +
  `formatVersionStatus`.
- `pipelines/*.jsx` (all 6) — version in log banner + status line in completion alert.
- Tests — `update.sh` bash test + helper state fixtures + integration assertions.
- Docs — `docs/installer-artist-instructions.md` (mention the Desktop update command);
  `CLAUDE.md` note as needed.
