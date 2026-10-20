#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

go build -o /tmp/ccfree-build-http-server-go app/*.go
