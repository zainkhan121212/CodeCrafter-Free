import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { root, getCourse } from '../lib/content.mjs';
import { orderedStages } from '../lib/render.mjs';
import { Logger } from '../lib/harness/logger.mjs';
import { runStages } from '../lib/harness/runner.mjs';

export async function loadTesters(slug) {
  const file = join(root, 'testers', slug, 'index.mjs');
  return existsSync(file) ? import(pathToFileURL(file).href) : { stages: {} };
}

export function solutionProject(slug, dir = join(root, 'solutions', slug)) {
  return { course: slug, language: 'javascript', dir, build: null, run: [process.execPath, join(root, 'solutions', slug, 'main.mjs')] };
}

// Runs the given stages; returns { passed, results, logs }.
export async function run(slug, stageSlugs, project) {
  const course = getCourse(slug);
  const testers = await loadTesters(slug);
  const logs = [];
  const logger = new Logger({ quiet: true, sink: e => logs.push(`[${e.prefix}] ${e.msg}`) });
  const stages = stageSlugs.map(s => course.stages.find(x => x.slug === s));
  const result = await runStages({ course, stages, project, testers, logger });
  return { ...result, logs };
}

export async function testedStages(slug) {
  const testers = await loadTesters(slug);
  return orderedStages(getCourse(slug)).map(s => s.slug).filter(s => testers.stages[s]);
}
