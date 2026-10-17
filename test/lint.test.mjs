// The findings of `lint`, one by one: each is said when it should be, with the file and the line, what Codex does and the fix, and not otherwise.
// The worlds are pretend machines (test/fakesys.mjs), on Linux, macOS and Windows.
import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG, IDS } from "../src/catalog.mjs";
import { lint } from "../src/lint.mjs";
import { HELP } from "../src/cli.mjs";
import { collect } from "../src/collect.mjs";
import { fakeSys } from "./fakesys.mjs";
import { world } from "./world.mjs";

const run = (files, o) => {
  const { c, m } = world(files, o);
  return { ...lint(c), c, m };
};
const ids = (r) => r.findings.map((f) => f.id);
const one = (r, id) => { const f = r.findings.filter((x) => x.id === id); assert.equal(f.length, 1, `${id}: ${ids(r).join(", ")}`); return f[0]; };
const none = (r, id) => assert.ok(!ids(r).includes(id), `${id} was said: ${JSON.stringify(r.findings.filter((f) => f.id === id).map((f) => f.message))}`);

test("a clean configuration has no finding at all", () => {
  const r = run({ "config.toml": 'model = "gpt-5.5"\n[features]\nhooks = true\n' });
  assert.deepEqual(r.findings.filter((f) => f.id !== "windows-sandbox"), []);
  assert.deepEqual(r.counts.error + r.counts.warning, 0);
});

