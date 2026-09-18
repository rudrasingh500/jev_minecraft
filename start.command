#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  if [[ -x "$runtime/node" ]]; then export PATH="$runtime:$PATH"; fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22 or later, then run this again.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  echo 'Run npm install in this folder first.'
  exit 1
fi
if [[ -n "${1:-}" ]]; then
  export MC_PORT="$1"
elif [[ -t 0 ]]; then
  read "lan_port?Enter the Open to LAN port shown by Minecraft: "
  if [[ -n "$lan_port" ]]; then export MC_PORT="$lan_port"; fi
fi
exec node --env-file-if-exists=.env src/main.js
