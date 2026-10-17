// The rules findings, put to the real Codex: a rules file that does not load (what `codex exec` and the terminal UI's server do), an example
// that fails, which files are read at all, and when a project's rules count. The decisions of many commands are put to `codex execpolicy
// check` in test/e2e-tables.test.mjs; what the model is told to do is in test/e2e-why.test.mjs.
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { exec, lintWorld, thread } from "./behave.mjs";
import { put, runCodex, sandbox, shellCall, skip } from "./codex-sandbox.mjs";

const opts = { skip: skip() };
const rulesFile = (text) => ({ "codex-home/rules/default.rules": text });
const loadingError = (err) => /Error loading rules:\r?\n.*default\.rules:(\d+): /.exec(err);

test("rules-syntax: codex exec stops with \"Error loading rules:\" and the line lint names", opts, async () => {
  const worlds = [
    ["a bracket that is never closed", 'prefix_rule(pattern=["ls"], decision="allow"\n', /Parse error: unexpected new line, expected symbol '\)'/],
    ["a bracket that is never closed, with a line before it", 'x = 1\nprefix_rule(pattern=["ls"], decision="allow"\n', /Parse error: unexpected new line/],
    ["a stray closing bracket on line 3", "x = 1\ny = 2\nz = 3)\n", /Parse error/],
    ["a name that does not exist on line 3", "x = 1\ny = 2\nz = nosuch\n", /Variable `nosuch` not found/],
    ["a byte order mark", '﻿prefix_rule(pattern=["ls"])\n', /invalid input/],
    ["a decision that is not one", 'prefix_rule(pattern=["ls"], decision="maybe")\n', /decision/],
  ];
  for (const [what, text, message] of worlds) {
    const r = await exec({ label: "e2e-rules-syntax", files: rulesFile(text) });
    assert.equal(r.code, 1, what);
    const said = loadingError(r.err);
    assert.ok(said, `${what}: ${r.err}`);
    assert.match(r.err, message, what);
    assert.equal(r.requests.length, 0, what);
    const found = lintWorld(r.sb).find("rules-syntax");
    assert.equal(found.length, 1, what);
    assert.equal(found[0].line, Number(said[1]), `${what}: lint names the line Codex printed`);
  }
});