test("every finding has an id of the catalog, a severity, a basis, a message, what Codex does and a fix", () => {
  const r = run({ "config.toml": 'foo = 1\n[features]\nnosuch = true\njs_repl = true\ncodex_hooks = true\nweb_search_request = true\n', "work/.codex/config.toml": 'notify = ["x"]\n', "rules/a.rules": 'prefix_rule(pattern=["git"])\n' });
  for (const f of r.findings) {
    assert.ok(IDS.includes(f.id), f.id);
    assert.ok(["error", "warning", "note"].includes(f.severity), f.id);
    assert.ok(["binary", "docs"].includes(f.basis), f.id);
    assert.ok(f.message && f.effect && f.fix, f.id);
    assert.equal(f.basis, CATALOG[f.id].basis, `${f.id} keeps the basis of the catalog`);
  }
  assert.ok(r.findings.length >= 6);
  // errors come first, then warnings, then notes
  const order = r.findings.map((f) => ({ error: 0, warning: 1, note: 2 })[f.severity]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("toml-error: the layer that does not parse, with its line; also for a profile and for a project that is not trusted", () => {
  let r = run({ "config.toml": 'model = "gpt-5.5"\nfoo bar = 1\n' });
  let f = one(r, "toml-error");
  assert.equal(f.line, 2);
  assert.equal(f.severity, "error");
  assert.match(f.message, /key with no value/);
  r = run({ "config.toml": "", "work/.codex/config.toml": "a = = 1\n" }, { trusted: false });
  f = one(r, "toml-error");
  assert.match(f.file, /\.codex/);
  assert.equal(f.severity, "warning", "an untrusted project's file is not opened, so it does not stop Codex yet");
  assert.match(f.effect, /ignores this one for now/);
  assert.match(f.effect, /danger-full-access/);
  r = run({ "config.toml": "", "work/.codex/config.toml": "a = = 1\n" });
  assert.equal(one(r, "toml-error").severity, "error", "in a trusted project it stops Codex");
  r = run({ "config.toml": 'model = "x"\n', "p.config.toml": "x y\n" }, { profile: "p" });
  assert.match(one(r, "toml-error").file, /p\.config\.toml$/);
  none(run({ "config.toml": 'a = 1\n' }), "toml-error");
});

test("config-encoding: a config.toml in UTF-16 (PowerShell 5.1 writes one with >)", () => {
  const r = run({ "config.toml": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('model = "x"\n', "utf16le")]) }, { trusted: false, platform: "win32" });
  const f = one(r, "config-encoding");
  assert.match(f.message, /UTF-16/);
  assert.match(f.fix, /Set-Content -Encoding utf8|UTF-8/);
  assert.equal(ids(r).includes("toml-error"), false);
  // a byte order mark on UTF-8 is fine
  none(run({ "config.toml": '\ufeffmodel = "x"\n' }), "config-encoding");
});

test("unknown-key and wrong-type: the key, the line, a suggestion, the type that goes", () => {
  const r = run({ "config.toml": 'aproval_policy = "never"\nproject_doc_max_bytes = "big"\n[features]\nhooks = "yes"\n[sandbox_workspace_write]\nnetwork = true\n[mcp_servers.x]\ncommand = 5\n' });
  const unknown = r.findings.filter((f) => f.id === "unknown-key").map((f) => [f.line, f.message]);
  assert.equal(unknown.length, 2);
  assert.match(unknown[0][1], /aproval_policy/);
  assert.match(unknown[0][1], /Did you mean `approval_policy`/);
  assert.match(unknown[1][1], /sandbox_workspace_write\.network/);
  const wrong = r.findings.filter((f) => f.id === "wrong-type").map((f) => [f.line, f.message]);
  assert.deepEqual(wrong.map((w) => w[0]), [2, 4, 8]);
  assert.match(wrong[0][1], /project_doc_max_bytes/);
  assert.match(wrong[1][1], /boolean/);
  assert.match(r.findings.find((f) => f.id === "wrong-type").effect, /Codex does not start/);
  // a top-level key written under a table header
  const under = run({ "config.toml": '[mcp_servers.x]\ncommand = "node"\nmodel = "gpt-5.5"\n' });
  assert.match(one(under, "unknown-key").message, /top-level key of config\.toml/);
  // a value outside the allowed words
  assert.match(one(run({ "config.toml": 'sandbox_mode = "bogus"\n' }), "wrong-type").message, /one of `read-only`/);
  // a scalar where a table goes
  assert.match(one(run({ "config.toml": 'mcp_servers = "x"\n' }), "wrong-type").message, /must be a table/);
  assert.match(one(run({ "config.toml": "[agents]\nenable = true\n" }), "wrong-type").message, /must be a table/);
  // tables Codex does not check: tui, agents roles, desktop
  assert.deepEqual(run({ "config.toml": "[tui]\nbogus = 1\n[desktop]\nbogus = 1\n[agents.x]\nbogus = 1\n" }).findings.filter((f) => ["unknown-key", "wrong-type"].includes(f.id)), []);
});

test("key-removed: the one key Codex lists and refuses", () => {
  const toml = 'model = "x"\nexperimental_thread_store_endpoint = "http://x"\n';
  const f = one(run({ "config.toml": toml }), "key-removed");
  assert.deepEqual([f.severity, f.line, f.basis], ["error", 2, "binary"]);
  assert.match(f.effect, /`experimental_thread_store_endpoint` is no longer supported; remove it from config\.toml/);
  assert.equal(ids(run({ "config.toml": toml })).includes("unknown-key"), false);
});

test("unknown-key is not said for a project that is not trusted (the layer is skipped), and ignored-in-project is said for one that is", () => {
  const files = { "config.toml": "", "work/.codex/config.toml": 'foo = 1\nnotify = ["x"]\nmodel_provider = "p"\nmodel = "gpt-5.4"\n' };
  const off = run(files, { trusted: false });
  none(off, "unknown-key");
  none(off, "ignored-in-project");
  assert.ok(ids(off).includes("untrusted-project"));
  const on = run(files, { trusted: true });
  assert.ok(ids(on).includes("unknown-key"));
  const f = one(on, "ignored-in-project");
  assert.deepEqual([f.line, f.severity], [2, "warning"]);
  assert.match(f.message, /`model_provider`, `notify`/);
  assert.match(f.effect, /Ignored unsupported project-local config keys/);
  assert.match(f.effect, /model_provider, notify\./);
  none(on, "untrusted-project");
});

test("untrusted-project: a .codex folder with a config.toml, a hooks.json or rules, in a project that is not trusted, with the entry to add", () => {
  for (const what of [{ "work/.codex/config.toml": 'model = "x"\n' }, { "work/.codex/hooks.json": "{}" }, { "work/.codex/rules/a.rules": 'prefix_rule(pattern=["a"])\n' }]) {
    const r = run({ "config.toml": "", ...what }, { trusted: false });
    const f = one(r, "untrusted-project");
    assert.match(f.fix, /trust_level = "trusted"/);
    assert.match(f.effect, /Project-local config, hooks, and exec policies are disabled/);
  }
  none(run({ "config.toml": "" }, { trusted: false }), "untrusted-project");
  const w = run({ "config.toml": "", "work/.codex/config.toml": 'model = "x"\n' }, { trusted: false, platform: "win32" });
  const wf = one(w, "untrusted-project").fix;
  assert.match(wf, /\[projects\.'C:\\w\\work'\]/);
  assert.match(wf, /Write the path with backslashes, as here, without a trailing backslash/);
  // marked untrusted: change the entry that is there
  const marked = run({ "config.toml": `[projects.'${"/w/work"}']\ntrust_level = "untrusted"\n`, "work/.codex/config.toml": 'model = "x"\n' }, { trusted: false });
  assert.match(one(marked, "untrusted-project").message, /marked untrusted/);
  assert.match(one(marked, "untrusted-project").fix, /Set trust_level = "trusted" in \[projects\.'\/w\/work'\]/);
  // the Git root is what to trust when the .codex folder is in a subfolder
  const sub = run({ "config.toml": "", "work/a/.codex/config.toml": 'model = "x"\n' }, { trusted: false, dir: "a" });
  assert.match(one(sub, "untrusted-project").fix, /\[projects\.'\/w\/work'\]/);
});

test("trust-key-spelling: an entry for this folder that Codex does not match (forward slashes, a trailing separator, the \\\\?\\ prefix)", () => {
  const spell = (p) => ({ "config.toml": `[projects.'${p}']\ntrust_level = "trusted"\n`, "work/.codex/config.toml": 'model = "x"\n' });
  for (const p of ["C:/w/work", "C:\\w\\work\\", "\\\\?\\C:\\w\\work"]) {
    const r = run(spell(p), { trusted: false, platform: "win32" });
    const f = one(r, "trust-key-spelling");
    assert.equal(f.line, 1);
    assert.match(f.fix, /\[projects\.'C:\\w\\work'\]/);
    assert.ok(ids(r).includes("untrusted-project"));
  }
  none(run(spell("C:\\W\\Work"), { trusted: false, platform: "win32" }), "trust-key-spelling");
  none(run(spell("C:\\W\\Work"), { trusted: false, platform: "win32" }), "untrusted-project");
  const lin = run({ "config.toml": "[projects.'/w/work/']\ntrust_level = \"trusted\"\n", "work/.codex/config.toml": 'model = "x"\n' }, { trusted: false });
  one(lin, "trust-key-spelling");
});

test("profile-legacy and profile-missing", () => {
  let r = run({ "config.toml": 'profile = "x"\n[profiles.x]\nmodel = "y"\n' });
  const legacy = r.findings.filter((f) => f.id === "profile-legacy");
  assert.deepEqual(legacy.map((f) => [f.severity, f.line]), [["error", 1], ["note", 2]]);
  assert.match(legacy[0].effect, /legacy `profile = "x"` config is no longer supported/);
  r = run({ "config.toml": '[profiles.x]\nmodel = "y"\n', "x.config.toml": 'model = "z"\n' }, { profile: "x" });
  const used = one(r, "profile-legacy");
  assert.equal(used.severity, "error");
  assert.match(used.effect, /cannot be used while/);
  r = run({ "config.toml": "" }, { profile: "nope" });
  const missing = one(r, "profile-missing");
  assert.match(missing.effect, /exit code 0 and no message/);
  none(run({ "config.toml": "", "ok.config.toml": 'model = "z"\n' }, { profile: "ok" }), "profile-missing");
  assert.match(one(run({ "config.toml": "" }, { profile: "../evil" }), "profile-missing").message, /not a plain name/);
});

test("approval-deprecated: untrusted is an error, on-failure a warning", () => {
  let f = one(run({ "config.toml": 'approval_policy = "untrusted"\n' }), "approval-deprecated");
  assert.deepEqual([f.severity, f.line], ["error", 1]);
  assert.match(f.effect, /no longer supported/);
  f = one(run({ "config.toml": 'approval_policy = "on-failure"\n' }), "approval-deprecated");
  assert.equal(f.severity, "warning");
  none(run({ "config.toml": 'approval_policy = "on-request"\n' }), "approval-deprecated");
  none(run({ "config.toml": 'approval_policy = "never"\n' }), "approval-deprecated");
});

test("feature flags: the old name, the unknown, the removed, the deprecated", () => {
  const r = run({ "config.toml": '[features]\ncodex_hooks = true\nhoks = true\njs_repl = true\nelevated_windows_sandbox = true\nweb_search_request = true\nhooks = true\n' });
  assert.match(one(r, "feature-alias").message, /features\.hooks/);
  assert.match(one(r, "feature-unknown").message, /features\.hoks/);
  assert.match(one(r, "feature-unknown").message, /Did you mean `hooks`/);
  assert.equal(r.findings.filter((f) => f.id === "feature-removed").length, 2);
  assert.equal(one(r, "feature-deprecated").severity, "note");
  assert.match(r.findings.find((f) => f.id === "feature-removed").effect, /accepts the line in silence/);
});

test("env-policy-mix: filters with exclude or include_only in one file", () => {
  const f = one(run({ "config.toml": '[shell_environment_policy]\ninclude_only = ["PATH"]\n[shell_environment_policy.filters]\n"B*" = "exclude"\n' }), "env-policy-mix");
  assert.equal(f.line, 2);
  none(run({ "config.toml": '[shell_environment_policy.filters]\n"B*" = "exclude"\n' }), "env-policy-mix");
  none(run({ "config.toml": '[shell_environment_policy]\nexclude = ["A*"]\n' }), "env-policy-mix");
});

test("hooks: both formats, a hooks.json that does not parse, an event that does not exist, a program that is not found, untrusted, modified, ask, the feature off", () => {
  const hook = (cmd, extra = "") => `[[hooks.PreToolUse]]\nmatcher = "*"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(cmd)}\n${extra}`;
  let r = run({ "config.toml": hook("node x.mjs"), "hooks.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node y.mjs" }] }] } }) });
  assert.match(one(r, "hooks-both-formats").effect, /prefer a single representation/);
  assert.equal(r.findings.filter((f) => f.id === "hook-untrusted").length, 2);
  r = run({ "config.toml": "", "hooks.json": '\ufeff{"hooks":{}}' });
  assert.match(one(r, "hooks-json-error").message, /byte order mark/);
  r = run({ "config.toml": "", "hooks.json": JSON.stringify({ hooks: { SessionBegin: [{ hooks: [{ type: "command", command: "x" }] }] } }) });
  assert.match(one(r, "hook-event-unknown").message, /SessionBegin/);
  r = run({ "config.toml": hook("nosuchprog --x") });
  assert.match(one(r, "hook-command-missing").message, /nosuchprog/);
  r = run({ "config.toml": hook("node x.mjs"), "abs:/bin/node": "x" });
  none(r, "hook-command-missing");
  const untrusted = one(r, "hook-untrusted");
  assert.match(untrusted.fix, /\[hooks\.state\./);
  assert.match(untrusted.fix, /trusted_hash = "sha256:[0-9a-f]{64}"/);
  assert.match(untrusted.effect, /`codex exec` says nothing/);
  // trust it with the hash the finding printed, then change it
  const hash = /trusted_hash = "(sha256:[0-9a-f]{64})"/.exec(untrusted.fix)[1];
  const key = /\[hooks\.state\.("[^\]]+")\]/.exec(untrusted.fix)[1];
  const trusted = run({ "config.toml": `${hook("node x.mjs")}\n[hooks.state.${key}]\ntrusted_hash = "${hash}"\n`, "abs:/bin/node": "x" });
  none(trusted, "hook-untrusted");
  none(trusted, "hook-modified");
  const modified = run({ "config.toml": `${hook("node z.mjs")}\n[hooks.state.${key}]\ntrusted_hash = "${hash}"\n`, "abs:/bin/node": "x" });
  assert.match(one(modified, "hook-modified").message, /changed since it was trusted/);
  r = run({ "config.toml": `[features]\nhooks = false\n${hook("node x.mjs")}`, "abs:/bin/node": "x" });
  assert.match(one(r, "hooks-feature-off").effect, /in silence/);
  r = run({ "config.toml": hook("node ask.mjs"), "work/ask.mjs": 'console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } }));', "abs:/bin/node": "x" });
  const ask = one(r, "hook-ask-unsupported");
  assert.equal(ask.basis, "docs");
});

