import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {courses} from '../lib/catalog.mjs';
import {casesFor} from '../lib/cases.mjs';
import {invoke,runSuite} from '../lib/runner.mjs';
import {validateReport} from '../lib/reports.mjs';
import {createServer} from '../server.mjs';
import {solve} from './reference.mjs';
const reference=fileURLToPath(new URL('./reference.mjs',import.meta.url));
test('all 55 stages have independently evaluated fixtures',()=>{
  assert.equal(courses.flatMap(c=>c.stages).length,55);
  for(const course of courses)for(const stage of course.stages){
    const cases=casesFor(course.id,stage.id);assert.ok(cases.length);
    for(const c of cases)assert.deepEqual(solve(course.id,c.input),c.expected,`${course.id}/${stage.id}: ${c.name}`);
  }
});
for(const course of courses)test(`subprocess grading: ${course.id}`,async()=>{
  const report=await runSuite({challenge:course.id,command:[process.execPath,reference,course.id]});
  assert.equal(report.passed,true,JSON.stringify(report.results.filter(r=>!r.passed)));
  assert.equal(validateReport(report),true);
});
test('runner rejects incorrect, malformed, failing and hanging programs',async()=>{
  const wrong=await runSuite({challenge:'redis',stage:'ping',command:[process.execPath,'-e','console.log(JSON.stringify("wrong"))']});
  assert.equal(wrong.passed,false);assert.equal(wrong.results[0].checks[0].passed,false);
  assert.match((await invoke([process.execPath,'-e','console.log("not json")'],{})).error,/JSON/);
  assert.match((await invoke([process.execPath,'-e','process.exit(2)'],{})).error,/code 2/);
  assert.match((await invoke([process.execPath,'-e','setInterval(()=>{},1000)'],{},{timeout:100})).error,/Timed out/);
  assert.match((await invoke([process.execPath,'-e','console.log("x".repeat(100000))'],{})).error,/Output exceeded/);
  assert.match((await invoke(['ccfree-missing-executable'],{})).error,/Cannot launch/);
});
test('invalid challenge or stage cannot silently pass',async()=>{
  await assert.rejects(runSuite({challenge:'unknown',command:['node']}),/Unknown challenge/);
  await assert.rejects(runSuite({challenge:'redis',stage:'typo',command:['node']}),/Unknown stage/);
});
test('report validation rejects corrupted imports and inconsistent passed flags',async()=>{
  for(const bad of [null,{},[],{schemaVersion:1,id:'x',createdAt:1,results:[]}])assert.equal(validateReport(bad),false);
  const valid=await runSuite({challenge:'redis',stage:'ping',command:[process.execPath,reference,'redis']});
  const bad=structuredClone(valid);bad.results[0].checks[0].passed=false;
  assert.equal(validateReport(bad),false);
  for(const results of [[null],[...valid.results,...valid.results]]){
    assert.equal(validateReport({...valid,results}),false);
  }
  assert.equal(validateReport({...valid,results:[{...valid.results[0],checks:[null]}]}),false);
});
test('dashboard serves assets and refuses execution, traversal, foreign origins and hosts',async t=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status,200);
  assert.equal((await (await fetch(base+'/api/catalog')).json()).length,11);
  assert.equal((await fetch(base+'/api/run',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/.git/config')).status,404);
  assert.equal((await fetch(base+'/api/reports',{headers:{Origin:'https://evil.invalid'}})).status,403);
  const foreignHostStatus=await new Promise((resolve,reject)=>{
    http.get(base,{headers:{Host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);
  });
  assert.equal(foreignHostStatus,403);
});
