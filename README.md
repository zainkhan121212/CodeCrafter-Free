# CodeCrafter Free

An independent, free systems-programming workbench. **This is a foundation release, not full CodeCrafters feature parity.** It has 11 challenge families and 55 original, executable component-level stages. No subscription or run limits.

## Run locally

Requires Node.js 22+ and Git. There are no external npm dependencies.

```sh
git clone https://github.com/zainkhan121212/CodeCrafter-Free.git
cd CodeCrafter-Free
node server.mjs
```

Open **http://127.0.0.1:4317**. The repository and hosted preview are initially private.

In another terminal, from the platform directory:

```sh
node bin/ccfree.mjs list
node bin/ccfree.mjs init redis my-redis
cd my-redis
code .
node ../bin/ccfree.mjs test --stage ping
```

Implement `solve(request)` in the generated starter. The initial stub intentionally fails. Each test starts a fresh process, sends a JSON value on stdin and expects exactly one JSON value on stdout. Debug output goes on stderr.

For Redis's first stage, for example, input `{"commands":[["PING"]]}` expects `["PONG"]`. The next stages add echo, state, deletion and RESP encoding. These are foundation components, not a complete Redis server.

VS Code: **Tasks: Run Test Task** uses the generated `.vscode/tasks.json`. The task contains the platform's absolute location; regenerate it or update the path if you move the platform.

Python starter: append `--language python` to `init`. Python must be installed. Any compiled or interpreted language can be used by changing `command` in `ccfree.json`:

```json
{
  "challenge": "redis",
  "command": ["node", "main.mjs"],
  "timeout": 3000
}
```

Use an executable plus argument array, not a shell command. Compile Go/Rust/C/C++ solutions separately and point `command` to the binary. PowerShell can use `["pwsh", "-File", "main.ps1"]`. Custom language runtimes have not all been tested.

## Working features

- Original stages, hints, examples and primary-specification links.
- Redis, HTTP, Git, SQLite, Shell, grep, Interpreter, BitTorrent, DNS, Kafka, and AI Coding Agent.
- Real subprocess tests, edge cases, stage selection, structured failure reports, nonzero failure exit codes.
- JavaScript/Python scaffolding and VS Code tasks.
- Searchable responsive catalog, lessons, report inspection and progress.
- Automatic local report sync; import/export for the static hosted dashboard.
- No dependencies, billing, analytics or external model calls.

Reports are written to the student's `ccfree-report.json` and the platform's ignored `.data/reports/` directory. The browser retains its latest 100 reports in local storage. Reports are self-reported learning records, not trusted certificates. Use export for backups.

## Explicit limits

The 55 stages implement protocol and storage **components through a JSON driver**. They do not constitute complete systems or reproduce the paid curriculum. They currently do not launch TCP/UDP servers or compile submissions.

Not implemented: authenticated accounts, cloud progress, remote execution workers, Git-push grading, advanced curriculum, public discussions or shared solutions. See [research](docs/research.md) and [architecture](docs/architecture.md).

The local runner executes **your own code** with your OS permissions. Time and output limits improve feedback, but this is not an isolation boundary. It does not guarantee cleanup of descendant processes. Do not expose it as a remote judge. The HTTP server binds only to loopback and offers no execution endpoint.

Static hosting serves the learning dashboard; it cannot execute local programs. Import a report after running tests locally. Hosting and operating arbitrary-code workers would require separate infrastructure and funding.

## Verify and build

```sh
node --test tests/platform.test.mjs
node scripts/build.mjs
```

Tests independently evaluate all curriculum fixtures, run reference implementations through all 11 subprocess suites, and check timeout, output limits, malformed output, unknown stages, report validation and HTTP boundaries. Visible reference solutions live in `tests/reference.mjs`; they validate the platform, not hidden grading.

`dist/` is the static dashboard. Deployment configuration is in `.openai/hosting.json`; use a separate Site identity for forks.

## Research and independence

[Detailed REA and CodeCrafters research](docs/research.md) pins the inspected REA commit and distinguishes source findings, public documentation, proposals and unknowns.

CodeCrafter Free is not affiliated with or endorsed by CodeCrafters. No proprietary course content, paid tests, site assets or REA code are included. Product and technology names identify educational subjects. MIT license applies to this project's original source.
