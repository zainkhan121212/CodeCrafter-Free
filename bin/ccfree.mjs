#!/usr/bin/env node
// ccfree — CodeCrafter Free command line. Run `ccfree help` for usage.
import { cp, writeFile, mkdir, readdir, readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { root, getCourse, listCourses, findStage, starterDir, starterLanguages } from '../lib/content.mjs';
import { renderTemplate, orderedStages, currentStage, languageName } from '../lib/render.mjs';
import { findProject, defaultCommands, CONFIG_FILE } from '../lib/project.mjs';
import { readProgress, updateProgress, projectProgress, markCompleted, resetProject, createRun, home } from '../lib/store.mjs';
import { Logger } from '../lib/harness/logger.mjs';
import { runStages } from '../lib/harness/runner.mjs';

// node:sqlite (used by the SQLite tester) prints an ExperimentalWarning on some Node versions.
process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w.stack || String(w)); });

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'help';
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--') && ['language', 'stage', 'port', 'dir'].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else positional.push(a);
}

const c = (code, s) => (process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = s => c(1, s), dim = s => c(2, s), green = s => c(32, s), red = s => c(31, s), yellow = s => c(33, s), cyan = s => c(36, s);

function die(message) {
  console.error(red(message));
  process.exit(1);
}

function requireCourse(slug) {
  const course = getCourse(slug);
  if (!course) die(`Unknown course "${slug}". Run \`ccfree courses\` to see all courses.`);
  return course;
}

function requireProject() {
  let project;
  try { project = findProject(); } catch (e) { die(e.message); }
  if (!project) die(`No ${CONFIG_FILE} found in this directory or its parents.\nCreate a project with: ccfree init <course> [directory]`);
  return project;
}

// Terminal rendering of stage markdown: keeps it readable without a markdown library.
function terminalMarkdown(md) {
  return md
    .replace(/^#{1,6}\s+(.*)$/gm, (_, h) => bold(h))
    .replace(/\*\*(.+?)\*\*/g, (_, b) => bold(b))
    .replace(/`([^`\n]+)`/g, (_, code) => cyan(code))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `${text} ${dim(`(${url})`)}`)
    .replace(/^\[[^\]]+\]:\s+\S+$/gm, m => dim(m));
}

const COMMANDS = {
  help() {
    console.log(`${bold('CodeCrafter Free')} — build real systems from scratch. Free, local, no account.

${bold('Getting started')}
  ccfree courses                         List all courses and your progress
  ccfree init <course> [dir] [--language python]
                                         Create a project from a starter (default language: python)
  cd <dir> && code .                     Open it in VS Code

${bold('Inside a project')}
  ccfree test                            Test the current stage (advances when it passes)
  ccfree test --previous                 Also re-run every earlier stage
  ccfree test --stage <slug>             Test one specific stage
  ccfree status                          Show the current stage
  ccfree show [stage]                    Print stage instructions in the terminal
  ccfree stages [course]                 List all stages with their status

${bold('Other')}
  ccfree app [--port 4317]               Open the dashboard (live test logs, instructions, progress)
  ccfree doctor                          Check which language runtimes are installed
  ccfree reset                           Forget progress for the current project

Data is stored locally in ${home()}`);
  },

  async courses() {
    const progress = await readProgress();
    console.log(bold('Courses\n'));
    const projects = Object.values(progress.projects);
    for (const course of listCourses()) {
      const done = Math.max(0, ...projects.filter(p => p.course === course.slug).map(p => Object.keys(p.completed).length));
      const bar = done ? green(`${done}/${course.stages.length} stages`) : dim(`${course.stages.length} stages`);
      console.log(`  ${bold(course.slug.padEnd(13))} ${course.name.padEnd(16)} ${bar}`);
      console.log(`  ${''.padEnd(13)} ${dim(course.shortDescription)}\n`);
    }
    console.log(`Start one with: ${cyan('ccfree init redis')}`);
  },

  async init() {
    const [slug, dirArg] = positional;
    if (!slug) die('Usage: ccfree init <course> [directory] [--language <language>]');
    const course = requireCourse(slug);
    const language = flags.language || 'python';
    if (!starterDir(course.slug, language)) die(`No ${language} starter for ${course.name}. Available: ${starterLanguages(course.slug).join(', ')}`);
    const dir = resolve(dirArg || `ccfree-${course.slug}-${language}`);
    if (existsSync(dir) && (await readdir(dir)).length) die(`${dir} already exists and is not empty. Choose another directory.`);
    await cp(starterDir(course.slug, language), dir, { recursive: true });

    const { build, run } = defaultCommands(language, dir);
    await writeFile(join(dir, CONFIG_FILE), JSON.stringify({ course: course.slug, language, build, run }, null, 2) + '\n');

    const cli = [process.execPath, join(root, 'bin', 'ccfree.mjs')];
    await mkdir(join(dir, '.vscode'), { recursive: true });
    const task = (label, args, isDefault = false) => ({
      label, type: 'process', command: cli[0], args: [cli[1], ...args], options: { cwd: '${workspaceFolder}' },
      group: isDefault ? { kind: 'test', isDefault: true } : 'test', problemMatcher: [], presentation: { reveal: 'always', clear: true },
    });
    await writeFile(join(dir, '.vscode', 'tasks.json'), JSON.stringify({
      version: '2.0.0',
      tasks: [task('ccfree: test current stage', ['test'], true), task('ccfree: test all previous stages', ['test', '--previous']), task('ccfree: show instructions', ['show'])],
    }, null, 2) + '\n');

    const first = orderedStages(course)[0];
    await writeFile(join(dir, 'README.md'), `# Build your own ${course.name} (${languageName(language)})

${course.description}

This project was created by [CodeCrafter Free](https://github.com/zainkhan121212/CodeCrafter-Free).

## Workflow

1. Read the current stage: \`ccfree show\` (or open the dashboard with \`ccfree app\`).
2. Edit the code in \`app/\`.
3. Run \`ccfree test\`. In VS Code you can also press **Ctrl+Shift+P → Tasks: Run Test Task**.
4. When a stage passes, ccfree moves you to the next one automatically.

How your program is built and started is configured in \`${CONFIG_FILE}\` (\`build\` runs once, \`run\` is started for every test).

First stage: **${first.name}**.
`);
    if (!existsSync(join(dir, '.git')) && spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0) {
      spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    }
    await updateProgress(p => { projectProgress(p, { dir, course: course.slug, language }); });

    console.log(`${green('✓')} Created ${bold(dir)}\n`);
    console.log(`  Course:   ${course.title}`);
    console.log(`  Language: ${languageName(language)}`);
    console.log(`  Run with: ${run.join(' ')}${build ? `   (build: ${build.join(' ')})` : ''}\n`);
    const hints = [];
    if (language === 'javascript' && /"dependencies"\s*:\s*\{\s*"/.test(await readFile(join(dir, 'package.json'), 'utf8').catch(() => ''))) hints.push('npm install');
    if (language === 'python' && run[0] !== 'uv') {
      const deps = (await readFile(join(dir, 'pyproject.toml'), 'utf8').catch(() => '')).match(/dependencies = \[([\s\S]*?)\]/)?.[1].match(/"([^"]+)"/g);
      if (deps?.length) hints.push(`pip install ${deps.map(d => `'${d.slice(1, -1)}'`).join(' ')}`);
    }
    if (hints.length) console.log(`${yellow('Install dependencies first:')}\n  cd "${dir}"\n${hints.map(h => `  ${h}`).join('\n')}\n`);
    console.log(`Next steps:\n  cd "${dir}"\n  code .\n  ccfree show     ${dim('# read stage 1')}\n  ccfree test     ${dim('# run the tests')}`);
  },

  async test() {
    const project = requireProject();
    const course = requireCourse(project.course);
    const progress = await readProgress();
    const cprog = projectProgress(progress, project);
    const order = orderedStages(course, project.extensions);
    let stages;
    if (flags.stage) {
      const stage = findStage(course, flags.stage);
      if (!stage) die(`Unknown stage "${flags.stage}" for ${course.name}. Run \`ccfree stages\` to list them.`);
      stages = flags.previous ? order.slice(0, order.indexOf(stage) + 1) : [stage];
    } else {
      const current = currentStage(course, cprog.completed, project.extensions);
      if (!current) {
        console.log(green(`🎉 You have completed every stage of ${course.title}!`));
        console.log(`Re-run everything with: ccfree test --all`);
        if (!flags.all) return;
      }
      if (flags.all) stages = order;
      else stages = flags.previous ? order.slice(0, order.indexOf(current) + 1) : [current];
    }

    const testers = await loadTesters(course.slug);
    const run = await createRun({ course: course.slug, language: project.language, project: project.dir, stages: stages.map(s => s.slug) });
    const logger = new Logger({ sink: e => run.event(e), debug: !!flags.debug });
    let result;
    try {
      result = await runStages({ course, stages, project, testers, logger, debug: !!flags.debug });
    } catch (err) {
      logger.error(`Internal error: ${err.stack || err}`);
      result = { passed: false, results: [] };
    }
    const passedSlugs = result.results.filter(r => r.status === 'passed').map(r => r.slug);
    if (passedSlugs.length) await markCompleted(project, passedSlugs);
    await updateProgress(p => { const x = projectProgress(p, project); x.runs += 1; x.lastRunAt = new Date().toISOString(); });
    await run.finish({ status: result.passed ? 'passed' : 'failed', results: result.results });

    console.log('');
    if (result.passed) {
      const after = await readProgress();
      const next = currentStage(course, projectProgress(after, project).completed, project.extensions);
      console.log(green(bold(`✓ ${passedSlugs.length === 1 ? 'Stage passed' : `All ${passedSlugs.length} stages passed`}!`)));
      if (next) console.log(`Next stage: ${bold(`#${order.indexOf(next) + 1} ${next.name}`)}  ${dim('— run `ccfree show` to read it')}`);
      else console.log(green(`🎉 You completed ${course.title}!`));
    } else {
      console.log(red(bold('✗ Test failed.')) + dim(' Check the logs above, fix your code and run `ccfree test` again.'));
      process.exitCode = 1;
    }
  },

  async status() {
    const project = requireProject();
    const course = requireCourse(project.course);
    const completed = projectProgress(await readProgress(), project).completed;
    const order = orderedStages(course, project.extensions);
    const current = currentStage(course, completed, project.extensions);
    const done = order.filter(s => completed[s.slug]).length;
    console.log(`${bold(course.title)} in ${languageName(project.language)} — ${done}/${order.length} stages complete`);
    if (current) {
      console.log(`Current stage: ${bold(`#${order.indexOf(current) + 1} ${current.name}`)} ${dim(`(${current.slug}, ${current.difficulty})`)}`);
      console.log(dim('Run `ccfree show` for instructions and `ccfree test` to test.'));
    } else console.log(green('All stages complete!'));
  },

  async show() {
    const project = findProject();
    const course = requireCourse(project?.course || positional[1] || '');
    const completed = project ? projectProgress(await readProgress(), project).completed : {};
    const stage = positional[0] ? findStage(course, positional[0]) : currentStage(course, completed, project?.extensions);
    if (!stage) die(positional[0] ? `Unknown stage "${positional[0]}"` : 'All stages complete!');
    const order = orderedStages(course, project?.extensions);
    const ext = course.extensions.find(e => e.slug === stage.extension);
    console.log(bold(`Stage #${order.indexOf(stage) + 1}: ${stage.name}`) + dim(`  [${stage.slug}] ${ext ? `${ext.name} · ` : ''}${stage.difficulty}`));
    console.log('');
    console.log(terminalMarkdown(renderTemplate(stage.description, { language: project?.language })));
  },

  async stages() {
    const project = findProject();
    const course = requireCourse(positional[0] || project?.course || '');
    const completed = project?.course === course.slug ? projectProgress(await readProgress(), project).completed : {};
    const testers = await loadTesters(course.slug).catch(() => ({ stages: {} }));
    const current = currentStage(course, completed, project?.extensions);
    let lastExt;
    orderedStages(course, project?.extensions).forEach((s, i) => {
      if (s.extension !== lastExt) {
        lastExt = s.extension;
        console.log('\n' + bold(s.extension ? course.extensions.find(e => e.slug === s.extension).name : 'Base stages'));
      }
      const mark = completed[s.slug] ? green('✓') : s === current ? yellow('→') : ' ';
      const missing = testers.stages?.[s.slug] ? '' : dim('  (tester coming soon)');
      console.log(` ${mark} ${String(i + 1).padStart(3)}. ${s.name.padEnd(46)} ${dim(s.slug)}${missing}`);
    });
  },

  async reset() {
    const project = requireProject();
    await resetProject(project.dir);
    console.log(`Progress for this project (${project.dir}) was cleared.`);
  },

  async doctor() {
    const checks = [['node', '--version'], ['python', '--version'], ['python3', '--version'], ['uv', '--version'], ['go', 'version'], ['cargo', '--version'],
      ['gcc', '--version'], ['java', '--version'], ['dotnet', '--version'], ['bun', '--version'], ['bash', '--version'], ['git', '--version']];
    for (const [cmd, arg] of checks) {
      const r = spawnSync(cmd, [arg], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
      const ok = r.status === 0 && !/not found|Microsoft Store/i.test(r.stdout + r.stderr);
      console.log(`${ok ? green('✓') : dim('·')} ${cmd.padEnd(8)} ${ok ? (r.stdout || r.stderr).split('\n')[0].trim() : dim('not installed')}`);
    }
    console.log(`\nData directory: ${home()}`);
  },

  async app() {
    const { startServer } = await import('../server.mjs');
    const port = Number(flags.port || process.env.PORT || 4317);
    const { url } = await startServer({ port });
    console.log(`CodeCrafter Free dashboard: ${bold(url)}  ${dim('(Ctrl+C to stop)')}`);
    if (!flags['no-open']) openBrowser(url);
  },
};
COMMANDS.ui = COMMANDS.app;
COMMANDS.list = COMMANDS.courses;

async function loadTesters(slug) {
  const file = join(root, 'testers', slug, 'index.mjs');
  try { await access(file); } catch { return { stages: {} }; }
  return import(pathToFileURL(file).href);
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}

const fn = COMMANDS[command];
if (!fn) die(`Unknown command "${command}". Run \`ccfree help\`.`);
await fn();
