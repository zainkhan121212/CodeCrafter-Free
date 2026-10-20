#!/bin/sh
#
# Runs your program. ccfree starts this for every test instance.

set -e

# Pinned CPU count. Any constant keeps incremental builds deterministic across
# different-core hosts; this value only affects build parallelism. 4 CPUs avoids
# oversubscription on the test runners. If you need to speed up the infrequent
# dependency/image builds, you can raise it toward the image-build host's core
# count. Test runs remain incremental either way.
NCPUS=1

dir="$(dirname "$0")"
SHIM=/tmp/codecrafters-cpushim.so
# If this fails for any reason, fall back to a shim-less build (which is still
# correct, it just won't have the incremental build optimisation across
# different-core hosts).
clang -shared -fPIC -o "$SHIM" "$dir/cpushim.c" -ldl 2>/dev/null || SHIM=""

LD_PRELOAD="$SHIM" FAKE_NPROC="$NCPUS" \
    swift build -c release --jobs "$NCPUS" --build-path /tmp/ccfree-build-redis-swift
