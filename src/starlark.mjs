// A reader for the Starlark subset that Codex's .rules files use. A rules file is a Starlark program whose calls to prefix_rule()
// define the rules (the file is evaluated when Codex starts, so assignments, for loops, list comprehensions and small functions work
// in it). This reads the program, runs it with prefix_rule() and host_executable() as the only side effects, and returns the rules
// with the line of each call. What it does not understand it says so (kind "unsupported") and never guesses.
//
//   runRules(source) -> { ok: true, rules, hosts, examples }
//                    or { ok: false, error: { kind: "syntax" | "runtime" | "unsupported", message, line } }
//   rule: { pattern: [[token, ...], ...], decision, justification, line, matchExamples, notMatchExamples }

export class StarlarkError extends Error {
  constructor(kind, message, line) {
    super(message);
    this.kind = kind;
    this.line = line;
  }
}
const syntax = (m, line) => new StarlarkError("syntax", m, line);
const runtime = (m, line) => new StarlarkError("runtime", m, line);
const unsupported = (m, line) => new StarlarkError("unsupported", m, line);

// ---- tokens -------------------------------------------------------------------------------------------------------------------

const KEYWORDS = new Set(["def", "if", "elif", "else", "for", "in", "return", "pass", "and", "or", "not", "True", "False", "None", "break", "continue", "lambda", "load", "while", "import", "class", "try", "except", "raise", "with", "yield", "global", "nonlocal", "del", "assert", "is", "from", "as"]);
const OPS = ["**=", "//=", ">>=", "<<=", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "//", "**", "<<", ">>", "->", "+", "-", "*", "/", "%", "=", "<", ">", "(", ")", "[", "]", "{", "}", ",", ":", ".", ";", "|", "&", "^", "~"];

