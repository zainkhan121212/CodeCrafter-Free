import { marked } from '/vendor/marked.esm.js';
import { renderTemplate, orderedStages, currentStage, languageName } from '/render.mjs';

marked.setOptions({ gfm: true, breaks: false });

const $ = sel => document.querySelector(sel);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = (text, language) => marked.parse(renderTemplate(text, { language }));
const GLYPHS = { redis: 'RE', 'http-server': 'HT', shell: '$_', grep: '.*', interpreter: 'λ', git: 'GT', sqlite: 'SQ', bittorrent: 'BT', 'dns-server': 'DN', kafka: 'KF', 'claude-code': 'AI' };
const api = async path => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

const state = { courses: null, course: {}, progress: null, prefs: loadPrefs() };

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('ccfree.prefs')) || {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem('ccfree.prefs', JSON.stringify(state.prefs)); } catch { /* private mode */ }
}

async function getCourse(slug) {
  return (state.course[slug] ??= await api(`/api/courses/${slug}`));
}
async function refreshProgress() {
  state.progress = await api('/api/progress');
}
// The most recently active project for a course decides what the dashboard shows as "your progress".
function activeProject(slug) {
  const list = (state.progress?.projects || []).filter(p => p.course === slug);
  list.sort((a, b) => String(b.lastRunAt || b.createdAt).localeCompare(String(a.lastRunAt || a.createdAt)));
  return list[0] || null;
}

function copyBlock(lines) {
  const text = lines.join('\n');
  return `<div class="copy"><pre class="terminal">${lines.map(l => l.startsWith('#') ? `<span class="dim">${esc(l)}</span>` : `<span class="p">$ </span><span class="c">${esc(l)}</span>`).join('\n')}</pre><button data-copy="${esc(text)}">Copy</button></div>`;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  navigator.clipboard?.writeText(btn.dataset.copy).then(() => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); });
});

// ---------- views ----------

