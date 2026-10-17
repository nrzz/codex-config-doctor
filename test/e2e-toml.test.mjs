// The TOML reader (src/toml.mjs) against the Codex that runs now: every case of test/toml-table.mjs is written as a config.toml and read by
// `codex debug prompt-input`; the reader must accept and reject the same files, and name the same line for an error. The record the unit
// tests use (test/fixtures/toml-oracle.json) must be what Codex says today.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { PARALLEL, askToml, pool } from "./ask.mjs";
import { skip } from "./codex-sandbox.mjs";
import { ROOT } from "./helpers.mjs";
import { parseToml } from "../src/toml.mjs";
import { CASES } from "./toml-table.mjs";

test("every case of the table: this reader and Codex accept and reject the same files, at the same line", { skip: skip() }, async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "toml-oracle.json"), "utf8"));
  const live = await pool(CASES, PARALLEL, ([name, text]) => askToml(name, text));
  // Codex names the line after a string that holds a newline (it reads on to the next line); this reader names the line of the string
  const lineDiffers = new Set(["basic string with a raw newline"]);
  const wrong = [];
  const drift = [];
  CASES.forEach(([name, text], i) => {
    const codex = live[i];
    const mine = parseToml(text);
    if (mine.ok !== codex.valid) wrong.push(`${name}: Codex ${codex.valid ? "accepts" : "rejects"} it`);
    else if (!codex.valid && !lineDiffers.has(name) && mine.error.line !== codex.line) wrong.push(`${name}: Codex says line ${codex.line}, this says ${mine.error.line}`);
    const rec = fixture.cases.find((c) => c.name === name);
    if (!rec || rec.valid !== codex.valid || rec.line !== codex.line) drift.push(`${name}: the record says ${JSON.stringify(rec && { valid: rec.valid, line: rec.line })}, Codex says ${JSON.stringify({ valid: codex.valid, line: codex.line })}`);
  });
  assert.deepEqual(wrong, [], "this reader and Codex differ");
  assert.deepEqual(drift, [], "the record is out of date: run test/record-oracles.mjs toml");
  assert.ok(live.filter((c) => c.valid).length > 60 && live.filter((c) => !c.valid).length > 40);
});
