// Verifies every tester against (1) the reference solution, which must pass, and
// (2) a program that exits immediately, which must fail. Set CCFREE_COURSES=redis,git to limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root, COURSE_ORDER } from '../lib/content.mjs';
import { run, solutionProject, testedStages } from './helpers.mjs';

const only = process.env.CCFREE_COURSES?.split(',');
const courses = COURSE_ORDER.filter(c => (!only || only.includes(c)) && existsSync(join(root, 'solutions', c, 'main.mjs')));

for (const slug of courses) {
  test(`${slug}: reference solution passes every tested stage`, { timeout: 30 * 60 * 1000 }, async () => {
    const stages = await testedStages(slug);
    assert.ok(stages.length > 0, 'course has testers');
    const result = await run(slug, stages, solutionProject(slug));
    const failed = result.results.find(r => r.status !== 'passed');
    assert.ok(result.passed, failed ? `stage ${failed.slug} ${failed.status}: ${failed.error}\n${result.logs.slice(-25).join('\n')}` : 'failed');
  });

  test(`${slug}: a do-nothing program fails every tested stage`, { timeout: 30 * 60 * 1000 }, async () => {
    const project = { course: slug, language: 'javascript', dir: root, build: null, run: [process.execPath, '-e', ''] };
    const passedWrongly = [];
    for (const stage of await testedStages(slug)) {
      const result = await run(slug, [stage], project);
      if (result.passed) passedWrongly.push(stage);
    }
    assert.deepEqual(passedWrongly, [], 'these stages passed without any implementation');
  });
}
