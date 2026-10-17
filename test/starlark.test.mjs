// The Starlark reader for .rules files: the language it runs, what prefix_rule() accepts and what it refuses, and that it agrees with Codex
// about which files load (the record of test/fixtures/rules-oracle.json, made from `codex execpolicy check`).
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ROOT } from "./helpers.mjs";
import { checkExamples } from "../src/execpolicy.mjs";
import { runRules, shlexSplit } from "../src/starlark.mjs";
import { FILES } from "./rules-table.mjs";

const patterns = (src) => { const r = runRules(src); assert.ok(r.ok, r.ok ? "" : `${r.error.kind} line ${r.error.line}: ${r.error.message}`); return r.rules.map((x) => x.pattern.map((a) => (a.length === 1 ? a[0] : a))); };
const fails = (src) => { const r = runRules(src); assert.equal(r.ok, false, `ran: ${src}`); return r.error; };

test("prefix_rule(): the pattern, the decision (allow by default), the justification and the line of the call", () => {
  const r = runRules('\nprefix_rule(pattern=["git", ["pull", "fetch"]], decision="prompt", justification="look")\nprefix_rule(pattern=["ls"])\n');
  assert.ok(r.ok);
  assert.deepEqual(r.rules.map((x) => [x.pattern, x.decision, x.justification, x.line]), [[[["git"], ["pull", "fetch"]], "prompt", "look", 2], [[["ls"]], "allow", null, 3]]);
});

test("the language: variables, concatenation, loops, comprehensions, functions with defaults, conditions, lambda, tuples", () => {
  assert.deepEqual(patterns('X = "l"\nprefix_rule(pattern=[X + "s"])\n'), [["ls"]]);
  assert.deepEqual(patterns('for c in ["ls", "cat"]:\n    prefix_rule(pattern=[c])\n'), [["ls"], ["cat"]]);
  assert.deepEqual(patterns('[prefix_rule(pattern=[c, "x"]) for c in ["a", "b"] if c != "b"]\n'), [["a", "x"]]);
  assert.deepEqual(patterns('def f(x, d="allow"):\n    prefix_rule(pattern=[x], decision=d)\nf("ls")\nf("cat", d="prompt")\n'), [["ls"], ["cat"]]);
  assert.deepEqual(patterns('if True:\n    prefix_rule(pattern=["yes"])\nelse:\n    prefix_rule(pattern=["no"])\n'), [["yes"]]);
  assert.deepEqual(patterns('f = lambda x, y="z": x + y\nprefix_rule(pattern=[f("a")])\n'), [["az"]]);
  assert.deepEqual(patterns('prefix_rule(pattern=["{}-{}".format("a", "b"), "%s" % "c", "x" * 2, "q".upper(), ",".join(["d", "e"])])\n'), [["a-b", "c", "xx", "Q", "d,e"]]);
  assert.deepEqual(patterns('d = {"a": "ls"}\nfor k, v in d.items():\n    prefix_rule(pattern=[k, v])\nprefix_rule(pattern=[str(len(range(3)))])\n'), [["a", "ls"], ["3"]]);
  assert.deepEqual(patterns('t = ("a", "b")\nx, y = t\nprefix_rule(pattern=[y, x])\n'), [["b", "a"]]);
  assert.deepEqual(patterns("prefix_rule(pattern=['ls'], justification='single quotes')\n"), [["ls"]]);
});

test("strings: escapes, raw strings, triple quotes; an escape Starlark does not know stays as written", () => {
  assert.deepEqual(patterns('prefix_rule(pattern=["a\\tb", r"C:\\x", "\\u00e9", """long\ntext""", "\\q"])\n'), [["a\tb", "C:\\x", "é", "long\ntext", "\\q"]]);
});

test("comments, semicolons, CRLF and a missing final newline are fine; a byte order mark and tabs are not", () => {
  assert.deepEqual(patterns('# c\nprefix_rule(pattern=["a"]); prefix_rule(pattern=["b"]) # c\r\nprefix_rule(\r\n  pattern=["c"],\r\n)'), [["a"], ["b"], ["c"]]);
  assert.match(fails('\ufeffprefix_rule(pattern=["a"])\n').message, /invalid input/);
  assert.match(fails('for p in ["ls"]:\n\tprefix_rule(pattern=[p])\n').message, /tabs/);
});

test("what prefix_rule() refuses", () => {
  assert.match(fails('prefix_rule(pattern=["ls"], decision="yes")\n').message, /decision must be/);
  assert.match(fails('prefix_rule(pattern=[], decision="allow")\n').message, /non-empty list/);
  assert.match(fails('prefix_rule(decision="allow")\n').message, /pattern/);
  assert.match(fails('prefix_rule(pattern="ls")\n').message, /non-empty list/);
  assert.match(fails('prefix_rule(pattern=("ls",))\n').message, /non-empty list/);
  assert.match(fails('prefix_rule(pattern=["ls", 1])\n').message, /pattern element 2/);
  assert.match(fails('prefix_rule(pattern=["ls", []])\n').message, /pattern element 2/);
  assert.match(fails('prefix_rule(pattern=["ls"], bogus=1)\n').message, /unexpected keyword argument `bogus`/);
  assert.match(fails('prefix_rule(pattern=["ls"], justification="")\n').message, /must not be empty/);
  assert.match(fails('prefix_rule(pattern=["ls"], justification=1)\n').message, /must be a string/);
  assert.match(fails('prefix_rule(pattern=["ls"], match="ls")\n').message, /match must be a list/);
  assert.match(fails('prefix_rule(pattern=["ls"], match=[1])\n').message, /match example/);
  assert.match(fails('prefix_rule(pattern=["ls"], match=["ls \'a"])\n').message, /quote/);
});

