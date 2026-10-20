// Reference implementations validate the curriculum's fixtures.
// These are visible solutions, not hidden grading infrastructure.
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
const hex=b=>Buffer.from(b).toString('hex');
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;};
const i32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
const variable=n=>{const a=[];do{const b=n&127;n=Math.floor(n/128);a.push(b|(n?128:0));}while(n);return Buffer.from(a);};
function domain(name){return Buffer.concat([...name.replace(/\.$/,'').split('.').filter(Boolean).flatMap(s=>[Buffer.from([s.length]),Buffer.from(s)]),Buffer.from([0])]);}
function tokens(source){return source.match(/\d+(?:\.\d+)?|[()+*/-]/g)||[];}
function evaluate(source){
  const a=tokens(source);let i=0;
  const primary=()=>{if(a[i]==='-'){i++;return -primary();}if(a[i]==='('){i++;const n=expr();if(a[i++]!==')')throw Error('Expected )');return n;}return Number(a[i++]);};
  const term=()=>{let n=primary();while(['*','/'].includes(a[i])){const op=a[i++],r=primary();n=op==='*'?n*r:n/r;}return n;};
  const expr=()=>{let n=term();while(['+','-'].includes(a[i])){const op=a[i++],r=term();n=op==='+'?n+r:n-r;}return n;};
  return expr();
}
function bdecode(source){
  let i=0;const parse=()=>{
    const ch=source[i++];
    if(ch==='i'){const end=source.indexOf('e',i),v=Number(source.slice(i,end));i=end+1;return v;}
    if(ch==='l'){const a=[];while(source[i]!=='e')a.push(parse());i++;return a;}
    if(ch==='d'){const o={};while(source[i]!=='e'){const key=parse();o[key]=parse();}i++;return o;}
    i--;const colon=source.indexOf(':',i),length=Number(source.slice(i,colon));i=colon+1;const value=source.slice(i,i+length);i+=length;return value;
  };return parse();
}
export function solve(kind,x){
  if(kind==='redis'){
    if(x.op==='encode')return x.value===null?'$-1\r\n':typeof x.value==='number'?`:${x.value}\r\n`:`$${Buffer.byteLength(x.value)}\r\n${x.value}\r\n`;
    const store=new Map();return x.commands.map(([op,...a])=>{switch(op.toUpperCase()){
      case'PING':return'PONG';case'ECHO':return a[0];case'SET':store.set(a[0],a[1]);return'OK';
      case'GET':return store.get(a[0])??null;case'EXISTS':return store.has(a[0])?1:0;
      case'DEL':return a.reduce((n,k)=>n+(store.delete(k)?1:0),0);
    }});
  }
  if(kind==='http'){
    const headers=request=>Object.fromEntries(request.split('\r\n\r\n')[0].split('\r\n').slice(1).map(s=>{const p=s.indexOf(':');return[s.slice(0,p).toLowerCase(),s.slice(p+1).trim()];}));
    switch(x.op){
      case'parse':{const [method,path,version]=x.request.split('\r\n')[0].split(' ');return{method,path,version};}
      case'headers':return headers(x.request);
      case'route':return x.path==='/'?{status:200,body:''}:x.path.startsWith('/echo/')?{status:200,body:decodeURIComponent(x.path.slice(6))}:{status:404,body:'Not Found'};
      case'response':return`HTTP/1.1 ${x.status} ${x.status===200?'OK':'Not Found'}\r\nContent-Length: ${Buffer.byteLength(x.body)}\r\n\r\n${x.body}`;
      case'body':return Buffer.from(x.request.slice(x.request.indexOf('\r\n\r\n')+4)).subarray(0,Number(headers(x.request)['content-length'])).toString();
    }
  }
  if(kind==='git'){
    const blob=()=>Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(x.content)}\0`),Buffer.from(x.content)]);
    switch(x.op){
      case'blob':return blob().toString('hex');
      case'hash':return createHash('sha1').update(blob()).digest('hex');
      case'read':{const b=inflateSync(Buffer.from(x.hex,'hex')),p=b.indexOf(0);return{type:b.subarray(0,p).toString().split(' ')[0],content:b.subarray(p+1).toString()};}
      case'tree':return [...x.entries].sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.type==='tree'?'/':'')),Buffer.from(b.name+(b.type==='tree'?'/':'')))).map(e=>e.name);
      case'commit':{const p=x.text.indexOf('\n\n'),headers=x.text.slice(0,p).split('\n');return{tree:headers.find(h=>h.startsWith('tree ')).slice(5),parents:headers.filter(h=>h.startsWith('parent ')).map(h=>h.slice(7)),message:x.text.slice(p+2)};}
    }
  }
  if(kind==='sqlite'){
    const b=Buffer.from(x.hex||'','hex');
    switch(x.op){
      case'header':return{pageSize:b.readUInt16BE(16)===1?65536:b.readUInt16BE(16)};
      case'varint':{let v=0n,i=0;for(;i<b.length;i++){v=(v<<BigInt(i===8?8:7))|BigInt(i===8?b[i]:b[i]&127);if(i===8||b[i]<128)break;}return{value:v.toString(),bytes:i+1};}
      case'page':return{type:b[0],cells:b.readUInt16BE(3),contentStart:b.readUInt16BE(5)};
      case'serial':return x.type===0?{kind:'null',size:0}:x.type===7?{kind:'float',size:8}:x.type<=9?{kind:'integer',size:[0,1,2,3,4,6,8,8,0,0][x.type]}:{kind:x.type%2?'text':'blob',size:Math.floor((x.type-12)/2)};
      case'integer':{let v=BigInt('0x'+x.hex);if(b[0]&128)v-=1n<<BigInt(b.length*8);return v.toString();}
    }
  }
  if(kind==='shell'){
    if(x.op==='split'){
      const out=[];let quote=null,word='',started=false;
      for(const c of x.line){if(quote){if(c===quote)quote=null;else word+=c;}
        else if(c==='"'||c==="'"){quote=c;started=true;}
        else if(/\s/.test(c)){if(started){out.push(word);word='';started=false;}}
        else{word+=c;started=true;}}
      if(started)out.push(word);return out;
    }
    if(x.name==='echo')return{stdout:x.args.join(' ')+'\n',code:0};
    if(x.name==='pwd')return{stdout:x.cwd+'\n',code:0};
    const builtin=['echo','pwd','exit','type','cd'].includes(x.args[0]);
    return{stdout:x.args[0]+(builtin?' is a shell builtin\n':': not found\n'),code:builtin?0:1};
  }
  if(kind==='grep')return new RegExp(x.pattern).test(x.text);
  if(kind==='interpreter')return x.op==='tokens'?tokens(x.source):evaluate(x.source);
  if(kind==='bittorrent')return x.op==='decode'?bdecode(x.value):'13426974546f7272656e742070726f746f636f6c'+'00'.repeat(8)+x.infoHash+x.peerId;
  if(kind==='dns'){
    switch(x.op){
      case'name':return hex(domain(x.name));
      case'header':{const b=Buffer.from(x.hex,'hex');return Object.fromEntries(['id','flags','questions','answers','authority','additional'].map((k,i)=>[k,b.readUInt16BE(i*2)]));}
      case'question':return hex(Buffer.concat([domain(x.name),u16(x.type),u16(x.class)]));
      case'address':return hex(x.address.split('.').map(Number));
      case'response':return hex(Buffer.concat([u16(x.id),u16(0x8180),u16(1),u16(x.answers),u16(0),u16(0)]));
    }
  }
  if(kind==='kafka'){
    switch(x.op){
      case'frame':return hex(Buffer.concat([i32(x.hex.length/2),Buffer.from(x.hex,'hex')]));
      case'header':{const b=Buffer.from(x.hex,'hex');return{apiKey:b.readInt16BE(0),apiVersion:b.readInt16BE(2),correlationId:b.readInt32BE(4)};}
      case'correlation':return hex(Buffer.concat([i32(4),i32(x.id)]));
      case'varint':return hex(variable(x.value));
      case'compact':return x.value===null?'00':hex(Buffer.concat([variable(Buffer.byteLength(x.value)+1),Buffer.from(x.value)]));
    }
  }
  if(kind==='agent'){
    const read=path=>Object.hasOwn(x.files,path)?{content:x.files[path]}:{error:'File not found'};
    switch(x.op){
      case'messages':return[{role:'system',content:x.system},{role:'user',content:x.prompt}];
      case'tool':return{name:'read_file',description:'Read a workspace file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}};
      case'read':return read(x.path);
      case'loop':return x.calls.map(c=>({id:c.id,result:c.name==='read_file'?read(c.arguments.path):{error:'Unknown tool'}}));
      case'budget':return{action:x.done||x.steps>=x.maxSteps?'stop':'continue'};
    }
  }
  throw Error('Unimplemented reference operation');
}
if(process.argv[2])console.log(JSON.stringify(solve(process.argv[2],JSON.parse(readFileSync(0,'utf8')))));
