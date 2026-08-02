#!/bin/bash
# macOS launcher — double-click in Finder to start the app in dev mode.
# Mirror of "Launch App.bat" for Windows.
cd "$(dirname "$0")" || exit 1

# Finder double-clicks don't load your shell profile, and Node here is
# installed via nvm — so put Node on PATH ourselves before running npm.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
if ! command -v npm >/dev/null 2>&1; then
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Could not find npm/node. Is Node installed (via nvm) on this machine?"
  echo "Press any key to close."; read -r -n 1; exit 1
fi

npm run dev
