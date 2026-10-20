// Pseudo-terminal support for tests that need the program's stdout (or stdin) to be a TTY.
// Node has no built-in PTY, so on Linux/macOS we use Python's `pty` module. Windows is not supported;
// testers skip TTY-only checks there and say so in the log.
import { spawnSync } from 'node:child_process';

let cached;
export function ptyPython() {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform === 'win32') return cached;
  for (const py of ['python3', 'python']) {
    const r = spawnSync(py, ['-c', 'import pty, os, sys; print("ok")'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'ok') { cached = py; break; }
  }
  return cached;
}

// Wraps a command so it runs attached to a pseudo-terminal; returns null if PTYs are unavailable.
// With `stdinFile`, stdin is redirected from that file (so only stdout/stderr are the TTY).
export function ptyCommand(command, { stdinFile = null, cols = 200, rows = 50 } = {}) {
  const py = ptyPython();
  if (!py) return null;
  const script = [
    'import os, pty, sys, struct, fcntl, termios',
    `stdin_file = ${stdinFile ? JSON.stringify(stdinFile) : 'None'}`,
    'argv = sys.argv[1:]',
    'pid, fd = pty.fork()',
    'if pid == 0:',
    '    if stdin_file is not None:',
    '        f = os.open(stdin_file, os.O_RDONLY); os.dup2(f, 0)',
    '    os.execvp(argv[0], argv)',
    `fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ${rows}, ${cols}, 0, 0))`,
    'import select',
    'out = sys.stdout.buffer',
    'inp = sys.stdin.buffer.raw',
    'stdin_open = True',
    'while True:',
    '    r, _, _ = select.select([fd] + ([inp] if stdin_open else []), [], [])',
    '    if fd in r:',
    '        try: data = os.read(fd, 65536)',
    '        except OSError: data = b""',
    '        if not data: break',
    '        out.write(data); out.flush()',
    '    if stdin_open and inp in r:',
    '        data = os.read(inp.fileno(), 65536)',
    '        if not data: stdin_open = False',
    '        else: os.write(fd, data)',
    '_, status = os.waitpid(pid, 0)',
    'sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else status >> 8)',
  ].join('\n');
  return [py, '-c', script, ...command];
}
