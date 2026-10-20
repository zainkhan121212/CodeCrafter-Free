#!/usr/bin/env node
import { readFile,writeFile,mkdir,access } from 'node:fs/promises';
import { resolve,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { courses,getCourse } from '../lib/catalog.mjs';
import { runSuite } from '../lib/runner.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [action,...args]=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
async function main(){
  if(action==='list'){
    for(const c of courses)console.log(`${c.id.padEnd(14)} ${c.name.padEnd(18)} ${c.stages.length} foundation stages`);
  } else if(action==='init'){
    const course=getCourse(args[0]);
    if(!course)throw new Error('Use init <challenge> <directory>. Run list for challenge IDs.');
    const destination=resolve(args[1]||`my-${course.id}`);
    try{await access(destination);throw new Error(`Directory already exists: ${destination}. Choose a new directory to avoid overwriting work.`);}
    catch(e){if(e.code!=='ENOENT')throw e;}
    const language=option('--language','javascript');
    if(!['javascript','python'].includes(language))throw new Error('Starter languages: javascript, python. Other languages can use a custom command array.');
    await mkdir(join(destination,'.vscode'),{recursive:true});
    const command=language==='python'?['python','main.py']:['node','main.mjs'];
    const starter=language==='python'
      ?'import json, sys\n\ndef solve(request):\n    # Implement the stage contract here.\n    return {"error": "Not implemented"}\n\nprint(json.dumps(solve(json.loads(sys.stdin.readline()))))\n'
      :'import { readFileSync } from "node:fs";\n\nfunction solve(request) {\n  // Implement the stage contract here.\n  return { error: "Not implemented" };\n}\n\nconst request = JSON.parse(readFileSync(0, "utf8"));\nconsole.log(JSON.stringify(solve(request)));\n';
    await writeFile(join(destination,language==='python'?'main.py':'main.mjs'),starter);
    await writeFile(join(destination,'ccfree.json'),JSON.stringify({challenge:course.id,command,timeout:3000},null,2)+'\n');
    await writeFile(join(destination,'.vscode','tasks.json'),JSON.stringify({version:'2.0.0',tasks:[{
      label:'CodeCrafter Free: test',type:'process',command:process.execPath,
      args:[join(root,'bin','ccfree.mjs'),'test'],group:{kind:'test',isDefault:true},problemMatcher:[]
    }]},null,2));
    await writeFile(join(destination,'README.md'),`# Build your own ${course.name}\n\nOpen this folder in VS Code. Implement the contracts in the CodeCrafter Free dashboard.\n\nRun \`node "${join(root,'bin','ccfree.mjs')}" test\` or VS Code **Tasks: Run Test Task**.\n\nEvery test launches your program, sends one JSON value on stdin, and expects one JSON value on stdout. Use stderr for debugging. The process starts fresh for each test. This is a foundation lab, not a complete production ${course.name} implementation.\n`);
    console.log(`Created ${destination}\nOpen this folder in VS Code and run the test task.`);
  } else if(action==='test'){
    const configPath=resolve(option('--config','ccfree.json'));
    const config=JSON.parse(await readFile(configPath,'utf8'));
    if(!Number.isInteger(config.timeout??3000)||(config.timeout??3000)<100||(config.timeout??3000)>30000)
      throw new Error('timeout must be an integer between 100 and 30000 milliseconds');
    const report=await runSuite({...config,cwd:dirname(configPath),stage:option('--stage','all')});
    const reportDir=join(root,'.data','reports');await mkdir(reportDir,{recursive:true});
    const reportText=JSON.stringify(report,null,2)+'\n';
    await writeFile(join(reportDir,report.id+'.json'),reportText,{flag:'wx'});
    await writeFile(join(dirname(configPath),'ccfree-report.json'),reportText);
    for(const r of report.results){
      console.log(`${r.passed?'PASS':'FAIL'} ${r.title}`);
      for(const c of r.checks.filter(x=>!x.passed)){
        console.log(`  ${c.name}: ${c.error||`expected ${JSON.stringify(c.expected)}, received ${JSON.stringify(c.actual)}`}`);
        if(c.stderr)console.log(`  stderr: ${c.stderr}`);
      }
    }
    console.log(`\n${report.results.filter(r=>r.passed).length}/${report.results.length} stages passed in ${report.durationMs}ms.\nReport: ${join(dirname(configPath),'ccfree-report.json')}`);
    process.exitCode=report.passed?0:1;
  } else {
    console.log('CodeCrafter Free — original foundation labs\n\n  list\n  init <challenge> <new-directory> [--language javascript|python]\n  test [--config ccfree.json] [--stage <id>|all]\n\nStart dashboard from platform directory: node server.mjs\nNo installation or subscription required. Node.js 22+.');
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
