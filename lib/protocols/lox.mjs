// A complete Lox implementation that matches jlox ("Crafting Interpreters") output exactly.
// The Interpreter tester uses it as the oracle: expected stdout, stderr and exit code for any program.
//   runLox(mode, source) -> { stdout, stderr, code }   mode: tokenize | parse | evaluate | run

const KEYWORDS = ['and', 'class', 'else', 'false', 'for', 'fun', 'if', 'nil', 'or', 'print', 'return', 'super', 'this', 'true', 'var', 'while'];

class Token {
  constructor(type, lexeme, literal, line) { Object.assign(this, { type, lexeme, literal, line }); }
}

// Java's Double.toString for the values Lox programs produce (integers get ".0").
const javaDouble = n => (Number.isInteger(n) && Math.abs(n) < 1e16 ? n.toFixed(1) : String(n));

class Ctx {
  constructor() { this.out = []; this.err = []; this.hadError = false; this.hadRuntimeError = false; }
  print(s) { this.out.push(s); }
  error(line, where, message) { this.err.push(`[line ${line}] Error${where}: ${message}`); this.hadError = true; }
  tokenError(token, message) { this.error(token.line, token.type === 'EOF' ? ' at end' : ` at '${token.lexeme}'`, message); }
}

// ---------- scanner ----------
function scan(source, ctx) {
  const tokens = [];
  let start = 0, current = 0, line = 1;
  const isDigit = c => c >= '0' && c <= '9';
  const isAlpha = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  const add = (type, literal = null) => tokens.push(new Token(type, source.slice(start, current), literal, line));
  const match = c => (source[current] === c ? (current++, true) : false);
  const peek = (o = 0) => source[current + o] ?? '\0';
  while (current < source.length) {
    start = current;
    const c = source[current++];
    switch (c) {
      case '(': add('LEFT_PAREN'); break;
      case ')': add('RIGHT_PAREN'); break;
      case '{': add('LEFT_BRACE'); break;
      case '}': add('RIGHT_BRACE'); break;
      case ',': add('COMMA'); break;
      case '.': add('DOT'); break;
      case '-': add('MINUS'); break;
      case '+': add('PLUS'); break;
      case ';': add('SEMICOLON'); break;
      case '*': add('STAR'); break;
      case '!': add(match('=') ? 'BANG_EQUAL' : 'BANG'); break;
      case '=': add(match('=') ? 'EQUAL_EQUAL' : 'EQUAL'); break;
      case '<': add(match('=') ? 'LESS_EQUAL' : 'LESS'); break;
      case '>': add(match('=') ? 'GREATER_EQUAL' : 'GREATER'); break;
      case '/':
        if (match('/')) while (peek() !== '\n' && current < source.length) current++;
        else add('SLASH');
        break;
      case ' ': case '\r': case '\t': break;
      case '\n': line++; break;
      case '"': {
        while (peek() !== '"' && current < source.length) { if (peek() === '\n') line++; current++; }
        if (current >= source.length) { ctx.error(line, '', 'Unterminated string.'); break; }
        current++;
        add('STRING', source.slice(start + 1, current - 1));
        break;
      }
      default:
        if (isDigit(c)) {
          while (isDigit(peek())) current++;
          if (peek() === '.' && isDigit(peek(1))) { current++; while (isDigit(peek())) current++; }
          add('NUMBER', Number(source.slice(start, current)));
        } else if (isAlpha(c)) {
          while (isAlpha(peek()) || isDigit(peek())) current++;
          const text = source.slice(start, current);
          add(KEYWORDS.includes(text) ? text.toUpperCase() : 'IDENTIFIER');
        } else ctx.error(line, '', `Unexpected character: ${c}`);
    }
  }
  tokens.push(new Token('EOF', '', null, line));
  return tokens;
}

// ---------- parser ----------
class ParseError extends Error {}