test("hook-field-unknown: a handler field Codex does not read, with the spelling it does, in config.toml and in hooks.json", () => {
  const hook = (extra) => `[[hooks.PreToolUse]]\nmatcher = "*"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "node x.mjs"\n${extra}`;
  let r = run({ "config.toml": hook("timeout_sec = 5\nstatus_message = \"hi\"\nasync = false\nwhatever = 1\n"), "abs:/bin/node": "x" });
  const found = r.findings.filter((f) => f.id === "hook-field-unknown");
  assert.deepEqual(found.map((f) => f.line), [6, 7, 9]);
  assert.match(found[0].message, /has the field `timeout_sec`, which Codex does not read in a hook handler\. Did you mean `timeout`\?/);
  assert.match(found[0].effect, /600 seconds/);
  assert.equal(found[0].fix, "Rename it to `timeout`.");
  assert.match(found[1].fix, /statusMessage/);
  assert.match(found[2].fix, /Delete the field/);
  assert.equal(found[2].severity, "warning");
  // the fields Codex reads are not flagged
  r = run({ "config.toml": hook('timeout = 5\nasync = true\nstatusMessage = "hi"\nadditionalContextLimit = 10\ncommandWindows = "x"\ncommand_windows = "x"\n'), "abs:/bin/node": "x" });
  assert.equal(r.findings.filter((f) => f.id === "hook-field-unknown").length, 0);
  // in a hooks.json the line is the one that names the field; an mcp_tool handler has its own fields
  const json = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node y.mjs", timeoutSec: 5 }, { type: "mcp_tool", server: "s", tool: "t", timeout_sec: 2, input: {} }] }] } }, null, 2);
  r = run({ "config.toml": "", "hooks.json": json, "abs:/bin/node": "x" });
  assert.deepEqual(r.findings.filter((f) => f.id === "hook-field-unknown").map((f) => [f.line, /`(\w+)`, which/.exec(f.message)[1]]), [[9, "timeoutSec"], [15, "timeout_sec"]]);
  // a hook of a project that is not trusted is not read, so its fields are not judged
  r = run({ "config.toml": "", "work/.codex/config.toml": hook("timeout_sec = 5\n") }, { trusted: false });
  assert.equal(r.findings.filter((f) => f.id === "hook-field-unknown").length, 0);
});

