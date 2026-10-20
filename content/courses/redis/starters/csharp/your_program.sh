#!/bin/sh
#
# Runs your program locally: compiles it (if needed), then executes it with the given arguments.

set -e

(
  cd "$(dirname "$0")"
  dotnet build --configuration Release --output /tmp/ccfree-build-redis-csharp codecrafters-redis.csproj
)

exec /tmp/ccfree-build-redis-csharp/codecrafters-redis "$@"
