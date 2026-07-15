#!/bin/bash

SUPPORT_DIR="$HOME/Library/Application Support/Noteworthie"
INSTALL_DIR="$SUPPORT_DIR/scripts"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_LABEL="com.noteworthie.scripts-update"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$PLIST_LABEL.plist"
UPDATE_SCRIPT="$SUPPORT_DIR/update.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

trap 'echo ""; echo "Something went wrong. Screenshot this window and send it to Joshua."; read -r -p "Press Enter to close..." _' ERR

echo "Installing Noteworthie Scripts..."
echo ""

# ── 1. Download scripts ────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
mkdir -p "$LAUNCH_AGENTS_DIR"

cp "$SCRIPT_DIR/update.sh" "$UPDATE_SCRIPT"
chmod +x "$UPDATE_SCRIPT"

if ! bash "$UPDATE_SCRIPT"; then
    echo ""
    echo "Download failed — check your internet connection and run this installer again."
    read -r -p "Press Enter to close..." _
    exit 1
fi
if [ ! -d "$INSTALL_DIR/pipelines" ] || [ -z "$(ls -A "$INSTALL_DIR/pipelines" 2>/dev/null)" ]; then
    echo ""
    echo "Download failed — no scripts were installed. Check your internet connection and run this installer again."
    read -r -p "Press Enter to close..." _
    exit 1
fi
echo "  ↓ Downloaded latest scripts"
echo "  (enter your Mac password if prompted)"

# ── 2. Install one Scripts-menu entry per pipeline ────────────────────────────
# Each pipeline becomes its own "Noteworthie N - ..." item under File > Scripts.
# Each item is a thin wrapper that runs the real pipeline from the auto-updating
# scripts folder (so the menu entries stay tiny and never need re-installing when
# the pipeline code changes). The Scripts folder is inside the app bundle, which
# is root-owned — requires sudo.

# install_entry <scripts-dir> <#target app> <menu name> <pipeline filename>
install_entry() {
    local scripts_dir="$1"; local target="$2"; local menu_name="$3"; local pipeline="$4"
    sudo tee "$scripts_dir/$menu_name.jsx" >/dev/null <<WRAP
#target $target
(function () {
    var f = new File((new File("~")).fsName + "/Library/Application Support/Noteworthie/scripts/pipelines/$pipeline");
    if (!f.exists) {
        alert("Noteworthie script not found:\n" + f.fsName + "\n\nRe-run the Noteworthie installer.");
        return;
    }
    \$.evalFile(f);
})();
WRAP
    sudo chmod 755 "$scripts_dir/$menu_name.jsx"
}

PS_APP=$(find /Applications -maxdepth 1 -name "Adobe Photoshop*" -type d 2>/dev/null | sort -r | head -1)
AI_APP=$(find /Applications -maxdepth 1 -name "Adobe Illustrator*" -type d 2>/dev/null | sort -r | head -1)

if [ -n "$PS_APP" ]; then
    PS_SCRIPTS="$PS_APP/Presets/Scripts"
    sudo mkdir -p "$PS_SCRIPTS"
    # Clear any prior Noteworthie entries (old launcher, setup scripts, renamed steps)
    sudo find "$PS_SCRIPTS" -maxdepth 1 -name "Noteworthie*.jsx" -delete 2>/dev/null
    install_entry "$PS_SCRIPTS" "photoshop" "Noteworthie 1 - Build Elements" "PS_BuildElements.jsx"
    echo "  ✓ Photoshop   — 1 script"
else
    echo "  ✗ Photoshop not found — skipped"
fi

if [ -n "$AI_APP" ]; then
    AI_SCRIPTS=$(find "$AI_APP" -maxdepth 4 -path "*/en_US/Scripts" -type d 2>/dev/null | head -1)
    if [ -z "$AI_SCRIPTS" ]; then
        AI_SCRIPTS="$AI_APP/Presets/Scripts"
    fi
    sudo mkdir -p "$AI_SCRIPTS"
    sudo find "$AI_SCRIPTS" -maxdepth 1 -name "Noteworthie*.jsx" -delete 2>/dev/null
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 2 - Build & Export Cutlines" "AI_BuildAndExportCutlines.jsx"
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 3 - Import Nesting"  "AI_ImportNesting.jsx"
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 4 - Normalise Captions" "AI_NormaliseCaptions.jsx"
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 5 - Layout QA"       "AI_LayoutQA.jsx"
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 6 - Export Final"    "AI_ExportFinal.jsx"
    echo "  ✓ Illustrator — 5 scripts"
else
    echo "  ✗ Illustrator not found — skipped"
fi

echo ""

# ── 3. Install LaunchAgent (auto-update on every login) ───────────────────────
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${UPDATE_SCRIPT}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>StandardErrorPath</key>
    <string>${SUPPORT_DIR}/update-error.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

# ── Desktop "Update Noteworthie" force-update command ─────────────────────────
DESKTOP_CMD="$HOME/Desktop/Update Noteworthie.command"
cat > "$DESKTOP_CMD" <<EOF
#!/bin/bash
echo "Updating Noteworthie scripts..."
bash "$UPDATE_SCRIPT"
S="$SUPPORT_DIR/update-status.txt"
if [ -f "\$S" ]; then
    inst=\$(grep '^installed=' "\$S" | cut -d= -f2 | cut -c1-7)
    ok=\$(grep '^ok=' "\$S" | cut -d= -f2)
    if [ "\$ok" = "1" ]; then
        echo "Up to date — version \$inst"
        echo "Now re-run your step from File > Scripts (no need to restart the app)."
    else
        echo "Updates aren't reaching this Mac. Check your connection, then try again."
    fi
fi
read -r -p "Press Enter to close..." _
EOF
chmod +x "$DESKTOP_CMD"
echo "  ✓ Desktop      — Update Noteworthie.command"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Installed."
echo ""
echo "DO THIS ONCE:"
echo "  1. Fully QUIT Photoshop & Illustrator — press Cmd+Q"
echo "     (closing the window isn't enough), then reopen."
echo "  2. Run a step from File > Scripts (the \"Noteworthie 1-6\" items)."
echo ""
echo "Pipelines auto-update on login. If the menu items ever vanish"
echo "after an Adobe update, run this installer again."
echo ""
read -r -p "Press Enter to close..." _
