#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

mix escript.build
mv codecrafters_dns_server /tmp/ccfree-build-dns-server-elixir
