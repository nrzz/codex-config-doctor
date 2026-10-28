// The README, held to the code: its sections, the commands and options it names, the usage block, the numbers it quotes, the table of
// findings, the JSON shapes, the examples (they are what the code prints), the Files table and the numbers of the tables of cases.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./helpers.mjs";
import { HELP, main } from "../src/cli.mjs";
import { CATALOG, IDS } from "../src/catalog.mjs";
import { BANNED_PREFIXES, FEATURES, IGNORED_IN_PROJECT } from "../src/knowledge.mjs";
import { markdownBound } from "../src/report.mjs";
import { exampleMachine, exampleWindows } from "./examples.mjs";
import { fakeSys } from "./fakesys.mjs";
import { machine } from "./world.mjs";

const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const readme = rd("README.md");
const n = (x) => x.toLocaleString("en-US");
const fixture = (name) => JSON.parse(rd(`test/fixtures/${name}`));

/** Runs the command line in this process on a pretend machine: { code, out } with standard output and error together. */
async function run(argv, sys) {
  const out = [];
  const write = { write: (s) => out.push(s) };
  const code = await main(argv, { sys, stdout: write, stderr: write });
  return { code, out: out.join("") };
}

const readdirE2e = () => fs.readdirSync(path.join(ROOT, "test")).filter((f) => /^e2e-.*\.test\.mjs$/.test(f)).length;

const README_SECTIONS = ["## What you get", "## What it costs in tokens", "## Install", "## Use", "## How it works", "## What was verified, and how", "## Not verified", "## Files", "## Contributing", "## Also by the same author", "## License"];

