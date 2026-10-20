// Verifies every tester against (1) the reference solution, which must pass, and
// (2) a program that exits immediately, which must fail. Set CCFREE_COURSES=redis,git to limit.
// Stages that need something this machine lacks (e.g. a pseudo-terminal on Windows) are reported as skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root, COURSE_ORDER } from '../lib/content.mjs';
import { run, solutionProject, testedStages } from './helpers.mjs';

const only = process.env.CCFREE_COURSES?.split(',');
const onlyStages = process.env.CCFREE_STAGES?.split(',');
const courses = COURSE_ORDER.filter(c => (!only || only.includes(c)) && existsSync(join(root, 'solutions', c, 'main.mjs')));
const unsupported = r => r.results.some(x => /^This stage needs /.test(x.error || ''));

for (const slug of courses) {
  test(`${slug}: reference solution passes every tested stage`, { timeout: 60 * 60 * 1000 }, async t => {
    const stages = (await testedStages(slug)).filter(s => !onlyStages || onlyStages.includes(s));
    assert.ok(stages.length > 0, 'course has testers');
    const failures = [], skipped = [];
    for (const stage of stages) {
      const result = await run(slug, [stage], solutionProject(slug));
      if (result.passed) continue;
      if (unsupported(result)) { skipped.push(stage); continue; }
      failures.push(`stage ${stage}: ${result.results[0].error}\n${result.logs.slice(-20).join('\n')}`);
    }
    if (skipped.length) t.diagnostic(`skipped on ${process.platform}: ${skipped.join(' ')}`);
    assert.deepEqual(failures, [], failures.join('\n\n'));
  });

  test(`${slug}: a do-nothing program fails every tested stage`, { timeout: 60 * 60 * 1000 }, async () => {
    const project = { course: slug, language: 'javascript', dir: root, build: null, run: [process.execPath, '-e', ''] };
    const passedWrongly = [];
    for (const stage of (await testedStages(slug)).filter(s => !onlyStages || onlyStages.includes(s))) {
      const result = await run(slug, [stage], project);
      if (result.passed) passedWrongly.push(stage);
    }
    assert.deepEqual(passedWrongly, [], 'these stages passed without any implementation');
  });
}
