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

# ── 2. Install the Noteworthie launcher into PS and AI Scripts menus ───────────
# The launcher (File > Scripts > Noteworthie) opens a dialog of pipeline buttons.
# It must live inside the app bundle, which is root-owned — requires sudo.
echo "Installing the Noteworthie launcher into Photoshop and Illustrator..."
echo "(You may be prompted for your Mac password — this is normal.)"
echo ""

# install_launcher <app-label> <scripts-dir> <source-jsx> [stale-name ...]
# Copies the launcher in as Noteworthie.jsx, then deletes any stale launcher
# names from earlier installer versions. Copy-before-remove so a failed copy
# never leaves the app with no launcher at all.
install_launcher() {
    local label="$1"; local scripts_dir="$2"; local src="$3"; shift 3
    sudo mkdir -p "$scripts_dir"
    sudo cp "$INSTALL_DIR/installer/$src" "$scripts_dir/Noteworthie.jsx"
    sudo chmod 755 "$scripts_dir/Noteworthie.jsx"
    local stale
    for stale in "$@"; do
        sudo rm -f "$scripts_dir/$stale"
    done
    echo "  $label launcher installed."
}

PS_APP=$(find /Applications -maxdepth 1 -name "Adobe Photoshop*" -type d 2>/dev/null | sort -r | head -1)
AI_APP=$(find /Applications -maxdepth 1 -name "Adobe Illustrator*" -type d 2>/dev/null | sort -r | head -1)

if [ -n "$PS_APP" ]; then
    install_launcher "Photoshop" "$PS_APP/Presets/Scripts" "noteworthie-panel-ps.jsx" \
        "NoteworthieSetupPS.jsx" "Noteworthie Setup PS.jsx"
else
    echo "  Photoshop not found — skipping."
fi

if [ -n "$AI_APP" ]; then
    AI_SCRIPTS=$(find "$AI_APP" -maxdepth 4 -path "*/en_US/Scripts" -type d 2>/dev/null | head -1)
    if [ -z "$AI_SCRIPTS" ]; then
        AI_SCRIPTS="$AI_APP/Presets/Scripts"
    fi
    install_launcher "Illustrator" "$AI_SCRIPTS" "noteworthie-panel-ai.jsx" \
        "NoteworthieSetupAI.jsx" "Noteworthie Setup AI.jsx"
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
echo "       File > Scripts > Noteworthie"
echo "     then click the pipeline you want to run."
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
