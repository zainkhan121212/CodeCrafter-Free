# CodeCrafter Free

**Build your own Redis, Git, SQLite, HTTP server, shell, interpreter and more — from scratch. Free, forever.**

CodeCrafter Free is an open-source, local-first take on "build your own X" challenges. Pick a system, write the code in your
own editor (VS Code works great), and run `ccfree test` in the terminal. The tester starts *your* program and talks to it
the way a real client would — over TCP, UDP, files and command-line arguments — and the results stream live into a desktop
dashboard.

- **No account, no subscription, no limits.** Progress is saved on your computer.
- **11 courses, 412 stages**, with the same stage lists as the CodeCrafters catalog (see [content/UPSTREAM.md](content/UPSTREAM.md)).
- **Python.** New learner projects, instructions and example answers use Python.
- **Works on Windows, macOS and Linux.** The testers are written from scratch in Node.js and run natively on Windows (see platform notes).

| Course | Stages | You build |
| --- | --- | --- |
| Redis | 124 | A Redis server: RESP, expiry, lists, streams, transactions, replication, RDB/AOF persistence, pub/sub, sorted sets, geo, auth |
| HTTP Server | 14 | An HTTP/1.1 server: routing, headers, files, concurrency, gzip, persistent connections |
| Shell | 76 | A POSIX shell: REPL, builtins, quoting, redirection, pipelines, completion, history, jobs |
| grep | 33 | A regex engine: character classes, anchors, quantifiers, alternation, backreferences |
| Interpreter | 84 | A Lox interpreter: scanner, parser, evaluator, functions, closures, classes |
| Git | 7 | Git internals: objects, trees, commits, and cloning over the smart HTTP protocol |
| SQLite | 9 | A SQLite file reader: pages, B-trees, schemas, SELECT/WHERE, index scans |
| BitTorrent | 19 | A BitTorrent client: bencode, trackers, peer wire protocol, magnet links |
| DNS Server | 8 | A DNS server: wire format, compression, forwarding |
| Kafka | 25 | A Kafka broker: ApiVersions, DescribeTopicPartitions, Fetch, Produce |
| Claude Code | 13 | An AI coding agent: tool calls, agent loop, skills |

## How the tests work

### Viewing example answers

Open a stage and select **Show answer** under **Python solution**. **Hide answer** collapses it.
Answers show a stage-specific diff for `app/main.py`: green `+` lines are additions and red `-` lines are removals, with a short explanation. Apply the changes to your existing file; do not paste diff markers into Python.

Each example builds on the previous example (linked in the panel), beginning with the shipped Python starter. If your implementation differs, adapt the changes.

**Current answer coverage: the seven Redis base stages**, from binding a port through SET/GET expiry. Each example is checked against its own and all preceding base-stage testers. Other stages explicitly say that their Python answer has not been written yet; their instructions and testers remain available. Complete JavaScript references remain internal tester fixtures and are never served as learner answers.

### Tester coverage

**Every one of the 412 stages has a tester.** Everything runs locally and offline:

| Course | What the tester does |
| --- | --- |
| Redis | Talks RESP over TCP like `redis-cli`; for replication it plays the master, the replicas and the clients; writes RDB/AOF files |
| HTTP Server | Sends raw HTTP/1.1 requests; checks headers, bodies, gzip, keep-alive and `Connection: close` |
| Shell | Types into your shell through a pseudo-terminal and reads the screen (TAB completion, bell, history, jobs) |
| grep | Runs your grep with `-E` patterns on stdin, files and directories; checks exit codes, `-o` and `--color` output |
| Interpreter | Compares your `tokenize`/`parse`/`evaluate`/`run` output and exit codes with a jlox-compatible reference |
| Git | Uses the real `git` to check your objects; clones from a local smart-HTTP server (with delta objects) |
| SQLite | Generates random databases with the real SQLite engine; the index stage uses a ~1 GB database (built once, cached) |
| BitTorrent | Starts a local tracker and seeder peers (BEP 3, 9, 10) and checks the files you download |
| DNS Server | Sends DNS queries over UDP, including compressed names; runs a fake upstream resolver for forwarding |
| Kafka | Speaks the Kafka wire protocol; writes cluster metadata and partition logs as real RecordBatches |
| Claude Code | Points `OPENROUTER_BASE_URL` at a scripted mock LLM, so no API key is needed and runs are deterministic |

Inputs are randomized, so answers can't be hard-coded. Every tester is verified (`npm test`) against a reference
solution, which must pass, and a program that does nothing, which must fail. The Lox reference matches 238 of the 240
programs in the official *Crafting Interpreters* test suite.

