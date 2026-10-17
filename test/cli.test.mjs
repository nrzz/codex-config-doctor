// The command line: the arguments, the exit codes (0 ok, 1 findings or a refusal, 2 a usage error), the JSON of every command, and that
// the tool changes nothing. The processes run in throwaway worlds (test/helpers.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HELP, main, parseArgs } from "../src/cli.mjs";
import { IDS } from "../src/catalog.mjs";
import { VERSION } from "../src/version.mjs";
import { ROOT, homeEnv, put, runCli, tmpDir } from "./helpers.mjs";
import { world } from "./world.mjs";

/** A throwaway world on disk: { root, home, codexHome, work, env }. */
function disk(files = {}, { trusted = true } = {}) {
  const root = tmpDir("ccd-cli-");
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const work = path.join(root, "work");
  for (const d of [home, codexHome, path.join(work, ".git")]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(work, ".git", "HEAD"), "ref: refs/heads/main\n");
  const trust = trusted ? `\n[projects.'${work}']\ntrust_level = "trusted"\n` : "";
  // on Windows Codex has no sandbox until one is selected (the windows-sandbox finding): the worlds select one, so that they are clean
  const sandbox = process.platform === "win32" ? '\n[windows]\nsandbox = "unelevated"\n' : "";
  put(path.join(codexHome, "config.toml"), `${files["config.toml"] || ""}${sandbox}${trust}`);
  for (const [rel, text] of Object.entries(files)) if (rel !== "config.toml") put(rel.startsWith("work/") ? path.join(root, rel) : path.join(codexHome, rel), text);
  return { root, home, codexHome, work, env: homeEnv(home, codexHome) };
}
const sha = (dir) => {
  const h = crypto.createHash("sha256");
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      h.update(`${path.relative(dir, full)}|${st.isDirectory() ? "d" : st.size}\n`);
      if (st.isDirectory()) walk(full);
      else h.update(fs.readFileSync(full));
    }
  };
  walk(dir);
  return h.digest("hex");
};
const cli = (w, args, o = {}) => runCli(args, { cwd: w.work, env: w.env, ...o });

test("the arguments: commands, options, values, the end of options", () => {
  const p = parseArgs(["lint", "--project", "/x", "--profile", "work", "--json", "--markdown"]);
  assert.deepEqual([p.command, p.project, p.profile, p.json, p.markdown], ["lint", "/x", "work", true, true]);
  assert.equal(parseArgs(["show", "--project=/y"]).project, "/y");
  assert.deepEqual(parseArgs(["why", "git status"]).positional, ["git status"]);
  assert.deepEqual(parseArgs(["why", "--", "-x --y"]).positional, ["-x --y"]);
  assert.equal(parseArgs(["why", "ls", "--shell", "powershell"]).shell, "powershell");
  assert.equal(parseArgs(["explain", "--list"]).list, true);
  assert.deepEqual(parseArgs(["explain", "wrong-type"]).positional, ["wrong-type"]);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-v"]).version, true);
  assert.equal(parseArgs(["agents", "--print"]).print, true);
});

test("the usage errors, one by one", () => {
  const bad = (argv, re) => assert.throws(() => parseArgs(argv), re, argv.join(" "));
  bad([], /no command given/);
  bad(["nosuch"], /unknown command "nosuch"/);
  bad(["show", "--nosuch"], /unknown option --nosuch/);
  bad(["show", "extra"], /show takes no argument, not "extra"/);
  bad(["show", "--markdown"], /show does not take --markdown/);
  bad(["lint", "--print"], /lint does not take --print/);
  bad(["explain", "--profile", "x", "unknown-key"], /explain does not take --profile/);
  bad(["why"], /why needs the command, in quotes/);
  bad(["why", "git", "status"], /why takes one argument, the command in quotes: why "git status"/);
  bad(["why", "x", "--shell", "fish"], /--shell is bash or powershell/);
  bad(["show", "--project"], /--project needs a value/);
  bad(["show", "--profile", "--json"], /--profile needs a value/);
  bad(["explain"], /explain needs a finding id or --list/);
  bad(["explain", "--list", "wrong-type"], /explain takes --list or one finding id, not both/);
  bad(["why", "-x"], /unknown option -x/);
});

