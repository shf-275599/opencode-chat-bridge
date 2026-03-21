#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TASK_NAME="opencode-im-bridge"
TRIGGER="login"
REMOVE=0
CONFIG_ID=""
BUN_PATH="${BUN_PATH:-$(command -v bun || true)}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/setup-autostart.sh [options]

Options:
  --trigger login|startup   Autostart timing. Linux user systemd always behaves like login.
  --bun-path PATH           Explicit bun binary path.
  --repo-root PATH          Explicit repository root.
  --task-name NAME          Service/agent name. Default: opencode-im-bridge
  --config-id ID            Optional configuration identifier.
  --remove                  Remove autostart configuration.
  -h, --help                Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --trigger)
      TRIGGER="${2:-}"
      shift 2
      ;;
    --bun-path)
      BUN_PATH="${2:-}"
      shift 2
      ;;
    --repo-root)
      REPO_ROOT="${2:-}"
      shift 2
      ;;
    --task-name)
      TASK_NAME="${2:-}"
      shift 2
      ;;
    --config-id)
      CONFIG_ID="${2:-}"
      shift 2
      ;;
    --remove)
      REMOVE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BUN_PATH" ]]; then
  echo "Could not find 'bun' in PATH. Install Bun first or pass --bun-path." >&2
  exit 1
fi

if [[ ! -x "$BUN_PATH" ]]; then
  echo "bun is not executable: $BUN_PATH" >&2
  exit 1
fi

if [[ ! -d "$REPO_ROOT" ]]; then
  echo "Repository root does not exist: $REPO_ROOT" >&2
  exit 1
fi

OS_NAME="$(uname -s)"
LAUNCHER_PATH="$SCRIPT_DIR/unix-start-bridge.sh"

install_linux() {
  local service_dir="$HOME/.config/systemd/user"
  local service_path="$service_dir/${TASK_NAME}.service"

  mkdir -p "$service_dir"

  cat > "$service_path" <<EOF
[Unit]
Description=OpenCode IM Bridge
After=default.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
ExecStart=$LAUNCHER_PATH $REPO_ROOT $CONFIG_ID
Environment=BUN_PATH=$BUN_PATH
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable "$TASK_NAME" >/dev/null
  systemctl --user restart "$TASK_NAME"

  cat <<EOF
Installed Linux user service: $service_path
Manage it with:
  systemctl --user status $TASK_NAME
  systemctl --user restart $TASK_NAME
  ./scripts/setup-autostart.sh --remove
EOF
}

remove_linux() {
  local service_dir="$HOME/.config/systemd/user"
  local service_path="$service_dir/${TASK_NAME}.service"

  systemctl --user disable --now "$TASK_NAME" >/dev/null 2>&1 || true
  rm -f "$service_path"
  systemctl --user daemon-reload
  echo "Removed Linux user service: $service_path"
}

install_macos() {
  local agent_dir="$HOME/Library/LaunchAgents"
  local plist_path="$agent_dir/com.${TASK_NAME}.plist"

  mkdir -p "$agent_dir"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.${TASK_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>$LAUNCHER_PATH</string>
        <string>$REPO_ROOT</string>
        <string>$CONFIG_ID</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>BUN_PATH</key>
        <string>$BUN_PATH</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/${TASK_NAME}.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/${TASK_NAME}.error.log</string>
</dict>
</plist>
EOF

  launchctl unload "$plist_path" >/dev/null 2>&1 || true
  launchctl load "$plist_path"

  cat <<EOF
Installed macOS launch agent: $plist_path
Manage it with:
  launchctl list | grep $TASK_NAME
  launchctl unload $plist_path
  ./scripts/setup-autostart.sh --remove
EOF
}

remove_macos() {
  local plist_path="$HOME/Library/LaunchAgents/com.${TASK_NAME}.plist"
  launchctl unload "$plist_path" >/dev/null 2>&1 || true
  rm -f "$plist_path"
  echo "Removed macOS launch agent: $plist_path"
}

case "$OS_NAME" in
  Linux)
    if [[ $REMOVE -eq 1 ]]; then
      remove_linux
    else
      install_linux
    fi
    ;;
  Darwin)
    if [[ $REMOVE -eq 1 ]]; then
      remove_macos
    else
      install_macos
    fi
    ;;
  *)
    echo "Unsupported OS: $OS_NAME" >&2
    exit 1
    ;;
esac
