// `cost`: what the first request carries before the user's words. The figures from the user's files are computed and the rest recorded
// (src/recorded.mjs); test/e2e-cost.test.mjs compares both with a real first request of Codex.
import test from "node:test";
import assert from "node:assert/strict";
import { cost, environmentChars, parseSkill, recordedFor, skillsBlock, tokens, toolList } from "../src/cost.mjs";
import { costDoc, costText } from "../src/report.mjs";
import { BASE_INSTRUCTIONS_CHARS, MCP_TOOLS } from "../src/recorded.mjs";
import { world } from "./world.mjs";

const row = (r, id) => r.rows.find((x) => x.id === id);
// the pretend machines of world() are Linux machines: the figures recorded on Linux
const REC = recordedFor("linux");
const TOOLS = REC.tools;
const PERMISSIONS_CHARS = REC.permissions;
const ENVIRONMENT_CHARS = REC.environment;
const ENVIRONMENT_CWD_CHARS = REC.cwdChars;

test("a token is four characters, rounded", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map(tokens), [0, 0, 1, 1, 1, 1, 2, 2, 2, 3]);
});

test("the rows add up to the total, and AGENTS.md is what the model gets", () => {
  const { c } = world({ "config.toml": "" });
  const r = cost(c);
  assert.deepEqual(r.rows.map((x) => x.id), ["base", "skills", "permissions", "agents", "environment", "tools", "mcp"]);
  assert.equal(r.total, r.rows.reduce((n, x) => n + (x.chars || 0), 0));
  assert.equal(r.totalTokens, tokens(r.total));
  assert.equal(row(r, "base").chars, BASE_INSTRUCTIONS_CHARS);
  assert.equal(row(r, "tools").chars, TOOLS.reduce((n, t) => n + t[1], 0) + TOOLS.length + 1, "the definitions are one JSON array");
  assert.equal(row(r, "agents").chars, c.agents.chars);
  assert.equal(row(r, "mcp").chars, null);
  assert.deepEqual(r.recorded, { codex: "0.163.0", model: "gpt-5.5", on: REC.on, system: REC.system, exact: REC.exact });
});

test("AGENTS.md: the figure follows the files that reach the model", () => {
  const none = cost(world({ "config.toml": "" }).c);
  assert.equal(row(none, "agents").chars, 0);
  assert.match(row(none, "agents").detail, /no AGENTS\.md/);
  const some = world({ "config.toml": "", "AGENTS.md": "Be brief.\n", "work/AGENTS.md": "x".repeat(1000) }).c;
  const r = cost(some);
  assert.equal(row(r, "agents").chars, some.agents.chars);
  assert.ok(row(r, "agents").chars > 1000);
  assert.equal(r.yours, some.agents.chars);
  assert.equal(r.yoursTokens, tokens(some.agents.chars));
});

test("permissions follow the approval policy and the sandbox; the environment follows the folder's path and the sandbox", () => {
  const perm = (top) => row(cost(world({ "config.toml": top }).c), "permissions").chars;
  const cwd = world({ "config.toml": "" }).c.world.dir.length;
  assert.equal(perm(""), PERMISSIONS_CHARS["on-request"]["workspace-write"] + (cwd - ENVIRONMENT_CWD_CHARS), "the workspace-write block names the folder once");
  assert.equal(perm('sandbox_mode = "read-only"\n'), PERMISSIONS_CHARS["on-request"]["read-only"]);
  assert.equal(perm('sandbox_mode = "danger-full-access"\n'), PERMISSIONS_CHARS["on-request"]["danger-full-access"]);
  assert.equal(perm('approval_policy = "never"\n'), PERMISSIONS_CHARS.never["workspace-write"] + (cwd - ENVIRONMENT_CWD_CHARS));
  assert.equal(environmentChars("x".repeat(ENVIRONMENT_CWD_CHARS), "read-only", "linux"), ENVIRONMENT_CHARS["read-only"]);
  assert.equal(environmentChars("x".repeat(ENVIRONMENT_CWD_CHARS + 10), "read-only", "linux"), ENVIRONMENT_CHARS["read-only"] + 20);
  assert.equal(environmentChars("x".repeat(ENVIRONMENT_CWD_CHARS + 10), "workspace-write", "linux"), ENVIRONMENT_CHARS["workspace-write"] + 70);
  assert.equal(environmentChars("x".repeat(ENVIRONMENT_CWD_CHARS - 2), "danger-full-access", "linux"), ENVIRONMENT_CHARS["danger-full-access"] - 4);
});