function parser(tokens, ctx) {
  let current = 0;
  const peek = () => tokens[current];
  const previous = () => tokens[current - 1];
  const isAtEnd = () => peek().type === 'EOF';
  const check = t => !isAtEnd() && peek().type === t;
  const advance = () => { if (!isAtEnd()) current++; return previous(); };
  const match = (...types) => { for (const t of types) if (check(t)) { advance(); return true; } return false; };
  const error = (token, message) => { ctx.tokenError(token, message); return new ParseError(); };
  const consume = (type, message) => { if (check(type)) return advance(); throw error(peek(), message); };
  const synchronize = () => {
    advance();
    while (!isAtEnd()) {
      if (previous().type === 'SEMICOLON') return;
      if (['CLASS', 'FUN', 'VAR', 'FOR', 'IF', 'WHILE', 'PRINT', 'RETURN'].includes(peek().type)) return;
      advance();
    }
  };

  function expression() { return assignment(); }
  function assignment() {
    const expr = or();
    if (match('EQUAL')) {
      const equals = previous();
      const value = assignment();
      if (expr.kind === 'Variable') return { kind: 'Assign', name: expr.name, value };
      if (expr.kind === 'Get') return { kind: 'Set', object: expr.object, name: expr.name, value };
      error(equals, 'Invalid assignment target.');
    }
    return expr;
  }
  function or() { let e = and(); while (match('OR')) e = { kind: 'Logical', left: e, operator: previous(), right: and() }; return e; }
  function and() { let e = equality(); while (match('AND')) e = { kind: 'Logical', left: e, operator: previous(), right: equality() }; return e; }
  const binary = (next, ...ops) => () => { let e = next(); while (match(...ops)) { const operator = previous(); e = { kind: 'Binary', left: e, operator, right: next() }; } return e; };
  function unary() {
    if (match('BANG', 'MINUS')) { const operator = previous(); return { kind: 'Unary', operator, right: unary() }; }
    return call();
  }
  const factor = binary(unary, 'SLASH', 'STAR');
  const term = binary(factor, 'MINUS', 'PLUS');
  const comparison = binary(term, 'GREATER', 'GREATER_EQUAL', 'LESS', 'LESS_EQUAL');
  const equality = binary(comparison, 'BANG_EQUAL', 'EQUAL_EQUAL');
  function call() {
    let e = primary();
    for (;;) {
      if (match('LEFT_PAREN')) {
        const args = [];
        if (!check('RIGHT_PAREN')) {
          do { if (args.length >= 255) error(peek(), "Can't have more than 255 arguments."); args.push(expression()); } while (match('COMMA'));
        }
        const paren = consume('RIGHT_PAREN', "Expect ')' after arguments.");
        e = { kind: 'Call', callee: e, paren, args };
      } else if (match('DOT')) {
        e = { kind: 'Get', object: e, name: consume('IDENTIFIER', "Expect property name after '.'.") };
      } else break;
    }
    return e;
  }
  function primary() {
    if (match('FALSE')) return { kind: 'Literal', value: false };
    if (match('TRUE')) return { kind: 'Literal', value: true };
    if (match('NIL')) return { kind: 'Literal', value: null };
    if (match('NUMBER', 'STRING')) return { kind: 'Literal', value: previous().literal };
    if (match('SUPER')) {
      const keyword = previous();
      consume('DOT', "Expect '.' after 'super'.");
      return { kind: 'Super', keyword, method: consume('IDENTIFIER', 'Expect superclass method name.') };
    }
    if (match('THIS')) return { kind: 'This', keyword: previous() };
    if (match('IDENTIFIER')) return { kind: 'Variable', name: previous() };
    if (match('LEFT_PAREN')) { const e = expression(); consume('RIGHT_PAREN', "Expect ')' after expression."); return { kind: 'Grouping', expression: e }; }
    throw error(peek(), 'Expect expression.');
  }

  function declaration() {
    try {
      if (match('CLASS')) return classDeclaration();
      if (match('FUN')) return fn('function');
      if (match('VAR')) return varDeclaration();
      return statement();
    } catch (e) {
      if (e instanceof ParseError) { synchronize(); return null; }
      throw e;
    }
  }
  function classDeclaration() {
    const name = consume('IDENTIFIER', 'Expect class name.');
    let superclass = null;
    if (match('LESS')) { consume('IDENTIFIER', 'Expect superclass name.'); superclass = { kind: 'Variable', name: previous() }; }
    consume('LEFT_BRACE', "Expect '{' before class body.");
    const methods = [];
    while (!check('RIGHT_BRACE') && !isAtEnd()) methods.push(fn('method'));
    consume('RIGHT_BRACE', "Expect '}' after class body.");
    return { kind: 'Class', name, superclass, methods };
  }
  function fn(kind) {
    const name = consume('IDENTIFIER', `Expect ${kind} name.`);
    consume('LEFT_PAREN', `Expect '(' after ${kind} name.`);
    const params = [];
    if (!check('RIGHT_PAREN')) {
      do { if (params.length >= 255) error(peek(), "Can't have more than 255 parameters."); params.push(consume('IDENTIFIER', 'Expect parameter name.')); } while (match('COMMA'));
    }
    consume('RIGHT_PAREN', "Expect ')' after parameters.");
    consume('LEFT_BRACE', `Expect '{' before ${kind} body.`);
    return { kind: 'Function', name, params, body: block() };
  }
  function varDeclaration() {
    const name = consume('IDENTIFIER', 'Expect variable name.');
    const initializer = match('EQUAL') ? expression() : null;
    consume('SEMICOLON', "Expect ';' after variable declaration.");
    return { kind: 'Var', name, initializer };
  }
  function statement() {
    if (match('FOR')) return forStatement();
    if (match('IF')) return ifStatement();
    if (match('PRINT')) { const value = expression(); consume('SEMICOLON', "Expect ';' after value."); return { kind: 'Print', expression: value }; }
    if (match('RETURN')) {
      const keyword = previous();
      const value = check('SEMICOLON') ? null : expression();
      consume('SEMICOLON', "Expect ';' after return value.");
      return { kind: 'Return', keyword, value };
    }
    if (match('WHILE')) {
      consume('LEFT_PAREN', "Expect '(' after 'while'.");
      const condition = expression();
      consume('RIGHT_PAREN', "Expect ')' after condition.");
      return { kind: 'While', condition, body: statement() };
    }
    if (match('LEFT_BRACE')) return { kind: 'Block', statements: block() };
    const e = expression();
    consume('SEMICOLON', "Expect ';' after expression.");
    return { kind: 'Expression', expression: e };
  }
  function forStatement() {
    consume('LEFT_PAREN', "Expect '(' after 'for'.");
    let initializer;
    if (match('SEMICOLON')) initializer = null;
    else if (match('VAR')) initializer = varDeclaration();
    else { const e = expression(); consume('SEMICOLON', "Expect ';' after expression."); initializer = { kind: 'Expression', expression: e }; }
    const condition = check('SEMICOLON') ? null : expression();
    consume('SEMICOLON', "Expect ';' after loop condition.");
    const increment = check('RIGHT_PAREN') ? null : expression();
    consume('RIGHT_PAREN', "Expect ')' after for clauses.");
    let body = statement();
    if (increment) body = { kind: 'Block', statements: [body, { kind: 'Expression', expression: increment }] };
    body = { kind: 'While', condition: condition || { kind: 'Literal', value: true }, body };
    if (initializer) body = { kind: 'Block', statements: [initializer, body] };
    return body;
  }
  function ifStatement() {
    consume('LEFT_PAREN', "Expect '(' after 'if'.");
    const condition = expression();
    consume('RIGHT_PAREN', "Expect ')' after if condition.");
    const thenBranch = statement();
    const elseBranch = match('ELSE') ? statement() : null;
    return { kind: 'If', condition, thenBranch, elseBranch };
  }
  function block() {
    const statements = [];
    while (!check('RIGHT_BRACE') && !isAtEnd()) statements.push(declaration());
    consume('RIGHT_BRACE', "Expect '}' after block.");
    return statements;
  }

  return {
    parseExpression() { try { return expression(); } catch (e) { if (e instanceof ParseError) return null; throw e; } },
    parseProgram() { const out = []; while (!isAtEnd()) out.push(declaration()); return out; },
  };
}

