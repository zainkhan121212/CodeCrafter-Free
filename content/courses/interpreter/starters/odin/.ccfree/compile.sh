#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

mkdir -p /tmp/ccfree-build-interpreter-odin
odin build src -out:/tmp/ccfree-build-interpreter-odin/main
