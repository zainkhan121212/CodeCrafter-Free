// Drives the learner's shell like a person at a terminal. On Linux/macOS the shell runs inside a
// pseudo-terminal (so line editors, TAB completion and arrow keys work); elsewhere it runs on pipes and the
// session echoes typed input onto the screen model itself, so assertions read the same in both modes.
import { Proc } from '../../lib/harness/process.mjs';
import { ptyCommand } from '../../lib/harness/pty.mjs';
import { Screen } from '../../lib/harness/terminal.mjs';
import { TestFailure } from '../../lib/harness/runner.mjs';

const KEYS = { tab: '\t', up: '\x1b[A', down: '\x1b[B', enter: '\r' };

export class ShellSession {
  constructor(t, { env = {}, cwd, needPty = false } = {}) {
    this.t = t;
    this.env = env;
    this.cwd = cwd;
    this.needPty = needPty;
    this.screen = new Screen();
  }

  start() {
    const command = ptyCommand(this.t.programCommand, { cols: 200, rows: 50 });
    if (!command && this.needPty) throw new TestFailure(platformMessage('a pseudo-terminal (for TAB completion and arrow keys)'));
    this.pty = !!command;
    this.proc = new Proc(command || this.t.programCommand, [], {
      cwd: this.cwd, env: { ...this.t.programEnv, TERM: 'xterm', ...this.env }, logger: this.t.log, logOutput: false,
    });
    this.t.onCleanup(() => this.proc.kill());
    const feed = d => { const s = d.toString('utf8'); this.screen.write(this.pty ? s : s.replace(/\n/g, '\r\n')); this.changed?.(); };
    this.proc.on('stdout', feed);
    this.proc.on('stderr', feed);
    return this;
  }

  // Waits until `pred()` is true, re-checking whenever output arrives.
  async waitFor(pred, what, timeout = 3000) {
    const deadline = Date.now() + timeout;
    while (!pred()) {
      if (!this.proc.running && !pred()) { await new Promise(r => setTimeout(r, 50)); if (!pred()) throw new TestFailure(`Your shell exited while waiting for ${what}.\n${this.dump()}`); return; }
      const left = deadline - Date.now();
      if (left <= 0) throw new TestFailure(`Timed out waiting for ${what}.\n${this.dump()}`);
      await new Promise(r => { const timer = setTimeout(r, Math.min(left, 100)); this.changed = () => { clearTimeout(timer); r(); }; });
    }
  }

  atPrompt() { return this.screen.beforeCursor === '$ ' && this.screen.line.trimEnd() === '$'; }

  async waitForPrompt(what = 'the prompt "$ "') {
    await this.waitFor(() => this.atPrompt(), what);
    this.promptRow = this.screen.row;
  }

  // Sends raw keystrokes. In pipe mode, typed text is echoed onto the screen model.
  send(text) {
    if (!this.pty) {
      if (text.includes('\x1b') || text.includes('\t')) throw new TestFailure(platformMessage('a pseudo-terminal (for TAB completion and arrow keys)'));
      this.screen.write(text.replace(/\r/g, '\r\n'));
      this.proc.write(text.replace(/\r/g, '\n'));
    } else this.proc.write(text);
  }

  type(text) { this.t.log.info(`Typed ${JSON.stringify(text)}`); this.send(text); }
  press(key, times = 1) { this.t.log.info(`Pressed <${key.toUpperCase()}>${times > 1 ? ` x${times}` : ''}`); for (let i = 0; i < times; i++) this.send(KEYS[key]); }

  // Runs one command line and checks the lines printed before the next prompt.
  // `expected` is an array of strings/RegExps, or a function(lines) that throws on mismatch.
  async run(command, expected = [], { prompt = true } = {}) {
    await this.waitForPrompt();
    const startRow = this.screen.row;
    this.t.log.info(`$ ${command}`);
    this.send(`${command}\r`);
    if (!prompt) return;
    await this.waitFor(() => this.screen.row > startRow && this.atPrompt(), `the output of ${JSON.stringify(command)} followed by a new prompt`, 5000);
    this.promptRow = this.screen.row;
    // Output starts after the line showing the command (normally startRow, but anchor on the text to be safe).
    const text = this.screen.text();
    let cmdRow = startRow;
    for (let r = this.screen.row - 1; r >= startRow; r--) if (text[r] === `$ ${command}`.trimEnd()) { cmdRow = r; break; }
    const out = text.slice(cmdRow + 1, this.screen.row);
    this.check(command, out, expected);
    return out;
  }

  check(command, out, expected) {
    if (typeof expected === 'function') { expected(out); return; }
    const ok = out.length === expected.length && expected.every((e, i) => (e instanceof RegExp ? e.test(out[i]) : out[i] === e));
    if (!ok) throw new TestFailure(`Expected the output of ${JSON.stringify(command)} to be:\n${expected.map(e => `  ${e}`).join('\n') || '  (no output)'}\nGot:\n${out.map(l => `  ${l}`).join('\n') || '  (no output)'}`);
    this.t.log.success(`✓ ${expected.length ? `Received ${JSON.stringify(out.length === 1 ? out[0] : out.join('\\n'))}` : 'No output, as expected'}`);
  }

  // Asserts the current input line (prompt + typed/completed text, up to the cursor).
  async expectInput(text, what = null) {
    await this.waitFor(() => this.screen.beforeCursor === text, what || `the line to read ${JSON.stringify(text)}`);
    this.t.log.success(`✓ Line is ${JSON.stringify(text)}`);
  }

  async expectBell(before, what = 'a bell (\\x07)') {
    await this.waitFor(() => this.screen.bells > before, what, 2000);
    this.t.log.success('✓ Received bell');
  }

  async expectExit(timeout = 3000) {
    const code = await this.proc.waitForExit(timeout);
    if (code === null) throw new TestFailure(`Expected the shell to exit.\n${this.dump()}`);
    this.t.log.success(`✓ Shell exited with code ${code}`);
    return code;
  }

  dump() {
    const lines = this.screen.text();
    return `Screen:\n${lines.slice(-12).map(l => `  │ ${l}`).join('\n')}`;
  }
}

export const platformMessage = what => `This stage needs ${what}, which is not available on ${process.platform === 'win32' ? 'native Windows' : 'this system'}. ` +
  'Run it on Linux or macOS, or in WSL on Windows (VS Code: "WSL: Reopen Folder in WSL", install Node.js there, then run ccfree test). ' +
  'You can also skip ahead by listing other extensions in "extensions" in ccfree.json.';
