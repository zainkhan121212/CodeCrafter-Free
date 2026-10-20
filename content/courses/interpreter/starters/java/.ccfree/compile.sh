#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

mvn -q -B package -Ddir=/tmp/ccfree-build-interpreter-java
