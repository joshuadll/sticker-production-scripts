# Installer Distribution — always-latest, one-click for the artist

**Date:** 2026-07-02
**Status:** Design approved, pending spec review

## Problem

The remote artist needs a single, stable way to always download the **newest** installer, and the
distributable must never silently go stale. Two concrete failures motivate this:

1. **Staleness bug (found 2026-07-02):** the committed `installer/installer.zip` is hand-maintained.
   It was last rebuilt at commit `9a5a9f5`, *before* the caption-move (`fb697cb`) relocated Pipeline 2
   from Photoshop → Illustrator. So the committed zip still installs the old, broken menu structure.
   Any hand-built artifact will drift again.

2. **Unintuitive download:** a non-tech artist navigating GitHub's code view to find and download a
   file is hostile. The link must be paste-into-Notion, one-click, immediate-download.

Out of scope: changing the auto-update mechanism itself (`update.sh` + LaunchAgent), the menu-entry
model, or the pipeline code. This is purely about **how the artist obtains the installer**.

## Background — the two update layers (unchanged)

- **Pipeline code + assets** (`pipelines/`, `photoshop/`, `illustrator/`, `utils/`, `assets/`) —
  auto-update on every login via the LaunchAgent running `update.sh` (`rsync -a --delete`, excluding
  only `tests/`, `docs/`, `installer/`). Peel-tab assets (`assets/Peel_Tab_A.ai`, `Peel_Tab_B.ai`)
  ride this path; they are **not** bundled in the installer.
- **Menu entries** (the "Noteworthie N" items in each app's bundle Scripts folder) — written only by
  `install.command`. `update.sh` never touches the bundle. A *menu-set* change (add/move/rename an
  entry) is the only thing that requires the artist to re-run the installer. Code-only changes do not.

Because re-installs are rare (only on menu-set changes), the per-download Gatekeeper friction is
infrequent — a handful of times a year, not routine.

## Design

### 1. Auto-publishing GitHub Action (the core fix)

A workflow publishes the installer as a GitHub **Release asset** so a permanent URL always serves the
newest build, and the artifact is never hand-maintained.

- **Trigger:** push to `main` touching paths that can change the installer or the menu set —
  `installer/**`, `pipelines/**`, plus `workflow_dispatch` for manual re-publish.
- **Build:** zip the `installer/` **directory** (folder-wrapped) so the asset expands to
  `installer/install.command` + `installer/update.sh` — a tidy folder in Downloads, never two loose
  scripts. This preserves the structure the current committed zip already has.
- **Publish:** create/update a single dedicated Release whose asset is `installer.zip`. Because it is
  the repo's only/newest release, GitHub's `latest` resolves to it.
- **Result:** the maintainer never rebuilds the zip by hand; the staleness bug becomes structurally
  impossible.

### 2. The permalink (what goes on Notion)

`https://github.com/joshuadll/sticker-production-scripts/releases/latest/download/installer.zip`

This URL redirects to the newest asset served as an *attachment*, so a click triggers an **immediate
download** — it does not open a GitHub page. Pasted into Notion as a link/button, one click = the zip
lands in Downloads. Bookmark/paste once; it always serves the latest.

### 3. Delete the committed `installer.zip`

The Action becomes the sole source of the distributable. Remove `installer/installer.zip` from the repo
and add it to `.gitignore` so it can't be re-committed and drift again.

### 4. Gatekeeper guidance lives on the artist-facing page (external only)

`install.command` cannot instruct the artist past its own Gatekeeper block: the "unidentified
developer" dialog fires *before* the script runs, so any console output never reaches the user until
they have already gotten past it. (Verified 2026-07-02: `install.command` contains **no** Gatekeeper
text today — there is nothing stale in it to fix; the earlier "right-click → Open" claim was wrong.)
Therefore the Gatekeeper instructions live solely on the artist-facing distribution page (§5), which
is what the artist reads *before* opening the file. The current, correct flow (macOS Sequoia/Tahoe):

> 1. Double-click `install.command` → it's blocked → dismiss the dialog.
> 2. Open **System Settings → Privacy & Security**.
> 3. Scroll to the **Security** section → *"install.command was blocked…"* → click **Open Anyway**.
> 4. Authenticate (Touch ID / password) → **Open** to confirm.

### 5. Notion page copy (maintainer owns the page; spec provides the copy)

- A **Download Installer** button → the permalink above.
- The 4-step Gatekeeper flow (from §4).
- The 2 post-install steps already in `install.command`: fully **Cmd+Q** both Photoshop & Illustrator
  (closing the window is not enough), then run a step from **File > Scripts** ("Noteworthie 1–6").
- A one-line note: "If the menu items ever vanish after an Adobe update, download and run this again."

## Gatekeeper decision (settled)

**Instructions-only**, no code-signing. Rationale: re-downloads are rare, so the per-download "Open
Anyway" dance is infrequent, and signing requires enrolling in the Apple Developer Program ($99/yr) +
Developer ID cert + notarization. **Notarization is the documented upgrade path** if the Settings flow
ever becomes a genuine recurring annoyance — it is the only way to remove the warning entirely.
Rejected alternatives: `xattr -c` (needs Terminal — worse for non-tech), `spctl --master-disable`
(system-wide security downgrade).

## Non-goals / explicitly unchanged

- `update.sh`, the LaunchAgent, and the menu-entry model are untouched.
- Peel-tab assets need no installer bundling — they sync via `update.sh` (`assets/` is not excluded).
- No change to which pipelines exist or how they're wired.

## Success criteria

- One Notion link that always one-click-downloads the newest folder-wrapped `installer.zip`.
- The zip is produced only by CI on relevant `main` changes; no hand-maintained copy in the repo.
- The artist-facing distribution doc describes the correct (Settings → Open Anyway) Gatekeeper flow.
- An artist who runs the freshly downloaded installer gets the current menu set (Pipeline 2 in
  Illustrator), and peel tabs work after the next login (assets already synced).

## Open implementation details (for the plan, not the design)

- Exact release tag/naming and the `gh release` vs. `softprops/action-gh-release` mechanism.
- Whether the Action also fires on changes to `utils/**` / step files (only relevant if a future menu
  entry ever depends on them; currently the menu set lives entirely in `install.command`).
