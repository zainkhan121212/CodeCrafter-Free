#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

dart compile exe bin/main.dart -o compiled