test("the README has the sections the house keeps, in order, with the Privacy heading under How it works", () => {
  let at = -1;
  for (const h of README_SECTIONS) {
    const i = readme.indexOf(`\n${h}\n`);
    assert.ok(i > at, `${h} is there, after the one before it`);
    at = i;
  }
  assert.match(readme, /^# codex-config-doctor\n/);
  const how = readme.indexOf("\n## How it works\n");
  const verified = readme.indexOf("\n## What was verified, and how\n");
  for (const h of ["### Privacy", "### What `lint` finds"]) {
    const i = readme.indexOf(`\n${h}\n`);
    assert.ok(i > how && i < verified, `${h} sits under How it works`);
  }
  assert.ok(!readme.includes("@@"), "a placeholder is still in the README");
  assert.ok(!readme.includes("TBD"), "a value is still to be filled in");
});

test("the README names every command and option, the install lines, the numbers of the opening paragraph, and uses plain words", () => {
  for (const cmd of ["show", "lint", "why", "agents", "cost", "explain"]) assert.ok(readme.includes(`### \`${cmd}\``), `a heading for ${cmd}`);
  for (const flag of ["--json", "--project", "--profile", "--markdown", "--shell", "--print", "--list"]) assert.ok(readme.includes(flag), flag);
  for (const cmd of ["show", "lint", "why", "agents", "cost", "explain"]) assert.ok(readme.includes(`codex-config-doctor ${cmd}`), cmd);
  assert.ok(readme.includes("npx -y github:nrzz/codex-config-doctor show"));
  assert.ok(readme.includes("npx -y github:nrzz/codex-config-doctor lint"));
  assert.ok(readme.includes("git clone https://github.com/nrzz/codex-config-doctor"));
  const opening = readme.slice(0, readme.indexOf("\n## What you get\n"));
  for (const word of ["129,639 stars", "23,030 open issues", "#13386", "12 reactions", "#54755", "#50303", "17 October 2026", "codex doctor", "--strict-config", "four", "eight configurations"]) assert.ok(opening.includes(word), word);
  assert.ok(!/\p{Extended_Pictographic}/u.test(readme), "no emoji");
  assert.ok(!/\b(simply|easily|blazing|seamless|powerful|amazing|revolutionary)\b/i.test(readme), "plain words");
});

test("Also by the same author: the toolkit hub, with its number of tools, and the two closest tools", () => {
  const section = readme.slice(readme.indexOf("\n## Also by the same author\n"), readme.indexOf("\n## License\n"));
  assert.ok(section.includes("[claude-code-toolkit](https://github.com/nrzz/claude-code-toolkit)"));
  assert.ok(section.includes("nineteen tools for Claude Code"));
  assert.ok(section.includes("[claude-settings-doctor](https://github.com/nrzz/claude-settings-doctor)"));
  assert.ok(section.includes("[claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor)"));
});

test("the links in the README that point into the repository go to files that are there", () => {
  for (const m of readme.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) assert.ok(exists(m[1].split("#")[0]), `${m[1]} is linked and exists`);
});

test("the usage block of the README is the help text of the CLI", async () => {
  const help = (await run(["--help"], exampleMachine())).out;
  const usage = help.slice(help.indexOf("Usage: codex-config-doctor")).trimEnd();
  assert.ok(readme.includes(usage), "the README's usage block is out of date: paste the output of codex-config-doctor --help from its Usage line");
  assert.equal(HELP, help);
});

// ---- the numbers ----------------------------------------------------------------------------------------------------------------

test("what the token table says: the bound of lint --markdown, and the report of the example project", async () => {
  const md = (await run(["lint", "--markdown"], exampleMachine())).out;
  const bound = markdownBound(0);
  assert.ok(readme.includes(`at most ${n(bound)} characters plus the length of the project path`), `the bound is ${bound}`);
  assert.ok(readme.includes(`about ${n(Math.round(bound / 4))} tokens by characters / 4`));
  assert.ok(readme.includes(`is ${n(md.length)} characters, about ${n(Math.round(md.length / 4))} tokens`), `the example report is ${md.length} characters`);
  // the worst case: twenty findings with long messages stay under the bound
  const keys = Array.from({ length: 20 }, (_, i) => `bogus_key_${i} = ${i}`).join("\n");
  const m = machine({ "config.toml": `${keys}\n` });
  const project = m.j("work");
  const worst = (await run(["lint", "--markdown"], m.sys)).out;
  assert.ok(worst.length <= markdownBound(project.length), `${worst.length} <= ${markdownBound(project.length)}`);
  assert.ok(worst.split("\n").every((l) => l.length <= 500));
});

test("the numbers of the tables of cases and of the catalogue that the README quotes", () => {
  const toml = fixture("toml-oracle.json");
  const schema = fixture("schema-oracle.json");
  const layers = fixture("layers-oracle.json");
  const agents = fixture("agents-oracle.json");
  const rules = fixture("rules-oracle.json");
  const hooks = fixture("hooks-oracle.json");
  const covers = schema.groups.reduce((x, g) => x + g.covers, 0);
  const said = (text) => assert.ok(readme.includes(text), `the README says "${text}"`);
  said(`${toml.cases.length} files that Codex accepted or rejected`);
  said(`${covers} keys in seven groups`);
  assert.equal(schema.groups.length, 7);
  said(`${schema.typos.length} typos`);
  said(`${schema.wrong.length} values of the wrong type`);
  said(`${layers.scenarios.length} worlds: which folders Codex loads`);
  said(`${agents.scenarios.length} worlds, byte for byte`);
  said(`${rules.cases.length} commands under nine rule sets, and ${Object.keys(rules.files).length} rules files`);
  assert.equal(Object.keys(rules.policies).length, 9);
  said(`the hooks (${hooks.scenarios.length} worlds`);
  said(`${BANNED_PREFIXES.length} prefixes`);
  said(`${Object.keys(FEATURES).length} feature flags (${Object.values(FEATURES).filter((f) => f.stage === "removed").length} of them removed`);
  said(`${IDS.length} findings`);
  said(`${IDS.filter((id) => CATALOG[id].basis === "binary").length} rest on the real binary and two on the documentation`);
  assert.equal(IDS.filter((id) => CATALOG[id].basis === "docs").length, 2);
  said(`explain --list\` lists the ${IDS.length} ids`);
  assert.equal(IGNORED_IN_PROJECT.length, 10);
  said("Ten keys are ignored in a project");
});

test("the number of tests the README states is the runner's total minus the helper files that node --test lists as tests", { skip: process.env.CCD_COUNTING && "this is the run that counts" }, () => {
  const env = { ...process.env, CCD_COUNTING: "1" };
  delete env.E2E_CODEX;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test"], { cwd: ROOT, env, encoding: "utf8", timeout: 600000, windowsHide: true });
  const field = (name) => Number((new RegExp(`^(?:# |ℹ )${name} (\\d+)$`, "m").exec(r.stdout) || [])[1]);
  const total = field("tests");
  assert.ok(total > 100, `the runner reported ${total} tests:\n${r.stdout.slice(-600)}`);
  const helpers = fs.readdirSync(path.join(ROOT, "test")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")).length;
  const counted = total - helpers;
  // this test is skipped in the run that counted it, and passes in the run of the README's reader
  const skipped = field("skipped") - 1;
  const passed = field("pass") + 1 - helpers;
  const win = process.platform === "win32";
  const mine = win ? "on Windows" : "on Linux and macOS";
  const summary = `this system (${process.platform}): the runner reported ${total} tests, ${helpers} of them helper files, so ${counted} tests, of which ${passed} pass and ${skipped} are skipped`;
  assert.equal(field("fail"), 0, `the counting run had failures:\n${r.stdout.slice(-1500)}`);
  assert.equal(passed + skipped, counted, `every test passes or is skipped: ${summary}`);
  // the real-binary checks are registered differently on Windows (some rows and checks are about Windows), so the README gives both numbers
  const stated = /\*\*(\d+) automated tests\*\* on Windows and \*\*(\d+)\*\* on Linux and macOS/.exec(readme);
  assert.ok(stated, `the README says how many automated tests there are, on Windows and elsewhere: ${summary}`);
  assert.equal(Number(stated[win ? 1 : 2]), counted, summary);
  assert.ok(readme.includes(`each of the ${helpers} helper files`), `the README names the ${helpers} helper files: ${summary}`);
  const totals = /the runner's total was (\d+) on Windows and (\d+) on Linux and macOS/.exec(readme);
  assert.ok(totals, `the README gives the runner's total: ${summary}`);
  assert.equal(Number(totals[win ? 1 : 2]), total, summary);
  assert.ok(readme.includes(`${mine} ${passed} pass and ${skipped} are skipped`), `the README says "${mine} ${passed} pass and ${skipped} are skipped": ${summary}`);
  // without a binary every real-binary check is skipped, and nothing else is: the skipped tests are the ones that run Codex
  const e2e = /\*\*(\d+) tests that run the real binary\*\* on Windows and \*\*(\d+)\*\* on Linux and macOS/.exec(readme);
  assert.ok(e2e, `the README says how many tests run the real binary: ${summary}`);
  assert.equal(Number(e2e[win ? 1 : 2]), skipped, summary);
  assert.equal(readdirE2e(), 13, "13 files");
});

// ---- the findings -----------------------------------------------------------------------------------------------------------------

test("the README lists every finding that lint can emit, with the severity, the basis and the words of the catalogue, and no other", () => {
  const section = readme.slice(readme.indexOf("\n### What `lint` finds\n"), readme.indexOf("\n## What was verified, and how\n"));
  const rows = [...section.matchAll(/^\| `([a-z0-9-]+)` \| (error|warning|note) \| (binary|docs) \| (.+) \|$/gm)].map((m) => ({ id: m[1], severity: m[2], basis: m[3], what: m[4] }));
  assert.deepEqual(rows.map((r) => r.id), IDS, "the ids of the README and of the catalogue are the same, in the same order");
  for (const r of rows) assert.deepEqual({ severity: r.severity, basis: r.basis, what: r.what }, { severity: CATALOG[r.id].severity, basis: CATALOG[r.id].basis, what: CATALOG[r.id].title }, r.id);
});

// ---- the JSON documents -----------------------------------------------------------------------------------------------------------

/** The shapes of the README: { field, field?, field: { ... }, field: [ { ... } ], <key>: ... } into a tree. */
function parseShape(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const value = () => {
    ws();
    const nul = /^null\s*\|\s*/.exec(text.slice(i));
    if (nul) i += nul[0].length;
    if (text[i] === "{") return object();
    if (text[i] === "[") {
      i++; ws();
      let item = { kind: "leaf" };
      if (text[i] === "{") item = object();
      ws();
      if (text[i] !== "]") throw new Error(`] expected at: ${text.slice(i, i + 40)}`);
      i++;
      return { kind: "list", item };
    }
    throw new Error(`a { or a [ expected at: ${text.slice(i, i + 40)}`);
  };
  const object = () => {
    i++;
    const fields = {};
    for (;;) {
      ws();
      if (text[i] === "}") { i++; return { kind: "object", fields }; }
      if (text[i] === ",") { i++; continue; }
      const m = /^(<[a-z]+>|[A-Za-z_][A-Za-z0-9_]*)(\?)?/.exec(text.slice(i));
      if (!m) throw new Error(`a field name expected at: ${text.slice(i, i + 40)}`);
      i += m[0].length; ws();
      let node = { kind: "leaf" };
      if (text[i] === ":") { i++; node = value(); }
      fields[m[1]] = { optional: Boolean(m[2]), node };
    }
  };
  return value();
}

/** Hold the documents to a shape: every key of a document is in the shape, every key of the shape that is not optional is in some document. */
function holdTo(node, samples, where, errors) {
  if (node.kind === "object") {
    const objects = samples.filter((v) => v && typeof v === "object" && !Array.isArray(v));
    const named = Object.keys(node.fields).filter((k) => !k.startsWith("<"));
    const wildcard = Object.keys(node.fields).find((k) => k.startsWith("<"));
    const seen = new Set();
    for (const o of objects) {
      for (const k of Object.keys(o)) {
        seen.add(k);
        if (!named.includes(k) && !wildcard) errors.push(`${where}: "${k}" is in a document and not in the README shape`);
      }
    }
    for (const name of named) {
      const spec = node.fields[name];
      if (!spec.optional && !seen.has(name)) errors.push(`${where}: "${name}" is in the README shape and in no document (mark it with ? if it is optional)`);
      if (spec.node.kind !== "leaf") holdTo(spec.node, objects.map((o) => o[name]).filter((v) => v !== undefined && v !== null), `${where}.${name}`, errors);
    }
    if (wildcard && node.fields[wildcard].node.kind !== "leaf") {
      const rest = objects.flatMap((o) => Object.entries(o).filter(([k]) => !named.includes(k)).map(([, v]) => v));
      holdTo(node.fields[wildcard].node, rest, `${where}.${wildcard}`, errors);
    }
  } else if (node.kind === "list") {
    const items = samples.filter(Array.isArray).flat();
    if (node.item.kind !== "leaf") holdTo(node.item, items, `${where}[]`, errors);
  }
}

/** A busier machine than the example: a profile, a custom provider, an HTTP MCP server, both hook formats, a file that does not load. */
function busyMachine() {
  const m = machine({
    "config.toml": [
      'model = "gpt-5.5"', 'approval_policy = "never"', "project_doc_max_bytes = 40", 'model_provider = "fake"', "",
      "[model_providers.fake]", 'name = "fake"', 'base_url = "http://127.0.0.1:1/v1"', 'env_key = "FAKE_KEY"', 'wire_api = "responses"', "",
      "[mcp_servers.web]", 'url = "http://127.0.0.1:1/mcp"', "",
      "[mcp_servers.local]", 'command = "nosuchprogxyz"', "required = true", "",
      "[[hooks.PreToolUse]]", "[[hooks.PreToolUse.hooks]]", 'type = "command"', 'command = "node guard.mjs"', "timeout_sec = 5", "",
      "[features]", "hooks = false", "",
    ].join("\n"),
    "work.config.toml": 'model = "gpt-5.4"\n',
    "AGENTS.md": "Global.\n",
    "hooks.json": JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "node other.mjs" }] }] } }),
    "rules/broken.rules": 'prefix_rule(pattern=["ls"], decision="allow"\n',
    "rules/ok.rules": 'prefix_rule(pattern=["ls"], decision="allow")\n',
    "work/AGENTS.override.md": "Override.\n",
    "work/AGENTS.md": "x".repeat(200),
    "work/.codex/config.toml": 'model = "gpt-5.4"\nnotify = ["a"]\n',
  });
  return m;
}

