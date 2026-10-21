import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswer } from '../app/answers.js';
import { getAnswer } from '../lib/answers.mjs';

test('old running servers produce an actionable error instead of a blank answer', () => {
  assert.throws(() => validateAnswer({ language: 'javascript', scope: 'full-course', files: [] }), /server is outdated/);
  assert.throws(() => validateAnswer(null), /server is outdated/);
});

test('incomplete answer responses cannot render as empty content', () => {
  assert.throws(() => validateAnswer({ language: 'python', scope: 'stage', available: false }), /incomplete Python answer/);
  assert.throws(() => validateAnswer({ language: 'python', scope: 'stage', available: true, explanation: 'Example' }), /incomplete Python answer/);
});

test('both authored Python answers and explicit unavailable messages are accepted', async () => {
  const answer = await getAnswer('redis', 'rg2');
  assert.equal(validateAnswer(answer), answer);
  const unavailable = await getAnswer('git', 'gg4');
  assert.equal(validateAnswer(unavailable), unavailable);
});
