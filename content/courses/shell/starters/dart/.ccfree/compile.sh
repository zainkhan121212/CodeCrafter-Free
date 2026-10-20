#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

dart pub get
dart compile exe bin/main.dart -o /tmp/ccfree-build-shell-dart
