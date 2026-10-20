#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

dune build --build-dir /tmp/ccfree-build-shell-ocaml