async function documents() {
  const docs = { show: [], lint: [], why: [], agents: [], cost: [], explain: [] };
  const take = async (name, argv, sys) => { const r = await run([...argv, "--json"], sys); docs[name].push(JSON.parse(r.out)); };
  // the example project on Linux, and the Windows machine of the README, with and without a sandbox log
  for (const name of ["show", "lint", "agents", "cost"]) await take(name, [name], exampleMachine());
  await take("agents", ["agents", "--project", "/home/runner/shop/app"], exampleMachine());
  for (const name of ["show", "lint", "cost"]) await take(name, [name], exampleWindows());
  const logged = exampleWindows();
  logged.add("C:\\Users\\me\\.codex\\.sandbox\\sandbox.2026-10-17.log", "[2026-10-17T10:00:00Z 1] MXC availability: true\n[2026-10-17T10:00:01Z 1] Windows sandbox selection: mxc\n");
  await take("show", ["show"], logged);
  // the busier machine: a profile, a custom provider, an HTTP server, both hook formats, a rules file that does not load, a cut AGENTS.md
  const busy = busyMachine();
  const busyArgs = (argv) => [...argv, "--profile", "work"];
  for (const name of ["show", "lint", "agents", "cost"]) await take(name, busyArgs([name]), busy.sys);
  await take("agents", ["agents", "--project", busy.j("work")], busy.sys);
  await take("show", ["show"], machine({ "config.toml": "foo bar = 1\n" }).sys);
  await take("lint", ["lint"], machine({ "config.toml": "foo bar = 1\n" }).sys);
  // why: every kind of outcome, a script that is split, one that is not, a command with no rule, a refusal
  for (const command of ["git status", "git push origin main", "git status && rm -rf build", "npm publish", "ls -la", "echo $(date)", "node build.mjs"]) await take("why", ["why", command], exampleMachine());
  await take("why", ["why", "echo hi"], exampleWindows());
  await take("why", ["why", "git status; ls"], busy.sys);
  // explain: a page, the list, an id that is not one
  await take("explain", ["explain", "unknown-key"], exampleMachine());
  await take("explain", ["explain", "--list"], exampleMachine());
  await take("explain", ["explain", "no-such-finding"], exampleMachine());
  return docs;
}