function tokenize(source) {
  const src = source.replace(/\r\n?/g, "\n");
  const tokens = [];
  const indents = [0];
  let i = 0;
  let line = 1;
  let depth = 0;
  let atLineStart = true;
  const push = (t, v) => tokens.push({ t, v, line });
  while (i < src.length) {
    if (atLineStart && depth === 0) {
      // indentation of a logical line
      let col = 0;
      let j = i;
      while (src[j] === " " || src[j] === "\t") { if (src[j] === "\t") throw syntax("tabs are not allowed in the indentation", line); col += 1; j++; }
      if (src[j] === "\n") { i = j + 1; line++; continue; }
      if (src[j] === "#") { while (j < src.length && src[j] !== "\n") j++; i = j; continue; }
      if (j >= src.length) { i = j; break; }
      if (col > indents[indents.length - 1]) { indents.push(col); push("INDENT"); }
      while (col < indents[indents.length - 1]) { indents.pop(); push("DEDENT"); }
      if (col !== indents[indents.length - 1]) throw syntax("unindent does not match any outer indentation level", line);
      i = j;
      atLineStart = false;
    }
    const c = src[i];
    if (c === "\n") {
      if (depth === 0) { push("NEWLINE"); atLineStart = true; }
      i++; line++;
      continue;
    }
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "\\" && src[i + 1] === "\n") { i += 2; line++; continue; }
    // strings, with an optional r prefix
    const prefix = /^[rR]?(?:'''|"""|'|")/.exec(src.slice(i, i + 4));
    if (prefix) {
      const raw = /^[rR]/.test(prefix[0]);
      const quote = prefix[0].replace(/^[rR]/, "");
      const startLine = line;
      i += prefix[0].length;
      let out = "";
      let closed = false;
      while (i < src.length) {
        if (src.startsWith(quote, i)) { i += quote.length; closed = true; break; }
        const ch = src[i];
        if (ch === "\n") {
          if (quote.length === 1) throw syntax("unterminated string literal", startLine);
          out += ch; i++; line++;
          continue;
        }
        if (ch === "\\" && !raw) {
          const n = src[i + 1];
          i += 2;
          switch (n) {
            case "n": out += "\n"; break;
            case "t": out += "\t"; break;
            case "r": out += "\r"; break;
            case "a": out += "\u0007"; break;
            case "b": out += "\b"; break;
            case "f": out += "\f"; break;
            case "v": out += "\v"; break;
            case "\\": out += "\\"; break;
            case "'": out += "'"; break;
            case '"': out += '"'; break;
            case "\n": line++; break;
            case "x": { const h = src.slice(i, i + 2); if (!/^[0-9a-fA-F]{2}$/.test(h)) throw syntax("invalid escape sequence", line); out += String.fromCharCode(parseInt(h, 16)); i += 2; break; }
            case "u": { const h = src.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) throw syntax("invalid escape sequence", line); out += String.fromCharCode(parseInt(h, 16)); i += 4; break; }
            case "U": { const h = src.slice(i, i + 8); if (!/^[0-9a-fA-F]{8}$/.test(h)) throw syntax("invalid escape sequence", line); out += String.fromCodePoint(parseInt(h, 16)); i += 8; break; }
            default:
              if (n >= "0" && n <= "7") { let o = n; while (o.length < 3 && src[i] >= "0" && src[i] <= "7") { o += src[i]; i++; } out += String.fromCharCode(parseInt(o, 8)); break; }
              out += `\\${n}`; // an escape Starlark does not know stays as written (Codex loads "\q")
              break;
          }
          continue;
        }
        out += ch; i++;
      }
      if (!closed) throw syntax("unterminated string literal", startLine);
      tokens.push({ t: "STR", v: out, line: startLine });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = /^(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
      if (/^[A-Za-z_]/.test(src[i + m[0].length] || "")) throw syntax("invalid number", line);
      const text = m[0];
      if (/^0[xXoObB]/.test(text)) push("NUM", Number(text));
      else if (/[.eE]/.test(text)) push("NUM", Number(text));
      else {
        if (text.length > 1 && text[0] === "0") throw syntax("invalid octal literal", line);
        push("NUM", Number(text));
      }
      i += text.length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (/[A-Za-z0-9_]/.test(src[j] || "")) j++;
      const word = src.slice(i, j);
      push(KEYWORDS.has(word) ? "KW" : "NAME", word);
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw syntax(`invalid input \`${c === "\ufeff" ? "BOM" : c}\``, line);
    if ("([{".includes(op)) depth++;
    if (")]}".includes(op)) depth = Math.max(0, depth - 1);
    push("OP", op);
    i += op.length;
  }
  // the closing tokens are on the line the end of the file is on: with a newline at the end of the file, the line after the last one
  // (this is the line `Error loading rules:` names for a bracket that is never closed)
  const tail = (t) => tokens.push({ t, v: undefined, line });
  if (tokens.length && tokens[tokens.length - 1].t !== "NEWLINE") tail("NEWLINE");
  while (indents.length > 1) { indents.pop(); tail("DEDENT"); }
  tail("EOF");
  return tokens;
}

// ---- parser -------------------------------------------------------------------------------------------------------------------

class Parser {
  constructor(tokens) { this.toks = tokens; this.p = 0; }
  get tok() { return this.toks[this.p]; }
  next() { return this.toks[this.p++]; }
  isOp(v) { return this.tok.t === "OP" && this.tok.v === v; }
  isKw(v) { return this.tok.t === "KW" && this.tok.v === v; }
  eatOp(v) { if (this.isOp(v)) { this.p++; return true; } return false; }
  eatKw(v) { if (this.isKw(v)) { this.p++; return true; } return false; }
  expectOp(v) { if (!this.eatOp(v)) throw syntax(`unexpected ${this.describe()}, expected symbol '${v}'`, this.tok.line); }
  describe() { const t = this.tok; return t.t === "NEWLINE" ? "new line" : t.t === "EOF" ? "end of file" : t.t === "INDENT" ? "indent" : t.t === "DEDENT" ? "dedent" : `'${t.v}'`; }

  program() {
    const body = [];
    while (this.tok.t !== "EOF") {
      if (this.tok.t === "NEWLINE") { this.p++; continue; }
      body.push(...this.statement());
    }
    return body;
  }

  block() {
    this.expectOp(":");
    if (this.tok.t !== "NEWLINE") return this.simpleLine();
    this.p++;
    if (this.tok.t !== "INDENT") throw syntax("expected an indented block", this.tok.line);
    this.p++;
    const body = [];
    while (this.tok.t !== "DEDENT" && this.tok.t !== "EOF") {
      if (this.tok.t === "NEWLINE") { this.p++; continue; }
      body.push(...this.statement());
    }
    if (this.tok.t === "DEDENT") this.p++;
    return body;
  }

  statement() {
    const t = this.tok;
    if (t.t === "KW") {
      switch (t.v) {
        case "if": return [this.ifStmt()];
        case "for": return [this.forStmt()];
        case "def": return [this.defStmt()];
        case "while": case "class": case "try": case "with": case "import": case "from": case "raise": case "yield": case "global": case "nonlocal": case "del": case "assert": case "except": case "as": case "is":
          throw syntax(`cannot use reserved keyword \`${t.v}\``, t.line);
        case "load": throw runtime("No imports are available, you tried to import a module with load", t.line);
        default: break;
      }
    }
    if (t.t === "INDENT") throw syntax("unexpected indent", t.line);
    return this.simpleLine();
  }

  simpleLine() {
    const out = [this.simpleStmt()];
    while (this.eatOp(";")) { if (this.tok.t === "NEWLINE") break; out.push(this.simpleStmt()); }
    if (this.tok.t === "NEWLINE") this.p++;
    else if (this.tok.t !== "EOF" && this.tok.t !== "DEDENT") throw syntax(`unexpected ${this.describe()}, expected new line`, this.tok.line);
    return out;
  }

  simpleStmt() {
    const t = this.tok;
    if (t.t === "KW") {
      if (t.v === "pass") { this.p++; return { k: "pass", line: t.line }; }
      if (t.v === "break") { this.p++; return { k: "break", line: t.line }; }
      if (t.v === "continue") { this.p++; return { k: "continue", line: t.line }; }
      if (t.v === "return") {
        this.p++;
        const e = this.tok.t === "NEWLINE" || this.isOp(";") ? null : this.exprList();
        return { k: "return", e, line: t.line };
      }
    }
    const first = this.exprList();
    if (this.isOp("=")) {
      const targets = [first];
      let value;
      while (this.eatOp("=")) { value = this.exprList(); if (this.isOp("=")) targets.push(value); }
      return { k: "assign", targets, value, line: t.line };
    }
    const aug = this.tok.t === "OP" && ["+=", "-=", "*=", "/=", "//=", "%=", "&=", "|=", "^=", "<<=", ">>=", "**="].includes(this.tok.v) ? this.next().v : null;
    if (aug) return { k: "aug", target: first, op: aug.slice(0, -1), value: this.exprList(), line: t.line };
    return { k: "expr", e: first, line: t.line };
  }

  ifStmt() {
    const line = this.next().line;
    const branches = [];
    const test = this.expr();
    branches.push({ test, body: this.block() });
    let orelse = [];
    for (;;) {
      if (this.isKw("elif")) { this.p++; const t = this.expr(); branches.push({ test: t, body: this.block() }); continue; }
      if (this.isKw("else")) { this.p++; orelse = this.block(); }
      break;
    }
    return { k: "if", branches, orelse, line };
  }

  forStmt() {
    const line = this.next().line;
    const target = this.targetList();
    if (!this.eatKw("in")) throw syntax(`unexpected ${this.describe()}, expected 'in'`, this.tok.line);
    const iter = this.exprList();
    return { k: "for", target, iter, body: this.block(), line };
  }

  defStmt() {
    const line = this.next().line;
    if (this.tok.t !== "NAME") throw syntax("expected a function name", this.tok.line);
    const name = this.next().v;
    this.expectOp("(");
    const params = [];
    while (!this.isOp(")")) {
      if (this.isOp("*") || this.isOp("**")) throw unsupported("`*args` and `**kwargs` parameters are not supported here", this.tok.line);
      if (this.tok.t !== "NAME") throw syntax("expected a parameter name", this.tok.line);
      const pname = this.next().v;
      const def = this.eatOp("=") ? this.expr() : undefined;
      params.push({ name: pname, def });
      if (!this.eatOp(",")) break;
    }
    this.expectOp(")");
    return { k: "def", name, params, body: this.block(), line };
  }

  targetList() {
    const items = [this.target()];
    while (this.eatOp(",")) { if (this.isKw("in")) break; items.push(this.target()); }
    return items.length === 1 ? items[0] : { k: "tuple", items };
  }
  target() {
    if (this.isOp("(")) { this.p++; const t = this.targetList(); this.expectOp(")"); return t; }
    if (this.tok.t !== "NAME") throw syntax(`unexpected ${this.describe()}, expected a name`, this.tok.line);
    return { k: "name", name: this.next().v, line: this.tok.line };
  }

  // an expression list: a, b -> a tuple
  exprList() {
    const first = this.expr();
    if (!this.isOp(",")) return first;
    const items = [first];
    while (this.eatOp(",")) {
      if (this.tok.t === "NEWLINE" || this.isOp("=") || this.isOp(")") || this.isOp("]") || this.isOp(":") || this.tok.t === "EOF") break;
      items.push(this.expr());
    }
    return { k: "tuple", items, line: first.line };
  }

  expr() {
    if (this.isKw("lambda")) {
      const line = this.next().line;
      const params = [];
      while (!this.isOp(":")) {
        if (this.tok.t !== "NAME") throw syntax(`unexpected ${this.describe()}, expected a parameter name`, this.tok.line);
        const name = this.next().v;
        const def = this.eatOp("=") ? this.expr() : undefined;
        params.push({ name, def });
        if (!this.eatOp(",")) break;
      }
      this.expectOp(":");
      const body = this.expr();
      return { k: "lambda", params, body, line };
    }
    const e = this.or();
    if (this.isKw("if")) {
      this.p++;
      const test = this.or();
      if (!this.eatKw("else")) throw syntax("expected 'else' in a conditional expression", this.tok.line);
      const other = this.expr();
      return { k: "cond", test, a: e, b: other, line: e.line };
    }
    return e;
  }
  or() { let l = this.and(); while (this.isKw("or")) { const line = this.next().line; l = { k: "or", l, r: this.and(), line }; } return l; }
  and() { let l = this.not(); while (this.isKw("and")) { const line = this.next().line; l = { k: "and", l, r: this.not(), line }; } return l; }
  not() { if (this.isKw("not")) { const line = this.next().line; return { k: "not", e: this.not(), line }; } return this.compare(); }
  compare() {
    let l = this.bitor();
    for (;;) {
      const t = this.tok;
      let op = null;
      if (t.t === "OP" && ["==", "!=", "<", ">", "<=", ">="].includes(t.v)) { op = t.v; this.p++; }
      else if (this.isKw("in")) { op = "in"; this.p++; }
      else if (this.isKw("not") && this.toks[this.p + 1].t === "KW" && this.toks[this.p + 1].v === "in") { op = "not in"; this.p += 2; }
      else break;
      l = { k: "cmp", op, l, r: this.bitor(), line: t.line };
    }
    return l;
  }
  bitor() { let l = this.bitxor(); while (this.isOp("|")) { const line = this.next().line; l = { k: "bin", op: "|", l, r: this.bitxor(), line }; } return l; }
  bitxor() { let l = this.bitand(); while (this.isOp("^")) { const line = this.next().line; l = { k: "bin", op: "^", l, r: this.bitand(), line }; } return l; }
  bitand() { let l = this.shift(); while (this.isOp("&")) { const line = this.next().line; l = { k: "bin", op: "&", l, r: this.shift(), line }; } return l; }
  shift() { let l = this.add(); while (this.isOp("<<") || this.isOp(">>")) { const t = this.next(); l = { k: "bin", op: t.v, l, r: this.add(), line: t.line }; } return l; }
  add() { let l = this.mul(); while (this.isOp("+") || this.isOp("-")) { const t = this.next(); l = { k: "bin", op: t.v, l, r: this.mul(), line: t.line }; } return l; }
  mul() { let l = this.unary(); while (this.isOp("*") || this.isOp("/") || this.isOp("//") || this.isOp("%")) { const t = this.next(); l = { k: "bin", op: t.v, l, r: this.unary(), line: t.line }; } return l; }
  unary() {
    if (this.isOp("-") || this.isOp("+") || this.isOp("~")) { const t = this.next(); return { k: "un", op: t.v, e: this.unary(), line: t.line }; }
    return this.postfix();
  }

  postfix() {
    let e = this.primary();
    for (;;) {
      const t = this.tok;
      if (this.isOp("(")) {
        this.p++;
        const args = [];
        while (!this.isOp(")")) {
          if (this.isOp("*") || this.isOp("**")) throw unsupported("`*args` and `**kwargs` in a call are not supported here", this.tok.line);
          if (this.tok.t === "NAME" && this.toks[this.p + 1].t === "OP" && this.toks[this.p + 1].v === "=") {
            const name = this.next().v;
            this.p++;
            args.push({ name, e: this.expr() });
          } else args.push({ e: this.expr() });
          if (!this.eatOp(",")) break;
        }
        this.expectOp(")");
        e = { k: "call", fn: e, args, line: t.line };
      } else if (this.isOp("[")) {
        this.p++;
        let lo = null; let hi = null; let step = null;
        let isSlice = false;
        if (!this.isOp(":")) lo = this.expr();
        if (this.eatOp(":")) { isSlice = true; if (!this.isOp("]") && !this.isOp(":")) hi = this.expr(); if (this.eatOp(":")) { if (!this.isOp("]")) step = this.expr(); } }
        this.expectOp("]");
        e = isSlice ? { k: "slice", obj: e, lo, hi, step, line: t.line } : { k: "index", obj: e, idx: lo, line: t.line };
      } else if (this.isOp(".")) {
        this.p++;
        if (this.tok.t !== "NAME") throw syntax(`unexpected ${this.describe()}, expected a name`, this.tok.line);
        e = { k: "attr", obj: e, name: this.next().v, line: t.line };
      } else break;
    }
    return e;
  }

  primary() {
    const t = this.tok;
    switch (t.t) {
      case "STR": {
        this.p++;
        let v = t.v;
        while (this.tok.t === "STR") v += this.next().v; // adjacent literals are joined
        return { k: "str", v, line: t.line };
      }
      case "NUM": this.p++; return { k: "num", v: t.v, line: t.line };
      case "NAME": this.p++; return { k: "name", name: t.v, line: t.line };
      case "KW":
        if (t.v === "True") { this.p++; return { k: "bool", v: true, line: t.line }; }
        if (t.v === "False") { this.p++; return { k: "bool", v: false, line: t.line }; }
        if (t.v === "None") { this.p++; return { k: "none", line: t.line }; }
        throw syntax(`unexpected '${t.v}'`, t.line);
      case "OP":
        if (t.v === "(") {
          this.p++;
          if (this.eatOp(")")) return { k: "tuple", items: [], line: t.line };
          const first = this.expr();
          if (this.isKw("for")) throw unsupported("generator expressions are not supported here", t.line);
          if (this.isOp(",")) {
            const items = [first];
            while (this.eatOp(",")) { if (this.isOp(")")) break; items.push(this.expr()); }
            this.expectOp(")");
            return { k: "tuple", items, line: t.line };
          }
          this.expectOp(")");
          return first;
        }
        if (t.v === "[") {
          this.p++;
          if (this.eatOp("]")) return { k: "list", items: [], line: t.line };
          const first = this.expr();
          if (this.isKw("for")) {
            const clauses = this.compClauses();
            this.expectOp("]");
            return { k: "listcomp", e: first, clauses, line: t.line };
          }
          const items = [first];
          while (this.eatOp(",")) { if (this.isOp("]")) break; items.push(this.expr()); }
          this.expectOp("]");
          return { k: "list", items, line: t.line };
        }
        if (t.v === "{") {
          this.p++;
          if (this.eatOp("}")) return { k: "dict", pairs: [], line: t.line };
          const key = this.expr();
          this.expectOp(":");
          const val = this.expr();
          if (this.isKw("for")) {
            const clauses = this.compClauses();
            this.expectOp("}");
            return { k: "dictcomp", key, val, clauses, line: t.line };
          }
          const pairs = [[key, val]];
          while (this.eatOp(",")) { if (this.isOp("}")) break; const k2 = this.expr(); this.expectOp(":"); pairs.push([k2, this.expr()]); }
          this.expectOp("}");
          return { k: "dict", pairs, line: t.line };
        }
        break;
      default: break;
    }
    throw syntax(`unexpected ${this.describe()}`, t.line);
  }

  compClauses() {
    const clauses = [];
    while (this.isKw("for") || this.isKw("if")) {
      if (this.eatKw("for")) {
        const target = this.targetList();
        if (!this.eatKw("in")) throw syntax("expected 'in' in a comprehension", this.tok.line);
        clauses.push({ k: "for", target, iter: this.or() });
      } else { this.p++; clauses.push({ k: "if", test: this.or() }); }
    }
    return clauses;
  }
}

// ---- evaluation ---------------------------------------------------------------------------------------------------------------

class Break {}
class Continue {}
class Return { constructor(v) { this.v = v; } }

const MAX_STEPS = 2000000;

const makeTuple = (items) => Object.assign(items, { tuple: true });
const isList = (v) => Array.isArray(v) && !v.tuple;
const typeName = (v) => (v === null ? "NoneType" : Array.isArray(v) ? (v.tuple ? "tuple" : "list") : v instanceof Map ? "dict" : typeof v === "string" ? "string" : typeof v === "number" ? "int" : typeof v === "boolean" ? "bool" : v && v.isFunction ? "function" : "value");
const truthy = (v) => (v === null || v === false || v === 0 || v === "" ? false : Array.isArray(v) ? v.length > 0 : v instanceof Map ? v.size > 0 : true);
const same = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a instanceof Map && b instanceof Map) return a.size === b.size && [...a].every(([k, v]) => b.has(k) && same(v, b.get(k)));
  return a === b;
};

function formatValue(v) {
  if (typeof v === "string") return v;
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  return repr(v);
}
function repr(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  if (v instanceof Map) return `{${[...v].map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(", ")}}`;
  return formatValue(v);
}

class Evaluator {
  constructor(file) {
    this.steps = 0;
    this.loopDepth = 0;
    this.fnDepth = 0;
    this.rules = [];
    this.hosts = [];
    this.globals = new Map();
    this.installBuiltins();
  }

  tick(line) { if (++this.steps > MAX_STEPS) throw runtime("the program runs too long", line); }

  installBuiltins() {
    const b = (name, fn) => this.globals.set(name, Object.assign(fn, { isFunction: true, builtin: name }));
    b("prefix_rule", (args, kw, line) => this.prefixRule(args, kw, line));
    b("host_executable", (args, kw, line) => { this.hosts.push({ line, args, kw }); return null; });
    b("len", (a, kw, line) => { const x = a[0]; if (typeof x === "string" || Array.isArray(x)) return x.length; if (x instanceof Map) return x.size; throw runtime(`len() is not defined for ${typeName(x)}`, line); });
    b("range", (a, kw, line) => { const [lo, hi, st] = a.length === 1 ? [0, a[0], 1] : [a[0], a[1], a[2] ?? 1]; if (!st) throw runtime("range() step cannot be zero", line); const out = []; for (let x = lo; st > 0 ? x < hi : x > hi; x += st) { out.push(x); if (out.length > 100000) throw runtime("range() is too large", line); } return out; });
    b("str", (a) => formatValue(a[0]));
    b("repr", (a) => repr(a[0]));
    b("int", (a, kw, line) => { const x = a[0]; if (typeof x === "number") return Math.trunc(x); if (typeof x === "boolean") return x ? 1 : 0; if (typeof x === "string" && /^\s*[+-]?\d+\s*$/.test(x)) return parseInt(x, 10); throw runtime(`int() cannot convert ${repr(x)}`, line); });
    b("bool", (a) => truthy(a[0]));
    b("list", (a, kw, line) => (a.length ? [...this.iterate(a[0], line)] : []));
    b("tuple", (a, kw, line) => makeTuple(a.length ? [...this.iterate(a[0], line)] : []));
    b("dict", (a, kw) => { const m = new Map(); if (a.length) for (const [k, v] of a[0] instanceof Map ? a[0] : a[0]) m.set(k, v); for (const [k, v] of Object.entries(kw)) m.set(k, v); return m; });
    b("enumerate", (a, kw, line) => this.iterate(a[0], line).map((x, i) => makeTuple([i + (a[1] || 0), x])));
    b("zip", (a, kw, line) => { const lists = a.map((x) => this.iterate(x, line)); const n = Math.min(...lists.map((l) => l.length)); return Array.from({ length: n }, (_, i) => makeTuple(lists.map((l) => l[i]))); });
    b("sorted", (a, kw, line) => { const out = [...this.iterate(a[0], line)]; out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); return kw.reverse ? out.reverse() : out; });
    b("reversed", (a, kw, line) => [...this.iterate(a[0], line)].reverse());
    b("min", (a, kw, line) => { const l = a.length === 1 ? this.iterate(a[0], line) : a; return l.reduce((x, y) => (y < x ? y : x)); });
    b("max", (a, kw, line) => { const l = a.length === 1 ? this.iterate(a[0], line) : a; return l.reduce((x, y) => (y > x ? y : x)); });
    b("any", (a, kw, line) => this.iterate(a[0], line).some(truthy));
    b("all", (a, kw, line) => this.iterate(a[0], line).every(truthy));
    b("fail", (a, kw, line) => { throw runtime(`fail: ${a.map(formatValue).join(" ")}`, line); });
    b("hasattr", () => false);
    b("type", (a) => typeName(a[0]));
  }

  iterate(v, line) {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") return [...v];
    if (v instanceof Map) return [...v.keys()];
    throw runtime(`type '${typeName(v)}' is not iterable`, line);
  }

  // prefix_rule(pattern, decision = "allow", justification = None, match = None, not_match = None)
  prefixRule(args, kw, line) {
    const known = ["pattern", "decision", "justification", "match", "not_match"];
    for (const k of Object.keys(kw)) if (!known.includes(k)) throw runtime(`prefix_rule: unexpected keyword argument \`${k}\``, line);
    if (args.length > known.length) throw runtime("prefix_rule: too many positional arguments", line);
    const get = (name, idx) => (idx < args.length ? args[idx] : kw[name]);
    const pattern = get("pattern", 0);
    const decision = get("decision", 1) ?? "allow";
    const justification = get("justification", 2) ?? null;
    const match = get("match", 3) ?? [];
    const notMatch = get("not_match", 4) ?? [];
    if (pattern === undefined) throw runtime("prefix_rule: missing required argument `pattern`", line);
    if (!isList(pattern) || pattern.length === 0) throw runtime("prefix_rule: pattern must be a non-empty list", line);
    const alts = pattern.map((p, i) => {
      if (typeof p === "string") return [p];
      if (isList(p) && p.length > 0 && p.every((x) => typeof x === "string")) return [...p];
      throw runtime(`prefix_rule: pattern element ${i + 1} must be a string or a non-empty list of strings`, line);
    });
    if (!["allow", "prompt", "forbidden"].includes(decision)) throw runtime(`prefix_rule: decision must be "allow", "prompt" or "forbidden", not ${repr(decision)}`, line);
    if (justification !== null && typeof justification !== "string") throw runtime("prefix_rule: justification must be a string", line);
    if (justification !== null && justification.trim() === "") throw runtime("prefix_rule: justification must not be empty", line);
    const examples = (value, name) => {
      if (!isList(value)) throw runtime(`prefix_rule: ${name} must be a list`, line);
      return value.map((x) => {
        if (typeof x === "string") return { text: x, tokens: shlexSplit(x, line) };
        if (isList(x) && x.every((y) => typeof y === "string")) return { text: x.join(" "), tokens: [...x] };
        throw runtime(`prefix_rule: every ${name} example must be a string or a list of strings`, line);
      });
    };
    const rule = { pattern: alts, decision, justification, line, matchExamples: examples(match, "match"), notMatchExamples: examples(notMatch, "not_match") };
    this.rules.push(rule);
    return null;
  }

  // ---- statements ----
  execute(stmts, env) {
    for (const s of stmts) {
      this.tick(s.line);
      switch (s.k) {
        case "pass": break;
        case "break": if (!this.loopDepth) throw syntax("`break` can only be used inside a loop", s.line); throw new Break();
        case "continue": if (!this.loopDepth) throw syntax("`continue` can only be used inside a loop", s.line); throw new Continue();
        case "return": if (!this.fnDepth) throw syntax("`return` cannot be used outside of a `def` function", s.line); throw new Return(s.e ? this.evaluate(s.e, env) : null);
        case "expr": this.evaluate(s.e, env); break;
        case "assign": {
          const v = this.evaluate(s.value, env);
          for (const t of s.targets) this.assign(t, v, env, s.line);
          break;
        }
        case "aug": {
          const cur = this.evaluate(s.target, env);
          this.assign(s.target, this.binary(s.op, cur, this.evaluate(s.value, env), s.line), env, s.line);
          break;
        }
        case "if": {
          let done = false;
          for (const br of s.branches) { if (truthy(this.evaluate(br.test, env))) { this.execute(br.body, env); done = true; break; } }
          if (!done) this.execute(s.orelse, env);
          break;
        }
        case "for": {
          this.loopDepth++;
          try {
            for (const item of this.iterate(this.evaluate(s.iter, env), s.line).slice()) {
              this.assign(s.target, item, env, s.line);
              try { this.execute(s.body, env); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; }
            }
          } finally { this.loopDepth--; }
          break;
        }
        case "def": {
          const fn = { isFunction: true, name: s.name, params: s.params, body: s.body, defs: s.params.map((p) => (p.def ? this.evaluate(p.def, env) : undefined)) };
          env.vars.set(s.name, fn);
          break;
        }
        default: throw unsupported(`statement ${s.k}`, s.line);
      }
    }
  }

  assign(target, value, env, line) {
    if (target.k === "name") { env.vars.set(target.name, value); return; }
    if (target.k === "tuple" || target.k === "list") {
      const items = this.iterate(value, line);
      if (items.length !== target.items.length) throw runtime(`got ${items.length} values to unpack, expected ${target.items.length}`, line);
      target.items.forEach((t, i) => this.assign(t, items[i], env, line));
      return;
    }
    if (target.k === "index") {
      const obj = this.evaluate(target.obj, env);
      const idx = this.evaluate(target.idx, env);
      if (Array.isArray(obj)) { obj[idx < 0 ? obj.length + idx : idx] = value; return; }
      if (obj instanceof Map) { obj.set(idx, value); return; }
    }
    throw unsupported("this assignment target", line);
  }

  lookup(name, env, line) {
    for (let e = env; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name);
    throw runtime(`Variable \`${name}\` not found`, line);
  }

  // ---- expressions ----
  evaluate(n, env) {
    this.tick(n.line);
    switch (n.k) {
      case "str": return n.v;
      case "num": return n.v;
      case "bool": return n.v;
      case "none": return null;
      case "name": return this.lookup(n.name, env, n.line);
      case "list": return n.items.map((x) => this.evaluate(x, env));
      case "tuple": return makeTuple(n.items.map((x) => this.evaluate(x, env)));
      case "lambda": return { isFunction: true, name: "lambda", params: n.params, body: [{ k: "return", e: n.body, line: n.line }], defs: n.params.map((p) => (p.def ? this.evaluate(p.def, env) : undefined)) };
      case "dict": { const m = new Map(); for (const [k, v] of n.pairs) m.set(this.evaluate(k, env), this.evaluate(v, env)); return m; }
      case "listcomp": { const out = []; this.comprehension(n.clauses, 0, env, (e) => out.push(this.evaluate(n.e, e)), n.line); return out; }
      case "dictcomp": { const m = new Map(); this.comprehension(n.clauses, 0, env, (e) => m.set(this.evaluate(n.key, e), this.evaluate(n.val, e)), n.line); return m; }
      case "or": { const l = this.evaluate(n.l, env); return truthy(l) ? l : this.evaluate(n.r, env); }
      case "and": { const l = this.evaluate(n.l, env); return truthy(l) ? this.evaluate(n.r, env) : l; }
      case "not": return !truthy(this.evaluate(n.e, env));
      case "cond": return truthy(this.evaluate(n.test, env)) ? this.evaluate(n.a, env) : this.evaluate(n.b, env);
      case "cmp": return this.compare(n.op, this.evaluate(n.l, env), this.evaluate(n.r, env), n.line);
      case "bin": return this.binary(n.op, this.evaluate(n.l, env), this.evaluate(n.r, env), n.line);
      case "un": {
        const v = this.evaluate(n.e, env);
        if (typeof v !== "number") throw runtime(`unary ${n.op} is not defined for ${typeName(v)}`, n.line);
        return n.op === "-" ? -v : n.op === "~" ? ~v : v;
      }
      case "index": {
        const obj = this.evaluate(n.obj, env);
        const idx = this.evaluate(n.idx, env);
        if (obj instanceof Map) { if (!obj.has(idx)) throw runtime(`key ${repr(idx)} not found in dictionary`, n.line); return obj.get(idx); }
        if (typeof idx !== "number" || !(Array.isArray(obj) || typeof obj === "string")) throw runtime(`cannot index ${typeName(obj)} with ${typeName(idx)}`, n.line);
        const i = idx < 0 ? obj.length + idx : idx;
        if (i < 0 || i >= obj.length) throw runtime(`index ${idx} is out of bounds`, n.line);
        return obj[i];
      }
      case "slice": {
        const obj = this.evaluate(n.obj, env);
        if (!(Array.isArray(obj) || typeof obj === "string")) throw runtime(`cannot slice ${typeName(obj)}`, n.line);
        const lo = n.lo ? this.evaluate(n.lo, env) : null;
        const hi = n.hi ? this.evaluate(n.hi, env) : null;
        const step = n.step ? this.evaluate(n.step, env) : 1;
        if (step !== 1) throw unsupported("slice steps", n.line);
        return obj.slice(lo === null ? 0 : lo, hi === null ? undefined : hi);
      }
      case "attr": return this.attribute(this.evaluate(n.obj, env), n.name, n.line);
      case "call": {
        const fn = this.evaluate(n.fn, env);
        const args = [];
        const kw = {};
        for (const a of n.args) { const v = this.evaluate(a.e, env); if (a.name) kw[a.name] = v; else args.push(v); }
        return this.call(fn, args, kw, n.line);
      }
      default: throw unsupported(`expression ${n.k}`, n.line);
    }
  }

  // the variables of a comprehension are local to it: each step gets a child scope
  comprehension(clauses, i, env, body, line) {
    if (i === clauses.length) { body(env); return; }
    const c = clauses[i];
    if (c.k === "if") { if (truthy(this.evaluate(c.test, env))) this.comprehension(clauses, i + 1, env, body, line); return; }
    for (const item of this.iterate(this.evaluate(c.iter, env), line)) {
      const child = { vars: new Map(), parent: env };
      this.assign(c.target, item, child, line);
      this.comprehension(clauses, i + 1, child, body, line);
    }
  }

  call(fn, args, kw, line) {
    if (!fn || !fn.isFunction) throw runtime(`'${typeName(fn)}' is not callable`, line);
    if (fn.builtin !== undefined || typeof fn === "function") return fn(args, kw, line);
    const local = { vars: new Map(), parent: this.rootEnv };
    fn.params.forEach((p, i) => {
      let v;
      if (i < args.length) v = args[i];
      else if (Object.prototype.hasOwnProperty.call(kw, p.name)) v = kw[p.name];
      else if (fn.defs[i] !== undefined) v = fn.defs[i];
      else throw runtime(`${fn.name}() missing argument \`${p.name}\``, line);
      local.vars.set(p.name, v);
    });
    if (args.length > fn.params.length) throw runtime(`${fn.name}() got too many arguments`, line);
    const saved = this.loopDepth;
    this.loopDepth = 0;
    this.fnDepth++;
    try { this.execute(fn.body, local); } catch (e) { if (e instanceof Return) return e.v; throw e; } finally { this.fnDepth--; this.loopDepth = saved; }
    return null;
  }

  compare(op, l, r, line) {
    switch (op) {
      case "==": return same(l, r);
      case "!=": return !same(l, r);
      case "in": case "not in": {
        let found;
        if (typeof r === "string") { if (typeof l !== "string") throw runtime("'in <string>' requires a string as the left operand", line); found = r.includes(l); }
        else if (Array.isArray(r)) found = r.some((x) => same(x, l));
        else if (r instanceof Map) found = r.has(l);
        else throw runtime(`'in' is not defined for ${typeName(r)}`, line);
        return op === "in" ? found : !found;
      }
      default: {
        if (typeof l !== typeof r || (typeof l !== "number" && typeof l !== "string")) throw runtime(`cannot compare ${typeName(l)} and ${typeName(r)}`, line);
        return op === "<" ? l < r : op === ">" ? l > r : op === "<=" ? l <= r : l >= r;
      }
    }
  }

  binary(op, l, r, line) {
    if (op === "+") {
      if (typeof l === "number" && typeof r === "number") return l + r;
      if (typeof l === "string" && typeof r === "string") return l + r;
      if (Array.isArray(l) && Array.isArray(r) && Boolean(l.tuple) === Boolean(r.tuple)) return l.tuple ? makeTuple([...l, ...r]) : [...l, ...r];
      throw runtime(`operator '+' cannot be applied to ${typeName(l)} and ${typeName(r)}`, line);
    }
    if (op === "*") {
      if (typeof l === "number" && typeof r === "number") return l * r;
      if (typeof l === "string" && typeof r === "number") return l.repeat(Math.max(0, r));
      if (typeof l === "number" && typeof r === "string") return r.repeat(Math.max(0, l));
      if (Array.isArray(l) && typeof r === "number") return Array.from({ length: Math.max(0, r) }, () => l).flat();
      throw runtime(`operator '*' cannot be applied to ${typeName(l)} and ${typeName(r)}`, line);
    }
    if (op === "%") {
      if (typeof l === "string") return this.percentFormat(l, r, line);
      if (typeof l === "number" && typeof r === "number") { if (r === 0) throw runtime("integer modulo by zero", line); return ((l % r) + r) % r; }
    }
    if (typeof l === "number" && typeof r === "number") {
      switch (op) {
        case "-": return l - r;
        case "//": if (r === 0) throw runtime("integer division by zero", line); return Math.floor(l / r);
        case "/": throw runtime("the operator '/' is not supported: use '//'", line);
        case "&": return l & r;
        case "|": return l | r;
        case "^": return l ^ r;
        case "<<": return l << r;
        case ">>": return l >> r;
        case "**": return l ** r;
        default: break;
      }
    }
    if (op === "|" && l instanceof Map && r instanceof Map) return new Map([...l, ...r]);
    throw runtime(`operator '${op}' cannot be applied to ${typeName(l)} and ${typeName(r)}`, line);
  }

  percentFormat(fmt, arg, line) {
    const args = Array.isArray(arg) ? arg : [arg];
    let i = 0;
    return fmt.replace(/%([sdr%])/g, (m, c) => {
      if (c === "%") return "%";
      if (i >= args.length) throw runtime("not enough arguments for format string", line);
      const v = args[i++];
      return c === "r" ? repr(v) : c === "d" ? String(Math.trunc(Number(v))) : formatValue(v);
    });
  }

  attribute(obj, name, line) {
    const method = (fn) => Object.assign((a, kw, ln) => fn(a, kw, ln), { isFunction: true, builtin: name });
    if (typeof obj === "string") {
      switch (name) {
        case "format": return method((a, kw) => { let auto = 0; return obj.replace(/\{\{|\}\}|\{([A-Za-z0-9_]*)\}/g, (m, key) => { if (m === "{{") return "{"; if (m === "}}") return "}"; const v = key === "" ? a[auto++] : /^\d+$/.test(key) ? a[Number(key)] : kw[key]; return formatValue(v); }); });
        case "join": return method((a, kw, ln) => this.iterate(a[0], ln).map((x) => { if (typeof x !== "string") throw runtime("join() expects strings", ln); return x; }).join(obj));
        case "split": return method((a) => (a.length ? obj.split(a[0]) : obj.trim().split(/\s+/).filter(Boolean)));
        case "startswith": return method((a) => obj.startsWith(a[0]));
        case "endswith": return method((a) => obj.endsWith(a[0]));
        case "strip": return method((a) => (a.length ? obj.replace(new RegExp(`^[${a[0].replace(/[\]\\^-]/g, "\\$&")}]+|[${a[0].replace(/[\]\\^-]/g, "\\$&")}]+$`, "g"), "") : obj.trim()));
        case "lstrip": return method(() => obj.trimStart());
        case "rstrip": return method(() => obj.trimEnd());
        case "replace": return method((a) => obj.split(a[0]).join(a[1]));
        case "lower": return method(() => obj.toLowerCase());
        case "upper": return method(() => obj.toUpperCase());
        case "find": return method((a) => obj.indexOf(a[0]));
        case "count": return method((a) => (a[0] === "" ? obj.length + 1 : obj.split(a[0]).length - 1));
        case "elems": return method(() => [...obj]);
        default: break;
      }
    } else if (Array.isArray(obj)) {
      switch (name) {
        case "append": return method((a) => { obj.push(a[0]); return null; });
        case "extend": return method((a, kw, ln) => { obj.push(...this.iterate(a[0], ln)); return null; });
        case "index": return method((a, kw, ln) => { const i = obj.findIndex((x) => same(x, a[0])); if (i < 0) throw runtime("item not found in list", ln); return i; });
        case "pop": return method((a) => (a.length ? obj.splice(a[0], 1)[0] : obj.pop()));
        case "insert": return method((a) => { obj.splice(a[0], 0, a[1]); return null; });
        case "remove": return method((a) => { const i = obj.findIndex((x) => same(x, a[0])); if (i >= 0) obj.splice(i, 1); return null; });
        default: break;
      }
    } else if (obj instanceof Map) {
      switch (name) {
        case "get": return method((a) => (obj.has(a[0]) ? obj.get(a[0]) : a.length > 1 ? a[1] : null));
        case "keys": return method(() => [...obj.keys()]);
        case "values": return method(() => [...obj.values()]);
        case "items": return method(() => [...obj].map(([k, v]) => makeTuple([k, v])));
        case "update": return method((a) => { if (a[0] instanceof Map) for (const [k, v] of a[0]) obj.set(k, v); return null; });
        case "pop": return method((a) => { const v = obj.get(a[0]); obj.delete(a[0]); return v ?? (a.length > 1 ? a[1] : null); });
        default: break;
      }
    }
    throw unsupported(`the method \`${name}\` of ${typeName(obj)}`, line);
  }
}

/** Splits a string the way a POSIX shell would, for the string examples of match and not_match. */
export function shlexSplit(text, line = 0) {
  const out = [];
  let cur = "";
  let inWord = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      if (j < 0) throw runtime("prefix_rule: an example has an unterminated quote", line);
      cur += text.slice(i + 1, j); inWord = true; i = j + 1;
    } else if (c === '"') {
      i++; inWord = true;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length && '$`"\\\n'.includes(text[i + 1])) { cur += text[i + 1]; i += 2; } else { cur += text[i]; i++; }
      }
      if (i >= text.length) throw runtime("prefix_rule: an example has an unterminated quote", line);
      i++;
    } else if (c === "\\") {
      if (i + 1 >= text.length) throw runtime("prefix_rule: an example ends with a backslash", line);
      cur += text[i + 1]; inWord = true; i += 2;
    } else if (/\s/.test(c)) {
      if (inWord) { out.push(cur); cur = ""; inWord = false; }
      i++;
    } else { cur += c; inWord = true; i++; }
  }
  if (inWord) out.push(cur);
  return out;
}

/** Runs a rules file. See the top of this file for the result. */
export function runRules(source) {
  try {
    const tokens = tokenize(String(source));
    const program = new Parser(tokens).program();
    const ev = new Evaluator();
    ev.rootEnv = { vars: ev.globals, parent: null };
    // top-level assignments live in the same scope as the built-in names
    ev.execute(program, ev.rootEnv);
    return { ok: true, rules: ev.rules, hosts: ev.hosts };
  } catch (e) {
    if (e instanceof StarlarkError) return { ok: false, error: { kind: e.kind, message: e.message, line: e.line } };
    if (e instanceof Break || e instanceof Continue || e instanceof Return) return { ok: false, error: { kind: "syntax", message: "`break`, `continue` or `return` outside a loop or function", line: 0 } };
    throw e;
  }
}
