// The rules engine: that its answer is the answer of `codex execpolicy check` for all the commands of test/rules-table.mjs (the record of
// test/fixtures/rules-oracle.json), and how it decides: strictest wins, the programs whose bare allow rule Codex ignores, shadowed rules.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ROOT } from "./helpers.mjs";
import { asCheckJson, effective, evaluate, expandPattern, isBannedPrefix, isUnhonoured, matchRule, shadowedRules } from "../src/execpolicy.mjs";
import { BANNED_PREFIXES } from "../src/knowledge.mjs";
import { runRules } from "../src/starlark.mjs";
import { POLICIES, cases } from "./rules-table.mjs";

const rulesOf = (src) => { const r = runRules(src); assert.ok(r.ok, r.ok ? "" : r.error.message); return r.rules.map((x) => ({ ...x, file: "t.rules" })); };

test("matchRule: the pattern is a prefix; each position takes any of its alternatives; the case counts", () => {
  const [r] = rulesOf('prefix_rule(pattern=["git", ["pull", "fetch"]])\n');
  assert.deepEqual(matchRule(r, ["git", "pull", "x"]), ["git", "pull"]);
  assert.deepEqual(matchRule(r, ["git", "fetch"]), ["git", "fetch"]);
  assert.equal(matchRule(r, ["git"]), null);
  assert.equal(matchRule(r, ["git", "push"]), null);
  assert.equal(matchRule(r, ["Git", "pull"]), null);
  assert.equal(matchRule(r, ["/usr/bin/git", "pull"]), null);
});

test("evaluate: every rule that matches is listed in the order of the file, and the strictest decision is the answer", () => {
  const rules = rulesOf('prefix_rule(pattern=["npm"], decision="allow")\nprefix_rule(pattern=["npm", "publish"], decision="prompt", justification="look")\nprefix_rule(pattern=["npm", "publish", "x"], decision="forbidden")\n');
  const r = evaluate(rules, ["npm", "publish", "x"]);
  assert.deepEqual(r.matched.map((m) => m.decision), ["allow", "prompt", "forbidden"]);
  assert.equal(r.decision, "forbidden");
  assert.equal(evaluate(rules, ["npm", "publish"]).decision, "prompt");
  assert.equal(evaluate(rules, ["npm", "test"]).decision, "allow");
  assert.equal(evaluate(rules, ["pnpm"]).decision, null);
  assert.deepEqual(asCheckJson(evaluate(rules, ["pnpm"])), { matchedRules: [] });
  assert.deepEqual(asCheckJson(evaluate(rules, ["npm", "publish"])), { matchedRules: [{ prefixRuleMatch: { matchedPrefix: ["npm"], decision: "allow" } }, { prefixRuleMatch: { matchedPrefix: ["npm", "publish"], decision: "prompt", justification: "look" } }], decision: "prompt" });
});

test("the table: all the commands of test/rules-table.mjs get the answer Codex gave (at least 300 of them)", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "rules-oracle.json"), "utf8"));
  assert.deepEqual(Object.keys(fixture.policies), Object.keys(POLICIES));
  for (const [name, p] of Object.entries(POLICIES)) assert.equal(fixture.policies[name], p.text, `the record holds the policy ${name}: run test/record-oracles.mjs rules`);
  const all = cases();
  assert.equal(fixture.cases.length, all.length, "the record is for this table");
  assert.ok(all.length >= 300, `${all.length} cases`);
  const policies = Object.fromEntries(Object.entries(fixture.policies).map(([n, text]) => [n, rulesOf(text)]));
  const wrong = [];
  for (const c of fixture.cases) {
    const mine = asCheckJson(evaluate(policies[c.policy], c.tokens));
    if (JSON.stringify(mine) !== JSON.stringify(c.answer)) wrong.push(`${c.policy} ${JSON.stringify(c.tokens)}: Codex ${JSON.stringify(c.answer)}, this ${JSON.stringify(mine)}`);
  }
  assert.deepEqual(wrong, []);
  // the table has every kind of answer
  const decisions = new Set(fixture.cases.map((c) => c.answer.decision || "none"));
  assert.deepEqual([...decisions].sort(), ["allow", "forbidden", "none", "prompt"]);
});