// ---------- AST printer ----------
function printAst(e) {
  switch (e.kind) {
    case 'Literal': return e.value === null ? 'nil' : typeof e.value === 'number' ? javaDouble(e.value) : String(e.value);
    case 'Grouping': return `(group ${printAst(e.expression)})`;
    case 'Unary': return `(${e.operator.lexeme} ${printAst(e.right)})`;
    case 'Binary': case 'Logical': return `(${e.operator.lexeme} ${printAst(e.left)} ${printAst(e.right)})`;
    case 'Variable': return e.name.lexeme;
    case 'Assign': return `(= ${e.name.lexeme} ${printAst(e.value)})`;
    default: return `(${e.kind})`;
  }
}

// ---------- resolver ----------
function resolve(statements, ctx, locals) {
  const scopes = [];
  let currentFunction = 'NONE', currentClass = 'NONE';
  const begin = () => scopes.push(new Map());
  const end = () => scopes.pop();
  const declare = name => {
    if (!scopes.length) return;
    const scope = scopes.at(-1);
    if (scope.has(name.lexeme)) ctx.tokenError(name, 'Already a variable with this name in this scope.');
    scope.set(name.lexeme, false);
  };
  const define = name => { if (scopes.length) scopes.at(-1).set(name.lexeme, true); };
  const resolveLocal = (expr, name) => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name.lexeme)) { locals.set(expr, scopes.length - 1 - i); return; }
  };
  const resolveFunction = (fnNode, type) => {
    const enclosing = currentFunction;
    currentFunction = type;
    begin();
    for (const p of fnNode.params) { declare(p); define(p); }
    stmts(fnNode.body);
    end();
    currentFunction = enclosing;
  };
  function stmts(list) { for (const s of list) if (s) stmt(s); }
  function stmt(s) {
    switch (s.kind) {
      case 'Block': begin(); stmts(s.statements); end(); break;
      case 'Var': declare(s.name); if (s.initializer) expr(s.initializer); define(s.name); break;
      case 'Function': declare(s.name); define(s.name); resolveFunction(s, 'FUNCTION'); break;
      case 'Class': {
        const enclosing = currentClass;
        currentClass = 'CLASS';
        declare(s.name); define(s.name);
        if (s.superclass && s.superclass.name.lexeme === s.name.lexeme) ctx.tokenError(s.superclass.name, "A class can't inherit from itself.");
        if (s.superclass) { currentClass = 'SUBCLASS'; expr(s.superclass); begin(); scopes.at(-1).set('super', true); }
        begin(); scopes.at(-1).set('this', true);
        for (const m of s.methods) resolveFunction(m, m.name.lexeme === 'init' ? 'INITIALIZER' : 'METHOD');
        end();
        if (s.superclass) end();
        currentClass = enclosing;
        break;
      }
      case 'Expression': expr(s.expression); break;
      case 'If': expr(s.condition); stmt(s.thenBranch); if (s.elseBranch) stmt(s.elseBranch); break;
      case 'Print': expr(s.expression); break;
      case 'Return':
        if (currentFunction === 'NONE') ctx.tokenError(s.keyword, "Can't return from top-level code.");
        if (s.value) { if (currentFunction === 'INITIALIZER') ctx.tokenError(s.keyword, "Can't return a value from an initializer."); expr(s.value); }
        break;
      case 'While': expr(s.condition); stmt(s.body); break;
    }
  }
  function expr(e) {
    switch (e.kind) {
      case 'Variable':
        if (scopes.length && scopes.at(-1).get(e.name.lexeme) === false) ctx.tokenError(e.name, "Can't read local variable in its own initializer.");
        resolveLocal(e, e.name);
        break;
      case 'Assign': expr(e.value); resolveLocal(e, e.name); break;
      case 'Binary': case 'Logical': expr(e.left); expr(e.right); break;
      case 'Call': expr(e.callee); e.args.forEach(expr); break;
      case 'Get': expr(e.object); break;
      case 'Set': expr(e.value); expr(e.object); break;
      case 'Grouping': expr(e.expression); break;
      case 'Unary': expr(e.right); break;
      case 'This':
        if (currentClass === 'NONE') { ctx.tokenError(e.keyword, "Can't use 'this' outside of a class."); break; }
        resolveLocal(e, e.keyword);
        break;
      case 'Super':
        if (currentClass === 'NONE') ctx.tokenError(e.keyword, "Can't use 'super' outside of a class.");
        else if (currentClass !== 'SUBCLASS') ctx.tokenError(e.keyword, "Can't use 'super' in a class with no superclass.");
        resolveLocal(e, e.keyword);
        break;
    }
  }
  stmts(statements);
}

