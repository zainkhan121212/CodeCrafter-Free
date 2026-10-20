#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

mix escript.build
mv codecrafters_sqlite /tmp/ccfree-build-sqlite-elixir
