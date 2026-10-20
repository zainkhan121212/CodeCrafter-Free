#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec java --enable-native-access=ALL-UNNAMED --enable-preview -jar /tmp/ccfree-build-claude-code-java/codecrafters-claude-code.jar "$@"