test("an allow rule whose whole pattern is a banned prefix is ignored by Codex; longer patterns and the other decisions count", () => {
  const rules = rulesOf('prefix_rule(pattern=["git"], decision="allow")\nprefix_rule(pattern=["node", "build.mjs"], decision="allow")\nprefix_rule(pattern=["python"], decision="prompt")\nprefix_rule(pattern=["npm"], decision="allow")\nprefix_rule(pattern=[["bash", "ls"]], decision="allow")\nprefix_rule(pattern=["node", "-e"], decision="allow")\nprefix_rule(pattern=["npm", "run"], decision="allow")\nprefix_rule(pattern=["deno", "run"], decision="allow")\n');
  const git = effective(rules, ["git", "status"]);
  assert.equal(git.matched.length, 1);
  assert.equal(git.counted.length, 0);
  assert.equal(git.ignored.length, 1);
  assert.equal(git.decision, null);
  assert.equal(effective(rules, ["node", "build.mjs", "x"]).decision, "allow");
  assert.equal(effective(rules, ["node", "other.mjs"]).decision, null);
  assert.equal(effective(rules, ["python", "x"]).decision, "prompt", "a prompt rule on a banned prefix counts");
  assert.equal(effective(rules, ["npm", "test"]).decision, "allow", "npm alone is not banned");
  assert.equal(effective(rules, ["npm", "run", "build"]).ignored.length, 1, "npm run is banned (the rule for npm alone still counts)");
  assert.equal(effective(rulesOf('prefix_rule(pattern=["npm", "run"], decision="allow")\n'), ["npm", "run", "build"]).decision, null);
  assert.equal(effective(rules, ["node", "-e", "1"]).decision, null, "node -e is");
  assert.equal(effective(rules, ["deno", "run", "x"]).decision, "allow", "deno run is not");
  assert.equal(effective(rules, ["bash", "-c", "x"]).decision, null, "bash is one of the alternatives");
  assert.equal(effective(rules, ["ls"]).decision, "allow", "the other alternative is honoured");
  assert.equal(isUnhonoured(rules[0], ["git"]), true);
  assert.equal(isUnhonoured(rules[3], ["npm"]), false);
  assert.equal(isUnhonoured({ decision: "prompt" }, ["git"]), false);
});

test("the table of banned prefixes: 88 prefixes, sorted, the shells and interpreters and git, env, rm, sudo, npm run; not npm, make or git status", () => {
  assert.equal(BANNED_PREFIXES.length, 88);
  const keys = BANNED_PREFIXES.map((p) => p.join(" "));
  assert.deepEqual(keys, [...keys].sort(), "sorted the way the table is");
  assert.equal(new Set(keys).size, 88);
  for (const p of [["git"], ["env"], ["rm"], ["sudo"], ["python", "-"], ["bash", "-lc"], ["/bin/sh", "-c"], ["cmd.exe", "/c"], ["npm", "run"], ["yarn", "run"], ["pnpm", "run"], ["powershell.exe", "-EncodedCommand"], ["pwsh", "-ec"], ["py", "-3"]]) assert.ok(isBannedPrefix(p), p.join(" "));
  for (const p of [["npm"], ["make"], ["git", "status"], ["node", "script.js"], ["deno", "run"], ["Rscript", "-e"], ["rm", "-rf"], ["powershell", "-ec"], ["python3.12"], ["bash.exe"], ["osascript", "-e"]]) assert.ok(!isBannedPrefix(p), p.join(" "));
});

test("expandPattern: every way to pick one token at each position", () => {
  const rules = rulesOf('prefix_rule(pattern=[["git", "hg"], ["status", "log"]], decision="allow")\nprefix_rule(pattern=["ls"], decision="allow")\n');
  assert.deepEqual(expandPattern(rules[0]), [["git", "status"], ["git", "log"], ["hg", "status"], ["hg", "log"]]);
  assert.deepEqual(expandPattern(rules[1]), [["ls"]]);
});

test("shadowedRules: an allow rule that a stricter rule matches wherever it matches", () => {
  const rules = rulesOf('prefix_rule(pattern=["git", "status"], decision="allow")\nprefix_rule(pattern=["git"], decision="prompt")\nprefix_rule(pattern=["ls"], decision="allow")\nprefix_rule(pattern=["rm", "x"], decision="allow")\nprefix_rule(pattern=["rm"], decision="forbidden")\nprefix_rule(pattern=["npm", "install"], decision="allow")\nprefix_rule(pattern=["npm", "publish"], decision="forbidden")\n');
  assert.deepEqual(shadowedRules(rules).map((s) => [s.rule.pattern.flat().join(" "), s.by.pattern.flat().join(" ")]), [["git status", "git"], ["rm x", "rm"]]);
});
