// `cost`, put to the real Codex: the first request of a session is captured (a `codex exec` run and a thread of the app server, against the
// fake Responses API) and its parts are compared with what the tool computes from the same folder: the AGENTS.md message and the skills block
// character for character, the figures it takes from src/recorded.mjs by size. A different Codex shows up here as a figure that moved.
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { collect } from "../src/collect.mjs";
import { cost, recordedFor, skillsBlock, toolList } from "../src/cost.mjs";
import { BASE_INSTRUCTIONS_CHARS, RECORDED_CODEX } from "../src/recorded.mjs";
import { sysFor } from "./behave.mjs";
import { skip, put } from "./codex-sandbox.mjs";
import { SANDBOX_MODES, captureExec, captureThread, firstDifference, writeSkill } from "./measure.mjs";

const opts = { skip: skip() };
const row = (r, id) => r.rows.find((x) => x.id === id);
const worldOf = (cap) => collect(sysFor(cap.sb), { project: cap.cwd });
const TIMES = { "read-only": 2, "workspace-write": 7, "danger-full-access": 2 };
// the figures recorded on the system these checks run on
const REC = recordedFor(process.platform);
const ENVIRONMENT_CWD_CHARS = REC.cwdChars;
// the environment block holds the name of the time zone and of the shell, which differ from one machine to another by a few characters
const ENVIRONMENT_SLACK = 20;
const nearly = (actual, expected, what) => assert.ok(Math.abs(actual - expected) <= ENVIRONMENT_SLACK, `${what}: ${actual} against ${expected}`);

test("the recorded figures are what this Codex sends: base instructions, tools, permissions and environment, for each sandbox", opts, async () => {
  assert.equal(REC.exact, true, `src/recorded.mjs has no figures for ${process.platform}: run E2E_CODEX=... node test/record-oracles.mjs recorded on this system`);
  const seen = [];
  for (const mode of SANDBOX_MODES) {
    const cap = await captureExec({ sandboxMode: mode });
    const { parts } = cap;
    seen.push(`${mode}: base ${parts.chars.base}, tools ${parts.toolsChars}`);
    assert.equal(parts.chars.base, BASE_INSTRUCTIONS_CHARS, `${mode}: the base instructions`);
    assert.deepEqual(parts.tools, toolList(worldOf(cap)), `${mode}: the tool definitions, by name and size`);
    const shift = mode === "workspace-write" ? cap.cwd.length - ENVIRONMENT_CWD_CHARS : 0;
    assert.equal(parts.chars.permissions, REC.permissions.never[mode] + shift, `${mode}: the permissions block of codex exec (approval never)`);
    nearly(parts.chars.environment, REC.environment[mode] + TIMES[mode] * (cap.cwd.length - ENVIRONMENT_CWD_CHARS), `${mode}: the environment block; the folder of the run is ${cap.cwd}; Codex sent ${JSON.stringify(parts.text.environment.slice(0, 400))}`);
    assert.equal(parts.model, "gpt-5.5");
  }
  console.log(`# Codex ${RECORDED_CODEX} recorded; now ${seen.join("; ")}`);
});

test("the web_search definition: 89 characters cached, 88 live (the default with full access), 114 indexed, none when disabled", opts, async () => {
  for (const [top, mode] of [["", "read-only"], ['web_search = "cached"\n', "workspace-write"], ['web_search = "live"\n', "read-only"], ['web_search = "indexed"\n', "read-only"], ['web_search = "disabled"\n', "read-only"], ["", "danger-full-access"], ['web_search = "cached"\n', "danger-full-access"], ['web_search = "disabled"\n', "danger-full-access"]]) {
    const cap = await captureExec({ sandboxMode: mode, config: { top }, label: "e2e-cost-search" });
    const c = worldOf(cap);
    assert.deepEqual(cap.parts.tools, toolList(c), `${mode} ${top.trim() || "(default)"}`);
    assert.equal(row(cost(c), "tools").chars, cap.parts.toolsJsonChars, `${mode} ${top.trim() || "(default)"}: the row`);
  }
});

