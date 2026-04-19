#!/bin/bash
# Lariat Cockpit — double-click to launch the kitchen app.
# First run installs deps + builds (~2 min). After that, starts in seconds.

set -e
cd "$(dirname "$0")/.."

clear
echo "═══════════════════════════════════════════"
echo "       THE LARIAT — Kitchen Cockpit"
echo "═══════════════════════════════════════════"
echo ""

# ── Node check ────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js is not installed."
  echo ""
  echo "Install from https://nodejs.org (LTS)"
  echo "Then double-click this file again."
  echo ""
  read -p "Press return to close…"
  exit 1
fi

# ── First-run install ─────────────────────────
if [ ! -d "node_modules" ]; then
  echo "First run — installing (about a minute)…"
  npm install --production=false
  echo ""
  echo "✓ Installed."
  echo ""
fi

# ── Build if needed ───────────────────────────
if [ ! -d ".next" ] || [ "$(find app lib styles public -newer .next/BUILD_ID -type f 2>/dev/null | head -1)" ]; then
  echo "Building for production…"
  npm run build
  echo ""
  echo "✓ Built."
  echo ""
fi

# ── LAN IP for iPads ─────────────────────────
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")

echo "Starting…"
echo ""
echo "  This Mac:   http://localhost:3000"
if [ -n "$LAN_IP" ]; then
  echo "  iPads:      http://$LAN_IP:3000"
fi
echo ""
echo "Ctrl-C to stop."
echo "═══════════════════════════════════════════"
echo ""

# ── Auto-open browser once server is up ───────
# First run (no install marker) opens /install for the one-click PWA install.
# Later runs open Today. If the app is already running standalone, the browser tab is harmless.
INSTALL_MARKER=".lariat_install_opened"
if [ -f "$INSTALL_MARKER" ]; then
  OPEN_PATH=""
else
  OPEN_PATH="/install"
  touch "$INSTALL_MARKER"
fi

(
  # Wait up to 30s for the server to answer before opening a browser tab.
  for i in $(seq 1 60); do
    if curl -sf -o /dev/null --max-time 1 "http://localhost:3000$OPEN_PATH"; then
      # Prefer Chrome (best PWA install UX); fall back to default browser.
      if open -Ra "Google Chrome" 2>/dev/null; then
        open -a "Google Chrome" "http://localhost:3000$OPEN_PATH"
      else
        open "http://localhost:3000$OPEN_PATH"
      fi
      break
    fi
    sleep 0.5
  done
) &

npm run start
