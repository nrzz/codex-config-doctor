// AGENTS.md, put to the real Codex: the message `agents --print` prints is the one Codex builds, character for character, in worlds with a
// global file, files in several folders, a file that crosses the cap, an override, an empty file, a fallback name and a file that is not
// UTF-8; and the findings about the files say what Codex did with them. `codex debug prompt-input` prints what the model is given
// without a request. The hash, size and ends of 44 more worlds are in test/e2e-tables.test.mjs.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { collect } from "../src/collect.mjs";
import { lintWorld, sysFor } from "./behave.mjs";
import { gitInit, promptInput, put, sandbox, skip } from "./codex-sandbox.mjs";
import { firstDifference } from "./measure.mjs";
import { homeEnv, runCli } from "./helpers.mjs";

const opts = { skip: skip() };

/** A world, built by `setup(sb)`; Codex's message for it and the tool's. */
async function both(setup, { cwd = "" } = {}) {
  const sb = sandbox("e2e-agents");
  gitInit(sb);
  setup(sb);
  const dir = cwd ? path.join(sb.work, ...cwd.split("/")) : sb.work;
  fs.mkdirSync(dir, { recursive: true });
  const live = await promptInput(sb, { cwd: dir });
  assert.equal(live.code, 0, live.err);
  const c = collect(sysFor(sb), { project: dir });
  return { sb, dir, live, c, lint: lintWorld(sb, { project: dir }) };
}
const AG = (sb, rel, text) => put(path.join(sb.work, ...rel.split("/")), text);
const HOME_AG = (sb, name, text) => put(path.join(sb.codexHome, name), text);

const WORLDS = [
  ["no file at all", () => {}],
  ["a global file and one in the project", (sb) => { HOME_AG(sb, "AGENTS.md", "Global: be brief.\n"); AG(sb, "AGENTS.md", "Project: run the tests.\n"); }],
  ["files in three folders, working in the deepest", (sb) => { AG(sb, "AGENTS.md", "root\n"); AG(sb, "a/AGENTS.md", "a\n"); AG(sb, "a/b/AGENTS.md", "ab\n"); }, { cwd: "a/b" }],
  ["an override in front of a file", (sb) => { AG(sb, "AGENTS.md", "plain\n"); AG(sb, "AGENTS.override.md", "override\n"); }],
  ["a fallback name", (sb) => { fs.writeFileSync(sb.user, `${fs.existsSync(sb.user) ? fs.readFileSync(sb.user, "utf8") : ""}project_doc_fallback_filenames = ["TEAM.md"]\n`); AG(sb, "TEAM.md", "team\n"); }],
  ["CRLF line endings and a byte order mark", (sb) => AG(sb, "AGENTS.md", "﻿one\r\ntwo\r\n")],
  ["a file that is not UTF-8", (sb) => AG(sb, "AGENTS.md", Buffer.from([0x68, 0x69, 0xff, 0x21, 0x0a]))],
  ["a small cap crossed by the second file", (sb) => { fs.writeFileSync(sb.user, "project_doc_max_bytes = 40\n"); AG(sb, "AGENTS.md", "0123456789012345678901234567890123456789\n"); AG(sb, "a/AGENTS.md", "second file text that does not fit\n"); }, { cwd: "a" }],
  ["an empty file in front of a full one", (sb) => { AG(sb, "AGENTS.override.md", ""); AG(sb, "AGENTS.md", "hidden by the empty override\n"); }],
];

for (const [name, setup, o] of WORLDS) {
  test(`agents: Codex's message is the tool's, character for character: ${name}`, opts, async () => {
    const w = await both(setup, o);
    if (w.live.agents === null) { assert.equal(w.c.agents.text, null); return; }
    assert.equal(firstDifference(w.c.agents.text, w.live.agents), "");
  });
}

test("agents --print prints the message Codex builds", opts, async () => {
  const w = await both((sb) => { HOME_AG(sb, "AGENTS.md", "Global.\n"); AG(sb, "AGENTS.md", "Project.\n"); });
  const r = runCli(["agents", "--print", "--project", w.sb.work], { cwd: w.sb.work, env: { ...homeEnv(w.sb.home, w.sb.codexHome), ProgramData: path.join(w.sb.root, "pd") } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `${w.live.agents}\n`);
});

test("agents-md-over-cap: the file that crosses the cap is the one lint names, and the bytes are Codex's", opts, async () => {
  const w = await both((sb) => { fs.writeFileSync(sb.user, "project_doc_max_bytes = 100\n"); AG(sb, "AGENTS.md", `${"x".repeat(60)}\n`); AG(sb, "a/AGENTS.md", `${"y".repeat(80)}\n`); AG(sb, "a/b/AGENTS.md", "never read\n"); }, { cwd: "a/b" });
  const found = w.lint.find("agents-md-over-cap");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /a[\\/]AGENTS\.md is the first file that does not fit/);
  const body = /<INSTRUCTIONS>\n([\s\S]*)\n<\/INSTRUCTIONS>/.exec(w.live.agents)[1];
  assert.ok(body.includes("x".repeat(60)));
  assert.ok(body.includes("y".repeat(39)) && !body.includes("y".repeat(40)), "the second file is cut where the cap is used up");
  assert.ok(!body.includes("never read"));
  assert.equal(w.c.agents.files.map((f) => f.status).join(","), "included,cut,left-out");
});

test("agents-md-empty, agents-md-shadowed and agents-md-encoding: what Codex does with each", opts, async () => {
  const empty = await both((sb) => AG(sb, "AGENTS.md", "  \n\n"));
  assert.equal(empty.live.agents, null, "a file with only white space adds nothing");
  assert.equal(empty.lint.find("agents-md-empty").length, 1);
  const hidden = await both((sb) => { AG(sb, "AGENTS.md", "full\n"); AG(sb, "AGENTS.override.md", ""); });
  assert.equal(hidden.live.agents, null, "an empty override hides a full AGENTS.md in the same folder");
  assert.equal(hidden.lint.find("agents-md-shadowed")[0].severity, "warning");
  const both2 = await both((sb) => { AG(sb, "AGENTS.md", "full\n"); AG(sb, "AGENTS.override.md", "override\n"); });
  assert.match(both2.live.agents, /override/);
  assert.doesNotMatch(both2.live.agents, /full/);
  assert.equal(both2.lint.find("agents-md-shadowed")[0].severity, "note");
  const globalEmpty = await both((sb) => { HOME_AG(sb, "AGENTS.override.md", ""); HOME_AG(sb, "AGENTS.md", "global full\n"); });
  assert.match(globalEmpty.live.agents, /global full/, "in the Codex home an empty override does not hide AGENTS.md");
  const utf16 = await both((sb) => AG(sb, "AGENTS.md", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello\n", "utf16le")])));
  assert.match(utf16.live.agents, /�/, "UTF-16 reaches the model as replacement characters");
  assert.equal(utf16.lint.find("agents-md-encoding")[0].severity, "warning");
});
