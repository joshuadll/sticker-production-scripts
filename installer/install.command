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
# Finds the user-level Adobe support folder for each app (no admin required).
# Scripts placed here appear under File > Scripts in each app.

PS_SUPPORT=$(find "$HOME/Library/Application Support/Adobe" -maxdepth 1 -name "Adobe Photoshop*" -type d 2>/dev/null | sort -r | head -1)
AI_SUPPORT=$(find "$HOME/Library/Application Support/Adobe" -maxdepth 1 -name "Adobe Illustrator*" -type d 2>/dev/null | sort -r | head -1)

if [ -n "$PS_SUPPORT" ]; then
    mkdir -p "$PS_SUPPORT/Presets/Scripts"
    cp "$INSTALL_DIR/installer/generate-ps-actions.jsx" "$PS_SUPPORT/Presets/Scripts/Noteworthie Setup PS.jsx"
    echo "  Photoshop setup shortcut installed."
else
    echo "  Photoshop not found — skipping."
fi

if [ -n "$AI_SUPPORT" ]; then
    # AI uses en_US subfolder if present, otherwise fall back to Presets/Scripts
    if [ -d "$AI_SUPPORT/en_US" ]; then
        mkdir -p "$AI_SUPPORT/en_US/Scripts"
        cp "$INSTALL_DIR/installer/generate-ai-actions.jsx" "$AI_SUPPORT/en_US/Scripts/Noteworthie Setup AI.jsx"
    else
        mkdir -p "$AI_SUPPORT/Presets/Scripts"
        cp "$INSTALL_DIR/installer/generate-ai-actions.jsx" "$AI_SUPPORT/Presets/Scripts/Noteworthie Setup AI.jsx"
    fi
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
echo "  1. Restart Photoshop and Illustrator."
echo ""
echo "  2. In Photoshop:"
echo "       File > Scripts > Noteworthie Setup PS"
echo ""
echo "     In Illustrator:"
echo "       File > Scripts > Noteworthie Setup AI"
echo ""
echo "This adds the Noteworthie panel to the Actions"
echo "panel in each app. Scripts update automatically"
echo "on every login after that."
echo "============================================"
echo ""
read -r -p "Press Enter to close..." _