test("errors have a line: syntax, unknown names, reserved words, load, return outside a function", () => {
  assert.deepEqual([fails('x = 1\nfoo(pattern=["ls"])\n').kind, fails('x = 1\nfoo(pattern=["ls"])\n').line], ["runtime", 2]);
  assert.equal(fails('prefix_rule(pattern=["ls"]\n').kind, "syntax");
  assert.equal(fails('prefix_rule(pattern=["ls"]\n').line, 2, "a bracket that is never closed: the line after the last one, as `Error loading rules:` names it");
  assert.equal(fails('prefix_rule(pattern=["ls"]').line, 1, "with no newline at the end, the last line");
  assert.match(fails("prefix_rule(pattern=[Y])\n").message, /Variable `Y` not found/);
  assert.match(fails("while True:\n    pass\n").message, /reserved keyword `while`/);
  assert.match(fails('load("x.rules", "y")\n').message, /No imports are available/);
  assert.deepEqual([fails("return 1\n").kind, fails("return 1\n").line], ["syntax", 1]);
  assert.match(fails('print("x")\n').message, /Variable `print` not found/);
  assert.equal(fails("  prefix_rule(pattern=['a'])\n").kind, "syntax");
  assert.match(fails('def f(x):\n    prefix_rule(pattern=[x])\nf()\n').message, /missing argument/);
});

test("a construct this reader does not run is reported as unsupported, never guessed", () => {
  const e = fails("def f(*args):\n    pass\n");
  assert.equal(e.kind, "unsupported");
  assert.equal(fails('prefix_rule(pattern=["a"][::2])\n').kind, "unsupported");
});

test("a program that runs for ever is stopped", () => {
  const e = fails("for i in range(100000):\n    for j in range(100000):\n        pass\n");
  assert.match(e.message, /too long|too large/);
});

test("shlexSplit: the string examples of match and not_match are split like a POSIX shell", () => {
  assert.deepEqual(shlexSplit("gh pr view 7888 --repo openai/codex"), ["gh", "pr", "view", "7888", "--repo", "openai/codex"]);
  assert.deepEqual(shlexSplit("echo 'a b' \"c d\" e\\ f"), ["echo", "a b", "c d", "e f"]);
  assert.deepEqual(shlexSplit("  a   b  "), ["a", "b"]);
  assert.deepEqual(shlexSplit(""), []);
  assert.deepEqual(shlexSplit('a "" b'), ["a", "", "b"]);
});

test("examples: a match example must match its own rule, a not_match example must not", () => {
  const problems = (src) => { const r = runRules(src); assert.ok(r.ok); return checkExamples(r.rules).map((p) => [p.kind, p.example]); };
  assert.deepEqual(problems('prefix_rule(pattern=["git", "pull"], match=["git pull origin"], not_match=["git push"])\n'), []);
  assert.deepEqual(problems('prefix_rule(pattern=["git", "pull"], match=["git push"])\n'), [["match", "git push"]]);
  assert.deepEqual(problems('prefix_rule(pattern=["git", "pull"], match=["git push"])\nprefix_rule(pattern=["git", "push"])\n'), [["match", "git push"]]);
  assert.deepEqual(problems('prefix_rule(pattern=["git", "pull"], not_match=["git pull x"])\n'), [["not_match", "git pull x"]]);
  assert.deepEqual(problems('prefix_rule(pattern=["git", ["pull", "push"]], match=["git push"], not_match=["git fetch"])\n'), []);
});

test("the table of rules files: this reader agrees with Codex on which load", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "rules-oracle.json"), "utf8"));
  assert.equal(fixture.files.length, Object.keys(FILES).length, "the record is for this table: run test/record-oracles.mjs rules");
  // Codex names the line before a tab in the indentation; this names the line of the tab
  const lineDiffers = new Set(["tabs for indentation"]);
  // things Codex runs that this reader says it does not run
  const unsupported = new Set();
  const wrong = [];
  for (const want of fixture.files) {
    const text = FILES[want.name];
    const r = runRules(text);
    if (!r.ok && r.error.kind === "unsupported") { unsupported.add(want.name); continue; }
    const loads = r.ok && checkExamples(r.rules).length === 0;
    if (loads !== want.ok) { wrong.push(`${want.name}: Codex ${want.ok ? "loads" : "refuses"} it`); continue; }
    // the line a user sees is the one `codex exec` prints ("Error loading rules:"); `execpolicy check` says line 1 for a bracket that is never closed
    const line = want.execLine ?? want.line;
    if (!want.ok && line !== null && !r.ok && !lineDiffers.has(want.name) && r.error.line !== line) wrong.push(`${want.name}: Codex says line ${line}, this says ${r.error.line}`);
  }
  assert.deepEqual(wrong, []);
  assert.deepEqual([...unsupported], [], "every file of the table runs");
  assert.ok(fixture.files.length >= 60);
});
