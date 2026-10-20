#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

crystal build -o /tmp/ccfree-build-redis-crystal app/main.cr
