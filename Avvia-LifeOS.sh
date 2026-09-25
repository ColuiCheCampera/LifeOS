#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use 24 >/dev/null
fi
npm run local
