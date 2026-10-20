#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

LIBS_DIR="/tmp/codecrafters-libs-shell-kotlin"
BUILD_DIR="/tmp/ccfree-build-shell-kotlin"
KOTLIN_MAIN="$BUILD_DIR/classes/kotlin/main"
JVM_OPTS="--enable-native-access=ALL-UNNAMED --sun-misc-unsafe-memory-access=allow"

exec java $JVM_OPTS -cp "$KOTLIN_MAIN:$LIBS_DIR/*" AppKt "$@"