test("the permissions block of the other approval policies (the app server) is the recorded one", opts, async () => {
  for (const mode of SANDBOX_MODES) {
    const cap = await captureThread({ sandboxMode: mode });
    const shift = mode === "workspace-write" ? cap.cwd.length - ENVIRONMENT_CWD_CHARS : 0;
    assert.equal(cap.parts.chars.permissions, REC.permissions["on-request"][mode] + shift, `${mode}, on-request`);
    const c = worldOf(cap);
    assert.equal(row(cost(c), "permissions").chars, cap.parts.chars.permissions, `${mode}: cost`);
  }
});

test("cost: every row that is computed or sized agrees with the first request of a world with AGENTS.md files and skills", opts, async () => {
  const cap = await captureExec({
    sandboxMode: "workspace-write",
    label: "e2e-cost-world",
    setup: (sb) => {
      put(path.join(sb.codexHome, "AGENTS.md"), "Global: be brief.\n");
      put(path.join(sb.work, "AGENTS.md"), `Project rules.\n${"Use the existing helpers. ".repeat(40)}\n`);
      writeSkill(path.join(sb.codexHome, "skills"), "review", "Review a diff for bugs and missing tests");
      writeSkill(path.join(sb.work, ".agents", "skills"), "release", "Prepare a release: bump the version, write the changelog, tag it");
    },
  });
  const c = worldOf(cap);
  const r = cost(c);
  assert.equal(row(r, "base").chars, cap.parts.chars.base);
  assert.equal(row(r, "agents").chars, cap.parts.chars.agents, "the AGENTS.md message");
  assert.equal(firstDifference(c.agents.text, cap.parts.text.agents), "", "the AGENTS.md message, character for character");
  assert.equal(row(r, "skills").chars, cap.parts.chars.skills, "the skills block");
  assert.equal(firstDifference(skillsBlock(c.sys, c).text, cap.parts.text.skills), "", "the skills block, character for character");
  assert.equal(row(r, "permissions").chars, cap.parts.chars.permissions);
  nearly(row(r, "environment").chars, cap.parts.chars.environment, "the environment block");
  assert.equal(row(r, "tools").chars, cap.parts.toolsJsonChars);
  const ratio = r.total / cap.parts.requestChars;
  console.log(`# the rows add up to ${r.total} characters; the whole request is ${cap.parts.requestChars} characters of JSON (${(ratio * 100).toFixed(1)}%)`);
  assert.ok(ratio > 0.9 && ratio <= 1.0, `the rows are ${(ratio * 100).toFixed(1)}% of the request`);
});

const S = (dir, name, description = `Skill ${name}`) => writeSkill(dir, name, description);

