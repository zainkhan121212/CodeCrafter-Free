// Runs tester functions for a list of stages against the learner's program.
//
// A tester module (testers/<course>/index.mjs) exports `stages`: { [stageSlug]: async (t) => {...} }
// and optionally `timeouts`: { [stageSlug]: ms }. A tester throws (usually via t.fail) to fail a stage.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { Proc } from './process.mjs';

export class TestFailure extends Error {}

const DEFAULT_STAGE_TIMEOUT = 20000;

function formatValue(v) {
  if (Buffer.isBuffer(v)) return JSON.stringify(v.toString('utf8'));
  return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
}

// Testers often run the program from a temporary directory, so relative paths in the run command
// (e.g. "app/main.js", ".ccfree/run.sh") are made absolute, and Python modules are found via PYTHONPATH.
export function resolveRunCommand(project) {
  const command = project.run.map((arg, i) => {
    if (i === 0 && !/[\\/]/.test(arg)) return arg;
    if (arg.startsWith('-') || isAbsolute(arg)) return arg;
    const full = join(project.dir, arg);
    return existsSync(full) ? full : arg;
  });
  const env = { PYTHONPATH: [project.dir, process.env.PYTHONPATH].filter(Boolean).join(delimiter) };
  return { command, env };
}

function createContext({ project, stage, course, logger, debug }) {
  const cleanups = [];
  const runCommand = resolveRunCommand(project);
  const t = {
    stage,
    course,
    project,
    // The learner's run command with paths made absolute (for testers that wrap it, e.g. in a PTY).
    programCommand: runCommand.command,
    programEnv: runCommand.env,
    log: logger,
    debug,
    fail(message) { throw new TestFailure(message); },
    assert(condition, message) { if (!condition) throw new TestFailure(message); },
    assertEqual(actual, expected, what = 'value') {
      const same = Buffer.isBuffer(expected) ? Buffer.isBuffer(actual) && actual.equals(expected) : JSON.stringify(actual) === JSON.stringify(expected);
      if (!same) throw new TestFailure(`Expected ${what} to be ${formatValue(expected)}, got ${formatValue(actual)}`);
    },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    onCleanup(fn) { cleanups.push(fn); },

    // Start the learner's program (runs in the background until killed or the stage ends).
    spawn(args = [], { cwd = project.dir, env = {}, prefix = 'your_program', logOutput = true } = {}) {
      const proc = new Proc(runCommand.command, args, { cwd, env: { ...runCommand.env, ...env }, logger, prefix, logOutput });
      cleanups.push(() => proc.kill());
      return proc;
    },

    // Run the learner's program to completion.
    async exec(args = [], { cwd = project.dir, env = {}, stdin = null, timeout = 10000, prefix = 'your_program', logOutput = true } = {}) {
      const proc = t.spawn(args, { cwd, env, prefix, logOutput });
      if (stdin !== null) proc.write(stdin);
      proc.closeStdin();
      const code = await proc.waitForExit(timeout);
      if (code === null) {
        await proc.kill();
        throw new TestFailure(`Program did not exit within ${timeout / 1000}s`);
      }
      if (proc.spawnError) throw new TestFailure(`Could not start program: ${proc.spawnError.message}`);
      // On Windows, text-mode stdout turns \n into \r\n (e.g. Python's print); that is not the learner's bug.
      const stdout = process.platform === 'win32' ? proc.stdout.replace(/\r\n/g, '\n') : proc.stdout;
      return { exitCode: code, stdout, stderr: proc.stderr, stdoutBuffer: proc.stdoutBuf };
    },

    async tmpDir(prefix = 'ccfree-') {
      const dir = await mkdtemp(join(tmpdir(), prefix));
      cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {}));
      return dir;
    },

    async cleanup() {
      while (cleanups.length) {
        try { await cleanups.pop()(); } catch { /* keep cleaning */ }
      }
    },
  };
  return t;
}

async function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new TestFailure(onTimeout)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

export async function build(project, logger) {
  if (!project.build) return true;
  logger.build(`$ ${project.build.join(' ')}`);
  const proc = new Proc(project.build, [], { cwd: project.dir, logger, prefix: 'build' });
  proc.closeStdin();
  const code = await proc.waitForExit(10 * 60 * 1000);
  if (code !== 0) {
    logger.error(code === null ? 'Build timed out.' : `Build failed (exit code ${code}).`);
    await proc.kill();
    return false;
  }
  return true;
}

// Runs stages in order and stops at the first failure, like a real CI run.
export async function runStages({ course, stages, project, testers, logger, debug = false }) {
  const results = [];
  if (!(await build(project, logger.withPrefix('build')))) {
    return { passed: false, buildFailed: true, results: stages.map(s => ({ slug: s.slug, status: 'skipped' })) };
  }
  let failed = false;
  for (const stage of stages) {
    if (failed) { results.push({ slug: stage.slug, status: 'skipped' }); continue; }
    const log = logger.withPrefix(`tester::#${stage.slug.toUpperCase()}`);
    log.info(`Running tests for Stage #${stage.number}: ${stage.slug} (${stage.name})`);
    const fn = testers.stages?.[stage.slug];
    const started = Date.now();
    if (!fn) {
      log.error(`No tester is available for this stage yet. See the roadmap in the README.`);
      results.push({ slug: stage.slug, status: 'missing', durationMs: 0 });
      failed = true;
      continue;
    }
    const t = createContext({ project, stage, course, logger: log, debug });
    try {
      const ms = testers.timeouts?.[stage.slug] ?? DEFAULT_STAGE_TIMEOUT;
      if (testers.beforeStage) await testers.beforeStage(t);
      await withTimeout(fn(t), ms, `Stage timed out after ${ms / 1000}s`);
      log.success('Test passed.');
      results.push({ slug: stage.slug, status: 'passed', durationMs: Date.now() - started });
    } catch (err) {
      log.error(err instanceof TestFailure ? err.message : `Tester error: ${err?.stack || err}`);
      log.error('Test failed');
      results.push({ slug: stage.slug, status: 'failed', durationMs: Date.now() - started, error: String(err?.message || err) });
      failed = true;
    } finally {
      await t.cleanup();
    }
  }
  return { passed: !failed, results };
}
