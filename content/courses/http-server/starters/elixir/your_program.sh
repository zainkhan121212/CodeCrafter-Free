#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  mix escript.build
  mv codecrafters_http_server /tmp/ccfree-build-http-server-elixir
)

exec /tmp/ccfree-build-http-server-elixir "$@"
