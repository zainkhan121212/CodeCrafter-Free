#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

zig build