test("the skills block: the bundled skills alone, then yours, each with its line and its root", () => {
  const plain = skillsBlock(...pair({ "config.toml": "" }));
  assert.equal(plain.bundled, 4);
  assert.deepEqual(plain.yours, []);
  assert.match(plain.text, /^<skills_instructions>\n## Skills\n/);
  assert.match(plain.text, /### Skill roots\n- `r0` = `.*codex-home\/skills\/\.system`\n### Available skills\n- imagegen: /);
  assert.match(plain.text, /### How to use skills\n/);
  const withMine = skillsBlock(...pair({ "config.toml": "", "skills/review/SKILL.md": "---\nname: review\ndescription: Review a diff for bugs\n---\nbody that is not sent\n" }));
  assert.equal(withMine.yours.length, 1);
  assert.match(withMine.text, /- `r0` = `.*codex-home\/skills`\n- `r1` = `.*skills\/\.system`/);
  assert.match(withMine.text, /- review: Review a diff for bugs \(file: r0\/review\/SKILL\.md\)\n/);
  assert.ok(withMine.chars > plain.chars);
  // a longer path to the Codex home costs its length once more on the system root's line
  const long = skillsBlock(...pair({ "config.toml": "" }, { env: { CODEX_HOME: "/w/codex-home-with-a-longer-name" } }));
  assert.ok(long.chars > plain.chars);
});

test("the places skills are read from: the project's .codex/skills (trusted or not), the Codex home, ~/.agents/skills, and .agents/skills of the project folders", () => {
  const skill = (name) => `---\nname: ${name}\ndescription: skill ${name}\n---\n`;
  const files = {
    "config.toml": "",
    "work/.codex/skills/p/SKILL.md": skill("p"),
    "work/.agents/skills/q/SKILL.md": skill("q"),
    "skills/u/SKILL.md": skill("u"),
    "abs:/w/home/.agents/skills/h/SKILL.md": skill("h"),
  };
  for (const trusted of [true, false]) {
    const block = skillsBlock(...pair(files, { trusted }));
    assert.deepEqual(block.yours.map((s) => s.name), ["p", "q", "h", "u"], `trusted ${trusted}: the project's skills by name, then yours (the Codex home's and ~/.agents/skills together) by name`);
    assert.deepEqual(block.roots.map((r) => r.alias), ["r0", "r1", "r2", "r3", "r4"], `trusted ${trusted}: the project's .codex/skills, the Codex home, ~/.agents/skills, the bundled root, the project's .agents/skills`);
  }
});

test("the table of roots and the order of the list, with nested project folders", () => {
  const skill = (name) => `---\nname: ${name}\ndescription: skill ${name}\n---\n`;
  const files = {
    "config.toml": "",
    "work/.codex/skills/b-root-codex/SKILL.md": skill("b-root-codex"),
    "work/sub/.codex/skills/a-sub-codex/SKILL.md": skill("a-sub-codex"),
    "work/sub/deeper/.codex/skills/c-deeper-codex/SKILL.md": skill("c-deeper-codex"),
    "work/.agents/skills/e-root-agents/SKILL.md": skill("e-root-agents"),
    "work/sub/.agents/skills/d-sub-agents/SKILL.md": skill("d-sub-agents"),
    "work/other/.agents/skills/g-other/SKILL.md": skill("g-other"),
    "skills/h-user/SKILL.md": skill("h-user"),
    "skills/aaa-user/SKILL.md": skill("aaa-user"),
  };
  const { c } = world(files, { dir: "sub/deeper" });
  const block = skillsBlock(c.sys, c);
  assert.deepEqual(block.roots.map((r) => `${r.alias} ${r.dir.split(/[\\/]/).slice(-3).join("/")}`), [
    "r0 deeper/.codex/skills",
    "r1 sub/.codex/skills",
    "r2 work/.codex/skills",
    "r3 w/codex-home/skills",
    "r4 codex-home/skills/.system",
    "r5 work/.agents/skills",
    "r6 sub/.agents/skills",
  ], "the .codex folders from the working folder up, the Codex home, the bundled root, the .agents folders from the root down");
  assert.deepEqual(block.yours.map((s) => `${s.alias}/${s.name}`), ["r1/a-sub-codex", "r2/b-root-codex", "r0/c-deeper-codex", "r6/d-sub-agents", "r5/e-root-agents", "r3/aaa-user", "r3/h-user"], "the project's skills by name, then yours by name");
  assert.ok(block.text.indexOf("- imagegen:") < block.text.indexOf("- a-sub-codex:"), "the bundled skills come first");
});

test("hidden folders and a SKILL.MD are not skills; a nested folder is; the name is the one in the file", () => {
  const files = {
    "config.toml": "",
    "skills/.hidden/SKILL.md": "---\nname: hidden\ndescription: no\n---\n",
    "skills/upper/SKILL.MD": "---\nname: upper\ndescription: no\n---\n",
    "skills/group/nested/SKILL.md": "---\nname: nested\ndescription: yes\n---\n",
    "skills/folder-name/SKILL.md": "---\nname: other-name\ndescription: yes\n---\n",
    "skills/nodesc/SKILL.md": "---\nname: nodesc\n---\n",
  };
  for (const platform of ["linux", "win32"]) {
    const block = skillsBlock(...pair(files, { platform, extra: platform === "win32" ? { release: "10.0.26300" } : {} }));
    assert.deepEqual(block.yours.map((s) => `${s.name} ${s.rel}`), ["nested group/nested/SKILL.md", "other-name folder-name/SKILL.md"], platform);
  }
});

test("the web_search definition follows the configuration: 89 characters cached, 88 live, 114 indexed, none when disabled; live by default with full access", () => {
  const size = (top) => toolList(world({ "config.toml": top }).c).find((t) => t[0] === "web_search");
  assert.deepEqual(size(""), ["web_search", 89]);
  assert.deepEqual(size('web_search = "cached"\n'), ["web_search", 89]);
  assert.deepEqual(size('web_search = "live"\n'), ["web_search", 88]);
  assert.deepEqual(size('web_search = "indexed"\n'), ["web_search", 114]);
  assert.equal(size('web_search = "disabled"\n'), undefined);
  assert.deepEqual(size('sandbox_mode = "danger-full-access"\n'), ["web_search", 88]);
  assert.equal(toolList(world({ "config.toml": 'web_search = "disabled"\n' }).c).length, 9);
  const withLive = cost(world({ "config.toml": 'web_search = "live"\n' }).c);
  const cached = cost(world({ "config.toml": "" }).c);
  assert.equal(row(cached, "tools").chars - row(withLive, "tools").chars, 1);
});

test("a SKILL.md Codex would not list is not counted", () => {
  const f = (text) => parseSkill(text, "dir");
  assert.equal(f("no front matter"), null);
  assert.equal(f("---\nname: a\n---\n"), null);
  assert.equal(f("---\nname: a\ndescription:\n---\n"), null);
  assert.deepEqual(f("---\ndescription: only a description\n---\n"), { name: "dir", description: "only a description" });
  assert.deepEqual(f("---\nname: a\ndescription: \"quoted: text\"\n---\n"), { name: "a", description: "quoted: text" });
  assert.deepEqual(f("---\nname: a\ndescription: >\n  folded\n  over two lines\n---\n"), { name: "a", description: "folded over two lines" });
  assert.deepEqual(f("﻿---\r\nname: a\r\ndescription: with a byte order mark\r\n---\r\n"), { name: "a", description: "with a byte order mark" });
  const long = f(`---\nname: a\ndescription: ${"d".repeat(2000)}\n---\n`).description;
  assert.equal(long, `${"d".repeat(1021)}...`, "more than 1,024 characters: the first 1,021 and three dots");
  assert.equal(f(`---\nname: a\ndescription: ${"d".repeat(1024)}\n---\n`).description, "d".repeat(1024), "exactly 1,024 stays");
  assert.equal(f(`---\nname: a\ndescription: ${"é".repeat(1100)}\n---\n`).description, `${"é".repeat(1021)}...`, "characters, not bytes");
});

test("MCP servers: the three resource tools they bring are counted, their own tools are deferred and not measured", () => {
  const without = cost(world({ "config.toml": "" }).c);
  const files = { "config.toml": '[mcp_servers.a]\ncommand = "node"\n[mcp_servers.b]\ncommand = "y"\nenabled = false\n', "abs:/bin/node": "x" };
  const r = cost(world(files).c);
  assert.match(row(r, "mcp").label, /MCP servers \(1\)/);
  assert.equal(row(r, "mcp").chars, null);
  assert.match(row(r, "mcp").detail, /^a: the three resource tools they bring are counted under tool definitions; a server's own tools are not in the first request/);
  const names = row(r, "tools").items.map((t) => t.name);
  assert.deepEqual(names.slice(0, 5), ["exec_command", "write_stdin", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);
  const added = MCP_TOOLS.reduce((n, t) => n + t[1], 0);
  assert.equal(row(r, "tools").chars - row(without, "tools").chars, added + MCP_TOOLS.length + "a".length + 4, "three tools, their commas, and \"- a\" in the description of tool_search");
  // a server that is not found adds the tools and not its name; a server that is turned off adds nothing; the same for an http server
  const notFound = cost(world({ "config.toml": '[mcp_servers.gone]\ncommand = "nosuchprog"\n' }).c);
  assert.equal(row(notFound, "tools").chars - row(without, "tools").chars, added + MCP_TOOLS.length);
  const off = cost(world({ "config.toml": '[mcp_servers.a]\ncommand = "node"\nenabled = false\n', "abs:/bin/node": "x" }).c);
  assert.equal(row(off, "tools").chars, row(without, "tools").chars);
  const web = cost(world({ "config.toml": '[mcp_servers.web]\nurl = "http://127.0.0.1:1/mcp"\n' }).c);
  assert.equal(row(web, "tools").chars - row(without, "tools").chars, added + MCP_TOOLS.length + "web".length + 4);
  assert.equal(row(cost(world({ "config.toml": '[mcp_servers.x]\nargs = []\n' }).c), "tools").chars, row(without, "tools").chars, "an invalid server adds nothing");
});

test("the report: every row, the total, and a line for what is yours", () => {
  const { c } = world({ "config.toml": "", "AGENTS.md": "abc" });
  const r = cost(c);
  const doc = costDoc(c, r);
  assert.equal(doc.total, r.total);
  assert.equal(doc.rows.length, 7);
  const text = costText(c, r);
  for (const label of ["Base instructions", "Skills", "Permissions", "AGENTS.md", "Environment", "Tool definitions (10)", "MCP servers (0)", "Total"]) assert.ok(text.includes(label), label);
  assert.match(text, /Yours \(AGENTS\.md and your skills\): \d[\d,]* characters, about \d[\d,]* tokens/);
  assert.match(text, /Tokens are characters \/ 4, an estimate/);
});

function pair(files, o) {
  const { c } = world(files, o);
  return [c.sys, c];
}
