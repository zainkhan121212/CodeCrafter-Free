// Local, account-free persistence. Everything lives in ~/.ccfree (override with CCFREE_HOME).
//
//   progress.json          per-project progress (a project is a directory with ccfree.json)
//   runs/<id>.json         final result of every test run
//   runs/<id>.events.jsonl live log events, appended while a run is in progress
import { mkdir, readFile, writeFile, rename, readdir, appendFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const home = () => process.env.CCFREE_HOME || join(homedir(), '.ccfree');
export const runsDir = () => join(home(), 'runs');

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await rename(tmp, file);
}

const emptyProgress = () => ({ version: 2, projects: {} });

export async function readProgress() {
  try {
    const value = JSON.parse(await readFile(join(home(), 'progress.json'), 'utf8'));
    return value && value.version === 2 && typeof value.projects === 'object' ? value : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export async function updateProgress(mutate) {
  await mkdir(home(), { recursive: true });
  const progress = await readProgress();
  await mutate(progress);
  await writeJsonAtomic(join(home(), 'progress.json'), progress);
  return progress;
}

const projectKey = dir => (process.platform === 'win32' ? dir.toLowerCase() : dir);

// Progress record for a project directory, created on first use.
export function projectProgress(progress, { dir, course, language }) {
  const record = (progress.projects[projectKey(dir)] ??= { dir, course, language, completed: {}, runs: 0, createdAt: new Date().toISOString() });
  if (course) record.course = course;
  if (language) record.language = language;
  return record;
}

export async function markCompleted(project, stageSlugs) {
  return updateProgress(p => {
    const record = projectProgress(p, project);
    const now = new Date().toISOString();
    for (const s of stageSlugs) record.completed[s] ??= now;
  });
}

export async function resetProject(dir) {
  return updateProgress(p => { delete p.projects[projectKey(dir)]; });
}

// A run streams events to a .jsonl file (the dashboard tails it) and finishes with a summary file.
export async function createRun(meta) {
  await mkdir(runsDir(), { recursive: true });
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const eventsFile = join(runsDir(), `${id}.events.jsonl`);
  const run = { id, ...meta, status: 'running', startedAt: new Date().toISOString() };
  await appendFile(eventsFile, JSON.stringify({ type: 'start', run }) + '\n');
  return {
    id,
    // Synchronous so log ordering is preserved even if the process exits abruptly.
    event(e) {
      try { appendFileSync(eventsFile, JSON.stringify({ t: Date.now(), ...e }) + '\n'); } catch { /* best effort */ }
    },
    async finish(result) {
      const summary = { ...run, ...result, finishedAt: new Date().toISOString() };
      await writeJsonAtomic(join(runsDir(), `${id}.json`), summary);
      // Publish completion only after the dashboard can read the finished run.
      this.event({ type: 'finish', run: summary });
      return summary;
    },
  };
}

export async function listRuns(limit = 50) {
  const files = (await readdir(runsDir()).catch(() => [])).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit);
  const runs = [];
  for (const f of files) {
    try { runs.push(JSON.parse(await readFile(join(runsDir(), f), 'utf8'))); } catch { /* skip partial */ }
  }
  return runs;
}

export async function readRunEvents(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    return (await readFile(join(runsDir(), `${id}.events.jsonl`), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return null;
  }
}
