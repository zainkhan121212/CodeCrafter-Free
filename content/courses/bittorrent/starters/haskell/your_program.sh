#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  stack build
)

stackInstallRoot=$(cd $(dirname "$0") && stack path --local-install-root)
exec "$stackInstallRoot/bin/codecrafters-bittorrent-exe" "$@"
