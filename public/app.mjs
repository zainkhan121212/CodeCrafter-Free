import {courses,getCourse} from './catalog.mjs';
import {validateReport} from './reports.mjs';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let reports=[],local=false,category='All challenges',search='',language='javascript';
try{reports=JSON.parse(localStorage.getItem('ccfree-reports')||'[]').filter(validateReport);}catch{}
const repo='https://github.com/zainkhan121212/CodeCrafter-Free';
const json=v=>escape(JSON.stringify(v,null,2));
const code=text=>`<div class="code-wrap"><pre>${escape(text)}</pre><button class="copy" data-copy="${escape(text)}">Copy</button></div>`;
const icon=c=>`<span class="course-icon" style="--accent:${c.color}">${c.icon}</span>`;
function latestResult(id,stage){
  return [...reports].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).find(r=>r.challenge===id&&r.results.some(s=>s.id===stage))?.results.find(s=>s.id===stage);
}
const completed=c=>c.stages.filter(s=>latestResult(c.id,s.id)?.passed).length;
const started=c=>reports.some(r=>r.challenge===c.id);
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
function saveReports(){try{localStorage.setItem('ccfree-reports',JSON.stringify(reports.slice(0,100)));}catch{toast('Browser storage is full. Export reports to keep a backup.');}}
function mergeReports(incoming){const map=new Map(reports.map(r=>[r.id,r]));for(const r of incoming)if(validateReport(r))map.set(r.id,r);reports=[...map.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);saveReports();}
function card(c){
  const n=completed(c);
  return `<a class="card" href="#challenge/${c.id}" aria-label="Open ${escape(c.name)} challenge"><div class="card-top">${icon(c)}<span class="difficulty">${c.difficulty}</span></div><div class="build">BUILD YOUR OWN</div><h3>${c.name}</h3><p>${c.description}</p><div class="tags">${c.topics.map(t=>`<span>${t}</span>`).join('')}</div>${n?`<div class="progress-track" aria-label="${n} of ${c.stages.length} stages passed"><span style="width:${n/c.stages.length*100}%"></span></div>`:''}<div class="card-bottom"><span>${n?`${n}/${c.stages.length} passed`:`${c.stages.length} foundation stages`} · ${c.time}</span><b>↗</b></div></a>`;
}
function catalog(){
  return `<section class="intro"><div><div class="eyebrow">LEARN BY BUILDING</div><h1>Big ideas. <em>Built by you.</em></h1><p>Recreate the tools you use every day. Understand what’s under the hood.<br>Pick a challenge, open your editor, and make something work.</p></div><div class="intro-aside"><strong>100% free.</strong>NO TIMERS. NO PAYWALLS.</div></section>
  <section class="hero"><div class="hero-copy"><span class="pill">↗ YOUR FIRST BUILD</span><h2>A little server. A lot of discovery.</h2><p>Start with HTTP. Learn to parse requests, route paths, and turn bytes into a response.</p><div class="hero-actions"><a class="button primary" href="#challenge/http">Build an HTTP server →</a><span>Beginner friendly</span></div></div><div class="terminal"><div class="terminal-head"><i></i><i></i><i></i><span>YOUR TERMINAL · EXAMPLE WORKFLOW</span></div><code><span class="dim">$</span> node bin/ccfree.mjs init http my-http
<span class="green">→</span> Open my-http in VS Code
<span class="green">→</span> Implement your first stage
<span class="dim">$</span> node ../bin/ccfree.mjs test --stage request
<span class="dim">Real tests. Useful feedback. Keep building.</span></code></div></section>
  <div class="section-heading"><h2>The challenge library <small>${courses.length} projects</small></h2><span>ONE IDEA AT A TIME. ONE WORKING SYSTEM CLOSER.</span></div>
  <div class="filters"><div class="tabs" role="group" aria-label="Filter challenges">${['All challenges','Networking','Databases','Developer tools','Languages'].map(c=>`<button class="tab ${c===category?'active':''}" data-category="${c}" aria-pressed="${c===category}">${c}</button>`).join('')}</div><label class="search"><span>⌕</span><input id="search" placeholder="Find your next build…" value="${escape(search)}" aria-label="Search challenges"></label></div>
  <div class="grid" id="cards">${filteredCards()}</div><div class="footnote"><span>ⓘ</span><span><strong>Start with the foundations.</strong> These 55 original stages test core components using a JSON driver. Complete servers, advanced stages, and hosted execution are on the <a href="#roadmap"><u>roadmap</u></a>.</span></div>`;
}
function filteredCards(){
  const filtered=courses.filter(c=>(category==='All challenges'||c.category===category)&&`${c.name} ${c.description} ${c.topics.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return filtered.length?filtered.map(card).join(''):'<div class="empty"><h2>No matching builds</h2><p>Try another keyword or choose All challenges.</p></div>';
}
function guide(){
  return `<div class="eyebrow">YOUR LOCAL WORKBENCH</div><h1>From your editor.<br><em>All the way down.</em></h1><p class="page-lead">Run tests on your own computer, as often as you like. The dashboard reads your results; your source code stays in your project.</p>
  <div class="steps"><div><span class="number">01 / GET THE PLATFORM</span><h3>Clone the repository</h3><p class="page-lead">Install Node.js 22 or newer and Git. No dependencies to install. Repository access is currently private to the owner.</p></div><div><span class="number">02 / MAKE IT YOURS</span><h3>Open a starter in VS Code</h3><p class="page-lead">JavaScript and Python starters are included. Any language can use the same JSON contract.</p></div><div><span class="number">03 / CLOSE THE LOOP</span><h3>Run tests. Read feedback.</h3><p class="page-lead">Use the terminal or VS Code’s Run Test Task. Local results appear here automatically.</p></div></div>
  <section class="panel"><h2>1. Start the dashboard</h2>${code(`git clone ${repo}.git\ncd CodeCrafter-Free\nnode server.mjs`)}<p>Open <strong>http://127.0.0.1:4317</strong>. Leave that terminal running and open another one for your challenge.</p></section>
  <section class="panel"><h2>2. Create a challenge</h2><label>Starter language <select class="select" id="language"><option value="javascript" ${language==='javascript'?'selected':''}>JavaScript</option><option value="python" ${language==='python'?'selected':''}>Python</option></select></label>${code(`node bin/ccfree.mjs init http my-http --language ${language}\ncd my-http\ncode .`)}<p>Implement a stage in <strong>${language==='python'?'main.py':'main.mjs'}</strong>. The starter intentionally fails until you implement it.</p></section>
  <section class="panel"><h2>3. Test from VS Code</h2>${code('node ../bin/ccfree.mjs test --stage request\nnode ../bin/ccfree.mjs test')}<p>Or open the command palette and select <strong>Tasks: Run Test Task</strong>. The runner sends one JSON value on stdin and expects one JSON value on stdout. Debug logs belong on stderr. Each check starts a fresh process.</p><p>For Go, Rust, C#, PowerShell or another language, build your program and change the <strong>command</strong> array in ccfree.json to its executable and arguments. For example, <code>["pwsh", "-File", "main.ps1"]</code>. These runtimes must be installed separately.</p></section>
  <section class="panel"><h2>Using the hosted dashboard?</h2><p>The hosted website does not execute code. After a local test run, import <strong>ccfree-report.json</strong> to view results here. Progress is saved in this browser. Imported results are self-reported, not certified scores.</p><div class="actions-row"><button class="button primary" data-action="import">Import test report ↑</button><a class="button" href="#workspace">View my progress →</a></div></section>`;
}
function lesson(id,stageId){
  const c=getCourse(id);if(!c)return notFound();
  const s=c.stages.find(s=>s.id===stageId)||c.stages[0],r=latestResult(c.id,s.id);
  return `<a class="back" href="#catalog">← Back to challenge library</a><div class="lesson-header">${icon(c)}<div><div class="eyebrow">${c.category} / FOUNDATION LAB</div><h1>Build your own ${c.name}</h1></div></div><p class="page-lead">${c.description}</p>
  <div class="lesson-layout"><aside class="stage-list"><h3>YOUR BUILD · ${completed(c)} / ${c.stages.length} PASSED</h3>${c.stages.map((t,i)=>`<a class="stage-button ${t.id===s.id?'active':''} ${latestResult(c.id,t.id)?.passed?'passed':''}" href="#challenge/${c.id}/${t.id}" ${t.id===s.id?'aria-current="step"':''}><span class="stage-number">${latestResult(c.id,t.id)?.passed?'✓':String(i+1).padStart(2,'0')}</span>${t.title}</a>`).join('')}</aside>
  <article class="lesson-content"><section class="panel"><div class="eyebrow">STAGE ${String(c.stages.indexOf(s)+1).padStart(2,'0')} / ${c.stages.length}</div><h2>${s.title}</h2><p>${escape(s.goal)}</p><h3>The contract</h3><p>Your program receives the input as one JSON value and writes the expected result as one JSON value. No labels or extra output.</p><div class="contract"><div><label>Input / stdin</label><pre>${json(s.input)}</pre></div><div><label>Expected / stdout</label><pre>${json(s.output)}</pre></div></div>
  <details class="hint"><summary>A nudge in the right direction</summary><p>${escape(s.hint)}</p></details><p><a href="${c.reference}" target="_blank" rel="noopener">Read the underlying specification ↗</a></p><div class="lesson-actions"><span class="status ${r?r.passed?'pass':'fail':''}">${r?r.passed?'✓ Passed in latest report':'× Latest report has failures':'○ Not tested yet'}</span><button class="button primary" data-setup="${c.id}">Set up this challenge ↗</button></div></section>
  <section class="panel"><h2>Make it pass</h2><p>From your generated challenge directory, run:</p>${code(`node ../bin/ccfree.mjs test --stage ${s.id}`)}<p>The command assumes your starter is directly inside the platform folder. The generated VS Code test task also works for other locations.</p><div class="actions-row"><button class="button" data-action="import">Import test report ↑</button><a class="button ghost" href="#guide">Runner setup →</a></div></section>
  ${r?`<section class="panel"><h2>Latest stage results</h2>${r.checks.map(check=>`<details class="hint"><summary>${check.passed?'✓':'×'} ${escape(check.name)}${check.error?' — '+escape(check.error):''}</summary><pre class="report-details">Input: ${json(check.input)}\nExpected: ${json(check.expected)}\nReceived: ${json(check.actual)}${check.stderr?'\nDiagnostics: '+escape(check.stderr):''}</pre></details>`).join('')}</section>`:''}</article></div>`;
}
function workspace(){
  const total=courses.reduce((n,c)=>n+completed(c),0);
  return `<div class="eyebrow">YOUR PROGRESS</div><h1>Every little <em>breakthrough.</em></h1><p class="page-lead">A record of what you’ve built, one passing test at a time. ${local?'Connected to your local runner.':'Import a local test report to start tracking your builds.'}</p><div class="actions-row"><button class="button primary" data-action="import">Import test report ↑</button><button class="button" data-action="export">Export progress ↓</button></div>
  <div class="stats"><div class="stat"><span>STAGES PASSED</span><strong>${total} / 55</strong><div class="progress-track"><span style="width:${total/55*100}%"></span></div></div><div class="stat"><span>BUILDS STARTED</span><strong>${courses.filter(started).length}</strong><span>Of ${courses.length} challenges</span></div><div class="stat"><span>TEST RUNS SAVED</span><strong>${reports.length}</strong><span>Latest 100 reports retained</span></div></div>
  <div class="section-heading"><h2>Continue building</h2></div><div class="grid">${courses.filter(started).map(card).join('')||'<div class="empty"><h2>Your first build is waiting.</h2><p>Choose a challenge, implement its first stage, and run the tests.</p><a class="button primary" href="#catalog">Explore the library →</a></div>'}</div>
  <section class="panel"><h2>Recent test runs</h2>${reports.slice(0,15).map(r=>`<div class="report-row"><span class="status ${r.passed?'pass':'fail'}">${r.passed?'PASS':'FAIL'}</span><div class="report-info"><a href="#challenge/${r.challenge}">${getCourse(r.challenge).name}</a><small>${escape(new Date(r.createdAt).toLocaleString())} · ${r.results.filter(s=>s.passed).length}/${r.results.length} stages passed</small></div><a class="button small" href="#challenge/${r.challenge}/${r.results.find(s=>!s.passed)?.id||r.results[0].id}">Inspect →</a></div>`).join('')||'<p>No test runs yet. Results appear after a real local run or report import.</p>'}</section><p class="footnote">Progress reflects the latest report for each stage. Reports are local learning records and can be edited; they are not independently verified credentials.</p>`;
}
function roadmap(){
  return `<div class="eyebrow">ONE STEP AT A TIME</div><h1>The foundations are here.<br><em>There’s more to build.</em></h1><p class="page-lead">This is an independent learning project, not a complete replica of CodeCrafters. Here is exactly what works today and what still needs engineering.</p>
  <div class="two-columns"><section class="panel"><h2>Available today</h2><ul class="checklist"><li>11 challenge families, 55 original foundation stages</li><li>Executable checks with core and edge cases</li><li>Local CLI testing with useful failure output</li><li>JavaScript and Python starters + VS Code tasks</li><li>Stage instructions, hints and specification links</li><li>Local dashboard sync and portable JSON reports</li><li>No subscriptions, billing or test-run limits</li></ul></section><section class="panel"><h2>What these labs teach</h2><p>Each lab implements a core component through a small JSON interface. Redis teaches command dispatch and RESP; SQLite teaches file-format primitives; the AI coding agent uses a simulated workspace.</p><p>These foundations do not yet implement entire network services, SQL query engines, distributed Kafka, real model integrations or a complete shell.</p><p>PowerShell is supported as a custom executable for your solutions, rather than a dedicated PowerShell-reimplementation course.</p></section></div>
  <section class="panel"><h2>Remaining platform work</h2><table class="roadmap-list"><thead><tr><th>Capability</th><th>Next milestone</th><th>Status</th></tr></thead><tbody><tr><td>Advanced curriculum</td><td>Persistence, replication, queries, process execution and full protocol interoperability</td><td>Not implemented</td></tr><tr><td>Hosted test workers</td><td>Isolated containers, resource limits, queueing and operating budget</td><td>Not implemented</td></tr><tr><td>Git push testing</td><td>Authenticated Git receiver and worker orchestration</td><td>Not implemented</td></tr><tr><td>Accounts & cloud progress</td><td>Sign-in, per-user storage and multi-device sync</td><td>Not implemented</td></tr><tr><td>Community & solutions</td><td>Moderation, discussions and opt-in solution sharing</td><td>Not implemented</td></tr><tr><td>Public access</td><td>Owner release of repository and hosted site</td><td>Private preview</td></tr></tbody></table><p>See the repository’s research document for the REA source analysis, public-product observations and a feature parity checklist.</p><a class="button" href="${repo}/blob/main/docs/research.md" target="_blank" rel="noopener">Read the research ↗</a></section>`;
}
const notFound=()=>'<div class="empty"><h1>Build not found.</h1><a class="button" href="#catalog">Back to library</a></div>';
function render(){
  const [page='catalog',id,stage]=location.hash.slice(1).split('/'),view=page||'catalog';
  $('#main').innerHTML=view==='catalog'?catalog():view==='workspace'?workspace():view==='guide'?guide():view==='roadmap'?roadmap():view==='challenge'?lesson(id,stage):notFound();
  const names={catalog:'Challenge library',workspace:'My progress',guide:'Local setup',roadmap:'Project roadmap',challenge:getCourse(id)?.name||'Challenge'};
  $('#crumb').textContent=names[view]||'Workbench';document.title=`${names[view]||'Workbench'} — CodeCrafter Free`;
  document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===(view==='challenge'?'catalog':view)));
}
document.addEventListener('click',async event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.dataset.copy!==undefined){try{await navigator.clipboard.writeText(target.dataset.copy);toast('Copied to clipboard.');}catch{toast('Clipboard unavailable. Select and copy the command.');}}
  if(target.dataset.category){category=target.dataset.category;render();}
  if(target.dataset.setup){
    const c=getCourse(target.dataset.setup);
    $('#dialog-content').innerHTML=`<div class="eyebrow">START BUILDING</div><h2>Make ${c.name} your next project.</h2><p>From your CodeCrafter-Free repository folder:</p>${code(`node bin/ccfree.mjs init ${c.id} my-${c.id} --language ${language}\ncd my-${c.id}\ncode .`)}<p>Implement the stage contract, then use VS Code’s <strong>Run Test Task</strong>. The starter will fail until you write your solution.</p><a class="button primary" href="#guide" data-close>Full setup instructions →</a>`;
    $('#setup-dialog').showModal();
  }
  if(target.classList.contains('close'))$('#setup-dialog').close();
  if(target.dataset.action==='import')$('#report-file').click();
  if(target.dataset.action==='export'){
    if(!reports.length)return toast('No progress to export yet.');
    const url=URL.createObjectURL(new Blob([JSON.stringify(reports,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='ccfree-progress.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
});
document.addEventListener('click',e=>{if(e.target.closest('[data-close]'))$('#setup-dialog').close();});
document.addEventListener('input',e=>{if(e.target.id==='search'){search=e.target.value;$('#cards').innerHTML=filteredCards();}});
document.addEventListener('change',e=>{if(e.target.id==='language'){language=e.target.value;render();}});
$('#report-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>2_000_000)throw new Error('Report must be smaller than 2 MB.');
    const value=JSON.parse(await file.text()),incoming=Array.isArray(value)?value:[value];
    if(!incoming.length||incoming.length>100||!incoming.every(validateReport))throw new Error('This is not a valid CodeCrafter Free test report.');
    mergeReports(incoming);render();toast(`Imported ${incoming.length} test report${incoming.length===1?'':'s'}.`);
  }catch(error){toast(error.message);}finally{e.target.value='';}
});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
async function sync(){
  try{
    const response=await fetch('/api/reports',{signal:AbortSignal.timeout(2000)});
    if(!response.ok)return;
    const incoming=await response.json();if(!Array.isArray(incoming))return;
    const changed=incoming.some(r=>!reports.some(p=>p.id===r.id));
    local=true;$('#connection').textContent='Local runner connected';$('#connection').classList.add('live');
    if(changed){mergeReports(incoming);render();}
  }catch{}
}
render();
if(location.hostname==='127.0.0.1'){sync();setInterval(sync,8000);}
