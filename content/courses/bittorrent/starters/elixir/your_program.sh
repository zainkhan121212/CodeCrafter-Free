#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  mix escript.build
  mv codecrafters_bittorrent /tmp/ccfree-build-bittorrent-elixir
)

exec /tmp/ccfree-build-bittorrent-elixir "$@"