// ---------- interpreter ----------
class RuntimeError extends Error { constructor(token, message) { super(message); this.token = token; } }
class ReturnSignal { constructor(value) { this.value = value; } }

class Environment {
  constructor(enclosing = null) { this.values = new Map(); this.enclosing = enclosing; }
  define(name, value) { this.values.set(name, value); }
  ancestor(d) { let e = this; for (let i = 0; i < d; i++) e = e.enclosing; return e; }
  get(name) {
    if (this.values.has(name.lexeme)) return this.values.get(name.lexeme);
    if (this.enclosing) return this.enclosing.get(name);
    throw new RuntimeError(name, `Undefined variable '${name.lexeme}'.`);
  }
  assign(name, value) {
    if (this.values.has(name.lexeme)) { this.values.set(name.lexeme, value); return; }
    if (this.enclosing) { this.enclosing.assign(name, value); return; }
    throw new RuntimeError(name, `Undefined variable '${name.lexeme}'.`);
  }
}

class LoxFunction {
  constructor(decl, closure, isInitializer) { Object.assign(this, { decl, closure, isInitializer }); }
  get arity() { return this.decl.params.length; }
  bind(instance) { const env = new Environment(this.closure); env.define('this', instance); return new LoxFunction(this.decl, env, this.isInitializer); }
  toString() { return `<fn ${this.decl.name.lexeme}>`; }
}
class LoxClass {
  constructor(name, superclass, methods) { Object.assign(this, { name, superclass, methods }); }
  findMethod(name) { return this.methods.get(name) || this.superclass?.findMethod(name); }
  get arity() { return this.findMethod('init')?.arity ?? 0; }
  toString() { return this.name; }
}
class LoxInstance {
  constructor(klass) { this.klass = klass; this.fields = new Map(); }
  get(name) {
    if (this.fields.has(name.lexeme)) return this.fields.get(name.lexeme);
    const m = this.klass.findMethod(name.lexeme);
    if (m) return m.bind(this);
    throw new RuntimeError(name, `Undefined property '${name.lexeme}'.`);
  }
  toString() { return `${this.klass.name} instance`; }
}
class NativeFunction { constructor(arity, fn) { this.arity = arity; this.fn = fn; } toString() { return '<native fn>'; } }