test("the JSON shapes in the README: every field of a document is named there, and every field named is in some document or marked optional", async () => {
  const start = readme.indexOf("\nshow     {");
  assert.ok(start > 0, "the shapes are in the README");
  const block = readme.slice(start + 1, readme.indexOf("\n```", start));
  const entries = {};
  let current = null;
  for (const line of block.split("\n")) {
    const m = /^([a-z]+) +\{/.exec(line);
    if (m) { current = m[1]; entries[current] = ""; }
    if (current) entries[current] += `${line}\n`;
  }
  assert.deepEqual(Object.keys(entries), ["show", "lint", "why", "agents", "cost", "explain"]);
  const docs = await documents();
  const errors = [];
  for (const command of Object.keys(entries)) {
    const shape = parseShape(entries[command].replace(/^[a-z]+ +/, ""));
    holdTo(shape, docs[command], command, errors);
  }
  assert.deepEqual(errors, []);
});

// ---- the examples are what the code prints ----------------------------------------------------------------------------------------

const tokens = (line) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));

test("the examples in the README are what the code prints, for the project in examples/ on a pretend Linux machine and for a pretend Windows 11", async () => {
  const found = [...readme.matchAll(/```text\n(\$ |C:\\Users\\me\\shop> )codex-config-doctor ([^\n]+)\n([\s\S]*?)\n```/g)].map((m) => ({ windows: m[1] !== "$ ", command: m[2], text: m[3] }));
  assert.ok(found.length >= 13, `${found.length} examples`);
  assert.ok(found.some((f) => f.windows) && found.some((f) => !f.windows));
  const bad = [];
  for (const b of found) {
    const r = await run(tokens(b.command), b.windows ? exampleWindows() : exampleMachine());
    const actual = r.out.replace(/\s+$/, "");
    if (actual !== b.text) {
      const a = actual.split("\n");
      const e = b.text.split("\n");
      const i = a.findIndex((l, k) => l !== e[k]);
      bad.push(`${b.command}\n  line ${i + 1}: the code prints ${JSON.stringify(a[i])}\n  the README shows ${JSON.stringify(e[i])}`);
    }
  }
  assert.deepEqual(bad, []);
  for (const cmd of ["show", "lint", "lint --markdown", "why", "agents", "cost", "explain"]) assert.ok(found.some((f) => f.command === cmd || f.command.startsWith(`${cmd} `)), `an example of ${cmd}`);
});