test("rules-example-fails: a match example that matches nothing and a not_match example that matches stop codex exec", opts, async () => {
  const a = await exec({ label: "e2e-rules-example", files: rulesFile('prefix_rule(pattern=["git", "pull"], match=["git push"])\n') });
  assert.equal(a.code, 1);
  assert.match(a.err, /default\.rules:1: expected every example to match at least one rule\. rules: \[.*unmatched examples: \["git push"\]/);
  assert.equal(lintWorld(a.sb).find("rules-example-fails").length, 1);
  const b = await exec({ label: "e2e-rules-example-2", files: rulesFile('prefix_rule(pattern=["git", "pull"], not_match=["git pull x"])\n') });
  assert.equal(b.code, 1);
  assert.match(b.err, /default\.rules:1: expected example to not match rule `PrefixRuleMatch \{ matched_prefix: \["git", "pull"\]/);
  assert.equal(lintWorld(b.sb).find("rules-example-fails").length, 1);
  // a match example is held to its own rule: a rule of another file, or of the same file, does not count
  const c = await exec({ label: "e2e-rules-example-3", files: { ...rulesFile('prefix_rule(pattern=["git", "pull"], match=["git push"])\n'), "codex-home/rules/other.rules": 'prefix_rule(pattern=["git", "push"])\n' } });
  assert.equal(c.code, 1);
  assert.match(c.err, /unmatched examples: \["git push"\]/);
  assert.equal(lintWorld(c.sb).find("rules-example-fails").length, 1);
  const d = await exec({ label: "e2e-rules-example-4", files: rulesFile('prefix_rule(pattern=["git", "pull"], match=["git push"])\nprefix_rule(pattern=["git", "push"])\n') });
  assert.equal(d.code, 1);
  assert.equal(lintWorld(d.sb).find("rules-example-fails").length, 1);
});

test("rules: only files named *.rules directly in the rules folder are read", opts, async () => {
  const bad = 'prefix_rule(pattern=["ls"], decision="allow"\n';
  const r = await exec({ label: "e2e-rules-names", files: { "codex-home/rules/sub/a.rules": bad, "codex-home/rules/b.txt": bad, "codex-home/rules/C.RULES": bad, "codex-home/other.rules": bad } });
  assert.equal(r.code, 0, r.err);
  assert.equal(lintWorld(r.sb).find("rules-syntax").length, 0);
});

test("rules: a project's rules count only when the project is trusted", opts, async () => {
  const bad = 'prefix_rule(pattern=["ls"], decision="allow"\n';
  const trusted = await exec({ label: "e2e-rules-project", trust: true, files: { "work/.codex/rules/default.rules": bad } });
  assert.equal(trusted.code, 1);
  assert.match(trusted.err, /Error loading rules:\r?\n.*work.\.codex.rules.default\.rules:2: /);
  assert.equal(lintWorld(trusted.sb).find("rules-syntax").length, 1);
  const untrusted = await exec({ label: "e2e-rules-project-off", files: { "work/.codex/rules/default.rules": bad } });
  assert.equal(untrusted.code, 0, untrusted.err);
  assert.equal(lintWorld(untrusted.sb).find("rules-syntax").length, 0);
});

test("rules-syntax: the terminal UI's server starts anyway, warns, and applies none of the rules; with every file good, a forbidden rule blocks the command", opts, async () => {
  const forbid = 'prefix_rule(pattern=["echo", "PROBE-HI"], decision="forbidden", justification="no echo")\n';
  const run = (files) => thread({ label: "e2e-rules-thread", files, script: [shellCall("echo PROBE-HI"), { text: "DONE" }], approval: "never", sandbox: "danger-full-access" });
  const good = await run({ "codex-home/rules/default.rules": forbid });
  assert.match(good.outputs[0], /rejected: no echo/, good.outputs[0]);
  assert.deepEqual(good.warnings, []);
  for (const [what, extra] of [["a syntax error", 'prefix_rule(pattern=["ls"], decision="allow"\n'], ["a match example that matches nothing", 'prefix_rule(pattern=["git"], match=["svn up"])\n']]) {
    const r = await run({ "codex-home/rules/default.rules": forbid, "codex-home/rules/z.rules": extra });
    assert.deepEqual(r.warnings, ["Error parsing rules; custom rules not applied."], what);
    assert.match(r.outputs[0], /PROBE-HI/, `${what}: the command the forbidden rule blocks ran`);
    assert.doesNotMatch(r.outputs[0], /rejected/, what);
    assert.ok(lintWorld(r.sb).find("rules-syntax").length + lintWorld(r.sb).find("rules-example-fails").length >= 1, what);
  }
});

test("rules-shadowed: execpolicy check lists every rule that matches and decides with the strictest", opts, async () => {
  const sb = sandbox("e2e-rules-shadow");
  const file = put(path.join(sb.root, "shadow.rules"), 'prefix_rule(pattern=["git", "status"], decision="allow")\nprefix_rule(pattern=["git"], decision="prompt")\nprefix_rule(pattern=["git", "status", "-s"], decision="forbidden")\n');
  const ask = async (...tokens) => JSON.parse((await runCodex(sb, ["execpolicy", "check", "--rules", file, "--", ...tokens])).out);
  const status = await ask("git", "status");
  assert.equal(status.matchedRules.length, 2);
  assert.equal(status.decision, "prompt", "the prompt rule wins over the allow rule it covers");
  const short = await ask("git", "status", "-s");
  assert.equal(short.matchedRules.length, 3);
  assert.equal(short.decision, "forbidden");
  const none = await ask("ls");
  assert.deepEqual(none.matchedRules, []);
  assert.equal(none.decision, undefined);
});