test("hooks of a project that is not trusted are not judged", () => {
  const r = run({ "config.toml": "", "work/.codex/config.toml": '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "nosuch"\n' }, { trusted: false });
  none(r, "hook-command-missing");
  none(r, "hook-untrusted");
  one(r, "untrusted-project");
});

test("AGENTS.md: over the cap (which file, by how much), empty, hidden, garbled", () => {
  const big = "x".repeat(20 * 1024);
  let r = run({ "config.toml": "", "work/AGENTS.md": big, "work/a/AGENTS.md": big, "work/a/b/AGENTS.md": "small" }, { extra: {} });
  // the working folder is /w/work
  const c = collect(r.m.sys, { project: r.m.j("work", "a", "b") });
  r = { ...lint(c), c };
  const over = one(r, "agents-md-over-cap");
  assert.match(over.message, /work[\\/]a[\\/]AGENTS\.md is the first file that does not fit: Codex reads 12,288 bytes of its 20,480 bytes and leaves out 1 more file/);
  assert.match(over.effect, /prints nothing/);
  none(run({ "config.toml": "", "work/AGENTS.md": "small" }), "agents-md-over-cap");
  r = run({ "config.toml": "", "work/AGENTS.md": "  \n" });
  assert.equal(one(r, "agents-md-empty").severity, "note");
  r = run({ "config.toml": "", "work/AGENTS.md": "real", "work/AGENTS.override.md": "" });
  const hidden = one(r, "agents-md-shadowed");
  assert.equal(hidden.severity, "warning");
  assert.match(hidden.message, /AGENTS\.override\.md is in the same folder/);
  r = run({ "config.toml": "", "work/AGENTS.md": "real", "work/AGENTS.override.md": "override" });
  assert.equal(one(r, "agents-md-shadowed").severity, "note");
  r = run({ "config.toml": "", "work/AGENTS.md": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("ROOT\n", "utf16le")]) });
  assert.match(one(r, "agents-md-encoding").message, /UTF-16/);
  r = run({ "config.toml": "", "work/AGENTS.md": "\ufeffROOT\n" });
  assert.equal(one(r, "agents-md-encoding").severity, "note");
  none(run({ "config.toml": "", "work/AGENTS.md": "café\n" }), "agents-md-encoding");
});

