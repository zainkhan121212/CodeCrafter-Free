# Research: REA and CodeCrafters

Reviewed 2026-10-20. This is a bounded source and public-product investigation, not a claim that every line of REA or every authenticated CodeCrafters feature was audited. Nothing in REA was installed or executed. No CodeCrafters source bundle, paid curriculum, hidden tests, credentials, or private backend was obtained.

## Evidence vocabulary

- **Verified source:** directly read in the pinned REA checkout.
- **Verified public behavior/documentation:** visible in the linked official pages; documented behavior was not necessarily exercised.
- **Proposed:** an independent implementation decision for CodeCrafter Free.
- **Unknown:** not established by the evidence. Missing coverage is never a passing result.

## 1. REA repository identity and size

Source: https://github.com/morluto/rea

Pinned checkout: `4eaf3a117b3f4863a994b9be743ec5bc1501e16c`. `package.json` identifies `rea-agents` version `6.7.0`, ESM, with `rea` and `rea-agents` executables dispatching through `scripts/rea.mjs`. Its Node ranges are `^22.19.0 || ^24.11.0 || >=26.0.0`; npm is pinned to `11.16.0`. These are requirements of this research tool, not requirements for CodeCrafter Free.

Inventory found 3,697 files under `src` and `tests`, including 1,718 paths matching `.test.`. This is a file count, not a passed-test count. The repository is substantially larger than a small website-recreation script. The MIT root license permits reuse with preservation of its copyright/license notice; third-party notices and submodule licenses require separate consideration. This project does not incorporate REA source.

### Actual architecture

| Layer | Inspected source or inventory | Responsibility and consequence |
| --- | --- | --- |
| Executable adapter | `package.json`, `src/cli.ts`, `src/main.ts` | CLI command registration and long-lived MCP service are separate adapters. MCP defaults to stdio; HTTP is opt-in. |
| Configuration/startup | `src/main.ts` | Snapshots environment, parses config, constructs session, opens initial target, starts transport, then registers cleanup. Unexpected startup errors are projected rather than directly exposed. |
| Composition | `src/composition/binary.ts` | Shared production wiring gives CLI and MCP the same provider selection and session semantics. Native candidates include Hopper, Ghidra, IDA, and Kuna; auxiliary providers load separately. |
| Provider registry | `src/application/binary/AnalysisProviderRegistry.ts` | Validates unique provider identities and operation provenance. Selection returns explicit availability, support, binding, and unknown states. Providers are sorted rather than relying on registration order. |
| Application workflows | `src/application/` inventory, `docs/architecture.mermaid` | Use-case orchestration, binary sessions, investigations, JavaScript reconstruction. Interfaces separate workflows from adapters. |
| Evidence ledger | `src/application/investigation/EvidenceLedger.ts` | Immutable, session-owned evidence keyed by identity. Duplicate identical evidence is idempotent; conflicting content is rejected. Entire imports validate before atomic merge. Residual unknowns have independent revisions. |
| Browser adapters | `src/browser/`, browser documentation | CDP observation, Playwright scenarios, script capture, bundle analysis, screenshots, event listeners, runtime coverage, and comparison. Observations and actions are intentionally different capabilities. |
| JavaScript analysis | dependency list and JavaScript architecture | Babel AST parsing, ASAR input, source maps, application graphs and recovery. A static relationship does not establish runtime execution. |
| Native/other formats | source directory inventory | Native engines, .NET, Android, firmware, WebAssembly, EVM, SQLite, packet captures, Go/Rust and related metadata are independent adapters. Most are irrelevant to reproducing a web learning platform. |
| Resource boundary | `src/browser/PlaywrightExecutionBoundary.ts`, worker protocol | Cancellation/deadline handling and owned-resource cleanup. Bundle worker defines 1,024 MiB heap, 30-second script timeout, 300-second aggregate timeout, 64 KiB protocol and 8 MiB result limits. These are analysis bounds, not a sandbox for arbitrary learner code. |
| Contract/domain layer | inventory and architecture | Typed schemas, error categories, evidence and comparison logic; pure domain computations can be tested without external engines. |

### Dependencies and external prerequisites

Verified direct dependencies include Babel parser/types, Playwright Core, MCP client/server, Zod, AJV, source-map tracing, ASAR, WebSocket support, Pino, and process/terminal utilities. Frida is optional. Testing uses Vitest, fast-check, Stryker, and TypeScript checking. The external analysis providers are not silently supplied by reading the repository. `.gitmodules` lists JADX tooling, Binwalk, Unblob, Ghidra NativeAOT, and Wakaru. Their presence in a manifest does not prove they are installed or usable here.

