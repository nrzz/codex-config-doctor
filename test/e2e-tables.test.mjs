// The tables of cases the unit tests hold the code to, put to the Codex that runs now: the layers and where each key comes from
// (test/layers-table.mjs), the AGENTS.md message (test/agents-table.mjs), and the rules (test/rules-table.mjs: several hundred commands and
// files for `codex execpolicy check`). The records the unit tests use (test/fixtures/*-oracle.json) must be what Codex says today: the code
// agrees with the record offline, and the record agrees with the binary here.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { PARALLEL, askAgents, askLayers, askRulesCase, askRulesFile, pool, rulesWorld } from "./ask.mjs";
import { IS_WIN, skip } from "./codex-sandbox.mjs";
import { ROOT } from "./helpers.mjs";
import { SCENARIOS as AGENT_SCENARIOS } from "./agents-table.mjs";
import { SCENARIOS as LAYER_SCENARIOS } from "./layers-table.mjs";
import { FILES, cases } from "./rules-table.mjs";

const opts = { skip: skip() };
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", name), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test("layers: the layers Codex loads, which are disabled, what each key came from and the warnings, for every world of the table", opts, async () => {
  const rec = fixture("layers-oracle.json");
  const usable = LAYER_SCENARIOS.filter((s) => !s.noAppServer && (!s.windowsOnly || IS_WIN));
  const live = (await pool(usable, PARALLEL, askLayers)).filter(Boolean);
  const wrong = [];
  for (const s of live) {
    const want = rec.scenarios.find((x) => x.name === s.name);
    if (!want) { wrong.push(`${s.name}: not in the record`); continue; }
    if (s.error) { wrong.push(`${s.name}: ${s.error}`); continue; }
    // the system layer is not part of the record; on Linux and macOS the temporary folder has other path separators, normalised by the record
    for (const k of ["layers", "values", "warnings"]) if (!same(s[k], want[k])) wrong.push(`${s.name}: ${k} are ${JSON.stringify(s[k]).slice(0, 300)}, the record has ${JSON.stringify(want[k]).slice(0, 300)}`);
  }
  assert.deepEqual(wrong, []);
  assert.equal(live.length, usable.length);
});

test("agents: the AGENTS.md message Codex builds is the recorded one (size, hash, ends) for every world of the table", opts, async () => {
  const rec = fixture("agents-oracle.json");
  const live = await pool(AGENT_SCENARIOS, PARALLEL, askAgents);
  const wrong = [];
  for (const s of live) {
    const want = rec.scenarios.find((x) => x.name === s.name);
    if (!want) { wrong.push(`${s.name}: not in the record`); continue; }
    if (!same(s, want)) wrong.push(`${s.name}: Codex's message is ${JSON.stringify(s).slice(0, 260)}, the record has ${JSON.stringify(want).slice(0, 260)}`);
  }
  assert.deepEqual(wrong, []);
  assert.equal(live.length, AGENT_SCENARIOS.length);
  assert.ok(live.length >= 40);
});

test("rules: `codex execpolicy check` answers every command of the table as recorded", opts, async () => {
  const rec = fixture("rules-oracle.json");
  const world = await rulesWorld();
  const table = cases();
  const live = await pool(table, PARALLEL, (c) => askRulesCase(world, c));
  const wrong = [];
  live.forEach((r, i) => {
    const want = rec.cases[i];
    if (!want || want.policy !== r.policy || !same(want.tokens, r.tokens)) wrong.push(`case ${i}: the table changed since it was recorded`);
    else if (!same(r.answer, want.answer)) wrong.push(`${r.policy} ${JSON.stringify(r.tokens)}: Codex says ${JSON.stringify(r.answer).slice(0, 240)}, the record has ${JSON.stringify(want.answer).slice(0, 240)}`);
  });
  assert.deepEqual(wrong, []);
  assert.ok(live.length >= 300, `${live.length} commands`);
});

test("rules: files that do not load give the recorded error at the recorded line; files that load give the recorded answer", opts, async () => {
  const rec = fixture("rules-oracle.json");
  const world = await rulesWorld();
  const live = await pool(Object.entries(FILES), PARALLEL, ([name, text], i) => askRulesFile(world, name, text, i));
  const wrong = [];
  live.forEach((r) => {
    const want = rec.files.find((x) => x.name === r.name);
    if (!want) { wrong.push(`${r.name}: not in the record`); return; }
    if (want.ok !== r.ok || want.line !== r.line || !same(want.answer, r.answer)) wrong.push(`${r.name}: Codex says ${JSON.stringify(r).slice(0, 260)}, the record has ${JSON.stringify(want).slice(0, 260)}`);
  });
  assert.deepEqual(wrong, []);
  assert.ok(live.length >= 60, `${live.length} files`);
});