test("rules: a file that does not load, a failing example, a shadowed allow, an allow Codex ignores, a file this tool cannot run", () => {
  let r = run({ "config.toml": "", "rules/default.rules": 'prefix_rule(pattern=["ls"], decision="allow"\n' });
  const bad = one(r, "rules-syntax");
  assert.equal(bad.severity, "error");
  assert.match(bad.effect, /Error loading rules/);
  r = run({ "config.toml": "", "rules/default.rules": '\ufeffprefix_rule(pattern=["ls"])\n' });
  assert.match(one(r, "rules-syntax").fix, /byte order mark/);
  r = run({ "config.toml": "", "rules/default.rules": 'prefix_rule(pattern=["git", "pull"], match=["git push"], not_match=["git pull x"])\n' });
  assert.equal(r.findings.filter((f) => f.id === "rules-example-fails").length, 2);
  r = run({ "config.toml": "", "rules/default.rules": 'prefix_rule(pattern=["git", "status"], decision="allow")\nprefix_rule(pattern=["git"], decision="prompt")\n' });
  const shadow = one(r, "rules-shadowed");
  assert.deepEqual([shadow.line, shadow.severity], [1, "note"]);
  r = run({ "config.toml": "", "rules/default.rules": 'prefix_rule(pattern=["git"], decision="allow")\nprefix_rule(pattern=["npm"], decision="allow")\nprefix_rule(pattern=["bash"], decision="prompt")\n' });
  const ignored = one(r, "rules-allow-ignored");
  assert.equal(ignored.line, 1);
  assert.match(ignored.fix, /\["git", "status"\]/);
  r = run({ "config.toml": "", "rules/default.rules": 'def f(*a):\n    pass\n' });
  assert.equal(one(r, "rules-unevaluated").severity, "note");
  // files that are not read: in a subfolder, with another extension, in capitals
  r = run({ "config.toml": "", "rules/sub/a.rules": "syntax error (", "rules/b.txt": "(", "rules/C.RULES": "(" });
  none(r, "rules-syntax");
  // a project's rules are judged only when the project is trusted
  none(run({ "config.toml": "", "work/.codex/rules/a.rules": "(" }, { trusted: false }), "rules-syntax");
  one(run({ "config.toml": "", "work/.codex/rules/a.rules": "(" }), "rules-syntax");
});