test("examples/ is the project the README describes: what lint and show say about it, and the sentences that go with the examples", async () => {
  const lint = JSON.parse((await run(["lint", "--json"], exampleMachine())).out);
  assert.deepEqual(lint.counts, { error: 0, warning: 6, note: 1 });
  assert.deepEqual(lint.findings.map((f) => f.id), ["unknown-key", "ignored-in-project", "feature-alias", "hook-untrusted", "rules-allow-ignored", "mcp-command-missing", "feature-deprecated"]);
  const show = (await run(["show"], exampleMachine())).out;
  assert.ok(show.includes("1,458 characters reach the model") && readme.includes("says that 1,458 characters reach the model"));
  assert.match(show, /\n  model +"gpt-5\.4" +project\n/);
  assert.match(show, /untrusted +PreToolUse/);
  assert.match(show, /docs +stdio +docs-mcp +NOT FOUND/);
  const agents = (await run(["agents", "--project", "/home/runner/shop/app"], exampleMachine())).out;
  assert.ok(agents.includes("CUT: 678 of 1,072 bytes read") && agents.includes("1,900"));
  const git = JSON.parse((await run(["why", "git status", "--json"], exampleMachine())).out);
  assert.equal(git.parts[0].ignored.length, 1, "the allow rule for git alone is ignored");
  assert.equal(git.outcome, "outside-sandbox");
});

