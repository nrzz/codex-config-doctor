// The TOML reader: what it reads, where it puts the keys, and that it agrees with Codex on which files parse (the record of
// test/fixtures/toml-oracle.json, made by test/record-oracles.mjs from Codex's own answers).
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ROOT } from "./helpers.mjs";
import { parseToml } from "../src/toml.mjs";
import { CASES } from "./toml-table.mjs";

const ok = (text) => { const r = parseToml(text); assert.ok(r.ok, r.ok ? "" : `${r.error.line}:${r.error.column} ${r.error.message}`); return r; };
const bad = (text) => { const r = parseToml(text); assert.equal(r.ok, false, `parsed: ${text}`); return r.error; };

test("values: strings, numbers, booleans, dates, arrays and tables become plain values", () => {
  const { value } = ok('s = "a\\tb"\nl = \'C:\\x\'\ni = 1_000\nh = 0xff\nf = 2.5\nb = true\nd = 1979-05-27\narr = [1, "two", [3]]\nt = { x = 1, y.z = 2 }\n[sub.deep]\nk = "v"\n[[list]]\nn = 1\n[[list]]\nn = 2\n');
  assert.deepEqual(value, { s: "a\tb", l: "C:\\x", i: 1000, h: 255, f: 2.5, b: true, d: "1979-05-27", arr: [1, "two", [3]], t: { x: 1, y: { z: 2 } }, sub: { deep: { k: "v" } }, list: [{ n: 1 }, { n: 2 }] });
});

test("multi-line strings: the first newline goes, a line ending backslash trims, quotes may touch the end", () => {
  assert.equal(ok('a = """\nline one\nline two"""\n').value.a, "line one\nline two");
  assert.equal(ok('a = """one \\\n   two"""\n').value.a, "one two");
  assert.equal(ok('a = """say "hi" and """"\n').value.a, 'say "hi" and "');
  assert.equal(ok("a = '''\nraw \\n text\n'''\n").value.a, "raw \\n text\n");
});

test("the entries carry the line and the column of every key, with the path of keys in arrays of tables", () => {
  const r = ok('# comment\nmodel = "x"\n\n[hooks]\n[[hooks.PreToolUse]]\nmatcher = "*"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\n[[hooks.PreToolUse]]\nmatcher = "y"\n[a.b]\nc.d = { e = 1 }\n');
  const find = (p) => r.entries.find((e) => e.path.join(".") === p);
  assert.equal(find("model").line, 2);
  assert.equal(find("hooks.PreToolUse.0.matcher").line, 6);
  assert.equal(find("hooks.PreToolUse.0.hooks.0.type").line, 8);
  assert.equal(find("hooks.PreToolUse.1.matcher").line, 10);
  assert.equal(find("a.b.c.d").type, "table");
  assert.equal(find("a.b.c.d.e").line, 12);
  assert.equal(find("model").column, 1);
  assert.deepEqual(r.tables.map((t) => [t.path.join("."), t.line, t.array]), [["hooks", 4, false], ["hooks.PreToolUse", 5, true], ["hooks.PreToolUse.0.hooks", 7, true], ["hooks.PreToolUse", 9, true], ["a.b", 11, false]]);
});

test("entries have a type: string, integer, float, boolean, datetime, array, table", () => {
  const r = ok('a = "x"\nb = 1\nc = 1.5\nd = true\ne = 1979-05-27T07:32:00Z\nf = [1]\ng = {}\n');
  assert.deepEqual(r.entries.map((e) => e.type), ["string", "integer", "float", "boolean", "datetime", "array", "table"]);
});

test("a byte order mark and CRLF line endings are read, as Codex reads them", () => {
  assert.deepEqual(ok("\ufeffa = 1\r\nb = \"x\"\r\n[t]\r\nc = 2\r\n").value, { a: 1, b: "x", t: { c: 2 } });
  assert.equal(ok("a = \"\"\"one\r\ntwo\"\"\"\r\n").value.a, "one\ntwo");
});

test("errors name the line (and a column) and say what is wrong", () => {
  assert.deepEqual({ line: bad('model = "gpt-5.5"\nfoo bar = 1\n').line, column: bad('model = "gpt-5.5"\nfoo bar = 1\n').column }, { line: 2, column: 5 });
  assert.match(bad("a = 1\na = 2\n").message, /duplicate key/);
  assert.match(bad("[t]\nx = 1\n[t]\n").message, /more than once/);
  assert.match(bad('a = "abc\n').message, /unterminated string/);
  assert.match(bad("a = [1, 2\n").message, /unterminated array/);
  assert.match(bad("a = hello\n").message, /invalid value/);
  assert.match(bad("a = 1979-02-30\n").message, /invalid date/);
});

test("inline tables may span lines and end with a comma, and cannot be extended afterwards (Codex's reader accepts TOML 1.1 here)", () => {
  assert.deepEqual(ok("a = { x = 1,\n  y = 2, # two\n}\n").value, { a: { x: 1, y: 2 } });
  bad("a = { x = 1 }\n[a]\ny = 2\n");
  bad("a = { x = 1 }\na.y = 2\n");
});

test("arrays of tables: sub tables belong to the last element; a static array cannot be extended", () => {
  assert.deepEqual(ok("[[t]]\nx = 1\n[t.sub]\ny = 2\n[[t]]\nx = 3\n").value, { t: [{ x: 1, sub: { y: 2 } }, { x: 3 }] });
  bad("t = [{x = 1}]\n[[t]]\ny = 2\n");
  bad("[t]\nx = 1\n[[t]]\ny = 2\n");
});

test("the table of cases: the reader agrees with Codex on whether each file parses, and on the line of the error", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "toml-oracle.json"), "utf8"));
  assert.equal(fixture.cases.length, CASES.length, "the record is for this table: run test/record-oracles.mjs toml");
  assert.ok(CASES.length >= 120, `${CASES.length} cases`);
  // Codex names the line after a string that holds a newline (it reads on to the next line); this reader names the line of the string
  const lineDiffers = new Set(["basic string with a raw newline"]);
  const wrong = [];
  for (const [name, text] of CASES) {
    const want = fixture.cases.find((c) => c.name === name);
    assert.ok(want, `${name} is in the record`);
    const got = parseToml(text);
    if (got.ok !== want.valid) { wrong.push(`${name}: Codex ${want.valid ? "accepts" : "rejects"} it`); continue; }
    if (!want.valid && !lineDiffers.has(name) && got.error.line !== want.line) wrong.push(`${name}: Codex says line ${want.line}, this says ${got.error.line}`);
  }
  assert.deepEqual(wrong, []);
  assert.ok(fixture.cases.filter((c) => c.valid).length > 60 && fixture.cases.filter((c) => !c.valid).length > 40);
});