test("mcp: a program that is not found (an error when required), a command line in command, a transport that is not one", () => {
  let r = run({ "config.toml": '[mcp_servers.x]\ncommand = "nosuch"\n' });
  const f = one(r, "mcp-command-missing");
  assert.equal(f.severity, "warning");
  assert.equal(f.line, 1);
  assert.match(f.file, /config.toml$/);
  assert.match(f.effect, /in silence/);
  r = run({ "config.toml": '[mcp_servers.x]\ncommand = "node -e 0"\n', "abs:/bin/node": "x" });
  assert.match(one(r, "mcp-command-missing").fix, /command = "node" and args = \["-e","0"\]/);
  r = run({ "config.toml": '[mcp_servers.x]\ncommand = "nosuch"\nrequired = true\n' });
  assert.equal(one(r, "mcp-command-missing").severity, "error");
  none(run({ "config.toml": '[mcp_servers.x]\ncommand = "nosuch"\nenabled = false\n' }), "mcp-command-missing");
  none(run({ "config.toml": '[mcp_servers.x]\ncommand = "node"\n', "abs:/bin/node": "x" }), "mcp-command-missing");
  none(run({ "config.toml": '[mcp_servers.x]\nurl = "http://127.0.0.1:1/mcp"\n' }), "mcp-command-missing");
  assert.equal(run({ "config.toml": '[mcp_servers.x]\ncommand = "a"\nurl = "http://x"\n' }).findings.filter((x) => x.id === "mcp-invalid").length, 1);
  assert.match(one(run({ "config.toml": "[mcp_servers.x]\nargs = []\n" }), "mcp-invalid").message, /neither/);
  assert.match(one(run({ "config.toml": '[mcp_servers.x]\ncommand = "a"\nbearer_token_env_var = "T"\n' }), "mcp-invalid").message, /bearer_token_env_var/);
});

