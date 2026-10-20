// Structured logger. Every line goes to the terminal (colored) and to an event sink,
// which the CLI writes to the run's .jsonl file so the dashboard can show it live.

const COLORS = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m' };
const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (color, text) => (useColor() ? COLORS[color] + text + COLORS.reset : text);

export class Logger {
  constructor({ sink = () => {}, prefix = '', quiet = false, debug = false } = {}) {
    this.sink = sink;
    this.prefix = prefix;
    this.quiet = quiet;
    this.debugEnabled = debug;
  }

  withPrefix(prefix) {
    return new Logger({ sink: this.sink, prefix, quiet: this.quiet, debug: this.debugEnabled });
  }

  emit(level, prefix, msg) {
    for (const line of String(msg).split('\n')) {
      this.sink({ type: 'log', level, prefix, msg: line });
      if (this.quiet) continue;
      const color = { info: 'yellow', success: 'green', error: 'red', debug: 'gray', program: 'cyan', build: 'blue' }[level] || 'yellow';
      const head = prefix ? paint(color, `[${prefix}] `) : '';
      const body = level === 'success' ? paint('green', line) : level === 'error' ? paint('red', line) : level === 'debug' ? paint('gray', line) : line;
      process.stdout.write(head + body + '\n');
    }
  }

  info(msg) { this.emit('info', this.prefix, msg); }
  success(msg) { this.emit('success', this.prefix, msg); }
  error(msg) { this.emit('error', this.prefix, msg); }
  debug(msg) { if (this.debugEnabled) this.emit('debug', this.prefix, msg); }
  program(prefix, line) { this.emit('program', prefix, line); }
  build(line) { this.emit('build', 'build', line); }
}
