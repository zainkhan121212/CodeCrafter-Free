#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

alr toolchain --select gnat_external gprbuild
alr build
