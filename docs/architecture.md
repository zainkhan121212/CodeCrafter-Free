# Architecture and release boundaries

## Components

`lib/catalog.mjs` is browser-compatible curriculum data: stable challenge/stage IDs, requirements, examples, hints and references. `lib/cases.mjs` holds executable cases, including generated SQLite and compressed Git fixtures.

`bin/ccfree.mjs` creates starters and invokes `lib/runner.mjs`. The runner spawns an explicit executable without a shell, serializes input, bounds runtime and captured output, parses output as JSON and performs structural equality comparisons. One OS process is started per check. Each stage aggregates actual check results. Unknown challenge/stage IDs fail rather than yielding an empty pass.

`server.mjs` is a loopback-only, read-only dashboard server. Fixed asset routes prevent arbitrary file serving. Host and Origin checks constrain browser access. It never accepts submission commands. CLI reports are individual UUID-named files to avoid concurrent writers overwriting a shared report database.

The browser uses `lib/reports.mjs` validation, escaped text rendering, latest-report-per-stage progress, and local storage. Import supports one runner report or a progress-export array. The static build has the same UI but no report API. Hosted usage is explicit manual import.

## Testing model

Foundation stages use deterministic JSON adapters. This removes language-specific process arguments from beginner lessons and keeps tests free of external services. It also limits fidelity: a parser that passes HTTP component tests is not a validated HTTP server.

The current test suite validates fixture expectations using reference implementations, then separately runs those implementations through the process runner. Negative tests cover wrong answers, invalid JSON, exit failure, missing executable, timeouts, output caps and unknown IDs. HTTP checks use an actual loopback listener.

This release is tested with Node.js on Windows. Python starters are generated but a Python runtime was unavailable in this environment. Other languages require installed runtimes and their own JSON adapters.

## What a hosted judge would require

1. Account and repository identity with per-user authorization.
2. A submission API that enqueues immutable source snapshots, never executing inside the web service.
3. Dedicated isolated workers with no host credentials, denied external network by default, read-only base images, process/file/memory/CPU limits and complete process-tree cleanup.
4. A versioned language-image matrix and challenge-specific protocol harnesses.
5. Durable report storage, queue observability, cancellation and retention policies.
6. A Git receiver or GitHub integration with verified event signatures.
7. Abuse controls and a funded compute/storage budget.

Do not deploy the local CLI behind a public HTTP route. The current timeout/output bounds are not a sandbox.

## Curriculum expansion

Each challenge should add real protocol adapters before claiming full-system coverage: TCP/RESP for Redis, TCP HTTP request lifecycles, UDP DNS resolution, Kafka wire-level interoperability, SQLite file/query fixtures, Git filesystem/plumbing behavior, actual shell process execution, peer exchange, and real model adapters for the AI agent.

Keep stage IDs stable, version changing contracts, test failures as well as successes, and explicitly disclose unsupported behaviors. The public product comparison and broader backlog are in `research.md`.