### Web capabilities in useful detail

Based on `docs/browser-observation.md`, `docs/web-runtime.md`, `docs/website-script-export.md`, and `docs/website-module-trace.md`:

1. Passive inspection attaches to a scoped running CDP target and records DOM/resource/console/network metadata; optional script-source capture increases what can be analyzed. It cannot reveal server implementation.
2. Bundle analysis treats captured JavaScript as data and proposes route, endpoint, module and vendor candidates. A candidate is not proof that a backend route is available or authorized.
3. Scenario capture can observe specified interactions and compare aligned snapshots. Comparison exposes incomplete coverage rather than claiming equivalence from a small sample.
4. Script export writes retained bytes and a digest-verified manifest into a new directory. It does not fetch missing assets. Exported content is not the complete application.
5. Import tracing verifies selected bytes and uses native browser resolution for literal imports. Computed imports remain unknown. Query/fragment identities and conflicting versions remain distinct. It does not execute the analyzed application or infer its business rules.
6. Runtime observation captures main-document execution windows and directly registered listeners. Workers, service workers, child frames and framework-specific causal interpretation have explicit limits. Direct listener inspection does not invoke listeners.
7. Screenshot comparison is a bounded pixel comparison, not OCR or proof of feature correctness. The documented 256 MiB working-memory admission limit is not a bound on total host process memory.
8. Some real browser workflows are documented as verified on Linux x64/Chrome, while other hosts remain unverified. Windows compatibility cannot be assumed merely because adapters exist.

### Testing architecture and claims

`vitest.config.ts` and `scripts/lib/test-projects.mjs` divide tests into domain, services, adapters, composition, conformance, evaluation, CLI/MCP boundaries, process boundaries, and acceptance groups. Workers are capped at two; process-sensitive lanes use forks or serial execution. Source tests and built-artifact tests are distinguished.

`docs/reconstruction-readiness.md` defines a repository conformance verifier covering discovery, environment diagnosis, authority, static analysis, scenarios, comparison, contradictions, closure, and replay. It explicitly rejects aggregation of unknown/skipped/unsupported/truncated states into pass. The verifier uses source-owned fixtures. This is a useful quality model, not a proof that REA can reconstruct any arbitrary service. No REA tests were run during this investigation.

### What REA contributes to this project

**Useful methodology:** record evidence; isolate observations from assumptions; enumerate workflows; preserve unknowns; compare behavior with independent tests; require explicit closure before claiming parity.

**Not supplied:** CodeCrafters backend source, database schema, hidden tests, complete paid instructions, production runner isolation, user accounts, challenge authoring, hosting, Git submission infrastructure or a finished clone. Installing REA would not produce these. Building an independent platform with original protocol-based exercises is necessary.

### Inspection record

Read or inspected relevant portions of: `README.md`, `package.json`, `LICENSE`, `.gitmodules`, `src/main.ts`, `src/cli.ts`, `src/composition/binary.ts`, `src/application/binary/AnalysisProviderRegistry.ts`, `src/application/investigation/EvidenceLedger.ts`, `src/browser/PlaywrightExecutionBoundary.ts`, `src/browser/WebBundleAnalysisWorkerProtocol.ts`, `docs/architecture.mermaid`, `docs/browser-observation.md`, `docs/web-runtime.md`, `docs/website-module-trace.md`, `docs/website-script-export.md`, `docs/reconstruction-readiness.md`, `vitest.config.ts`, and `scripts/lib/test-projects.mjs`. Source and docs directories were inventoried. Large-file reads were targeted, and some shell output was truncated; this is not an exhaustive code audit.

