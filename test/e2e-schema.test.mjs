// The keys this tool knows (src/knowledge.mjs) against the Codex that runs now: every key of the schema is read without a warning, every
// typo is listed as ignored, every value of the wrong type is refused. The record the unit tests use (test/fixtures/schema-oracle.json)
// must be what Codex says today.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { PARALLEL, askWrong, pool, warningsFor } from "./ask.mjs";
import { skip } from "./codex-sandbox.mjs";
import { ROOT } from "./helpers.mjs";
import { TYPOS, groups, leaves, wrongSamples } from "./schema-table.mjs";
import { parseToml } from "../src/toml.mjs";
import { checkEntries } from "../src/schema.mjs";

const opts = { skip: skip() };
const fixture = () => JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "schema-oracle.json"), "utf8"));
const problems = (toml) => checkEntries(parseToml(toml).entries);

test("the groups: Codex reads every key this tool knows without a warning, and so does this tool", opts, async () => {
  const table = groups();
  const live = await pool(table, PARALLEL, (g) => warningsFor(g.toml));
  const wrong = [];
  table.forEach((g, i) => {
    if (!live[i].ok) wrong.push(`${g.name}: Codex did not read the file: ${live[i].error}`);
    else if (live[i].unrecognized.length) wrong.push(`${g.name}: Codex ignores ${live[i].unrecognized.join(", ")}`);
    if (problems(g.toml).length) wrong.push(`${g.name}: this tool finds ${problems(g.toml).map((p) => p.key).join(", ")}`);
  });
  assert.deepEqual(wrong, []);
  assert.ok(table.reduce((n, g) => n + g.covers.length, 0) >= 320);
});

test("the typos: Codex lists as ignored exactly the keys this tool flags", opts, async () => {
  const live = await pool(TYPOS, PARALLEL, (t) => warningsFor(t));
  const wrong = [];
  TYPOS.forEach((t, i) => {
    if (!live[i].ok) {
      if (!problems(t).some((p) => p.id === "wrong-type")) wrong.push(`${t}: Codex refuses the file (${live[i].error}), this tool does not`);
      return;
    }
    const mine = problems(t).filter((p) => p.id === "unknown-key" || p.id === "feature-unknown").map((p) => p.key).sort();
    if (JSON.stringify(mine) !== JSON.stringify(live[i].unrecognized)) wrong.push(`${t}: Codex ignores ${JSON.stringify(live[i].unrecognized)}, this tool flags ${JSON.stringify(mine)}`);
  });
  assert.deepEqual(wrong, []);
});

test("the wrong types: Codex refuses every value this tool calls wrong", opts, async () => {
  const jobs = [];
  for (const { path: p, type } of leaves()) for (const bad of wrongSamples(type)) jobs.push([p, type, bad]);
  const live = await pool(jobs, PARALLEL, ([p, type, bad]) => askWrong(p, type, bad));
  const rec = fixture().wrong;
  const wrong = [];
  const drift = [];
  const { wrongToml } = await import("./schema-table.mjs");
  live.forEach((r, i) => {
    const found = problems(wrongToml(r.path, r.value)).some((p) => p.id === "wrong-type" || p.id === "key-removed");
    if (r.refused !== found) wrong.push(`${r.path} = ${JSON.stringify(r.value)}: Codex ${r.refused ? "refuses" : "takes"} it (${r.message}), this tool ${found ? "refuses" : "takes"} it`);
    const old = rec.find((x) => x.path === r.path && JSON.stringify(x.value) === JSON.stringify(r.value));
    if (!old || old.refused !== r.refused) drift.push(`${r.path} = ${JSON.stringify(r.value)}`);
    void i;
  });
  assert.deepEqual(wrong, []);
  assert.deepEqual(drift, [], "the record is out of date: run test/record-oracles.mjs schema");
  assert.ok(live.length >= 190);
});
