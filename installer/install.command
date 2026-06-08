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
bash "$UPDATE_SCRIPT"
echo ""

# ── 2. Install action setup scripts into PS and AI Scripts menus ──────────────
# Scripts must go into the app bundle — requires admin password (sudo).
echo "Installing setup shortcuts into Photoshop and Illustrator..."
echo "(You may be prompted for your Mac password — this is normal.)"
echo ""

PS_APP=$(find /Applications -maxdepth 1 -name "Adobe Photoshop*" -type d 2>/dev/null | sort -r | head -1)
AI_APP=$(find /Applications -maxdepth 1 -name "Adobe Illustrator*" -type d 2>/dev/null | sort -r | head -1)

if [ -n "$PS_APP" ]; then
    PS_DEST="$PS_APP/Presets/Scripts/NoteworthieSetupPS.jsx"
    sudo mkdir -p "$PS_APP/Presets/Scripts"
    sudo cp "$INSTALL_DIR/installer/generate-ps-actions.jsx" "$PS_DEST"
    sudo chmod 755 "$PS_DEST"
    echo "  Photoshop setup shortcut installed."
else
    echo "  Photoshop not found — skipping."
fi

if [ -n "$AI_APP" ]; then
    AI_SCRIPTS=$(find "$AI_APP" -maxdepth 4 -path "*/en_US/Scripts" -type d 2>/dev/null | head -1)
    if [ -z "$AI_SCRIPTS" ]; then
        AI_SCRIPTS="$AI_APP/Presets/Scripts"
    fi
    AI_DEST="$AI_SCRIPTS/NoteworthieSetupAI.jsx"
    sudo mkdir -p "$AI_SCRIPTS"
    sudo cp "$INSTALL_DIR/installer/generate-ai-actions.jsx" "$AI_DEST"
    sudo chmod 755 "$AI_DEST"
    echo "  Illustrator setup shortcut installed."
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
echo "     are open. Press Cmd+Q in each app — closing"
echo "     the window is NOT enough, the app keeps running"
echo "     in the background and won't see the new scripts."
echo ""
echo "  2. Reopen Photoshop and Illustrator."
echo ""
echo "  3. In Photoshop:"
echo "       File > Scripts > NoteworthieSetupPS"
echo ""
echo "     In Illustrator:"
echo "       File > Scripts > NoteworthieSetupAI"
echo ""
echo "This adds the Noteworthie panel to the Actions"
echo "panel in each app. Scripts update automatically"
echo "on every login after that."
echo "============================================"
echo ""
read -r -p "Press Enter to close..." _
