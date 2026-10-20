import http from 'node:http';
import { readFile,readdir } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { courses } from './lib/catalog.mjs';
import { validateReport } from './lib/reports.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export function createServer(){
  return http.createServer(async(req,res)=>{
    const reply=(code,body,type='application/json')=>{
      res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));
    };
    if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||''))return reply(403,{error:'Use the printed loopback address.'});
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return reply(403,{error:'Origin not allowed'});
    if(req.method!=='GET')return reply(405,{error:'Read-only dashboard. Run tests from your terminal.'});
    let path;try{path=new URL(req.url,'http://127.0.0.1').pathname;}catch{return reply(400,{error:'Invalid URL'});}
    if(path==='/api/catalog')return reply(200,courses);
    if(path==='/api/reports'){
      const directory=join(root,'.data','reports');
      const files=await readdir(directory).catch(()=>[]);
      const reports=await Promise.all(files.filter(f=>/^[a-f0-9-]+\.json$/.test(f)).slice(-1000).map(async f=>{
        try{const r=JSON.parse(await readFile(join(directory,f),'utf8'));return validateReport(r)?r:null;}catch{return null;}
      }));
      return reply(200,reports.filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100));
    }
    const assets={'/':'public/index.html','/index.html':'public/index.html','/app.mjs':'public/app.mjs','/style.css':'public/style.css','/catalog.mjs':'lib/catalog.mjs','/reports.mjs':'lib/reports.mjs'};
    if(!assets[path])return reply(404,{error:'Not found'});
    try{return reply(200,await readFile(join(root,assets[path])),path.endsWith('.css')?'text/css':path.endsWith('.mjs')?'text/javascript':'text/html');}
    catch{return reply(500,{error:'Asset unavailable'});}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4317);
  createServer().listen(port,'127.0.0.1',()=>console.log(`CodeCrafter Free: http://127.0.0.1:${port}`));
}