### Platform notes

- **Windows:** everything runs natively except 49 Shell stages that need POSIX tools (`cat`, `ls`, executable scripts) or a
  pseudo-terminal (TAB completion, arrow keys). Run those in WSL ("WSL: Reopen Folder in WSL" in VS Code, install Node
  there) — the tester tells you when that's needed. The `--color=auto` grep stage checks its terminal half on Linux/macOS only.
- **Linux/macOS:** everything runs. The pseudo-terminal uses `python3`, which is preinstalled on most systems.

## Install

You need Python 3.10 or newer, [Node.js](https://nodejs.org) 22.13 or newer and [Git](https://git-scm.com).

```sh
git clone https://github.com/zainkhan121212/CodeCrafter-Free.git
cd CodeCrafter-Free
npm link            # makes the `ccfree` command available in every terminal
```

No other dependencies are needed. (If `npm link` is not an option, use `node /path/to/CodeCrafter-Free/bin/ccfree.mjs`
wherever this README says `ccfree`.)

### Open the dashboard

```sh
ccfree app          # opens the dashboard in your browser
npm run desktop     # or: open it as a desktop app (downloads Electron the first time)
```

## Your first stage

```sh
ccfree init redis my-redis
cd my-redis
code .              # open in VS Code
ccfree show         # read the stage instructions
ccfree test         # run the tests
```

When a stage passes, ccfree moves you to the next one. In VS Code you can also run **Tasks: Run Test Task**
(`Ctrl+Shift+P`), which `ccfree init` sets up for you.

## Commands

| Command | What it does |
| --- | --- |
| `ccfree courses` | List courses and your progress |
| `ccfree init <course> [dir]` | Create a project from a starter |
| `ccfree test` | Test the current stage; advance when it passes |
| `ccfree test --previous` | Re-test every stage up to the current one |
| `ccfree test --stage <slug>` | Test one specific stage (any order) |
| `ccfree test --all` | Test every stage |
| `ccfree show [stage]` | Print stage instructions in the terminal |
| `ccfree status` / `ccfree stages` | Current stage / full stage list |
| `ccfree app` | Open the dashboard (live logs, instructions, progress) |
| `ccfree doctor` | Show which language runtimes are installed |
| `ccfree reset` | Clear progress for the current project |

Add `--debug` to `ccfree test` for extra tester output.

## How your program is run

`ccfree init` writes a `ccfree.json` into your project:

```json
{
  "course": "redis",
  "language": "python",
  "build": null,
  "run": ["python", "-u", "-m", "app.main"]
}
```

- `build` (optional) runs once before the tests, e.g. `["sh", ".ccfree/compile.sh"]` for Go/Rust/C/Java.
- `run` is started for every test instance, with stage-specific arguments appended.
- Optional `"extensions": ["lists", "streams"]` limits and orders which extensions you work through.

Python runs directly through the interpreter configured in `ccfree.json`. Existing project configurations remain runnable.

## Where data is stored

Everything is local, in `~/.ccfree` (override with the `CCFREE_HOME` environment variable):
`progress.json` (completed stages per project) and `runs/` (logs of every test run). Delete it to start over.

## Project layout

```
bin/ccfree.mjs          CLI
server.mjs              local dashboard server (read-only, loopback only)
app/                    dashboard frontend
desktop/                optional Electron wrapper
lib/harness/            process launcher, logger, TCP/UDP helpers, stage runner
lib/protocols/          protocol codecs shared by testers (RESP, …)
testers/<course>/       the testers — one function per stage
solutions/<course>/     reference solutions used to verify the testers (spoilers!)
content/courses/        imported stage descriptions and starter code
tests/                  platform tests: `npm test`
```

## Contributing

Testers live in `testers/<course>/` (one async function per stage slug) and reference solutions in
`solutions/<course>/main.mjs`. After changing either, run `CCFREE_COURSES=<course> npm test`; it checks that the reference
passes every stage and that a do-nothing program fails every stage. `CCFREE_STAGES=slug1,slug2` narrows it further.

## Credits and license

Stage descriptions and starter code come from the open-source
[CodeCrafters course repositories](https://github.com/codecrafters-io) (MIT License); see
[content/UPSTREAM.md](content/UPSTREAM.md) for exact sources. The testers, CLI, dashboard and everything else are original
to this project. CodeCrafter Free is independent and is not affiliated with or endorsed by CodeCrafters. If you can, support
the people who made the original curriculum.

MIT License — see [LICENSE](LICENSE).