export function stringify(v) {
  if (v === null) return 'nil';
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  return String(v);
}

function interpreter(ctx, locals) {
  const globals = new Environment();
  globals.define('clock', new NativeFunction(0, () => Math.floor(Date.now() / 1000)));
  let env = globals;
  const truthy = v => v !== null && v !== false;
  const equal = (a, b) => a === b;
  const num = (op, ...vs) => { if (!vs.every(v => typeof v === 'number')) throw new RuntimeError(op, vs.length === 1 ? 'Operand must be a number.' : 'Operands must be numbers.'); };
  const lookup = (name, e) => (locals.has(e) ? env.ancestor(locals.get(e)).values.get(name.lexeme) : globals.get(name));

  function call(fnv, args) {
    if (fnv instanceof NativeFunction) return fnv.fn(...args);
    if (fnv instanceof LoxClass) {
      const instance = new LoxInstance(fnv);
      const init = fnv.findMethod('init');
      if (init) call(init.bind(instance), args);
      return instance;
    }
    const environment = new Environment(fnv.closure);
    fnv.decl.params.forEach((p, i) => environment.define(p.lexeme, args[i]));
    try {
      executeBlock(fnv.decl.body, environment);
    } catch (e) {
      if (e instanceof ReturnSignal) return fnv.isInitializer ? fnv.closure.values.get('this') : e.value;
      throw e;
    }
    return fnv.isInitializer ? fnv.closure.values.get('this') : null;
  }

  function evaluate(e) {
    switch (e.kind) {
      case 'Literal': return e.value;
      case 'Grouping': return evaluate(e.expression);
      case 'Unary': {
        const r = evaluate(e.right);
        if (e.operator.type === 'BANG') return !truthy(r);
        num(e.operator, r);
        return -r;
      }
      case 'Binary': {
        const l = evaluate(e.left), r = evaluate(e.right), op = e.operator;
        switch (op.type) {
          case 'GREATER': num(op, l, r); return l > r;
          case 'GREATER_EQUAL': num(op, l, r); return l >= r;
          case 'LESS': num(op, l, r); return l < r;
          case 'LESS_EQUAL': num(op, l, r); return l <= r;
          case 'BANG_EQUAL': return !equal(l, r);
          case 'EQUAL_EQUAL': return equal(l, r);
          case 'MINUS': num(op, l, r); return l - r;
          case 'SLASH': num(op, l, r); return l / r;
          case 'STAR': num(op, l, r); return l * r;
          case 'PLUS':
            if (typeof l === 'number' && typeof r === 'number') return l + r;
            if (typeof l === 'string' && typeof r === 'string') return l + r;
            throw new RuntimeError(op, 'Operands must be two numbers or two strings.');
        }
        break;
      }
      case 'Logical': {
        const l = evaluate(e.left);
        if (e.operator.type === 'OR' ? truthy(l) : !truthy(l)) return l;
        return evaluate(e.right);
      }
      case 'Variable': return lookup(e.name, e);
      case 'Assign': {
        const v = evaluate(e.value);
        if (locals.has(e)) env.ancestor(locals.get(e)).values.set(e.name.lexeme, v); else globals.assign(e.name, v);
        return v;
      }
      case 'Call': {
        const callee = evaluate(e.callee);
        const args = e.args.map(evaluate);
        if (!(callee instanceof LoxFunction || callee instanceof LoxClass || callee instanceof NativeFunction)) throw new RuntimeError(e.paren, 'Can only call functions and classes.');
        if (args.length !== callee.arity) throw new RuntimeError(e.paren, `Expected ${callee.arity} arguments but got ${args.length}.`);
        return call(callee, args);
      }
      case 'Get': {
        const o = evaluate(e.object);
        if (o instanceof LoxInstance) return o.get(e.name);
        throw new RuntimeError(e.name, 'Only instances have properties.');
      }
      case 'Set': {
        const o = evaluate(e.object);
        if (!(o instanceof LoxInstance)) throw new RuntimeError(e.name, 'Only instances have fields.');
        const v = evaluate(e.value);
        o.fields.set(e.name.lexeme, v);
        return v;
      }
      case 'This': return lookup(e.keyword, e);
      case 'Super': {
        const d = locals.get(e);
        const superclass = env.ancestor(d).values.get('super');
        const object = env.ancestor(d - 1).values.get('this');
        const method = superclass.findMethod(e.method.lexeme);
        if (!method) throw new RuntimeError(e.method, `Undefined property '${e.method.lexeme}'.`);
        return method.bind(object);
      }
    }
    throw new Error(`cannot evaluate ${e.kind}`);
  }

  function executeBlock(statements, environment) {
    const previous = env;
    try { env = environment; for (const s of statements) execute(s); } finally { env = previous; }
  }

  function execute(s) {
    switch (s.kind) {
      case 'Expression': evaluate(s.expression); break;
      case 'Print': ctx.print(stringify(evaluate(s.expression))); break;
      case 'Var': env.define(s.name.lexeme, s.initializer ? evaluate(s.initializer) : null); break;
      case 'Block': executeBlock(s.statements, new Environment(env)); break;
      case 'If': if (truthy(evaluate(s.condition))) execute(s.thenBranch); else if (s.elseBranch) execute(s.elseBranch); break;
      case 'While': while (truthy(evaluate(s.condition))) execute(s.body); break;
      case 'Function': env.define(s.name.lexeme, new LoxFunction(s, env, false)); break;
      case 'Return': throw new ReturnSignal(s.value ? evaluate(s.value) : null);
      case 'Class': {
        let superclass = null;
        if (s.superclass) {
          superclass = evaluate(s.superclass);
          if (!(superclass instanceof LoxClass)) throw new RuntimeError(s.superclass.name, 'Superclass must be a class.');
        }
        env.define(s.name.lexeme, null);
        if (superclass) { env = new Environment(env); env.define('super', superclass); }
        const methods = new Map(s.methods.map(m => [m.name.lexeme, new LoxFunction(m, env, m.name.lexeme === 'init')]));
        const klass = new LoxClass(s.name.lexeme, superclass, methods);
        if (superclass) env = env.enclosing;
        env.assign(s.name, klass);
        break;
      }
    }
  }

  const runtimeError = e => { ctx.err.push(`${e.message}\n[line ${e.token.line}]`); ctx.hadRuntimeError = true; };
  return {
    evaluateExpression(e) { try { ctx.print(stringify(evaluate(e))); } catch (err) { if (err instanceof RuntimeError) runtimeError(err); else throw err; } },
    interpret(statements) { try { for (const s of statements) execute(s); } catch (err) { if (err instanceof RuntimeError) runtimeError(err); else throw err; } },
  };
}

