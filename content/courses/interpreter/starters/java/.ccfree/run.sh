#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

exec java --enable-preview -jar /tmp/ccfree-build-interpreter-java/codecrafters-interpreter.jar "$@"