Pinned source links: [entrypoint](https://github.com/morluto/rea/blob/4eaf3a117b3f4863a994b9be743ec5bc1501e16c/src/main.ts), [composition](https://github.com/morluto/rea/blob/4eaf3a117b3f4863a994b9be743ec5bc1501e16c/src/composition/binary.ts), [evidence ledger](https://github.com/morluto/rea/blob/4eaf3a117b3f4863a994b9be743ec5bc1501e16c/src/application/investigation/EvidenceLedger.ts), [browser boundaries](https://github.com/morluto/rea/blob/4eaf3a117b3f4863a994b9be743ec5bc1501e16c/docs/browser-observation.md), [readiness](https://github.com/morluto/rea/blob/4eaf3a117b3f4863a994b9be743ec5bc1501e16c/docs/reconstruction-readiness.md).

## 2. CodeCrafters public product investigation

The official landing page describes an IDE-based workflow: choose a system, implement it locally, and push code for test feedback. It links to eleven challenge families. These observable concepts can inform an independent learning product without reproducing their artwork, testimonials or lesson prose. [Official homepage](https://codecrafters.io/)

The public catalog lists Redis, Shell, grep, Interpreter, BitTorrent, Kafka, Git, SQLite, DNS server, HTTP server and Claude Code. Its language tracks include Rust, Go, Python, C, C#, C++, Clojure, Crystal, Dart, Elixir, Gleam, Haskell, Java, JavaScript, Kotlin, OCaml, Odin, PHP, Ruby, Scala, TypeScript and Zig. Coverage varies by language. [Official catalog](https://app.codecrafters.io/catalog)

Public counts differ: the homepage shows Redis at 97 stages while the app catalog shows 124. This mismatch is retained rather than resolved by guessing. Counts and promotions are time-dependent. The catalog showed Shell free until November 1, 2026 and Claude Code free during beta. An independent curriculum should use its own stage counts and availability.

The user's references to “gate,” “cloud code,” and “data server” are plausibly Git, Claude Code, and DNS server; this is an interpretation, not verified intent. PowerShell appears in the official setup documentation as a Windows terminal option; the public challenge is Shell, not a separate PowerShell implementation course. [How challenges work](https://docs.codecrafters.io/challenges/how-challenges-work)

### Verified workflow contracts

- Challenge setup creates a repository after language selection. An initial test push checks setup; later successful submissions advance staged instructions. Language-specific guidance is documented. These are public documentation claims, not an authenticated session capture. [Challenge workflow](https://docs.codecrafters.io/challenges/how-challenges-work)
- The CLI allows testing uncommitted local changes and supports a previous-stages option. Test logs stream back to the terminal. This establishes that “works from VS Code” can be fulfilled through its integrated terminal without a dedicated editor extension. [CLI usage](https://docs.codecrafters.io/cli/usage)
- Submission processing separates environment build, compilation and execution. The official system distinguishes local launch scripts from remote compile/run scripts. Our platform should publish its own stable launch contract. [Program interface](https://docs.codecrafters.io/challenges/program-interface)
- Debug mode emits more test information; program stdout/stderr is exposed in run logs. A useful independent runner needs expected/actual diagnostics and process output. [Debugging tests](https://docs.codecrafters.io/challenges/debug-test-failures)
- Public documentation lists GitHub publishing, profiles, community access, repeat attempts, dependencies and CLI maintenance. Detailed permission semantics and implementation internals are unverified. [Documentation index](https://docs.codecrafters.io/introduction)
- Pricing distinguishes limited free access, membership benefits (unlimited content, faster tests, examples, anonymous mode, perks, priority support) and team features (seat management, leaderboard, analytics, Slack). It lists three-month, yearly and lifetime plans; the fetched page did not establish exact dollar amounts. The user's $60/$180 figures remain unverified and should not be copied into marketing claims. [Pricing](https://codecrafters.io/pricing)

### Unknowns that public pages cannot settle

Authenticated dashboard details; full stage specifications and edge cases; exact runner isolation; queue behavior and quotas; repository transport implementation; database schema; authorization rules; paid member examples; private analytics; exhaustive device/accessibility behavior; SLA and cost model. Public descriptions cannot justify “complete feature parity.”

## 3. Independent architecture proposal

This is a proposal, not a description of CodeCrafters internals or an assertion that every component is implemented.

1. **Versioned challenge catalog:** stable challenge/stage IDs; original descriptions; protocol references; prerequisites; explicit test capability; starter templates. Catalog visibility and executable coverage are separate fields.
2. **Learning frontend:** searchable catalog, language filter, challenge overview, stage instructions, hints, local setup commands, progress, and run history. Never fabricate other learners' statistics or passed tests.
3. **CLI:** initialize a workspace, validate config, run a chosen stage, optionally run all earlier stages, return a meaningful exit status and machine-readable results. It works in VS Code, PowerShell and other terminals.
4. **Test adapters:** stdio programs, TCP servers, UDP servers and binary-file readers have different harnesses. A common run envelope contains challenge/stage/test versions, timestamps, logs, assertions and duration. Timeouts and unsupported runners are failures/unsupported states, not success.
5. **Local execution:** learner explicitly invokes testing against their own code. Bind dashboard services to loopback and avoid accepting arbitrary shell commands from unauthenticated browsers. Local results are useful feedback, not trusted credentials or leaderboard proof.
6. **Hosted execution:** separate upload API, authentication, bounded queue, disposable runner, no application secrets, strict CPU/memory/time/process/storage/network constraints, immutable test images, artifact retention and abuse controls. This needs deployment infrastructure and operational funding even when learner access is free.
7. **Persistence:** local progress can be browser storage; cross-device accounts require server-side identity and a database. Verified stage completion must be committed from trusted runner results rather than accepting arbitrary client assertions.
8. **Git submissions:** optional independent Git receive service or authorized GitHub integration can enqueue a commit digest. A local CLI is not equivalent to a hosted Git push tester.

## 4. Feature parity backlog and acceptance criteria

All entries below describe work to verify; this document does not mark them as implemented. Consult the repository's current README and tests for shipped coverage.

| Priority | Capability | Concrete acceptance requirement |
| --- | --- | --- |
| P0 | Original catalog for all eleven families | Every card opens real stage content; executable support is labeled truthfully. |
| P0 | Local terminal workflow | A fresh checkout can initialize a starter and run its code from VS Code/PowerShell; failures return nonzero. |
| P0 | Real test feedback | Intentionally incorrect implementations fail; correct independent fixtures pass; no timer-driven simulated success. |
| P0 | Durable progress | Refresh preserves local progress; clearing/exporting state is explicit; test version is recorded. |
| P0 | Process management | Timeout and crash produce useful diagnostics; child processes are cleaned up; parallel ports do not collide. |
| P1 | HTTP/TCP/UDP runner adapters | Tests exercise framing, malformed input, concurrent requests and shutdown where appropriate. |
| P1 | Full independent curriculum | Every original stage has instructions, prerequisites, positive/negative tests and reference solutions for harness verification. |
| P1 | Language matrix | Advertised languages have tested starter/build/run contracts; unsupported combinations are visible. |
| P1 | Historical regression runs | Stage selection and prior-stage mode are deterministic and reports identify every assertion. |
| P1 | Hosted multi-user tester | Authenticated upload, isolated jobs, resource caps, cancellation, streaming logs and tenant separation are tested. |
| P1 | Cross-device accounts | Sign-in, synchronization, privacy, account deletion and session revocation work. |
| P2 | Git push testing | Push identifies immutable commit, enqueues test, reports status and updates correct account. |
| P2 | Community and examples | Original or licensed examples; opt-in sharing; moderation and private progress controls. |
| P2 | Profiles and tracks | Progress reflects actual completed stages and supported languages. |
| P3 | Teams | Organizations, membership, roles, analytics and leaderboards with privacy boundaries. |
| P3 | External integrations | GitHub publishing or chat notifications require explicit account connection and scoped authorization. |

### Curriculum breadth is different from full system fidelity

A starting Redis track could teach RESP framing, PING/ECHO, string storage and expiry; advanced coverage needs persistence, replication, streams and many edge cases. An HTTP track can begin with request parsing, response headers and routing before keep-alive, bodies and compression. Git requires content-addressed objects and tree parsing; SQLite requires its file format and B-tree traversal. DNS requires wire-format packets and UDP; Kafka and BitTorrent require substantial independent binary-protocol suites. A shell exercise is not a complete PowerShell engine. A small agent-loop exercise is not a production Claude Code equivalent.

Do not advertise completion of an entire upstream system based on a small introductory test suite. Each implemented scope should be described directly, and extension work should remain visible.

## 5. Verification plan

Use independent reference implementations as positive fixtures and deliberate errors as negative fixtures. Verify both CLI and browser-facing results against the same test-report schema. Cover malformed configuration, unsupported challenge/stage, missing runtimes, crashing/hanging programs, large output, concurrent runs and cleanup. For hosted execution additionally test tenant boundaries, upload path traversal, archive expansion limits, network restrictions, resource exhaustion and cancellation. Frontend smoke checks should exercise filtering, challenge selection, stage navigation, setup commands, progress persistence, empty/error states, keyboard navigation and small screens.

A final release statement should separately report: catalog families, authored stages, executable stages, validated language/runtime combinations, local workflow, hosted workflow, and deployed integrations. This avoids confusing a polished website with a complete learning and grading service.
