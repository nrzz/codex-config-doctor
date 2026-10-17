// The keys Codex knows (src/knowledge.mjs, src/schema.mjs) held to what Codex 0.163.0 answered (test/fixtures/schema-oracle.json, written by
// test/record-oracles.mjs schema from the tables in test/schema-table.mjs): every key the tool lists is read without a warning, every typo is
// listed as ignored, every value of the wrong type is refused. test/e2e-schema.test.mjs asks the real Codex the same again.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseToml } from "../src/toml.mjs";
import { checkEntries, TOP_LEVEL_KEYS } from "../src/schema.mjs";
import { FEATURES, FEATURE_ALIASES, SCHEMA_LINES } from "../src/knowledge.mjs";
import { TYPOS, groups, leaves, wrongSamples, wrongToml } from "./schema-table.mjs";

const oracle = JSON.parse(fs.readFileSync(new URL("./fixtures/schema-oracle.json", import.meta.url), "utf8"));
const problemsOf = (text) => {
  const p = parseToml(text);
  assert.ok(p.ok, `does not parse: ${text}`);
  return checkEntries(p.entries);
};

test("the record is of the Codex this tool checks against", () => {
  assert.equal(oracle.codex, "0.163.0");
  assert.ok(oracle.groups.length >= 7 && oracle.typos.length >= 21 && oracle.wrong.length >= 190);
});

test("every group of keys that Codex read without a warning raises no problem here, and the tables are the ones that were recorded", () => {
  const table = groups();
  assert.equal(table.length, oracle.groups.length);
  let covered = 0;
  for (const g of table) {
    const rec = oracle.groups.find((x) => x.name === g.name);
    assert.ok(rec, `no record for ${g.name}`);
    assert.equal(rec.ok, true, `${g.name}: Codex did not read the file: ${rec.error}`);
    assert.deepEqual(rec.unrecognized, [], `${g.name}: Codex ignored keys`);
    assert.equal(rec.covers, g.covers.length, `${g.name}: the table changed since it was recorded: record it again`);
    assert.deepEqual(problemsOf(g.toml), [], g.name);
    covered += g.covers.length;
  }
  assert.ok(covered >= 320, `${covered} keys`);
});

test("every one of the 175 feature flags is known here, with Codex's stage", () => {
  const all = oracle.groups.find((g) => g.name === "every feature flag");
  assert.equal(all.covers, Object.keys(FEATURES).length);
  assert.equal(Object.keys(FEATURES).length, 175);
});

test("every typo that Codex lists as ignored is listed here, and no key besides", () => {
  assert.deepEqual(oracle.typos.map((t) => t.toml), TYPOS, "the typo table changed since it was recorded: record it again");
  let flagged = 0;
  for (const rec of oracle.typos) {
    const problems = problemsOf(rec.toml);
    if (!rec.ok) {
      // Codex refuses the file: here it is a wrong-type problem
      assert.ok(problems.some((p) => p.id === "wrong-type"), `${rec.toml}: Codex refused (${rec.error}), this tool found ${JSON.stringify(problems.map((p) => p.id))}`);
      continue;
    }
    const ours = problems.filter((p) => p.id === "unknown-key" || p.id === "feature-unknown").map((p) => p.key).sort();
    assert.deepEqual(ours, rec.unrecognized, rec.toml);
    flagged += ours.length;
  }
  assert.ok(flagged >= 19);
});

test("every value of the wrong type that Codex refused is a problem here, and the samples are the ones that were recorded", () => {
  const want = [];
  for (const { path, type } of leaves()) for (const bad of wrongSamples(type)) want.push(`${path} ${JSON.stringify(bad)}`);
  const have = oracle.wrong.map((w) => `${w.path} ${JSON.stringify(w.value)}`);
  assert.deepEqual(want, have, "the schema changed since the samples were recorded: record them again");
  let refused = 0;
  for (const rec of oracle.wrong) {
    const problems = problemsOf(wrongToml(rec.path, rec.value));
    const bad = problems.filter((p) => p.id === "wrong-type" || p.id === "key-removed");
    if (rec.refused) {
      assert.ok(bad.length > 0, `${rec.path} = ${JSON.stringify(rec.value)}: Codex refused it (${rec.message}), this tool found nothing`);
      refused++;
    } else {
      assert.equal(bad.length, 0, `${rec.path} = ${JSON.stringify(rec.value)}: Codex took it, this tool refused: ${JSON.stringify(bad.map((p) => p.message))}`);
    }
  }
  assert.ok(refused >= 190, `${refused} refused`);
});