async function catalogView() {
  state.courses ??= await api('/api/courses');
  const totalStages = state.courses.reduce((n, c) => n + c.stageCount, 0);
  const cards = state.courses.map(c => {
    const p = activeProject(c.slug);
    const done = p ? Object.keys(p.completed).length : 0;
    return `<a class="card" href="#/course/${c.slug}">
      <h3><span class="glyph">${esc(GLYPHS[c.slug] || c.name[0])}</span>${esc(c.name)}</h3>
      <p>${esc(c.shortDescription)}</p>
      ${done ? `<div class="progress" title="${done}/${c.stageCount}"><i style="width:${(done / c.stageCount) * 100}%"></i></div>` : ''}
      <div class="meta"><span>${c.stageCount} stages</span>${c.extensions.length ? `<span>${c.extensions.length} extensions</span>` : ''}<span>${c.languages.length} languages</span>
      ${done ? `<span style="color:var(--accent)">${done} done${p.language ? ` · ${esc(languageName(p.language))}` : ''}</span>` : ''}</div>
    </a>`;
  }).join('');
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>Build <em>Redis</em>, <em>Git</em>, <em>SQLite</em> and more — from scratch. Free.</h1>
        <p>Real systems-programming challenges, tested on your own machine. Write code in VS Code, run <code>ccfree test</code> in the terminal, and watch the results appear here live. No account, no subscription, no limits.</p>
        <div class="pills"><span class="pill">${state.courses.length} courses</span><span class="pill">${totalStages} stages</span><span class="pill">20+ languages</span><span class="pill">Progress saved locally</span></div>
      </div>
      <pre class="terminal"><span class="p">$ </span><span class="c">ccfree init redis my-redis --language python</span>
<span class="p">$ </span><span class="c">cd my-redis &amp;&amp; code .</span>
<span class="p">$ </span><span class="c">ccfree test</span>
<span class="dim">[tester::#JM1] Running tests for Stage #1: jm1 (Bind to a port)</span>
<span class="dim">[tester::#JM1] Connecting to port 6379...</span>
<span class="ok">[tester::#JM1] Test passed.</span>
<span class="ok">✓ Stage passed!</span> <span class="dim">Next stage: #2 Respond to PING</span></pre>
    </section>
    <div class="section-title"><h2>Courses</h2><span>Pick a system to build</span></div>
    <div class="grid">${cards}</div>`;
}

async function courseView(slug) {
  const course = await getCourse(slug);
  const project = activeProject(slug);
  const completed = project?.completed || {};
  const current = currentStage(course, completed);
  const language = state.prefs.language && course.languages.includes(state.prefs.language) ? state.prefs.language : project?.language || (course.languages.includes('python') ? 'python' : course.languages[0]);
  const tested = new Set(course.tested);
  const stages = orderedStages(course);
  const groups = [{ slug: null, name: 'Base stages' }, ...course.extensions];
  const groupHtml = groups.map(g => {
    const list = stages.filter(s => s.extension === g.slug);
    if (!list.length) return '';
    const doneCount = list.filter(s => completed[s.slug]).length;
    return `<div class="stage-group"><h3><span>${esc(g.name)}</span><span>${doneCount}/${list.length}</span></h3>
      ${g.description ? `<div class="prose" style="margin-bottom:10px;font-size:14px">${md(g.description)}</div>` : ''}
      <ol class="stage-list">${list.map(s => `<li class="${completed[s.slug] ? 'done' : ''} ${s === current ? 'current' : ''}">
        <a href="#/course/${slug}/${s.slug}"><span class="state">${completed[s.slug] ? '✓' : ''}</span><span class="num">#${stages.indexOf(s) + 1}</span>
        <span>${esc(s.name)}</span>${tested.has(s.slug) ? '<span></span>' : '<span class="soon">tester coming soon</span>'}<span class="diff ${s.difficulty}">${esc(s.difficulty.replace('_', ' '))}</span></a></li>`).join('')}</ol></div>`;
  }).join('');
  const dir = `my-${slug}`;
  const projects = (state.progress?.projects || []).filter(p => p.course === slug);
  view.innerHTML = `
    <div class="crumbs"><a href="#/">Courses</a> / ${esc(course.name)}</div>
    <section class="course-head">
      <div>
        <h1><span class="glyph">${esc(GLYPHS[slug])}</span>${esc(course.title)}</h1>
        <div class="prose">${md(course.description)}</div>
        <div class="pills" style="margin-top:14px"><span class="pill">${stages.length} stages</span><span class="pill">${course.extensions.length} extensions</span><span class="pill">${course.tested.length}/${stages.length} stages testable today</span></div>
      </div>
      <aside>
        <div class="panel">
          <h3>${project ? 'Continue' : 'Start this course'}</h3>
          <label class="field">Language
            <select id="lang">${course.languages.map(l => `<option value="${l}" ${l === language ? 'selected' : ''}>${esc(languageName(l))}</option>`).join('')}</select>
          </label>
          ${copyBlock([`ccfree init ${slug} ${dir} --language ${language}`, `cd ${dir}`, 'code .', 'ccfree test'])}
          ${current ? `<p style="margin:14px 0 0"><a class="btn primary" href="#/course/${slug}/${current.slug}">${project ? 'Continue' : 'Read'} stage #${stages.indexOf(current) + 1}: ${esc(current.name)} →</a></p>` : '<p>🎉 All stages complete!</p>'}
        </div>
        ${projects.length ? `<div class="panel"><h3>Your projects</h3><div class="projects">${projects.map(p => {
          const n = Object.keys(p.completed).length;
          return `<div class="project"><div class="row"><b>${esc(languageName(p.language))}</b><span>${n}/${stages.length}</span></div>
            <div class="progress"><i style="width:${(n / stages.length) * 100}%"></i></div>
            <span class="path">${esc(p.dir)}</span><a href="vscode://file/${encodeURI(p.dir.replace(/\\/g, '/'))}">Open in VS Code</a></div>`;
        }).join('')}</div></div>` : ''}
      </aside>
    </section>
    <div class="stage-groups">${groupHtml}</div>`;
  $('#lang').addEventListener('change', e => { state.prefs.language = e.target.value; savePrefs(); courseView(slug); });
}

async function stageView(slug, stageSlug) {
  const course = await getCourse(slug);
  const project = activeProject(slug);
  const completed = project?.completed || {};
  const stages = orderedStages(course);
  const stage = stages.find(s => s.slug === stageSlug);
  if (!stage) return notFound();
  const i = stages.indexOf(stage);
  const language = project?.language || state.prefs.language || null;
  const ext = course.extensions.find(e => e.slug === stage.extension);
  const tested = course.tested.includes(stage.slug);
  let lastGroup;
  const nav = stages.map((s, n) => {
    let head = '';
    if (s.extension !== lastGroup || n === 0) { lastGroup = s.extension; head = `<h4>${esc(s.extension ? course.extensions.find(e => e.slug === s.extension).name : 'Base stages')}</h4>`; }
    return `${head}<a href="#/course/${slug}/${s.slug}" class="${s === stage ? 'active' : ''} ${completed[s.slug] ? 'done' : ''}"><span class="n">${completed[s.slug] ? '✓' : `#${n + 1}`}</span><span>${esc(s.name)}</span></a>`;
  }).join('');
  const prev = stages[i - 1], next = stages[i + 1];
  view.innerHTML = `
    <div class="crumbs"><a href="#/">Courses</a> / <a href="#/course/${slug}">${esc(course.name)}</a> / Stage #${i + 1}</div>
    <div class="stage-layout">
      <nav class="stage-nav" aria-label="Stages">${nav}</nav>
      <article class="stage-main">
        <h1>${esc(stage.name)}</h1>
        <div class="stage-meta"><span class="diff ${stage.difficulty}">${esc(stage.difficulty.replace('_', ' '))}</span>${ext ? `<span class="pill">${esc(ext.name)}</span>` : ''}<span class="pill">${esc(stage.slug)}</span>
          ${completed[stage.slug] ? '<span class="status passed">Completed</span>' : ''}${tested ? '' : '<span class="soon">Tester coming soon — you can read ahead</span>'}</div>
        <div class="prose">${md(stage.description, language)}</div>
        <div class="panel" style="margin-top:28px">
          <h3>Test your code</h3>
          <p style="margin:0 0 12px;color:var(--muted);font-size:14px">Run this in your project's terminal (VS Code: <kbd>Ctrl</kbd>+<kbd>\`</kbd>). Results stream into this page.</p>
          ${copyBlock(completed[stage.slug] || currentStage(course, completed) !== stage ? [`ccfree test --stage ${stage.slug}`] : ['ccfree test'])}
          <div id="stage-run" style="margin-top:14px"></div>
        </div>
        <div class="stage-foot">${prev ? `<a class="btn" href="#/course/${slug}/${prev.slug}">← ${esc(prev.name)}</a>` : '<span></span>'}${next ? `<a class="btn" href="#/course/${slug}/${next.slug}">${esc(next.name)} →</a>` : ''}</div>
      </article>
    </div>`;
  document.querySelector('.stage-nav a.active')?.scrollIntoView({ block: 'center' });
  const runs = await api('/api/runs');
  const last = runs.find(r => r.course === slug && r.stages?.includes(stage.slug));
  if (last) {
    const events = await api(`/api/runs/${last.id}/events`);
    $('#stage-run').innerHTML = `<div class="row" style="margin-bottom:8px;font-size:13px"><span>Last run · ${new Date(last.startedAt).toLocaleString()}</span><span class="status ${last.status}">${esc(last.status)}</span></div><pre class="log" style="max-height:320px;border-radius:10px">${events.filter(e => e.type === 'log').map(logLine).join('')}</pre>`;
  }
}

async function runsView(id) {
  const runs = await api('/api/runs');
  if (id) {
    const run = runs.find(r => r.id === id);
    const events = await api(`/api/runs/${id}/events`).catch(() => []);
    view.innerHTML = `<div class="crumbs"><a href="#/runs">Test runs</a> / ${esc(id)}</div>
      <div class="section-title"><h2>${esc(run ? `${run.course} · ${languageName(run.language)}` : 'Run')}</h2>${run ? `<span class="status ${run.status}">${esc(run.status)}</span>` : ''}</div>
      <pre class="log" style="border-radius:12px;min-height:300px">${events.filter(e => e.type === 'log').map(logLine).join('')}</pre>`;
    return;
  }
  view.innerHTML = `<div class="section-title"><h2>Test runs</h2><span>Every <code>ccfree test</code> you run shows up here</span></div>
    ${runs.length ? `<table class="runs"><thead><tr><th>When</th><th>Course</th><th>Language</th><th>Stages</th><th>Result</th></tr></thead><tbody>
    ${runs.map(r => `<tr class="clickable" data-run="${esc(r.id)}"><td>${new Date(r.startedAt).toLocaleString()}</td><td>${esc(r.course)}</td><td>${esc(languageName(r.language))}</td>
      <td>${esc((r.stages || []).length === 1 ? r.stages[0] : `${(r.stages || []).length} stages`)}</td><td><span class="status ${r.status}">${esc(r.status)}</span></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No test runs yet. Create a project with <code>ccfree init</code> and run <code>ccfree test</code>.</div>'}`;
  view.querySelectorAll('[data-run]').forEach(tr => tr.addEventListener('click', () => { location.hash = `#/runs/${tr.dataset.run}`; }));
}

function helpView() {
  view.innerHTML = `<div class="section-title"><h2>How CodeCrafter Free works</h2></div>
  <div class="course-head"><div class="prose">
    <ol class="steps">
      <li><b>Pick a course and language.</b> Each course is split into small stages, from "bind to a port" to replication, transactions and more.</li>
      <li><b>Create a project.</b> <code>ccfree init &lt;course&gt; &lt;dir&gt; --language &lt;lang&gt;</code> copies a starter repository and writes <code>ccfree.json</code>, which says how to build and run your program.</li>
      <li><b>Write code in VS Code.</b> Read the stage instructions here or with <code>ccfree show</code>.</li>
      <li><b>Test from the terminal.</b> <code>ccfree test</code> starts your program and talks to it the way a real client would (TCP, UDP, files, CLI arguments). Logs stream to your terminal and to this dashboard.</li>
      <li><b>Advance.</b> When a stage passes, you move on automatically. Use <code>ccfree test --previous</code> to make sure older stages still pass.</li>
    </ol>
    <h3>Commands</h3>
    <table><tbody>
      <tr><td><code>ccfree courses</code></td><td>List courses and progress</td></tr>
      <tr><td><code>ccfree init &lt;course&gt; [dir] --language &lt;lang&gt;</code></td><td>Create a project</td></tr>
      <tr><td><code>ccfree test</code></td><td>Test the current stage</td></tr>
      <tr><td><code>ccfree test --previous</code></td><td>Test all stages up to the current one</td></tr>
      <tr><td><code>ccfree test --stage &lt;slug&gt;</code></td><td>Test one stage</td></tr>
      <tr><td><code>ccfree show</code> / <code>ccfree status</code> / <code>ccfree stages</code></td><td>Read instructions and progress in the terminal</td></tr>
      <tr><td><code>ccfree app</code></td><td>Open this dashboard</td></tr>
      <tr><td><code>ccfree doctor</code></td><td>Check installed language runtimes</td></tr>
    </tbody></table>
    <h3>Privacy</h3>
    <p>Everything stays on your computer${state.progress ? ` in <code>${esc(state.progress.home)}</code>` : ''}. There are no accounts, no telemetry and no remote execution.</p>
  </div>
  <aside><div class="panel"><h3>Languages need their own runtime</h3><p style="color:var(--muted);font-size:14px;margin:0">JavaScript, TypeScript and Python run directly. Compiled languages (Go, Rust, C, C++, Java, …) use the starter's <code>.ccfree/compile.sh</code> and <code>.ccfree/run.sh</code>, which need <code>bash</code> (on Windows: Git Bash or WSL). Run <code>ccfree doctor</code> to see what is installed.</p></div></aside></div>`;
}

function notFound() {
  view.innerHTML = '<div class="empty">Page not found. <a href="#/">Back to courses</a></div>';
}

// ---------- live drawer ----------

const drawer = { el: $('#drawer'), log: $('#drawer-log'), title: $('#drawer-title'), status: $('#drawer-status'), runId: null };
$('#drawer-close').addEventListener('click', () => { drawer.el.hidden = true; });
$('#drawer-toggle').addEventListener('click', () => drawer.el.classList.toggle('collapsed'));

function logLine(e) {
  const kind = e.level === 'program' ? 'program' : e.level === 'build' ? 'build' : e.level === 'success' ? 'success' : e.level === 'error' ? 'error' : e.level === 'debug' ? 'debug' : 'tester';
  const prefix = e.prefix ? `<span class="${kind === 'success' || kind === 'error' ? (e.level === 'program' ? 'program' : 'tester') : kind}">[${esc(e.prefix)}]</span> ` : '';
  return `${prefix}<span class="${kind === 'tester' ? '' : kind}">${esc(e.msg)}</span>\n`;
}

function connectLive() {
  const dot = $('#live-dot');
  const source = new EventSource('/api/live');
  source.onopen = () => { dot.className = 'live-dot on'; dot.querySelector('span').textContent = 'Listening'; };
  source.onerror = () => { dot.className = 'live-dot'; dot.querySelector('span').textContent = 'Disconnected'; };
  source.onmessage = async msg => {
    const e = JSON.parse(msg.data);
    if (e.type === 'start') {
      drawer.runId = e.runId;
      drawer.log.innerHTML = '';
      drawer.title.textContent = `${e.run.course} · ${languageName(e.run.language)} · ${e.run.stages.length === 1 ? e.run.stages[0] : `${e.run.stages.length} stages`}`;
      drawer.status.className = 'status running';
      drawer.status.textContent = 'Running';
      drawer.el.hidden = false;
      drawer.el.classList.remove('collapsed');
      dot.className = 'live-dot running';
      dot.querySelector('span').textContent = 'Test running';
    } else if (e.runId === drawer.runId && e.type === 'log') {
      const atBottom = drawer.log.scrollTop + drawer.log.clientHeight >= drawer.log.scrollHeight - 30;
      drawer.log.insertAdjacentHTML('beforeend', logLine(e));
      if (atBottom) drawer.log.scrollTop = drawer.log.scrollHeight;
    } else if (e.runId === drawer.runId && e.type === 'finish') {
      drawer.status.className = `status ${e.run.status}`;
      drawer.status.textContent = e.run.status === 'passed' ? 'Passed' : 'Failed';
      dot.className = 'live-dot on';
      dot.querySelector('span').textContent = 'Listening';
      await refreshProgress();
      route();
    }
  };
}

// ---------- router ----------

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (parts[0] === 'runs' ? 'runs' : parts[0] === 'help' ? 'help' : 'catalog')));
  try {
    if (!state.progress) await refreshProgress();
    if (!parts.length) await catalogView();
    else if (parts[0] === 'course' && parts[2]) await stageView(parts[1], parts[2]);
    else if (parts[0] === 'course') await courseView(parts[1]);
    else if (parts[0] === 'runs') await runsView(parts[1]);
    else if (parts[0] === 'help') helpView();
    else notFound();
  } catch (err) {
    view.innerHTML = `<div class="empty">Something went wrong: ${esc(err.message)}</div>`;
  }
}

let lastHash = null;
window.addEventListener('hashchange', () => {
  const sameCourse = lastHash && location.hash.split('/').slice(0, 3).join('/') === lastHash.split('/').slice(0, 3).join('/');
  lastHash = location.hash;
  route().then(() => { if (!sameCourse || location.hash.split('/').length > 3) window.scrollTo(0, 0); });
});
lastHash = location.hash;
route();
connectLive();
