#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

LIBS_DIR="/tmp/codecrafters-libs-redis-kotlin"
BUILD_DIR="/tmp/ccfree-build-redis-kotlin"
KOTLIN_MAIN="$BUILD_DIR/classes/kotlin/main"
KOTLIN_JVM_OPTS="-J--enable-native-access=ALL-UNNAMED -J--sun-misc-unsafe-memory-access=allow"

if [ -d "$LIBS_DIR" ] && [ "$(ls -A "$LIBS_DIR" 2>/dev/null)" ] && command -v kotlinc >/dev/null 2>&1; then

  mkdir -p "$KOTLIN_MAIN"
  find app/src/main/kotlin -type f -name '*.kt' -exec kotlinc $KOTLIN_JVM_OPTS -cp "$(echo "$LIBS_DIR"/*.jar | tr ' ' ':')" -d "$KOTLIN_MAIN" {} +
else

  gradle installDist
  mkdir -p "$LIBS_DIR"
  for f in "$BUILD_DIR/install/app/lib/"*.jar; do
    [ "$(basename "$f")" != "app.jar" ] && cp "$f" "$LIBS_DIR/"
  done
fi
