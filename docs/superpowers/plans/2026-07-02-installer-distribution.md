# Installer Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the artist one permanent Notion link that always one-click-downloads the newest folder-wrapped `installer.zip`, produced only by CI so it can never go stale.

**Architecture:** A GitHub Actions workflow zips the `installer/` directory (folder-wrapped) on relevant `main` pushes and publishes it as the asset of a single, explicitly-latest GitHub Release; the artist link is the stable `releases/latest/download/installer.zip` permalink. The hand-maintained committed zip is deleted and gitignored so CI is the sole source. Gatekeeper guidance lives only in an artist-facing doc (the Notion copy), because `install.command` cannot instruct past its own pre-execution Gatekeeper block.

**Tech Stack:** GitHub Actions (YAML), `zip`/`unzip` (macOS + Linux built-ins), `softprops/action-gh-release@v2`, Markdown.

## Global Constraints

- Repo (public, artist pulls from here): `github.com/joshuadll/sticker-production-scripts`.
- The auto-updater `installer/update.sh` rsyncs the repo excluding only `tests/`, `docs/`, `installer/`. Do NOT change this behavior.
- The distributable zip MUST be **folder-wrapped**: unzipping yields an `installer/` folder containing `install.command` + `update.sh`, never two loose files.
- The permalink handed to the artist is exactly: `https://github.com/joshuadll/sticker-production-scripts/releases/latest/download/installer.zip`
- `installer/install.command` and `installer/update.sh` are the only files that belong in the zip. `installer/.DS_Store` is untracked (gitignored) and must never appear in the asset.
- The correct macOS Sequoia/Tahoe Gatekeeper flow (verbatim, for the artist doc): (1) double-click → blocked → dismiss; (2) System Settings → Privacy & Security; (3) Security section → "…was blocked" → **Open Anyway**; (4) authenticate → **Open**.
- Gatekeeper handling is **instructions-only**; notarization is the documented future upgrade, NOT implemented here.
- Do not touch the pre-existing uncommitted working-tree changes that are unrelated to this work (`assets/Stamp Cutline Template.ai` deletion, `*.log` files). Stage only the files each task names.

---

### Task 1: Remove the hand-maintained `installer.zip` and gitignore it

Deletes the stale committed artifact so CI becomes the sole source and it can never be re-committed to drift again. Must land before the workflow, so the workflow never zips a stale zip into itself.

**Files:**
- Delete: `installer/installer.zip`
- Modify: `.gitignore` (append an entry)

**Interfaces:**
- Produces: a repo with no tracked `installer/installer.zip`; `installer/` now contains only `install.command` + `update.sh` as tracked files. Task 3's zip step relies on this.

- [ ] **Step 1: Remove the tracked zip**

Run:
```bash
git rm installer/installer.zip
```
Expected: `rm 'installer/installer.zip'`.

- [ ] **Step 2: Gitignore it so it can't come back**

Append to `.gitignore` (after the `tmp-verify/` block):
```
# Installer distributable — built and published by CI (see .github/workflows/publish-installer.yml),
# never committed. The artist downloads it from the GitHub Releases "latest" permalink.
installer/installer.zip
```

- [ ] **Step 3: Verify it's gone and ignored**

Run:
```bash
git ls-files installer/ && echo "---" && git check-ignore installer/installer.zip
```
Expected: the file list shows only `installer/install.command` and `installer/update.sh`; the second line prints `installer/installer.zip` (confirming it is ignored).

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(installer): stop committing installer.zip; CI publishes it instead"
```

---

### Task 2: GitHub Action — build & publish the folder-wrapped `installer.zip` to the latest Release

The core deliverable. On relevant `main` pushes (and manual dispatch), zip the `installer/` folder and publish it as the asset of a single Release explicitly marked latest, so the permalink always resolves.

**Files:**
- Create: `.github/workflows/publish-installer.yml`

**Interfaces:**
- Consumes: the tracked `installer/install.command` + `installer/update.sh` (Task 1 guarantees no `installer.zip` among them).
- Produces: a Release tagged `installer` marked as latest, with a folder-wrapped `installer.zip` asset reachable at the Global-Constraints permalink.

- [ ] **Step 1: Verify the zip command produces a folder-wrapped archive (local test)**

This is the one piece of workflow logic testable offline. Run from the repo root:
```bash
rm -f /tmp/installer-test.zip
zip -r /tmp/installer-test.zip installer -x 'installer/.DS_Store' 'installer/installer.zip' >/dev/null
unzip -l /tmp/installer-test.zip
```
Expected: the listing contains exactly `installer/install.command` and `installer/update.sh` (each under the `installer/` prefix), and NO `.DS_Store`, NO `installer.zip`, NO loose top-level files.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/publish-installer.yml`:
```yaml
name: Publish installer

# Rebuild and publish installer.zip whenever the installer itself changes, or the
# menu-entry set (which lives in install.command) could have changed. Manual dispatch
# lets the maintainer force a republish.
on:
  push:
    branches: [main]
    paths:
      - 'installer/**'
      - '.github/workflows/publish-installer.yml'
  workflow_dispatch:

permissions:
  contents: write   # required to create/update the Release and upload the asset

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build folder-wrapped installer.zip
        run: |
          rm -f installer.zip
          # Zip the installer/ DIRECTORY so the archive is folder-wrapped:
          # unzipping yields installer/install.command + installer/update.sh.
          zip -r installer.zip installer -x 'installer/.DS_Store' 'installer/installer.zip'
          echo "--- asset contents ---"
          unzip -l installer.zip

      - name: Publish to the 'installer' Release (marked latest)
        uses: softprops/action-gh-release@v2
        with:
          tag_name: installer
          name: Installer (latest)
          body: |
            Auto-published by CI from `installer/`. Always the newest build.
            Artist download link:
            https://github.com/joshuadll/sticker-production-scripts/releases/latest/download/installer.zip
          files: installer.zip
          prerelease: false
          make_latest: true
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-installer.yml
git commit -m "ci(installer): auto-publish folder-wrapped installer.zip to the latest Release"
```

