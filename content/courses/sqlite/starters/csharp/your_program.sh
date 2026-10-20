#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  dotnet build --configuration Release --output /tmp/ccfree-build-sqlite-csharp codecrafters-sqlite.csproj
)

exec /tmp/ccfree-build-sqlite-csharp/codecrafters-sqlite "$@"
