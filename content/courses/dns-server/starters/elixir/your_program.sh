#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  mix escript.build
  mv codecrafters_dns_server /tmp/ccfree-build-dns-server-elixir
)

exec /tmp/ccfree-build-dns-server-elixir "$@"
