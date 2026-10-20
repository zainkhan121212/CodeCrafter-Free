import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { getCourse } from './catalog.mjs';
import { casesFor } from './cases.mjs';

// Local code execution only. This is deliberately not exposed over HTTP.
export function invoke(command, input, {cwd, timeout=3000, outputLimit=65536}={}) {
  if(!Array.isArray(command)||!command.length||command.some(x=>typeof x!=='string'))
    throw new Error('command must be a non-empty array of executable and arguments');
  return new Promise(resolve=>{
    let stdout='',stderr='',size=0,finished=false,timer;
    const child=spawn(command[0],command.slice(1),{cwd,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const finish=result=>{
      if(finished)return;
      finished=true;clearTimeout(timer);
      resolve({...result,stderr:stderr.slice(0,4096)});
    };
    timer=setTimeout(()=>{child.kill();finish({error:`Timed out after ${timeout} ms`});},timeout);
    const collect=(kind,data)=>{
      size+=Buffer.byteLength(data);
      if(size>outputLimit){child.kill();finish({error:'Output exceeded 64 KiB'});return;}
      if(kind==='stdout')stdout+=data;else stderr+=data;
    };
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',d=>collect('stdout',d));child.stderr.on('data',d=>collect('stderr',d));
    child.on('error',e=>finish({error:`Cannot launch program: ${e.message}`}));
    child.on('close',code=>{
      if(code!==0)return finish({error:`Program exited with code ${code}`});
      try{finish({value:JSON.parse(stdout.trim())});}
      catch{finish({error:'Expected exactly one JSON value on stdout. Write diagnostics to stderr.'});}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(input)+'\n');
  });
}
export async function runSuite({challenge,stage='all',command,cwd,timeout=3000}) {
  const course=getCourse(challenge);
  if(!course)throw new Error(`Unknown challenge: ${challenge}`);
  const selected=stage==='all'?course.stages:course.stages.filter(s=>s.id===stage);
  if(!selected.length)throw new Error(`Unknown stage: ${stage}`);
  const started=Date.now(), results=[];
  for(const s of selected){
    const checks=[];
    for(const c of casesFor(challenge,s.id)){
      const result=await invoke(command,c.input,{cwd,timeout});
      checks.push({name:c.name,input:c.input,expected:c.expected,actual:result.value,
        passed:!result.error&&isDeepStrictEqual(result.value,c.expected),error:result.error,stderr:result.stderr});
    }
    results.push({id:s.id,title:s.title,passed:checks.every(c=>c.passed),checks});
  }
  return {schemaVersion:1,id:randomUUID(),challenge,createdAt:new Date().toISOString(),
    durationMs:Date.now()-started,results,passed:results.every(r=>r.passed)};
}
