// A learner project is a directory containing ccfree.json:
//   { "course": "redis", "language": "python", "build": [..] | null, "run": ["python", "-u", "-m", "app.main"] }
// `build` runs once before tests; `run` is started (with stage-specific arguments) for every test instance.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const CONFIG_FILE = 'ccfree.json';

export function findProject(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    const file = join(dir, CONFIG_FILE);
    if (existsSync(file)) return loadProject(file);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadProject(file) {
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const dir = dirname(file);
  const isCommand = v => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string');
  if (typeof config.course !== 'string') throw new Error(`${file}: "course" must be a course slug such as "redis"`);
  if (!isCommand(config.run)) throw new Error(`${file}: "run" must be an array like ["node", "app/main.js"]`);
  if (config.build != null && !isCommand(config.build)) throw new Error(`${file}: "build" must be null or an array of strings`);
  return { ...config, build: config.build || null, dir, file };
}

const onPath = cmd => {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore', windowsHide: true });
  return r.status === 0;
};

// On Windows, `python` may be the Microsoft Store alias, which prints a message instead of running.
const pythonWorks = cmd => spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() === '3';

function nodeSupportsTypeScript() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
}

// Chooses build/run commands for a starter. Interpreted languages get native commands (no bash needed);
// compiled languages use the starter's .ccfree/compile.sh and .ccfree/run.sh through sh.
export function defaultCommands(language, dir) {
  const hasScript = name => existsSync(join(dir, '.ccfree', name));
  const scriptBuild = hasScript('compile.sh') ? ['sh', '.ccfree/compile.sh'] : null;
  switch (language) {
    case 'javascript':
      return { build: null, run: ['node', 'app/main.js'] };
    case 'typescript':
      return nodeSupportsTypeScript() && !onPath('bun')
        ? { build: null, run: ['node', '--no-warnings', 'app/main.ts'] }
        : { build: null, run: ['bun', 'run', 'app/main.ts'] };
    case 'python': {
      // Prefer the installed interpreter: `uv run` may download a new Python on first use, which looks like a hang.
      const python = process.platform === 'win32' ? 'python' : 'python3';
      if (!pythonWorks(python) && onPath('uv')) return { build: null, run: ['uv', 'run', '--quiet', '-m', 'app.main'] };
      return { build: null, run: [python, '-u', '-m', 'app.main'] };
    }
    default:
      return { build: scriptBuild, run: ['sh', '.ccfree/run.sh'] };
  }
}
