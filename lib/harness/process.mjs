// Launches the learner's program and other helper processes, cross-platform.
// The program is always started without a shell; on Windows, .cmd/.bat shims are run through cmd.exe
// and `sh`/`bash` resolve to Git for Windows' bash when it is not on PATH.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, delimiter, extname, isAbsolute } from 'node:path';
import { EventEmitter } from 'node:events';

const isWindows = process.platform === 'win32';

function searchPath(name) {
  const exts = isWindows ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase()) : [''];
  const candidates = isWindows && extname(name) ? [''] : exts;
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of candidates) {
      const full = join(dir, name + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

const GIT_BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];

export function resolveCommand(command) {
  let [file, ...args] = command;
  if (!isWindows) return { file, args };
  if (file === 'sh' || file === 'bash') {
    const bash = searchPath('bash') || GIT_BASH.find(existsSync);
    if (!bash) throw new Error('This language needs bash. Install Git for Windows (https://git-scm.com) or use WSL.');
    return { file: bash, args };
  }
  if (file === 'python3' && !searchPath('python3.exe')) file = 'python';
  const resolved = isAbsolute(file) || file.includes('/') || file.includes('\\') ? file : searchPath(file) || file;
  if (/\.(cmd|bat)$/i.test(resolved)) {
    const quote = a => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved, ...args].map(quote).join(' ')}"`], verbatim: true };
  }
  return { file: resolved, args };
}

export function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try {
    if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

const live = new Set();
process.on('exit', () => { for (const c of live) killTree(c); });

// A running process with line-based logging of its output and buffered stdout/stderr.
export class Proc extends EventEmitter {
  constructor(command, args = [], { cwd, env = {}, logger = null, prefix = 'your_program', logOutput = true } = {}) {
    super();
    const { file, args: baseArgs, verbatim } = resolveCommand(command);
    this.stdoutBuf = Buffer.alloc(0);
    this.stderrBuf = Buffer.alloc(0);
    this.exitCode = null;
    this.logger = logOutput ? logger : null;
    this.prefix = prefix;
    this.child = spawn(file, [...baseArgs, ...args], {
      cwd, env: { ...process.env, PYTHONUNBUFFERED: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true, detached: !isWindows, windowsVerbatimArguments: !!verbatim,
    });
    live.add(this.child);
    this.exited = new Promise(resolve => {
      this.child.on('error', err => {
        this.spawnError = err;
        this.exitCode = -1;
        this.logger?.error(`Failed to start ${command[0]}: ${err.message}`);
        live.delete(this.child);
        resolve(-1);
      });
      this.child.on('close', code => {
        this.flushLines();
        this.exitCode = code ?? -1;
        live.delete(this.child);
        this.emit('exit', this.exitCode);
        resolve(this.exitCode);
      });
    });
    this.partial = { stdout: '', stderr: '' };
    this.child.stdout.on('data', d => this.onData('stdout', d));
    this.child.stderr.on('data', d => this.onData('stderr', d));
    this.child.stdin.on('error', () => {});
  }

  onData(stream, data) {
    if (stream === 'stdout') this.stdoutBuf = Buffer.concat([this.stdoutBuf, data]);
    else this.stderrBuf = Buffer.concat([this.stderrBuf, data]);
    this.emit(stream, data);
    if (!this.logger) return;
    const text = this.partial[stream] + data.toString('utf8');
    const lines = text.split(/\r?\n/);
    this.partial[stream] = lines.pop();
    for (const line of lines) this.logger.program(this.prefix, line);
  }

  flushLines() {
    for (const s of ['stdout', 'stderr']) {
      if (this.partial[s] && this.logger) this.logger.program(this.prefix, this.partial[s]);
      this.partial[s] = '';
    }
  }

  get stdout() { return this.stdoutBuf.toString('utf8'); }
  get stderr() { return this.stderrBuf.toString('utf8'); }
  get running() { return this.exitCode === null; }

  write(data) { this.child.stdin.write(data); }
  closeStdin() { this.child.stdin.end(); }

  async waitForExit(timeoutMs = 10000) {
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
    const result = await Promise.race([this.exited, timeout]);
    clearTimeout(timer);
    if (result === 'timeout') return null;
    return result;
  }

  async kill() {
    if (!this.running) return;
    killTree(this.child);
    await this.waitForExit(5000);
  }
}
