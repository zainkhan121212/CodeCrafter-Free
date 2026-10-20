# Architecture

CodeCrafter Free is local-first: the learner's code, the testers and all progress live on the learner's machine.
There is no server-side execution and no account system.

```
 VS Code terminal                         Dashboard (browser or Electron window)
 ┌──────────────────────┐                 ┌───────────────────────────────┐
 │ ccfree test          │                 │ app/app.js                    │
 │  ├─ build (once)     │                 │  ├─ catalog / course / stage  │
 │  ├─ testers/<course> │ ── TCP/UDP/ ──▶ │  └─ live log drawer (SSE)     │
 │  │    └─ your program│    files/args   └──────────────▲────────────────┘
 │  └─ ~/.ccfree/runs/  │                                │ GET /api/live
 └──────────┬───────────┘                 ┌──────────────┴────────────────┐
            └──── append events ────────▶ │ server.mjs (loopback, read-only)
                  progress.json           │ tails ~/.ccfree/runs/*.jsonl  │
                                          └───────────────────────────────┘
```

## Pieces

- **Content** (`content/courses/<slug>/course.json`, `starters/`): imported from the MIT-licensed CodeCrafters course
  repositories by `scripts/import-upstream.mjs`. Stages are ordered base-first, then by extension.
- **CLI** (`bin/ccfree.mjs`): `init` copies a starter and writes `ccfree.json` and VS Code tasks; `test` picks stages,
  runs them, records the run and advances progress.
- **Runner** (`lib/harness/runner.mjs`): builds once, then runs each stage's tester in order and stops at the first
  failure. A missing tester is reported as `missing`, never as a pass. Each stage has a timeout and a cleanup list
  (processes, temp dirs, sockets).
- **Process launcher** (`lib/harness/process.mjs`): starts programs without a shell, resolves Windows `.cmd` shims and
  Git Bash, streams output line-by-line into the log, and kills whole process trees (`taskkill /T` on Windows, process
  groups elsewhere).
- **Testers** (`testers/<course>/index.mjs`): export `stages: { [slug]: async t => … }`. They use protocol helpers in
  `lib/protocols/` and network helpers in `lib/harness/net.mjs`.
- **Store** (`lib/store.mjs`): `~/.ccfree/progress.json` keyed by project directory, plus one `.events.jsonl` and one
  summary `.json` per run.
- **Dashboard** (`server.mjs`, `app/`): a read-only HTTP server bound to 127.0.0.1 that serves the UI, the catalog and
  progress, and streams run events with Server-Sent Events. It rejects non-loopback `Host` headers and non-GET requests.
- **Desktop** (`desktop/`): an Electron window around the same server.

## Notable testers

- **Shell** runs the learner's shell in a pseudo-terminal (Python's `pty` on Linux/macOS) and keeps a small VT100 screen
  model (`lib/harness/terminal.mjs`), so TAB completion, the bell, match lists and arrow-key history are asserted on what a
  user would actually see.
- **Claude Code** sets `OPENROUTER_BASE_URL` to a scripted, OpenAI-compatible mock model (`testers/claude-code/mock-llm.mjs`)
  that reads the request like a model would (advertised tools, system prompt, tool results).
- **BitTorrent** runs a local tracker and seeder peers; **Git** serves clones through `git upload-pack`; **DNS** runs a fake
  upstream resolver; **Redis replication** plays master, replicas and clients.
- **Interpreter** compares against `lib/protocols/lox.mjs`, a jlox-compatible implementation checked against the official
  *Crafting Interpreters* test suite.
- Testers with fixed ports (Redis 6379, HTTP 4221, DNS 2053/udp, Kafka 9092) check the port is free first (`beforeStage`).

## Verification

`npm test` runs platform tests (catalog, CLI, RESP, dashboard boundaries) and, for every course with a reference solution
in `solutions/`, runs all of its testers twice: against the reference (must pass) and against a program that exits
immediately (must fail).

## Security model

The tester runs code the learner wrote, with the learner's permissions — the same trust model as running your own
program. The dashboard never executes anything and is not reachable from other machines.