// ---------- entry point ----------
export function runLox(mode, source) {
  const ctx = new Ctx();
  const done = () => ({ stdout: ctx.out.map(l => `${l}\n`).join(''), stderr: ctx.err.map(l => `${l}\n`).join(''), code: ctx.hadError ? 65 : ctx.hadRuntimeError ? 70 : 0 });
  const tokens = scan(source, ctx);
  if (mode === 'tokenize') {
    for (const t of tokens) ctx.print(`${t.type} ${t.lexeme} ${t.literal === null ? 'null' : typeof t.literal === 'number' ? javaDouble(t.literal) : t.literal}`);
    return done();
  }
  // Like jlox, parsing continues after lexical errors so syntax errors are reported too.
  const p = parser(tokens, ctx);
  if (mode === 'parse' || mode === 'evaluate') {
    const expr = p.parseExpression();
    if (ctx.hadError || !expr) return done();
    if (mode === 'parse') ctx.print(printAst(expr));
    else interpreter(ctx, new Map()).evaluateExpression(expr);
    return done();
  }
  const statements = p.parseProgram();
  if (ctx.hadError) return done();
  const locals = new Map();
  resolve(statements, ctx, locals);
  if (ctx.hadError) return done();
  interpreter(ctx, locals).interpret(statements);
  return done();
}