test("--help is the help text and --version is the version of package.json", () => {
  const w = disk();
  const h = cli(w, ["--help"]);
  assert.deepEqual([h.code, h.out, h.err], [0, HELP, ""]);
  const v = cli(w, ["--version"]);
  assert.deepEqual([v.code, v.out, v.err], [0, `codex-config-doctor ${VERSION}\n`, ""]);
  assert.equal(VERSION, JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
  assert.equal(cli(w, ["-h"]).out, HELP);
});

test("usage errors exit 2 with a message on stderr (a JSON document on stdout with --json)", () => {
  const w = disk();
  for (const argv of [[], ["nosuch"], ["show", "--nosuch"], ["why"], ["explain"], ["lint", "--print"]]) {
    const r = cli(w, argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.equal(r.out, "");
    assert.match(r.err, /^codex-config-doctor: .+\nRun codex-config-doctor --help for the commands\.\n$/);
  }
  const j = cli(w, ["nosuch", "--json"]);
  assert.equal(j.code, 2);
  assert.deepEqual(JSON.parse(j.out), { ok: false, error: 'unknown command "nosuch"' });
  assert.equal(j.err, "");
});

test("show: a clean world exits 0; a layer that does not parse exits 1; the JSON has the layers and the merged settings", () => {
  const w = disk({ "config.toml": 'model = "gpt-5.5"\n[features]\nhooks = true\n' });
  const r = cli(w, ["show", "--json"]);
  assert.equal(r.code, 0, r.all);
  const doc = JSON.parse(r.out);
  assert.equal(doc.command, "show");
  assert.equal(doc.ok, true);
  assert.equal(doc.version, VERSION);
  assert.ok(doc.layers.some((l) => l.kind === "user" && l.status === "read"));
  assert.deepEqual(doc.config.find((x) => x.key === "model"), { key: "model", value: "gpt-5.5", layer: "user", file: path.join(w.codexHome, "config.toml") });
  assert.equal(doc.trust.level, "trusted");
  const text = cli(w, ["show"]);
  assert.equal(text.code, 0);
  assert.match(text.out, /^codex-config-doctor .* {2}what Codex will do with this configuration\n/);
  assert.match(text.out, /Layers, the one that wins first/);
  const broken = disk({ "config.toml": "model = \n" });
  const b = cli(broken, ["show"]);
  assert.equal(b.code, 1);
  assert.match(b.out, /BROKEN/);
  assert.equal(cli(broken, ["show", "--json"]).code, 1);
});

test("lint: exit 0 with nothing to say, 1 with a warning or an error, 0 with notes only; --json and --markdown", () => {
  const clean = disk({ "config.toml": 'model = "gpt-5.5"\n' });
  const ok = cli(clean, ["lint"]);
  assert.equal(ok.code, 0, ok.all);
  assert.match(ok.out, /Nothing to report\./);
  const warn = disk({ "config.toml": 'aproval_policy = "never"\n' });
  const w = cli(warn, ["lint"]);
  assert.equal(w.code, 1);
  assert.match(w.out, /WARNING unknown-key/);
  assert.match(w.out, /Did you mean `approval_policy`\?/);
  const j = JSON.parse(cli(warn, ["lint", "--json"]).out);
  assert.equal(j.ok, false);
  assert.equal(j.counts.warning >= 1, true);
  assert.equal(j.findings[0].id, "unknown-key");
  for (const k of ["id", "severity", "basis", "file", "line", "column", "message", "effect", "fix"]) assert.ok(k in j.findings[0], k);
  const md = cli(warn, ["lint", "--markdown"]);
  assert.equal(md.code, 1);
  assert.match(md.out, /^## codex-config-doctor lint: /);
  assert.match(md.out, /- WARNING unknown-key \(.*config\.toml:1\): /);
  for (const line of md.out.split("\n")) assert.ok(line.length <= 500, line.length);
});

test("lint --markdown: at most 12 findings and 500 characters a line, and a pointer to the rest", () => {
  const keys = Array.from({ length: 20 }, (_, i) => `bogus_key_${i} = ${i}`).join("\n");
  const w = disk({ "config.toml": `${keys}\n` });
  const md = cli(w, ["lint", "--markdown"]);
  const lines = md.out.trimEnd().split("\n");
  assert.equal(lines.filter((l) => l.startsWith("- WARNING")).length, 12);
  assert.match(lines[lines.length - 1], /^- \.\.\. and 8 more \(run `codex-config-doctor lint`\)$/);
  assert.ok(lines.every((l) => l.length <= 500));
});

test("why: exit 0 when Codex would run or ask, 1 when it would refuse; the JSON says which", () => {
  const w = disk({ "config.toml": "", "rules/default.rules": 'prefix_rule(pattern=["rm", "-rf"], decision="forbidden")\n' });
  const ok = cli(w, ["why", "echo hi", "--shell", "bash"]);
  assert.equal(ok.code, 0, ok.all);
  assert.match(ok.out, /Codex runs it inside the .* sandbox, without asking\./);
  const no = cli(w, ["why", "rm -rf build", "--json"]);
  assert.equal(no.code, 1);
  const doc = JSON.parse(no.out);
  assert.deepEqual([doc.ok, doc.outcome, doc.decision, doc.command, doc.shellCommand], [false, "forbidden", "forbidden", "why", "rm -rf build"]);
});

test("agents: exit 0, 1 when a file is cut; --print is the text the model gets", () => {
  const w = disk({ "config.toml": "project_doc_max_bytes = 100\n", "AGENTS.md": "global\n", "work/AGENTS.md": "x".repeat(300) });
  const r = cli(w, ["agents"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /CUT: 100 of 300 bytes read, 200 lost/);
  const doc = JSON.parse(cli(w, ["agents", "--json"]).out);
  assert.equal(doc.ok, false);
  assert.equal(doc.files[0].status, "cut");
  const p = cli(w, ["agents", "--print"]);
  assert.equal(p.out, `${doc.text}\n`);
  const fine = disk({ "config.toml": "", "work/AGENTS.md": "hello\n" });
  assert.equal(cli(fine, ["agents"]).code, 0);
  const none = disk({ "config.toml": "" });
  const np = cli(none, ["agents", "--print"]);
  assert.equal(np.code, 1);
  assert.match(np.err, /no instruction file is found: Codex sends no AGENTS\.md message/);
});

test("cost: exit 0 and a total", () => {
  const w = disk({ "config.toml": "", "work/AGENTS.md": "hello\n" });
  const r = cli(w, ["cost"]);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /Total {2}/);
  const doc = JSON.parse(cli(w, ["cost", "--json"]).out);
  assert.equal(doc.rows.length, 7);
  assert.equal(doc.total, doc.rows.reduce((n, x) => n + (x.chars || 0), 0));
});

test("explain: every id has a page, an unknown id exits 1 with a suggestion, --list lists them all", () => {
  const w = disk();
  const list = cli(w, ["explain", "--list"]);
  assert.equal(list.code, 0);
  for (const id of IDS) assert.ok(list.out.includes(id), id);
  assert.equal(JSON.parse(cli(w, ["explain", "--list", "--json"]).out).findings.length, IDS.length);
  for (const id of ["wrong-type", "hook-untrusted", "agents-md-over-cap"]) {
    const r = cli(w, ["explain", id]);
    assert.equal(r.code, 0, id);
    assert.match(r.out, new RegExp(`^${id} `));
    assert.match(r.out, /What Codex does\n/);
  }
  const bad = cli(w, ["explain", "wrong-typo"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /no finding called "wrong-typo"\. Did you mean wrong-type\?/);
  const badJson = JSON.parse(cli(w, ["explain", "nosuch", "--json"]).out);
  assert.equal(badJson.ok, false);
  assert.deepEqual(badJson.ids, IDS);
});

test("a profile and a project folder given on the command line", () => {
  const w = disk({ "config.toml": 'model = "a"\n', "p.config.toml": 'model = "b"\n' });
  const elsewhere = path.join(w.root, "elsewhere");
  fs.mkdirSync(elsewhere);
  const r = JSON.parse(cli(w, ["show", "--json", "--profile", "p", "--project", w.work], { cwd: elsewhere }).out);
  assert.equal(r.profile.name, "p");
  assert.equal(r.project, w.work);
  assert.equal(r.config.find((x) => x.key === "model").value, "b");
  const missing = JSON.parse(cli(w, ["lint", "--json", "--profile", "nope"]).out);
  assert.ok(missing.findings.some((f) => f.id === "profile-missing"));
});

test("the tool changes nothing: every file of the world is the same after every command", () => {
  const w = disk({ "config.toml": 'model = "x"\nbogus = 1\n', "rules/default.rules": 'prefix_rule(pattern=["a"])\n', "hooks.json": "{}", "work/AGENTS.md": "hi\n", "work/.codex/config.toml": 'model = "y"\n' });
  const before = sha(w.root);
  for (const argv of [["show"], ["lint"], ["lint", "--markdown"], ["why", "a b"], ["agents"], ["agents", "--print"], ["cost"], ["explain", "wrong-type"], ["show", "--json"]]) cli(w, argv);
  assert.equal(sha(w.root), before);
});

test("main() writes to the streams it is given and returns the exit code", async () => {
  const out = [];
  const err = [];
  const { c } = world({ "config.toml": 'bogus = 1\n' });
  const code = await main(["lint", "--json"], { sys: c.sys, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } });
  assert.equal(code, 1);
  assert.equal(err.length, 0);
  assert.equal(JSON.parse(out.join("")).command, "lint");
});
