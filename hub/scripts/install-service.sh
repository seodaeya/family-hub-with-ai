#!/bin/bash
set -euo pipefail

HUB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.familyhub.hub.plist"

if [ -z "$NODE_BIN" ]; then
  echo "node 를 찾을 수 없습니다." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HUB_DIR/data"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.familyhub.hub</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$HUB_DIR/src/server.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$HUB_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HUB_HOST</key><string>0.0.0.0</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HUB_DIR/data/hub.log</string>
  <key>StandardErrorPath</key><string>$HUB_DIR/data/hub.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "설치 완료: $PLIST"
echo "로그: $HUB_DIR/data/hub.log"
echo "상태: launchctl list | grep familyhub"