// ---- the files ----------------------------------------------------------------------------------------------------------------------

const walk = (dir, ext) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`, ext) : e.name.endsWith(ext) ? [`${dir}/${e.name}`] : []));

test("the Files table of the README names every source file and every helper of the tests, and every file it names is there", () => {
  const section = readme.slice(readme.indexOf("\n## Files\n"), readme.indexOf("\n## Contributing\n"));
  assert.ok(section.length > 1000, "the section is there");
  for (const f of [...walk("src", ".mjs"), ...walk("bin", ".mjs")]) assert.ok(section.includes(`\`${f}\``), `${f} is in the Files table`);
  for (const f of walk("test", ".mjs").filter((x) => !x.endsWith(".test.mjs"))) assert.ok(section.includes(`\`${f}\``), `${f} is in the Files table`);
  for (const dir of ["test/fixtures/", "examples/", ".github/workflows/", "test/*.test.mjs"]) assert.ok(section.includes(`\`${dir}\``), `${dir} is in the Files table`);
  for (const m of section.matchAll(/`((?:src|bin|test|examples|\.github)\/[^`\s*]*)`/g)) assert.ok(exists(m[1].replace(/\/$/, "")), `${m[1]} is named in the Files table and exists`);
  for (const f of walk(".github/workflows", ".yml")) assert.ok(section.includes(path.basename(f)), `${f} is named`);
});

test("the changelog, the roadmap and the contributing guide name what the README names", () => {
  const changelog = rd("CHANGELOG.md");
  for (const word of ["show", "lint", "why", "agents", "cost", "explain", "--json", "--markdown", "--print"]) assert.ok(changelog.includes(word), `the changelog says ${word}`);
  assert.match(rd("ROADMAP.md"), /https:\/\/github\.com\/nrzz\/codex-config-doctor\/issues\/4\b/, "the roadmap links the good first issue");
  assert.ok(readme.includes("https://github.com/nrzz/codex-config-doctor/issues/4"), "the README links the good first issue");
  assert.match(rd("CONTRIBUTING.md"), /good first issue/);
  assert.match(rd("CONTRIBUTING.md"), /test\/readme\.test\.mjs/);
});