- [ ] **Step 4: Post-merge manual verification (cannot run in CI-less local env)**

GitHub Actions cannot be exercised offline; verify after this branch is merged to `main`
(the push triggers the workflow; or run it via the Actions tab → "Publish installer" → Run workflow):
- [ ] Actions run "Publish installer" completes green; its log's `unzip -l` shows only `installer/install.command` + `installer/update.sh`.
- [ ] A Release tagged `installer` exists, is marked **Latest**, and lists `installer.zip` as an asset.
- [ ] In a browser, visiting `https://github.com/joshuadll/sticker-production-scripts/releases/latest/download/installer.zip` downloads the zip immediately (no GitHub page).
- [ ] Unzipping the downloaded file yields an `installer/` folder (not loose files), containing `install.command` + `update.sh`.

---

### Task 3: Artist-facing distribution doc (the Notion copy)

The single home for the artist instructions — download link, Gatekeeper flow, and post-install steps. Version-controlled in the repo so it's reviewable; the maintainer copies it into Notion. (Lives under `docs/`, which the auto-updater excludes — correct, it's maintainer-facing, not shipped to the artist's machine.)

**Files:**
- Create: `docs/installer-artist-instructions.md`

**Interfaces:**
- Consumes: the permalink from the Global Constraints; the Gatekeeper flow from the Global Constraints.
- Produces: nothing other code depends on (terminal documentation deliverable).

- [ ] **Step 1: Write the doc**

Create `docs/installer-artist-instructions.md`:
```markdown
# Installing / Updating the Noteworthie Scripts (artist)

This is the copy for the Notion "Install the Scripts" page. Keep it in sync with this file.

## 1. Download

**[⬇︎ Download Installer](https://github.com/joshuadll/sticker-production-scripts/releases/latest/download/installer.zip)**

This always downloads the newest installer. It lands in your **Downloads** folder as
`installer.zip`. Double-click it to unzip — you'll get an `installer` folder with
`install.command` inside.

## 2. Run it (first time you'll see a security warning — this is expected)

Double-click **install.command**. macOS will block it with an "unidentified developer"
message. That's normal for our in-house tool. To allow it (you only do this per download):

1. Click **Done** to dismiss the warning.
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the **Security** section. You'll see: *"install.command was blocked to
   protect your Mac."* Click **Open Anyway**.
4. Confirm with **Open**, and authenticate with Touch ID or your Mac password.

`install.command` will now run and set everything up.

## 3. After it finishes — do this once

1. Fully **QUIT** Photoshop and Illustrator with **Cmd+Q** (closing the window is not
   enough — the app has to actually quit), then reopen them.
2. Run a step from **File > Scripts** — the **"Noteworthie 1–6"** items.

## When do I need to re-run this?

Almost never. The scripts update themselves automatically every time you log in. You only
need to download and run the installer again if the **File > Scripts menu items disappear**
(this can happen after a big Adobe update).
```

- [ ] **Step 2: Verify the link and flow are exact**

Run:
```bash
grep -c "releases/latest/download/installer.zip" docs/installer-artist-instructions.md
grep -n "Open Anyway" docs/installer-artist-instructions.md
```
Expected: the first prints `1` (permalink present); the second shows the "Open Anyway" step. Confirm by eye that the permalink host is `github.com/joshuadll/sticker-production-scripts` and the 4 Gatekeeper steps match the Global Constraints.

- [ ] **Step 3: Commit**

```bash
git add docs/installer-artist-instructions.md
git commit -m "docs(installer): artist-facing install/update instructions (Notion copy)"
```

---

## Post-implementation (maintainer, after merge to main)

Not code tasks — the human maintainer does these once:
- [ ] Confirm Task 2 Step 4's verification checklist all passes.
- [ ] Paste `docs/installer-artist-instructions.md` into the Notion "Install the Scripts" page, wiring the Download button to the permalink.
- [ ] Send the artist the Notion page once; they bookmark it.
