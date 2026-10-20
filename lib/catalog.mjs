// Original foundation curriculum. Stage IDs are stable report identifiers.
const stage = (id, title, goal, input, output, hint) => ({ id, title, goal, input, output, hint });
export const courses = [
  {
    id: 'redis', name: 'Redis', icon: '▱', color: '#e86d67', category: 'Databases', difficulty: 'Intermediate', time: '4–6 hours',
    description: 'Turn bytes into commands. Build the core of an in-memory key-value store.',
    topics: ['RESP', 'State', 'Expiration'],
    reference: 'https://redis.io/docs/latest/develop/reference/protocol-spec/',
    stages: [
      stage('ping', 'Your first PONG', 'Accept an array of commands. Return one response for each command. PING returns the string PONG.', {commands:[['PING']]}, ['PONG'], 'Start with command dispatch. Normalize command names to uppercase.'),
      stage('echo', 'Echo a message', 'Support ECHO with one argument, preserving spaces and Unicode. PING must keep working.', {commands:[['ECHO','hello world'],['PING']]}, ['hello world','PONG'], 'Do not split the message on spaces; the JSON driver has already separated arguments.'),
      stage('store', 'Remember a value', 'Add SET key value and GET key. SET returns OK; a missing key returns null. State lasts for the entire commands array.', {commands:[['SET','language','Rust'],['GET','language'],['GET','missing']]}, ['OK','Rust',null], 'Use a map. Keep it outside the command dispatch function.'),
      stage('delete', 'Delete and count keys', 'DEL accepts one or more keys and returns how many existing keys were removed. EXISTS returns 1 or 0 for one key.', {commands:[['SET','a','1'],['EXISTS','a'],['DEL','a','b'],['GET','a']]}, ['OK',1,1,null], 'Count only keys that were actually present.'),
      stage('resp', 'Speak the wire format', 'For op=encode, encode a JSON string as a RESP bulk string, a number as a RESP integer, and null as a null bulk string. Return the wire string.', {op:'encode',value:'hello'}, '$5\r\nhello\r\n', 'RESP lengths count UTF-8 bytes, not JavaScript string characters.')
    ]
  },
  {
    id:'http', name:'HTTP Server', icon:'↗', color:'#73bfa6', category:'Networking', difficulty:'Beginner', time:'3–5 hours',
    description:'Follow a request from its first byte to a well-formed HTTP response.',
    topics:['HTTP/1.1','Routing','Headers'], reference:'https://www.rfc-editor.org/rfc/rfc9112',
    stages:[
      stage('request','Read the request line','Given a raw HTTP request, return method, path and version. Ignore subsequent lines.',{op:'parse',request:'GET /hello HTTP/1.1\r\nHost: localhost\r\n\r\n'},{method:'GET',path:'/hello',version:'HTTP/1.1'},'The request line ends at the first CRLF.'),
      stage('headers','Normalize headers','Return an object containing all request headers with lowercase names and trimmed values.',{op:'headers',request:'GET / HTTP/1.1\r\nHost: localhost\r\nUser-Agent: ccfree\r\n\r\n'},{host:'localhost','user-agent':'ccfree'},'Split each header at its first colon, so values may contain colons.'),
      stage('route','Route a request','For op=route: / returns {status:200,body:""}, /echo/<text> returns decoded text with status 200, and every other path returns {status:404,body:"Not Found"}.',{op:'route',path:'/echo/hello%20world'},{status:200,body:'hello world'},'Decode only the portion after /echo/.'),
      stage('response','Serialize a response','Serialize status 200 or 404, a UTF-8 body and Content-Length into HTTP/1.1. Header order: status line, Content-Length, blank line, body.',{op:'response',status:200,body:'hello'},'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello','The empty line separating headers and body is required.'),
      stage('body','Read the request body','Return exactly Content-Length UTF-8 bytes after the header terminator, ignoring any trailing bytes. Inputs contain complete requests.',{op:'body',request:'POST / HTTP/1.1\r\nContent-Length: 5\r\n\r\nhelloEXTRA'},'hello','Locate CRLF CRLF before slicing the body.')
    ]
  },
  {
    id:'git', name:'Git', icon:'⑂', color:'#e7a36a', category:'Developer tools', difficulty:'Intermediate', time:'4–6 hours',
    description:'Discover content-addressed storage, object headers, and the shape of a commit.',
    topics:['SHA-1','Objects','Commits'], reference:'https://git-scm.com/book/en/v2/Git-Internals-Git-Objects',
    stages:[
      stage('header','Frame a blob','Return the uncompressed Git blob object as hex: ASCII "blob ", decimal UTF-8 byte length, a NUL byte, then content.',{op:'blob',content:'hello'},'626c6f6220350068656c6c6f','The header is part of the object, even though it is not file content.'),
      stage('hash','Hash an object','Return the SHA-1 hexadecimal object ID of a blob. Hash the full header plus content, not just the content.',{op:'hash',content:'hello'},'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0','Use your language’s SHA-1 implementation; cryptography is not the lesson here.'),
      stage('read','Read a loose object','Inflate the zlib-compressed bytes in hex. Return {type,content}; content is UTF-8 and follows the first NUL.',{op:'read',hex:'generated during testing'},{type:'blob',content:'hello'},'Separate decompression from object parsing. Test fixtures contain valid blob objects.'),
      stage('tree','Order tree entries','Given entries with name and type (blob or tree), return names sorted using Git tree order: compare UTF-8 name bytes, with a slash appended to directory names.',{op:'tree',entries:[{name:'z',type:'blob'},{name:'a',type:'tree'},{name:'a.c',type:'blob'}]},['a.c','a','z'],'A directory named a compares as a/; a.c comes before a/.'),
      stage('commit','Parse a commit','Parse a commit payload into {tree,parents,message}. Collect all parent headers and preserve the message after the first blank line.',{op:'commit',text:'tree abc\nparent def\nauthor Student\n\nFirst commit\n'},{tree:'abc',parents:['def'],message:'First commit\n'},'A merge commit can have multiple parent lines.')
    ]
  },
  {
    id:'sqlite', name:'SQLite', icon:'▤', color:'#7ba9df', category:'Databases', difficulty:'Advanced', time:'5–8 hours',
    description:'Read database pages and decode the compact structures beneath SQL.',
    topics:['Pages','Varints','Records'], reference:'https://www.sqlite.org/fileformat.html',
    stages:[
      stage('header','Read a database header','Given a valid 100-byte SQLite header as hex, return {pageSize}. The unsigned big-endian field is at offset 16; value 1 means 65536.',{op:'header',hex:'generated during testing'},{pageSize:4096},'Use byte offsets, not character offsets in the hex string.'),
      stage('varint','Decode a varint','Decode a SQLite varint from hex. Return {value,bytes}; value is a decimal string so 64-bit integers remain exact. First eight bytes carry 7 bits, ninth carries 8.',{op:'varint',hex:'8100'},{value:'128',bytes:2},'The high bit of the first eight bytes says whether another byte follows.'),
      stage('page','Inspect a B-tree page','Given a B-tree page header at offset zero as hex, return {type,cells,contentStart}; these fields are at offsets 0, 3 (two bytes), and 5 (two bytes).',{op:'page',hex:'0d000000020ff000'},{type:13,cells:2,contentStart:4080},'Interior and leaf page headers differ in total size, but these fields have the same offsets.'),
      stage('serial','Decode serial types','Return {kind,size} for a serial type: 0 null/0; 1..6 integer with byte widths 1,2,3,4,6,8; 7 float/8; 8 and 9 integer/0; even >=12 blob; odd >=13 text.',{op:'serial',type:23},{kind:'text',size:5},'For text, size=(type-13)/2; blob size=(type-12)/2.'),
      stage('integer','Read a signed integer','Decode big-endian two’s-complement integer bytes from hex. Return the decimal value as a string. Widths range from 1 to 8 bytes.',{op:'integer',hex:'fffe'},'-2','If the sign bit is set, subtract 2 raised to the total bit width.')
    ]
  },
  {
    id:'shell',name:'Shell',icon:'>_',color:'#b1a0e5',category:'Developer tools',difficulty:'Beginner',time:'3–5 hours',
    description:'Build a command parser and learn what happens after you press Enter.',
    topics:['Parsing','Quoting','Builtins'],reference:'https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html',
    stages:[
      stage('split','Split a command','Return tokens from a command separated by whitespace. Ignore leading/trailing whitespace.',{op:'split',line:'  echo   hello world '},['echo','hello','world'],'Start with unquoted commands before adding a state machine.'),
      stage('quotes','Keep quoted text together','Tokenize a line with single and double quotes. Remove quote delimiters; preserve whitespace inside quotes and empty quoted arguments. No escapes or variable expansion yet.',{op:'split',line:'echo "hello world" \'\''},['echo','hello world',''],'Track whether a token started, even when its content is empty.'),
      stage('echo','Implement echo','For op=builtin and name=echo, join args with one space and append a newline. Return {stdout,code:0}.',{op:'builtin',name:'echo',args:['hello','world']},{stdout:'hello world\n',code:0},'Your driver returns JSON; stdout is a string inside that result.'),
      stage('pwd','Track the working directory','For op=builtin and name=pwd, return the supplied cwd plus newline and code 0. Use the supplied value for deterministic tests.',{op:'builtin',name:'pwd',args:[],cwd:'/home/student'},{stdout:'/home/student\n',code:0},'This foundation lab models working-directory state; it does not execute host commands.'),
      stage('type','Identify builtins','For name=type and one argument: echo, pwd, exit, type and cd are builtins. Return "<name> is a shell builtin\\n" with code 0; otherwise "<name>: not found\\n" with code 1.',{op:'builtin',name:'type',args:['echo']},{stdout:'echo is a shell builtin\n',code:0},'Keep supported builtin names in one set.')
    ]
  },
  {
    id:'grep',name:'grep',icon:'.*',color:'#d8b967',category:'Languages',difficulty:'Intermediate',time:'3–5 hours',
    description:'Make a small pattern matcher, from literal text to repetition.',
    topics:['Patterns','Anchors','Quantifiers'],reference:'https://www.gnu.org/software/grep/manual/grep.html',
    stages:[
      stage('literal','Find a literal','Return true if pattern occurs anywhere in text, otherwise false. Matching is case-sensitive.',{pattern:'cat',text:'the cat sleeps'},true,'A search can begin at any position in the text.'),
      stage('wildcard','Match any character','Add dot: it matches one character other than newline. Keep literal matching.',{pattern:'c.t',text:'cat'},true,'Separate matching at a position from searching across positions.'),
      stage('anchors','Anchor a match','Support ^ at the beginning of a pattern and $ at its end. They constrain position without consuming characters.',{pattern:'^cat$',text:'cat'},true,'An anchored full match must consume the entire input.'),
      stage('classes','Match character classes','Add positive character classes such as [abc] and ranges such as [a-z]. Support literals, dot and anchors from earlier stages.',{pattern:'^[a-z][0-9]$',text:'a7'},true,'Parse a class as a single matcher even though it uses several pattern characters.'),
      stage('repeat','Repeat a matcher','Add * (zero or more) and + (one or more) after literals, dot or classes. Use backtracking or an automaton. No groups or alternation required.',{pattern:'^ab+c*$',text:'abbbc'},true,'Greedy consumption must allow backtracking when later matchers fail.')
    ]
  },
  {
    id:'interpreter',name:'Interpreter',icon:'λ',color:'#b699dc',category:'Languages',difficulty:'Advanced',time:'5–8 hours',
    description:'Give a tiny language meaning with tokens, precedence and evaluation.',
    topics:['Tokens','Expressions','Evaluation'],reference:'https://craftinginterpreters.com/scanning.html',
    stages:[
      stage('tokens','Scan punctuation','For op=tokens, return all punctuation tokens as strings, ignoring whitespace. Supported punctuation: ( ) + - * /.',{op:'tokens',source:'( + ) *'},['(','+',')','*'],'Consume source characters with a cursor.'),
      stage('numbers','Scan numbers','Extend tokens to decimal numbers, returned as strings. Preserve spelling. Decimal forms have digits before and after the dot.',{op:'tokens',source:'12 + 3.5'},['12','+','3.5'],'Keep scanning while the next character belongs to the current number.'),
      stage('add','Evaluate addition','For op=eval, evaluate numeric expressions using + and -. Return the number. Whitespace is optional.',{op:'eval',source:'10 - 3 + 2'},9,'Addition and subtraction associate left to right.'),
      stage('precedence','Respect precedence','Extend eval with * and /. Multiplication and division bind more tightly than + and -.',{op:'eval',source:'2 + 3 * 4'},14,'Parse a term before parsing an additive expression.'),
      stage('group','Handle grouping and unary minus','Extend eval with parentheses and unary minus. Tests use finite arithmetic results.',{op:'eval',source:'-(2 + 3) * 4'},-20,'A primary expression may recursively contain a complete expression.')
    ]
  },
  {
    id:'bittorrent',name:'BitTorrent',icon:'⇅',color:'#80babf',category:'Networking',difficulty:'Advanced',time:'4–6 hours',
    description:'Decode bencoding and build the handshake that starts a peer conversation.',
    topics:['Bencoding','Peers','Handshakes'],reference:'https://www.bittorrent.org/beps/bep_0003.html',
    stages:[
      stage('string','Decode byte strings','For op=decode, decode an ASCII bencoded string into its JSON string value.',{op:'decode',value:'5:hello'},'hello','Read the decimal byte length before the colon.'),
      stage('integer','Decode integers','Extend decode to bencoded integers i<number>e, including zero and negative values.',{op:'decode',value:'i-42e'},-42,'The trailing e is a delimiter, not part of the number.'),
      stage('list','Decode lists','Extend decode to nested lists, beginning with l and ending with e.',{op:'decode',value:'l4:spamli1ei2eee'},['spam',[1,2]],'Use a recursive parser that advances a shared cursor.'),
      stage('dictionary','Decode dictionaries','Extend decode to dictionaries d<key><value>...e. Keys are ASCII byte strings. Return a JSON object.',{op:'decode',value:'d3:bar4:spam3:fooi42ee'},{bar:'spam',foo:42},'Dictionary values may be any bencoded value.'),
      stage('handshake','Build a peer handshake','For op=handshake return hex: byte 19, ASCII BitTorrent protocol, eight zero bytes, 20-byte infoHash and 20-byte peerId (both given as hex).',{op:'handshake',infoHash:'00'.repeat(20),peerId:'11'.repeat(20)},'13'+BufferlessHex('BitTorrent protocol')+'00'.repeat(8)+'00'.repeat(20)+'11'.repeat(20),'The complete handshake is 68 bytes.')
    ]
  },
  {
    id:'dns',name:'DNS Server',icon:'◎',color:'#88b9dc',category:'Networking',difficulty:'Intermediate',time:'3–5 hours',
    description:'Pack names into bytes and read the fields that make DNS work.',
    topics:['Binary formats','Labels','Packets'],reference:'https://www.rfc-editor.org/rfc/rfc1035',
    stages:[
      stage('name','Encode a domain name','For op=name, return uncompressed DNS name hex. Each ASCII label gets a one-byte length prefix. End with zero. The root "." is one zero byte.',{op:'name',name:'example.com'},'076578616d706c6503636f6d00','A trailing dot does not create an additional empty label.'),
      stage('header','Read a DNS header','For op=header, parse 12 bytes of hex into {id,flags,questions,answers,authority,additional}; each field is an unsigned big-endian 16-bit integer.',{op:'header',hex:'123401000001000000000000'},{id:4660,flags:256,questions:1,answers:0,authority:0,additional:0},'Read six consecutive 16-bit fields.'),
      stage('question','Build a question','For op=question, return encoded name + 16-bit type + 16-bit class in hex.',{op:'question',name:'a.io',type:1,class:1},'016102696f0000010001','Reuse the name encoder from stage one.'),
      stage('address','Encode an IPv4 address','For op=address, convert a dotted decimal IPv4 address to four bytes of lowercase hex.',{op:'address',address:'192.0.2.1'},'c0000201','Each decimal octet becomes exactly two hexadecimal characters.'),
      stage('response','Write a response header','For op=response, return a DNS response header hex with supplied id, flags 0x8180, one question, supplied answers count, and zero authority/additional counts.',{op:'response',id:4660,answers:1},'123481800001000100000000','The QR bit distinguishes a response from a query.')
    ]
  },
  {
    id:'kafka',name:'Kafka',icon:'⋮',color:'#d094bb',category:'Networking',difficulty:'Advanced',time:'5–8 hours',
    description:'Explore length-prefixed messages and Kafka’s binary protocol primitives.',
    topics:['Framing','Correlation IDs','Varints'],reference:'https://kafka.apache.org/protocol.html',
    stages:[
      stage('frame','Frame a message','For op=frame, prefix payload hex with its signed 32-bit big-endian byte length. Return the combined hex.',{op:'frame',hex:'010203'},'00000003010203','The prefix counts only payload bytes.'),
      stage('header','Read a request header','For op=header, given request body hex (without size prefix), return {apiKey,apiVersion,correlationId} from two signed 16-bit fields and one signed 32-bit field.',{op:'header',hex:'001200040000002a'},{apiKey:18,apiVersion:4,correlationId:42},'Kafka fields use network byte order.'),
      stage('correlation','Echo a correlation ID','For op=correlation, produce a size-prefixed response containing only the supplied signed 32-bit correlationId.',{op:'correlation',id:42},'000000040000002a','The response payload is four bytes long.'),
      stage('varint','Encode an unsigned varint','For op=varint, encode a nonnegative integer <= 2^31-1 using seven data bits per byte and the high continuation bit. Return hex.',{op:'varint',value:300},'ac02','The least significant group of seven bits comes first.'),
      stage('compact','Encode a compact string','For op=compact, return an unsigned-varint prefix of UTF-8 byte length + 1, then UTF-8 bytes, all as hex. Null is encoded as 00.',{op:'compact',value:'hi'},'036869','An empty string has prefix 01; null has prefix 00.')
    ]
  },
  {
    id:'agent',name:'AI Coding Agent',icon:'✳',color:'#d7ae80',category:'Developer tools',difficulty:'Intermediate',time:'3–5 hours',
    description:'Build the deterministic core of a tool-using assistant, without an API bill.',
    topics:['Messages','Tool calls','Agent loops'],reference:'https://json-schema.org/understanding-json-schema/reference/object',
    stages:[
      stage('messages','Build a conversation','For op=messages, return a message array with supplied system string and user prompt, each using role and content fields.',{op:'messages',system:'Be helpful.',prompt:'Hello'},[{role:'system',content:'Be helpful.'},{role:'user',content:'Hello'}],'Model adapters can translate this common representation later.'),
      stage('tool','Describe a tool','For op=tool, return a JSON Schema function definition: {name:"read_file",description:"Read a workspace file",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false}}.',{op:'tool'},{name:'read_file',description:'Read a workspace file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},'A tool description is data; it does not execute the tool.'),
      stage('read','Read a virtual workspace','For op=read, look up path in the supplied files object. Return {content:<value>} or {error:"File not found"}. Never read the host filesystem.',{op:'read',path:'main.js',files:{'main.js':'hello'}},{content:'hello'},'The in-memory workspace makes tests deterministic and free.'),
      stage('loop','Resolve tool calls','For op=loop, map supplied calls to {id,result}. Each call names read_file with arguments.path. Use the supplied files object; unknown tools return {error:"Unknown tool"}.',{op:'loop',files:{'a.txt':'hi'},calls:[{id:'1',name:'read_file',arguments:{path:'a.txt'}}]},[{id:'1',result:{content:'hi'}}],'Keep the original call ID so the assistant can associate replies.'),
      stage('budget','Stop at a budget','For op=budget, return {action:"stop"} if steps >= maxSteps or done is true; otherwise {action:"continue"}.',{op:'budget',steps:5,maxSteps:5,done:false},{action:'stop'},'A stopping condition prevents an unbounded tool loop.')
    ]
  }
];
function BufferlessHex(text) { return Array.from(new TextEncoder().encode(text), b=>b.toString(16).padStart(2,'0')).join(''); }
export const getCourse = id => courses.find(c => c.id === id);