test("mcp on Windows: a .cmd or .bat on PATH is found, a .ps1 or a file with no extension is not", () => {
  const win = (files) => run({ "config.toml": '[mcp_servers.x]\ncommand = "tool"\n', ...files }, { platform: "win32" });
  none(win({ "abs:C:\\bin\\tool.cmd": "x" }), "mcp-command-missing");
  none(win({ "abs:C:\\bin\\tool.BAT": "x" }), "mcp-command-missing");
  one(win({ "abs:C:\\bin\\tool.ps1": "x" }), "mcp-command-missing");
  one(win({ "abs:C:\\bin\\tool": "x" }), "mcp-command-missing");
  none(run({ "config.toml": '[mcp_servers.x]\ncommand = "C:\\\\tools\\\\tool"\n', "abs:C:\\tools\\tool.exe": "x" }, { platform: "win32" }), "mcp-command-missing");
});

test("providers: reserved ids, wire_api, undefined provider, the key variable, no base_url, no name, auth with env_key", () => {
  const p = (extra = "", top = 'model_provider = "p"\n') => ({ "config.toml": `${top}[model_providers.p]\nname = "p"\nbase_url = "http://127.0.0.1:1/v1"\nenv_key = "PKEY"\nwire_api = "responses"\n${extra}` });
  let r = run(p());
  assert.match(one(r, "provider-env-key-unset").message, /PKEY/);
  none(run(p(), { env: { PKEY: "x" } }), "provider-env-key-unset");
  none(run({ "config.toml": p()["config.toml"].replace('model_provider = "p"\n', "") }), "provider-env-key-unset");
  r = run({ "config.toml": '[model_providers.openai]\nname = "x"\n' });
  assert.match(one(r, "provider-reserved-id").effect, /reserved built-in provider IDs: `openai`/);
  r = run({ "config.toml": 'model_provider = "p"\n[model_providers.p]\nname = "p"\nbase_url = "http://x"\nwire_api = "chat"\n' });
  assert.match(one(r, "provider-wire-api").effect, /no longer supported/);
  r = run({ "config.toml": 'model_provider = "nope"\n' });
  assert.match(one(r, "provider-undefined").effect, /Model provider `nope` not found/);
  none(run({ "config.toml": 'model_provider = "openai"\n' }), "provider-undefined");
  r = run({ "config.toml": 'model_provider = "p"\n[model_providers.p]\nname = "p"\n' });
  one(r, "provider-base-url");
  r = run({ "config.toml": 'model_provider = "p"\n[model_providers.p]\nbase_url = "http://x"\n' });
  assert.match(one(r, "provider-conflict").message, /no `name`/);
  r = run({ "config.toml": 'model_provider = "p"\n[model_providers.p]\nname = "p"\nbase_url = "http://x"\nenv_key = "K"\n[model_providers.p.auth]\ncommand = "x"\n' });
  assert.match(one(r, "provider-conflict").message, /both `auth` and `env_key`/);
  none(run({ "config.toml": 'model_provider = "p"\n[model_providers.p]\nname = "p"\nbase_url = "http://x"\n' }), "provider-base-url");
});

