# CodeCrafter Free

**Build your own Redis, Git, SQLite, HTTP server, shell, interpreter and more — from scratch. Free, forever.**

CodeCrafter Free is an open-source, local-first take on "build your own X" challenges. Pick a system, write the code in your
own editor (VS Code works great), and run `ccfree test` in the terminal. The tester starts *your* program and talks to it
the way a real client would — over TCP, UDP, files and command-line arguments — and the results stream live into a desktop
dashboard.

- **No account, no subscription, no limits.** Progress is saved on your computer.
- **11 courses, 412 stages**, with the same stage lists as the CodeCrafters catalog (see [content/UPSTREAM.md](content/UPSTREAM.md)).
- **20+ languages.** Every course comes with starter code for Python, JavaScript, TypeScript, Go, Rust, C, C++, Java, C#, … .
- **Works on Windows, macOS and Linux.** The testers are written from scratch in Node.js, so they run natively on Windows.

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

## Tester status

The curriculum (every stage's instructions and starters) is complete. Testers are being written course by course;
stages without a tester yet are marked **"tester coming soon"** in the dashboard and in `ccfree stages`, and they never
pass silently.

| Course | Stages with a tester |
| --- | --- |
| Redis | 18 / 124 (base stages and Lists) |
| Others | in progress |

Every tester is verified in CI against a reference solution (which must pass) and a do-nothing program (which must fail).

## Install

You need [Node.js](https://nodejs.org) 20 or newer and [Git](https://git-scm.com).

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
ccfree init redis my-redis --language python
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
| `ccfree init <course> [dir] --language <lang>` | Create a project from a starter |
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

JavaScript, TypeScript and Python run directly. Compiled languages use the starter's `.ccfree/compile.sh` and
`.ccfree/run.sh`, which need `sh`/`bash` — on Windows that means Git Bash (installed with Git) or WSL. You can always edit
`ccfree.json` to use any command you like.

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

## Contributing a tester

1. Read the stage description in `content/courses/<course>/course.json` (or the dashboard).
2. Add a function for the stage slug in `testers/<course>/`. Use `t.spawn()` / `t.exec()` to run the learner's program and
   `t.fail()` / `t.assertEqual()` to check behavior. Randomize inputs so answers cannot be hard-coded.
3. Extend `solutions/<course>/main.mjs` so the reference solution passes.
4. Run `CCFREE_COURSES=<course> npm test`. The suite checks that the reference passes *and* that a do-nothing program fails.

## Credits and license

Stage descriptions and starter code come from the open-source
[CodeCrafters course repositories](https://github.com/codecrafters-io) (MIT License); see
[content/UPSTREAM.md](content/UPSTREAM.md) for exact sources. The testers, CLI, dashboard and everything else are original
to this project. CodeCrafter Free is independent and is not affiliated with or endorsed by CodeCrafters. If you can, support
the people who made the original curriculum.

MIT License — see [LICENSE](LICENSE).