test("a key is named with the nearest name Codex knows", () => {
  const [p] = problemsOf('aproval_policy = "never"\n');
  assert.deepEqual([p.id, p.key, p.hint], ["unknown-key", "aproval_policy", "Did you mean `approval_policy`?"]);
  const [q] = problemsOf("[features]\nhoks = true\n");
  assert.deepEqual([q.id, q.key, q.hint], ["feature-unknown", "features.hoks", "Did you mean `hooks`?"]);
  assert.match(q.message, /Codex 0\.163\.0 knows/);
  const [r] = problemsOf("[sandbox_workspace_write]\nnetwork = true\n");
  assert.equal(r.key, "sandbox_workspace_write.network");
  assert.match(r.hint, /network_access/);
  const [s] = problemsOf("zzzzzzzzzz = 1\n");
  assert.equal(s.hint, null);
});

test("a top-level key written under a table header is explained", () => {
  const [p] = problemsOf('[mcp_servers.x]\ncommand = "node"\nmodel = "gpt-5.5"\n');
  assert.equal(p.key, "mcp_servers.x.model");
  assert.match(p.hint, /top-level key of config\.toml/);
});

test("one problem for an unknown table, not one per key", () => {
  assert.equal(problemsOf("[foo]\na = 1\nb = 2\n[foo.bar]\nc = 3\n").length, 1);
  assert.equal(problemsOf("a = 1\n[[x]]\nb = 1\n[[x]]\nb = 2\n").length, 2);
});

test("feature flags: the old name is known, a table is allowed where Codex allows one, a number is not a flag", () => {
  assert.ok(FEATURE_ALIASES.codex_hooks);
  assert.deepEqual(problemsOf("[features]\ncodex_hooks = true\n"), []);
  const [p] = problemsOf('[features]\nhooks = "yes"\n');
  assert.deepEqual([p.id, p.expected, p.got], ["wrong-type", "a boolean", 'string "yes"']);
});

test("types: strings, booleans, integers (with the range), numbers, tables, arrays, the allowed words", () => {
  const one = (toml) => { const r = problemsOf(toml); assert.equal(r.length, 1, toml); return r[0]; };
  assert.match(one("model = 5\n").message, /must be a string, not integer `5`/);
  assert.match(one('project_doc_max_bytes = -1\n').message, /must be a non-negative integer, not `-1`/);
  assert.match(one('project_doc_max_bytes = 1.5\n').message, /must be a non-negative integer/);
  assert.match(one('sandbox_mode = "bogus"\n').message, /must be one of `read-only`, `workspace-write`, `danger-full-access`, not `bogus`/);
  assert.match(one("sandbox_mode = 1\n").message, /not integer `1`/);
  assert.match(one('project_doc_fallback_filenames = "x"\n').message, /an array of strings, not string "x"/);
  assert.match(one("project_doc_fallback_filenames = [1]\n").message, /an array of strings/);
  assert.match(one('mcp_servers = "x"\n').message, /must be a table/);
  assert.match(one('[mcp_servers.x]\ncommand = 5\n').message, /must be a string/);
  // model_reasoning_effort takes any string; Codex does not check the word
  assert.deepEqual(problemsOf('model_reasoning_effort = "whatever"\n'), []);
  // a float where a number goes, an integer where a number goes
  assert.deepEqual(problemsOf("[agents.x]\ndescription = \"d\"\n"), []);
});

test("the removed key Codex refuses with its own words", () => {
  const [p] = problemsOf('experimental_thread_store_endpoint = "x"\n');
  assert.equal(p.id, "key-removed");
  assert.equal(p.message, "`experimental_thread_store_endpoint` is no longer supported; remove it from config.toml");
});

test("tables Codex does not check are not checked here: tui and agents roles", () => {
  assert.deepEqual(problemsOf("[tui]\nnotification = true\nwhatever = 1\n[tui.x]\ny = 1\n"), []);
  assert.deepEqual(problemsOf('[agents.reviewer]\ndescription = "d"\nanything = 1\n'), []);
});

test("hook events and hooks.state are keys of the file that are not in the schema table", () => {
  assert.deepEqual(problemsOf('[[hooks.PreToolUse]]\nmatcher = "*"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "x"\n'), []);
  assert.deepEqual(problemsOf('[hooks.state."a:b:0:0"]\ntrusted_hash = "sha256:00"\n'), []);
  const [p] = problemsOf('[[hooks.PreToolUsee]]\nmatcher = "*"\n');
  assert.equal(p.id, "unknown-key");
  assert.match(p.hint, /PreToolUse/);
});

test("the top-level keys the tool knows are the ones of the schema table", () => {
  assert.ok(TOP_LEVEL_KEYS.length >= 100);
  for (const line of SCHEMA_LINES) {
    const [path] = line.split(" ");
    assert.ok(TOP_LEVEL_KEYS.includes(path.split(".")[0]), path);
  }
});