test("windows-sandbox: none selected, the build for mxc, the log, elevated; and nothing off Windows", () => {
  const win = (cfg, o = {}) => run({ "config.toml": cfg, ...(o.files || {}) }, { platform: "win32", extra: { release: "10.0.26300" }, ...o });
  let r = win("");
  let f = one(r, "windows-sandbox");
  assert.match(f.message, /No Windows sandbox is selected/);
  assert.match(f.message, /becomes read-only/);
  assert.match(f.fix, /sandbox = "unelevated"/);
  assert.match(f.effect, /Windows sandbox selection: disabled/);
  none(win('[windows]\nsandbox = "unelevated"\n'), "windows-sandbox");
  none(win("[features]\nprefer_mxc = true\n"), "windows-sandbox");
  none(win('sandbox_mode = "danger-full-access"\n'), "windows-sandbox");
  none(run({ "config.toml": "" }, { platform: "linux" }), "windows-sandbox");
  none(run({ "config.toml": "" }, { platform: "darwin" }), "windows-sandbox");
  r = run({ "config.toml": '[windows]\nsandbox = "mxc"\n' }, { platform: "win32", extra: { release: "10.0.22631" } });
  f = one(r, "windows-sandbox");
  assert.deepEqual([f.severity, f.basis], ["error", "binary"]);
  assert.match(f.message, /build 22631/);
  r = run({ "config.toml": '[windows]\nsandbox = "mxc"\n' }, { platform: "win32", extra: { release: "10.0.26100" } });
  assert.equal(one(r, "windows-sandbox").severity, "note");
  r = run({ "config.toml": '[windows]\nsandbox = "mxc"\n', ".sandbox/sandbox.2026-10-17.log": "[2026-10-17 23:51:02.106 codex.exe] MXC availability: false\n[2026-10-17 23:51:02.107 codex.exe] Windows sandbox selection: mxc\n" }, { platform: "win32", extra: { release: "10.0.26300" } });
  assert.match(one(r, "windows-sandbox").message, /MXC availability: false/);
  r = run({ "config.toml": '[windows]\nsandbox = "mxc"\n', ".sandbox/sandbox.2026-10-17.log": "[2026-10-17 23:51:02.106 codex.exe] MXC availability: true\n" }, { platform: "win32", extra: { release: "10.0.26300" } });
  none(r, "windows-sandbox");
  r = win('[windows]\nsandbox = "elevated"\n');
  assert.equal(one(r, "windows-sandbox").severity, "note");
});

test("codex-home: CODEX_HOME names a folder that is not there", () => {
  const sys = fakeSys({ platform: "linux", home: "/h", cwd: "/p", env: { CODEX_HOME: "/nope" } });
  const r = lint(collect(sys, { project: "/p" }));
  const f = r.findings.find((x) => x.id === "codex-home");
  assert.equal(f.severity, "error");
  assert.match(f.effect, /but that path does not exist/);
});

test("the help text names every command and option", () => {
  for (const w of ["show", "lint", "why", "agents", "cost", "explain", "--json", "--project", "--profile", "--markdown", "--shell", "--print", "--list"]) assert.ok(HELP.includes(w), w);
});
