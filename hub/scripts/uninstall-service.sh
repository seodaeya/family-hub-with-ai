#!/bin/bash
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.familyhub.hub.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "자동 실행을 해제했습니다."
