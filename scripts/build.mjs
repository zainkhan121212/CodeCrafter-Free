import { mkdir,copyFile } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const file of ['index.html','style.css','app.mjs'])await copyFile(`public/${file}`,`dist/${file}`);
for(const file of ['catalog.mjs','reports.mjs'])await copyFile(`lib/${file}`,`dist/${file}`);
console.log('Static dashboard built in dist/. Local execution remains in the CLI.');