test("the skills block, character for character, for the places Codex looks in", opts, async () => {
  const worlds = [
    ["no skills of your own", {}, () => {}],
    ["a skill in the Codex home", {}, (sb) => S(path.join(sb.codexHome, "skills"), "alpha")],
    ["a skill in the repository's .agents/skills", {}, (sb) => S(path.join(sb.work, ".agents", "skills"), "beta")],
    ["a skill in the project's .codex/skills, project not trusted", {}, (sb) => S(path.join(sb.work, ".codex", "skills"), "gamma")],
    ["the same skill in the user's and the repository's", {}, (sb) => { S(path.join(sb.codexHome, "skills"), "same"); S(path.join(sb.work, ".agents", "skills"), "same"); }],
    ["a skill in ~/.agents/skills and one in the Codex home", { notOnWindows: true }, (sb) => { S(path.join(sb.home, ".agents", "skills"), "homeone"); S(path.join(sb.codexHome, "skills"), "useone"); }],
    ["a description of 3,000 characters", {}, (sb) => S(path.join(sb.codexHome, "skills"), "long", "x".repeat(3000))],
    ["a SKILL.md with no front matter, a hidden folder, a SKILL.MD", {}, (sb) => {
      put(path.join(sb.codexHome, "skills", "plain", "SKILL.md"), "just text\n");
      put(path.join(sb.codexHome, "skills", ".hidden", "SKILL.md"), "---\nname: hidden\ndescription: Hidden\n---\n");
      put(path.join(sb.codexHome, "skills", "upper", "SKILL.MD"), "---\nname: upper\ndescription: Upper\n---\n");
      S(path.join(sb.codexHome, "skills"), "fine");
    }],
    ["a folded description, a nested folder, a name that differs from the folder", {}, (sb) => {
      put(path.join(sb.codexHome, "skills", "folded", "SKILL.md"), "---\nname: folded\ndescription: >\n  one line\n  continued\n---\nbody\n");
      put(path.join(sb.codexHome, "skills", "group", "nested", "SKILL.md"), "---\nname: nested\ndescription: A nested skill\n---\n");
      put(path.join(sb.codexHome, "skills", "folder-name", "SKILL.md"), "---\nname: other-name\ndescription: Name differs\n---\n");
    }],
    ["project folders: .codex/skills and .agents/skills at three levels, and the user's", { subdir: "sub/deeper" }, (sb) => {
      S(path.join(sb.work, ".codex", "skills"), "b-root-codex");
      S(path.join(sb.work, "sub", ".codex", "skills"), "a-sub-codex");
      S(path.join(sb.work, "sub", "deeper", ".codex", "skills"), "c-deeper-codex");
      S(path.join(sb.work, ".agents", "skills"), "e-root-agents");
      S(path.join(sb.work, "sub", ".agents", "skills"), "d-sub-agents");
      S(path.join(sb.work, "sub", "deeper", ".agents", "skills"), "f-deeper-agents");
      S(path.join(sb.work, "other", ".agents", "skills"), "g-other-agents");
      S(path.join(sb.codexHome, "skills"), "h-user");
      S(path.join(sb.codexHome, "skills"), "aaa-user");
    }],
  ];
  for (const [what, extra, setup] of worlds) {
    // Codex on Windows opens the profile folder that Windows reports, not the one in USERPROFILE: a throwaway home cannot hold ~/.agents/skills there
    if (extra.notOnWindows && process.platform === "win32") continue;
    const cap = await captureExec({ sandboxMode: "read-only", setup, subdir: extra.subdir, label: "e2e-cost-skills" });
    const c = worldOf(cap);
    const mine = skillsBlock(c.sys, c).text;
    const diff = firstDifference(mine, cap.parts.text.skills);
    // on a difference, both lists of roots and skills are in the message, with the throwaway folder shortened
    const middle = (s) => s.slice(s.indexOf("### Skill roots"), s.indexOf("### How to use skills")).split(cap.sb.root).join("<root>").replace(/- (imagegen|openai-docs|skill-creator|skill-installer): .*\n/g, "- $1: ...\n");
    assert.equal(diff, "", `${what}\nthis tool:\n${middle(mine)}\nCodex:\n${middle(cap.parts.text.skills)}`);
  }
});

test("the environment block grows with the folder's path as the tool says: twice, seven times in workspace-write", opts, async () => {
  const short = await captureExec({ sandboxMode: "read-only", label: "e2e-cost-env" });
  const long = await captureExec({ sandboxMode: "read-only", label: "e2e-cost-env-with-a-much-longer-name-than-before" });
  const grown = long.cwd.length - short.cwd.length;
  assert.ok(grown >= 20);
  assert.equal(long.parts.chars.environment - short.parts.chars.environment, 2 * grown);
  const wwShort = await captureExec({ sandboxMode: "workspace-write", label: "e2e-cost-env" });
  const wwLong = await captureExec({ sandboxMode: "workspace-write", label: "e2e-cost-env-with-a-much-longer-name-than-before" });
  const wwGrown = wwLong.cwd.length - wwShort.cwd.length;
  assert.equal(wwLong.parts.chars.environment - wwShort.parts.chars.environment, 7 * wwGrown);
  assert.equal(wwLong.parts.chars.permissions - wwShort.parts.chars.permissions, wwGrown);
});
