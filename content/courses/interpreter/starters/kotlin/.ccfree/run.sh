#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

LIBS_DIR="/tmp/codecrafters-libs-interpreter-kotlin"
BUILD_DIR="/tmp/ccfree-build-interpreter-kotlin"
KOTLIN_MAIN="$BUILD_DIR/classes/kotlin/main"

exec java -cp "$KOTLIN_MAIN:$LIBS_DIR/*" AppKt "$@"
