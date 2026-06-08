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

echo "Downloading latest scripts..."
if ! bash "$UPDATE_SCRIPT"; then
    echo ""
    echo "Download failed — could not fetch the latest scripts."
    echo "Check your internet connection and run this installer again."
    read -r -p "Press Enter to close..." _
    exit 1
fi
echo ""

# ── 2. Install one Scripts-menu entry per pipeline ────────────────────────────
# Each pipeline becomes its own "Noteworthie N - ..." item under File > Scripts.
# Each item is a thin wrapper that runs the real pipeline from the auto-updating
# scripts folder (so the menu entries stay tiny and never need re-installing when
# the pipeline code changes). The Scripts folder is inside the app bundle, which
# is root-owned — requires sudo.
echo "Installing the Noteworthie scripts into Photoshop and Illustrator..."
echo "(You may be prompted for your Mac password — this is normal.)"
echo ""

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
    install_entry "$PS_SCRIPTS" "photoshop" "Noteworthie 1 - Build Elements"          "PS_BuildElements.jsx"
    install_entry "$PS_SCRIPTS" "photoshop" "Noteworthie 2 - Build & Export Cutlines" "PSAI_BuildAndExportCutlines.jsx"
    echo "  Photoshop scripts installed (2 entries)."
else
    echo "  Photoshop not found — skipping."
fi

if [ -n "$AI_APP" ]; then
    AI_SCRIPTS=$(find "$AI_APP" -maxdepth 4 -path "*/en_US/Scripts" -type d 2>/dev/null | head -1)
    if [ -z "$AI_SCRIPTS" ]; then
        AI_SCRIPTS="$AI_APP/Presets/Scripts"
    fi
    sudo mkdir -p "$AI_SCRIPTS"
    sudo find "$AI_SCRIPTS" -maxdepth 1 -name "Noteworthie*.jsx" -delete 2>/dev/null
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 3 - Import Nesting"  "AI_ImportNesting.jsx"
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 4 - Refine Cutlines" "AI_RefineCutlines.jsx"
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 5 - Export Final"    "AI_ExportFinal.jsx"
    install_entry "$AI_SCRIPTS" "illustrator" "Noteworthie 6 - Nesting QA"      "AI_NestingQA.jsx"
    echo "  Illustrator scripts installed (4 entries)."
else
    echo "  Illustrator not found — skipping."
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
    <key>StandardErrorPath</key>
    <string>${SUPPORT_DIR}/update-error.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

# ── Done ───────────────────────────────────────────────────────────────────────
echo "============================================"
echo "  Installation complete!"
echo "============================================"
echo ""
echo "ONE-TIME SETUP (do this now, only once):"
echo ""
echo "  1. FULLY QUIT Photoshop and Illustrator if they"
echo "     are open. Closing the window (clicking the red"
echo "     dot) is NOT enough — the app keeps running in"
echo "     the background and won't see the new scripts."
echo ""
echo "     To fully quit:"
echo "       a. Click the app so it is in front."
echo "       b. Press Command (cmd) + Q together,"
echo "          OR use the menu bar at the very top:"
echo "          'Photoshop' > 'Quit Photoshop'"
echo "          'Illustrator' > 'Quit Illustrator'."
echo "       c. Tip: a still-running app shows a dot under"
echo "          its Dock icon. No dot = fully quit."
echo ""
echo "  2. Reopen Photoshop and Illustrator."
echo ""
echo "  3. To run a pipeline, in Photoshop or Illustrator:"
echo "       File > Scripts > Noteworthie N - <name>"
echo "     Each pipeline is its own entry, in order:"
echo "       Photoshop:    1 - Build Elements"
echo "                     2 - Build & Export Cutlines"
echo "       Illustrator:  3 - Import Nesting"
echo "                     4 - Refine Cutlines"
echo "                     5 - Export Final"
echo "                     6 - Nesting QA"
echo ""
echo "The pipeline scripts update automatically on every"
echo "login, so you only ever do this setup once."
echo ""
echo "NOTE: if 'Noteworthie' ever disappears from the"
echo "Scripts menu after Photoshop or Illustrator updates"
echo "itself, just run this installer again."
echo "============================================"
echo ""
read -r -p "Press Enter to close..." _
