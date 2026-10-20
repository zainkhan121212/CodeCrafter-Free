#!/bin/sh
#
# Compiles your program. ccfree runs this once before the tests start.

set -e

cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=${VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake
cmake --build ./build
