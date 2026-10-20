import { getCourse } from './catalog.mjs';
import { deflateSync } from 'node:zlib';
const extra = {
  redis: [
    [[{commands:[['ping'],['PING']]},['PONG','PONG']]],
    [[{commands:[['ECHO',''],['ECHO','你好']]},['','你好']]],
    [[{commands:[['SET','a','1'],['SET','a','2'],['GET','a']]},['OK','OK','2']]],
    [[{commands:[['DEL','absent'],['EXISTS','absent']]},[0,0]]],
    [[{op:'encode',value:'é'},'$2\r\né\r\n'],[{op:'encode',value:null},'$-1\r\n'],[{op:'encode',value:42},':42\r\n']]
  ],
  http: [
    [[{op:'parse',request:'POST /x?q=1 HTTP/1.1\r\n\r\n'},{method:'POST',path:'/x?q=1',version:'HTTP/1.1'}]],
    [[{op:'headers',request:'GET / HTTP/1.1\r\nX-URL: https://test.invalid/a\r\nAccept: */*\r\n\r\n'},{'x-url':'https://test.invalid/a',accept:'*/*'}]],
    [[{op:'route',path:'/'},{status:200,body:''}],[{op:'route',path:'/missing'},{status:404,body:'Not Found'}]],
    [[{op:'response',status:404,body:'é'},'HTTP/1.1 404 Not Found\r\nContent-Length: 2\r\n\r\né']],
    [[{op:'body',request:'POST / HTTP/1.1\r\ncontent-length: 2\r\n\r\néEXTRA'},'é']]
  ],
  git: [
    [[{op:'blob',content:''},'626c6f62203000'],[{op:'blob',content:'é'},'626c6f62203200c3a9']],
    [[{op:'hash',content:''},'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391']],
    [],
    [[{op:'tree',entries:[{name:'foo',type:'tree'},{name:'foo.bar',type:'blob'},{name:'foo0',type:'blob'}]},['foo.bar','foo','foo0']]],
    [[{op:'commit',text:'tree 123\nparent a\nparent b\n\nmerge\n\nbody'},{tree:'123',parents:['a','b'],message:'merge\n\nbody'}]]
  ],
  sqlite: [
    [],
    [[{op:'varint',hex:'7f'},{value:'127',bytes:1}],[{op:'varint',hex:'ffffffffffffffffff'},{value:'18446744073709551615',bytes:9}]],
    [[{op:'page',hex:'050010000300200000000005'},{type:5,cells:3,contentStart:32}]],
    [[{op:'serial',type:0},{kind:'null',size:0}],[{op:'serial',type:5},{kind:'integer',size:6}],[{op:'serial',type:16},{kind:'blob',size:2}],[{op:'serial',type:9},{kind:'integer',size:0}]],
    [[{op:'integer',hex:'7fffffffffffffff'},'9223372036854775807'],[{op:'integer',hex:'8000000000000000'},'-9223372036854775808']]
  ],
  shell: [
    [[{op:'split',line:' \t '},[]]],
    [[{op:'split',line:'echo a" b"c \'x y\''},['echo','a bc','x y']]],
    [[{op:'builtin',name:'echo',args:[]},{stdout:'\n',code:0}]],
    [[{op:'builtin',name:'pwd',cwd:'/',args:[]},{stdout:'/\n',code:0}]],
    [[{op:'builtin',name:'type',args:['missing']},{stdout:'missing: not found\n',code:1}]]
  ],
  grep: [
    [[{pattern:'dog',text:'cat'},false],[{pattern:'',text:'anything'},true]],
    [[{pattern:'a.b',text:'a\nb'},false],[{pattern:'c.t',text:'coat'},false]],
    [[{pattern:'^cat$',text:'cats'},false],[{pattern:'cat$',text:'a cat'},true]],
    [[{pattern:'^[a-z][0-9]$',text:'A7'},false],[{pattern:'[abc]',text:'zzz'},false]],
    [[{pattern:'^ab+c*$',text:'ac'},false],[{pattern:'^a*a$',text:'aaa'},true],[{pattern:'^ab*c$',text:'ac'},true]]
  ],
  interpreter: [
    [[{op:'tokens',source:' /- '},['/','-']]],
    [[{op:'tokens',source:'0.25*100'},['0.25','*','100']]],
    [[{op:'eval',source:'1-2-3'},-4]],
    [[{op:'eval',source:'12/3/2+1'},3]],
    [[{op:'eval',source:'2*(3+(4-1))'},12]]
  ],
  bittorrent: [
    [[{op:'decode',value:'0:'},'']],
    [[{op:'decode',value:'i0e'},0]],
    [[{op:'decode',value:'le'},[]]],
    [[{op:'decode',value:'d1:ali1ei2eee'},{a:[1,2]}]],
    [[{op:'handshake',infoHash:'ab'.repeat(20),peerId:'cd'.repeat(20)},'13426974546f7272656e742070726f746f636f6c'+'00'.repeat(8)+'ab'.repeat(20)+'cd'.repeat(20)]]
  ],
  dns: [
    [[{op:'name',name:'.'},'00'],[{op:'name',name:'a.io.'},'016102696f00']],
    [[{op:'header',hex:'ffff81800001000200030004'},{id:65535,flags:33152,questions:1,answers:2,authority:3,additional:4}]],
    [[{op:'question',name:'.',type:28,class:1},'00001c0001']],
    [[{op:'address',address:'0.255.16.1'},'00ff1001']],
    [[{op:'response',id:65535,answers:0},'ffff81800001000000000000']]
  ],
  kafka: [
    [[{op:'frame',hex:''},'00000000']],
    [[{op:'header',hex:'00010000ffffffff'},{apiKey:1,apiVersion:0,correlationId:-1}]],
    [[{op:'correlation',id:-1},'00000004ffffffff']],
    [[{op:'varint',value:0},'00'],[{op:'varint',value:16384},'808001']],
    [[{op:'compact',value:''},'01'],[{op:'compact',value:null},'00'],[{op:'compact',value:'é'},'03c3a9']]
  ],
  agent: [
    [[{op:'messages',system:'',prompt:'test'},[{role:'system',content:''},{role:'user',content:'test'}]]],
    [],
    [[{op:'read',files:{},path:'secret'},{error:'File not found'}]],
    [[{op:'loop',files:{},calls:[{id:'x',name:'execute',arguments:{}},{id:'y',name:'read_file',arguments:{path:'no'}}]},[{id:'x',result:{error:'Unknown tool'}},{id:'y',result:{error:'File not found'}}]]],
    [[{op:'budget',steps:0,maxSteps:3,done:false},{action:'continue'}],[{op:'budget',steps:0,maxSteps:3,done:true},{action:'stop'}]]
  ]
};
export function casesFor(courseId, stageId) {
  const course=getCourse(courseId);
  if(!course) throw new Error(`Unknown challenge: ${courseId}`);
  const index=course.stages.findIndex(s=>s.id===stageId);
  if(index<0) throw new Error(`Unknown stage: ${stageId}`);
  const s=course.stages[index];
  let cases=[[s.input,s.output],...(extra[courseId][index]||[])];
  if(courseId==='git' && stageId==='read') cases=['hello','', 'Unicode: é'].map(content=>{
    const blob=Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(content)}\0`),Buffer.from(content)]);
    return [{op:'read',hex:deflateSync(blob).toString('hex')},{type:'blob',content}];
  });
  if(courseId==='sqlite' && stageId==='header') cases=[512,4096,65536].map(pageSize=>{
    const b=Buffer.alloc(100); b.write('SQLite format 3\0'); b.writeUInt16BE(pageSize===65536?1:pageSize,16);
    return [{op:'header',hex:b.toString('hex')},{pageSize}];
  });
  return cases.map(([input,expected],i)=>({name:i===0?'Core behavior':`Edge case ${i}`,input,expected}));
}
