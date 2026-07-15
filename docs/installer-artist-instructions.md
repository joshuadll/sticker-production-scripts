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

## Automatic updates

The scripts check for updates every hour and install them automatically in the background.
To force an update right now, double-click **Update Noteworthie** on the Desktop, then
re-run the step you were working on. No app restart is needed.

When reporting a problem to Joshua, please read him the `version …` line shown at the end
of the completion dialog (after the script finishes).

## When do I need to re-run this?

Almost never. The scripts update themselves automatically every time you log in. You only
need to download and run the installer again if the **File > Scripts menu items disappear**
(this can happen after a big Adobe update).
