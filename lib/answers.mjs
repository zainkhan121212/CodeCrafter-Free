import { getCourse } from './content.mjs';
import { pythonAnswers } from './python-answers.mjs';
export async function getAnswer(course, stage) {
  const meta = getCourse(course)?.stages.find(s => s.slug === stage);
  if (!meta) return null;
  const answer = pythonAnswers(course).find(a => a.stage === stage);
  return { course, stage, stageName: meta.name, language: 'python', scope: 'stage', available: !!answer,
    ...(answer ? { file: 'app/main.py', diff: answer.diff, explanation: answer.explanation, previousStage: answer.previousStage }
      : { explanation: 'A Python answer has not been written for this stage yet. The instructions and tests are available.' }) };
}
