const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function validateAnswer(answer) {
  if (!answer || answer.language !== 'python' || answer.scope !== 'stage' || typeof answer.available !== 'boolean') {
    throw new Error('This dashboard server is outdated. Restart ccfree app, open the address it prints, and refresh this page.');
  }
  if (typeof answer.explanation !== 'string' || !answer.explanation.trim() ||
      (answer.available && (typeof answer.diff !== 'string' || !answer.diff.trim() || typeof answer.file !== 'string'))) {
    throw new Error('The server returned an incomplete Python answer. Restart ccfree app and retry.');
  }
  return answer;
}

export function mountAnswerPanel(host, { course, stage, language }) {
  host.dataset.answerKey = `${course}/${stage}/${language || ''}`;
  host.innerHTML = `<div class="answer-heading"><div><h3>Python solution</h3><p>Try the stage first, then compare your changes.</p></div><button class="btn" type="button" aria-expanded="false" aria-controls="answer-content">Show answer</button></div><div id="answer-content" hidden></div>`;
  const toggle = host.querySelector('button'), body = host.querySelector('#answer-content');
  let answer, loading = false;
  toggle.addEventListener('click', async () => {
    if (loading) return;
    if (answer && !body.hidden) { body.hidden = true; toggle.textContent = 'Show answer'; toggle.setAttribute('aria-expanded', 'false'); return; }
    if (!answer) {
      loading = true; toggle.disabled = true; toggle.textContent = 'Loading answer…';
      try {
        const res = await fetch(`/api/courses/${encodeURIComponent(course)}/stages/${encodeURIComponent(stage)}/answer`);
        if (!res.ok) throw new Error(`Could not load the answer (${res.status}).`);
        const result = validateAnswer(await res.json());
        if (!host.isConnected) return;
        renderAnswer(body, result); answer = result;
      } catch (error) {
        body.textContent = `${error.message} Select Show answer to retry.`; body.hidden = false;
        toggle.setAttribute('aria-expanded', 'true'); return;
      } finally { loading = false; toggle.disabled = false; toggle.textContent = 'Show answer'; }
    }
    body.hidden = false; toggle.textContent = 'Hide answer'; toggle.setAttribute('aria-expanded', 'true');
  });
}

function renderAnswer(body, answer) {
  if (!answer.available) {
    body.innerHTML = `<p role="status">${esc(answer.explanation)}</p>`;
    return;
  }
  body.innerHTML = `<p>${esc(answer.explanation)}</p>
    <p class="answer-base">${answer.previousStage ? `Changes from <a href="#/course/${encodeURIComponent(answer.course)}/${encodeURIComponent(answer.previousStage)}">the previous stage’s Python example</a>.` : 'Changes from the Python starter.'} If your code differs, adapt these changes to your implementation.</p>
    <div class="answer-tools"><strong>${esc(answer.file)}</strong><span>+ Add &nbsp; − Remove</span></div>
    <pre class="answer-code answer-diff" tabindex="0" aria-label="Python changes for this stage"><code>${answer.diff.trimEnd().split('\n').map(line => `<span class="diff-line ${line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') ? 'diff-meta' : line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : ''}">${esc(line)}</span>`).join('\n')}</code></pre>
    <p class="answer-base">Edit your existing <code>app/main.py</code>. The + and − signs describe changes; do not paste those signs into Python.</p>`;
}
