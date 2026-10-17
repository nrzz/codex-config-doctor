// The findings about configuration files, put to the real Codex. For each finding: a world that has the problem is run with `codex exec`
// against the fake Responses API (no model is reached, no token is spent), what Codex does is checked against what the finding says
// (the exit code, the words it prints), and `lint` is run on the same folder to check that it names the finding at the right line.
// They run when E2E_CODEX names a Codex command; the explain pages quote the words these checks found.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AppServer } from "./app-server.mjs";
import { fwd } from "./helpers.mjs";
import { exec, lintWorld, noise } from "./behave.mjs";
import { codexInfo, execArgs, fakeApi, gitInit, promptInput, put, runCodex, sandbox, shellCall, skip, skipUnlessWindows, writeUserConfig } from "./codex-sandbox.mjs";

const opts = { skip: skip() };
const LEGACY_PROFILE = '[profiles.x]\nmodel = "y"\n';

test("the binary is the one these checks are about", opts, () => {
  const info = codexInfo();
  assert.ok(info.ok, info.reason);
  assert.match(info.number, /^\d+\.\d+\.\d+/);
  console.log(`# Codex ${info.version}`);
});

test("codex-home: CODEX_HOME names a folder that is not there, or a file", opts, async () => {
  for (const [what, make] of [["does not exist", (sb) => path.join(sb.root, "nope")], ["is not a directory", (sb) => put(path.join(sb.root, "a-file"), "x")]]) {
    const sb = sandbox("e2e-codex-home");
    const bad = make(sb);
    const r = await promptInput(sb, { env: { CODEX_HOME: bad } });
    assert.equal(r.code, 1, what);
    assert.match(r.err, new RegExp(`CODEX_HOME points to ".*", but that path ${what}`), r.err);
    const l = lintWorld({ ...sb, codexHome: bad }, {});
    assert.equal(l.find("codex-home").length, 1, `${what}: ${l.ids}`);
    assert.equal(l.find("codex-home")[0].severity, "error");
  }
});

test("codex-home: a CODEX_HOME with spaces in it, or written with forward slashes and a trailing separator, is read", opts, async () => {
  // an empty CODEX_HOME or a relative one is not tried: on Windows an empty value sends Codex to the real profile folder
  const spaced = await exec({ label: "e2e home with spaces" });
  assert.match(spaced.sb.codexHome, / /, "the folder has spaces in its path");
  assert.equal(spaced.code, 0, spaced.err);
  assert.equal(spaced.model, "gpt-5.5", "the config.toml of the folder was read");
  assert.equal(lintWorld(spaced.sb).find("codex-home").length, 0);
  const slashed = await exec({ label: "e2e-home-slashes", env: (sb) => ({ CODEX_HOME: `${fwd(sb.codexHome)}/` }) });
  assert.equal(slashed.code, 0, slashed.err);
  assert.equal(slashed.model, "gpt-5.5");
});

test("toml-error: a user config.toml that does not parse stops Codex at the line lint names", opts, async () => {
  const r = await exec({ userTop: "foo bar = 1\n", label: "e2e-toml-error" });
  assert.equal(r.code, 1);
  assert.match(r.err, /Error loading config\.toml:/);
  const said = /config\.toml:(\d+):(\d+): key with no value, expected `=`/.exec(r.err);
  assert.ok(said, r.err);
  assert.equal(r.requests.length, 0, "no request was sent");
  const l = lintWorld(r.sb);
  assert.deepEqual(l.find("toml-error").map((f) => [f.line, f.column]), [[Number(said[1]), Number(said[2])]], "lint names the line and column Codex printed");
});

test("toml-error: a profile file that does not parse stops Codex too", opts, async () => {
  const r = await exec({ label: "e2e-toml-profile", files: { "codex-home/p.config.toml": "model = \n" }, args: ["--profile", "p"] });
  assert.equal(r.code, 1);
  assert.match(r.err, /Error loading config\.toml:/);
  assert.match(r.err, /p\.config\.toml:1:9/);
  const l = lintWorld(r.sb, { profile: "p" });
  assert.deepEqual(l.find("toml-error").map((f) => [path.basename(f.file), f.line]), [["p.config.toml", 1]]);
});

test("toml-error: a trusted project's config.toml with a syntax error stops Codex; an untrusted one is not opened until the folder is trusted", opts, async () => {
  const broken = 'model = "x"\nfoo bar = 1\n';
  const trusted = await exec({ label: "e2e-toml-project", trust: true, project: broken });
  assert.equal(trusted.code, 1);
  assert.match(trusted.err, /^Error loading config\.toml: Error parsing project config file .*config\.toml: TOML parse error at line 2, column 5/m);
  assert.equal(trusted.requests.length, 0);
  const l = lintWorld(trusted.sb);
  assert.deepEqual(l.find("toml-error").map((f) => [f.severity, f.line, f.column]), [["error", 2, 5]]);
  // not trusted: ignored, in silence, and `lint` says so
  const off = await exec({ label: "e2e-toml-project-off", project: broken });
  assert.equal(off.code, 0, off.err);
  assert.equal(off.requests.length, 1);
  assert.deepEqual(lintWorld(off.sb).find("toml-error").map((f) => [f.severity, f.line]), [["warning", 2]]);
  // a session with sandbox_mode danger-full-access trusts the folder first, and then meets the error
  const danger = await exec({ label: "e2e-toml-project-danger", userTop: 'sandbox_mode = "danger-full-access"\n', project: broken });
  assert.equal(danger.code, 1);
  assert.match(danger.err, /^Error: thread\/start: thread\/start failed: failed to load configuration: Error parsing project config file .*config\.toml: TOML parse error at line 2, column 5/m);
  assert.equal(danger.requests.length, 0);
});

test("untrusted-project: a run with sandbox_mode danger-full-access writes a trusted entry for the working folder, and the next run loads the folder's config", opts, async () => {
  const project = 'model = "gpt-5.4"\n';
  for (const [how, spec] of [["in the file", { userTop: 'sandbox_mode = "danger-full-access"\n' }], ["with --sandbox", { args: ["--sandbox", "danger-full-access"] }], ["with the bypass flag", { args: ["--dangerously-bypass-approvals-and-sandbox"] }]]) {
    const first = await exec({ label: "e2e-trust-danger", project, ...spec });
    assert.equal(first.code, 0, first.err);
    assert.equal(first.model, "gpt-5.5", `${how}: the first run did not load the project's file`);
    const text = readUser(first.sb);
    // Codex writes the key in single quotes on Windows (the path has backslashes) and in double quotes elsewhere
    const entry = /^\[projects\.(?:'([^']+)'|"([^"]+)")\]\ntrust_level = "trusted"$/m.exec(text);
    assert.ok(entry, `${how}: an entry was written:\n${text}`);
    assert.equal(entry[1] ?? entry[2], process.platform === "win32" ? first.sb.work.toLowerCase() : first.sb.work, `${how}: the folder, lower-cased on Windows`);
    assert.equal(lintWorld(first.sb).find("untrusted-project").length, 0, "after the run the project is trusted");
    // and the next session loads the folder's file: the app server reads the project's model, which wins over the user's
    const srv = new AppServer(first.sb, { cwd: first.sb.work, online: true });
    try {
      await srv.start();
      const cfg = await srv.request("config/read", { cwd: first.sb.work, includeLayers: false });
      assert.equal(cfg.config.model, "gpt-5.4", `${how}: the next session loads the folder's file`);
    } finally { await srv.close(); }
  }
  // the other sandbox modes: read-only and the default (read-only for a folder that is not trusted) write nothing; workspace-write writes the
  // entry where a sandbox can run it (Linux and macOS), and on Windows with no sandbox selected it is read-only, so it writes nothing
  const wrote = {};
  for (const [how, spec] of [["workspace-write", { args: ["--sandbox", "workspace-write"] }], ["read-only", { args: ["--sandbox", "read-only"] }], ["the default", {}]]) {
    const r = await exec({ label: "e2e-trust-safe", project, ...spec });
    assert.equal(r.code, 0, r.err);
    wrote[how] = /\[projects\./.test(readUser(r.sb));
  }
  assert.deepEqual(wrote, { "workspace-write": process.platform !== "win32", "read-only": false, "the default": false }, "which sandbox modes write an entry");
  // an entry that is there is left as it is
  const marked = await exec({ label: "e2e-trust-marked", project, userTop: 'sandbox_mode = "danger-full-access"\n', before: (sb) => { fs.appendFileSync(sb.user, `\n[projects.'${sb.work}']\ntrust_level = "untrusted"\n`); } });
  assert.equal(marked.code, 0, marked.err);
  assert.match(readUser(marked.sb), /trust_level = "untrusted"/);
  assert.doesNotMatch(readUser(marked.sb), /trust_level = "trusted"/);
});

test("a byte order mark and CRLF line endings are read; config-encoding: UTF-16 is not", opts, async () => {
  const ok = await exec({ label: "e2e-bom", before: (sb) => { fs.writeFileSync(sb.user, `\ufeff${readUser(sb).replace(/\n/g, "\r\n")}`); } });
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.requests.length, 1);
  assert.deepEqual(lintWorld(ok.sb).find("toml-error"), []);
  assert.deepEqual(lintWorld(ok.sb).find("config-encoding"), []);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('model = "gpt-5.5"\n', "utf16le")]);
  const r = await exec({ label: "e2e-utf16", rawUser: utf16 });
  assert.equal(r.code, 1);
  assert.match(r.err, /Failed to read config file .*config\.toml: invalid utf-8 sequence of 1 bytes from index 0/);
  assert.equal(lintWorld(r.sb).find("config-encoding").length, 1);
  assert.equal(lintWorld(r.sb).find("toml-error").length, 0);
});

const readUser = (sb) => fs.readFileSync(sb.user, "utf8");

test("unknown-key: Codex ignores the key and warns; --json prints nothing; --strict-config refuses to start", opts, async () => {
  const human = await exec({ label: "e2e-unknown", userTop: "aproval_policy = \"never\"\n" });
  assert.equal(human.code, 0, human.err);
  assert.match(human.err, /warning: Codex is ignoring 1 unrecognized configuration setting\. Check for typos or deprecated settings\./);
  assert.match(human.err, /`aproval_policy` is ignored/);
  const l = lintWorld(human.sb);
  assert.equal(l.find("unknown-key").length, 1);
  assert.match(l.find("unknown-key")[0].message, /Did you mean `approval_policy`\?/);
  const json = await exec({ label: "e2e-unknown-json", userTop: "aproval_policy = \"never\"\n", args: ["--json"] });
  assert.equal(json.code, 0);
  assert.doesNotMatch(json.err, /unrecognized configuration setting/, "nothing on stderr");
  const items = json.out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)).filter((e) => e.type === "item.completed" && e.item.type === "error");
  assert.ok(items.length >= 1, "in the event stream the warning is an item of type error");
  assert.match(items[0].item.message, /^Codex is ignoring 1 unrecognized configuration setting\. Check for typos or deprecated settings\.\n {2}user \(.*config\.toml\): `aproval_policy` is ignored\.$/);
  const strict = await exec({ label: "e2e-unknown-strict", userTop: "foo = 1\n", top: ["--strict-config"] });
  assert.equal(strict.code, 1);
  assert.match(strict.err, /Error loading config\.toml:/);
  assert.match(strict.err, /unknown configuration field `foo`/);
  assert.equal(strict.requests.length, 0);
});

test("unknown-key: a table key, a feature flag, and the same in a profile file and a project", opts, async () => {
  const r = await exec({ label: "e2e-unknown-2", userTables: "[sandbox_workspace_write]\nnetwork = true\n[features]\nhoks = true\n" });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /warning: Codex is ignoring 2 unrecognized configuration settings/);
  assert.match(r.err, /`sandbox_workspace_write\.network` is ignored/);
  assert.match(r.err, /`features\.hoks` is ignored/);
  const l = lintWorld(r.sb);
  assert.deepEqual(l.find("unknown-key").map((f) => f.line !== null), [true]);
  assert.equal(l.find("feature-unknown").length, 1);
  const flag = await exec({ label: "e2e-enable", args: ["--enable", "nosuch"] });
  assert.equal(flag.code, 1);
  assert.match(flag.err, /Error: Unknown feature flag: nosuch/);
  const profile = await exec({ label: "e2e-unknown-profile", files: { "codex-home/p.config.toml": "foo = 1\n" }, args: ["--profile", "p"] });
  assert.match(profile.err, /`foo` is ignored/);
  assert.equal(lintWorld(profile.sb, { profile: "p" }).find("unknown-key").length, 1);
  const project = await exec({ label: "e2e-unknown-project", trust: true, project: "foo = 1\n" });
  assert.match(project.err, /`foo` is ignored/);
  assert.equal(lintWorld(project.sb).find("unknown-key").length, 1);
});

test("wrong-type: a value of the wrong type or outside the allowed words stops Codex", opts, async () => {
  const cases = [
    ["features hooks = \"yes\"", "", '[features]\nhooks = "yes"\n', /invalid type: string "yes", expected a boolean/],
    ["review_model = 5", "review_model = 5\n", "", /invalid type: integer `5`, expected a string/],
    ["project_doc_max_bytes = -1", "project_doc_max_bytes = -1\n", "", /invalid value: integer `-1`, expected usize/],
    ["sandbox_mode = \"bogus\"", 'sandbox_mode = "bogus"\n', "", /unknown variant `bogus`, expected one of `read-only`, `workspace-write`, `danger-full-access`/],
  ];
  for (const [name, top, tables, re] of cases) {
    const r = await exec({ label: "e2e-wrong-type", userTop: top, userTables: tables });
    assert.equal(r.code, 1, name);
    assert.match(r.err, re, `${name}: ${r.err}`);
    assert.equal(r.requests.length, 0);
    const l = lintWorld(r.sb);
    assert.ok(l.find("wrong-type").length >= 1, `${name}: ${l.ids}`);
  }
  // the granular form needs all five keys; model_reasoning_effort takes any word
  const granular = await exec({ label: "e2e-granular", userTop: "approval_policy = { granular = { sandbox_approval = true } }\n" });
  assert.equal(granular.code, 1);
  assert.match(granular.err, /missing field `rules`/);
  const effort = await exec({ label: "e2e-effort", userTop: 'model_reasoning_effort = "whatever"\n' });
  assert.equal(effort.code, 0, effort.err);
  assert.deepEqual(lintWorld(effort.sb).find("wrong-type"), []);
});

test("key-removed: experimental_thread_store_endpoint is refused with its own words", opts, async () => {
  const r = await exec({ label: "e2e-removed", userTop: 'experimental_thread_store_endpoint = "http://127.0.0.1:1"\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /`experimental_thread_store_endpoint` is no longer supported; remove it from config\.toml/);
  const l = lintWorld(r.sb);
  assert.equal(l.find("key-removed").length, 1);
  assert.equal(l.find("unknown-key").length, 0);
  const strict = await exec({ label: "e2e-removed-strict", userTop: 'experimental_thread_store_endpoint = "http://127.0.0.1:1"\n', top: ["--strict-config"] });
  assert.match(strict.err, /no longer supported/);
});

test("ignored-in-project: the ten keys are ignored in a project's config.toml, with a warning; the rest of the file applies", opts, async () => {
  const project = 'model = "gpt-5.4"\nnotify = ["x"]\nmodel_provider = "other"\n[model_providers.other]\nname = "o"\nbase_url = "http://127.0.0.1:1/v1"\n';
  const r = await exec({ label: "e2e-ignored", trust: true, project });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /warning: Ignored unsupported project-local config keys in .*config\.toml: model_provider, model_providers, notify\. If you want these settings to apply, manually set them in your user-level config\.toml\./);
  assert.equal(r.model, "gpt-5.4", "the rest of the project's file applies");
  assert.equal(r.requests.length, 1, "the request went to the user's provider");
  const l = lintWorld(r.sb);
  assert.equal(l.find("ignored-in-project").length, 1);
  assert.deepEqual(l.find("ignored-in-project")[0].message.match(/`[a-z_]+`/g), ["`model_provider`", "`model_providers`", "`notify`"]);
  assert.equal(l.find("ignored-in-project")[0].line, 2);
  const json = await exec({ label: "e2e-ignored-json", trust: true, project, args: ["--json"] });
  assert.doesNotMatch(json.err, /Ignored unsupported project-local config keys/, "nothing on stderr");
  assert.match(json.out, /"type":"error","message":"Ignored unsupported project-local config keys in .*: model_provider, model_providers, notify\./, "the warning is an item of type error in the event stream");
});

test("untrusted-project: an untrusted project's config.toml is ignored in silence; a trusted one applies", opts, async () => {
  const project = 'model = "gpt-5.4"\n';
  const off = await exec({ label: "e2e-untrusted", trust: false, project });
  assert.equal(off.code, 0, off.err);
  assert.equal(off.model, "gpt-5.5", "the user's model");
  assert.deepEqual(noise(off.err).filter((l) => /project|trust/i.test(l)), [], "codex exec prints nothing about it");
  const l = lintWorld(off.sb);
  assert.equal(l.find("untrusted-project").length, 1);
  assert.match(l.find("untrusted-project")[0].fix, /trust_level = "trusted"/);
  const on = await exec({ label: "e2e-trusted", trust: true, project });
  assert.equal(on.model, "gpt-5.4", "the project's model");
  assert.equal(lintWorld(on.sb).find("untrusted-project").length, 0);
  const marked = await exec({ label: "e2e-untrusted-level", trust: false, userTables: "", project, before: (sb) => { put(sb.user, `${readUser(sb)}\n[projects.'${sb.work}']\ntrust_level = "untrusted"\n`); } });
  assert.equal(marked.model, "gpt-5.5");
  assert.match(lintWorld(marked.sb).find("untrusted-project")[0].message, /marked untrusted/);
});

test("trust-key-spelling: on Windows an entry with forward slashes, a trailing backslash or a \\\\?\\ prefix does not trust the folder; capitals and the spelling of Codex's own warning do", { skip: skipUnlessWindows() }, async () => {
  const entry = (spell) => (sb) => { put(sb.user, `${readUser(sb)}\n[projects.'${spell(sb.work)}']\ntrust_level = "trusted"\n`); };
  for (const [how, spell] of [["forward slashes", (p) => p.replace(/\\/g, "/")], ["a trailing separator", (p) => `${p}\\`], ["the \\\\?\\ prefix", (p) => `\\\\?\\${p}`]]) {
    const r = await exec({ label: "e2e-trust-spell", project: 'model = "gpt-5.4"\n', before: entry(spell) });
    assert.equal(r.model, "gpt-5.5", `${how}: the project stays untrusted`);
    const l = lintWorld(r.sb);
    assert.equal(l.find("trust-key-spelling").length, 1, `${how}: ${l.ids}`);
    assert.equal(l.find("untrusted-project").length, 1, how);
  }
  const upper = await exec({ label: "e2e-trust-upper", project: 'model = "gpt-5.4"\n', before: entry((p) => p.toUpperCase()) });
  assert.equal(upper.model, "gpt-5.4", "case does not matter on Windows");
  assert.equal(lintWorld(upper.sb).find("trust-key-spelling").length, 0);
  // the folder the app server's warning names (lower case, backslashes), written as it is, trusts the project
  const hinted = await exec({
    label: "e2e-trust-hint",
    project: 'model = "gpt-5.4"\n',
    before: async (sb) => {
      const srv = new AppServer(sb, { cwd: sb.work, online: true });
      try {
        await srv.start();
        await srv.request("config/read", { cwd: sb.work, includeLayers: true });
        const warning = srv.notifications.filter((n) => n.method === "configWarning").map((n) => n.params.summary).join("\n");
        const said = /add (.*) as a trusted project in /.exec(warning);
        assert.ok(said, warning);
        assert.equal(said[1], sb.work.toLowerCase(), "the folder, in lower case, with backslashes");
        put(sb.user, `${readUser(sb)}\n[projects.'${said[1]}']\ntrust_level = "trusted"\n`);
      } finally { await srv.close(); }
    },
  });
  assert.equal(hinted.model, "gpt-5.4");
});

test("profile-legacy: profile = \"x\" and [profiles.x] are no longer read", opts, async () => {
  const selector = await exec({ label: "e2e-legacy-1", userTop: 'profile = "x"\n', userTables: LEGACY_PROFILE });
  assert.equal(selector.code, 1);
  assert.match(selector.err, /legacy `profile = "x"` config is no longer supported; use `--profile x` with `x\.config\.toml` instead/);
  assert.equal(lintWorld(selector.sb).find("profile-legacy").filter((f) => f.severity === "error").length, 1);
  const used = await exec({ label: "e2e-legacy-2", userTables: LEGACY_PROFILE, files: { "codex-home/x.config.toml": 'model = "z"\n' }, args: ["--profile", "x"] });
  assert.equal(used.code, 1);
  assert.match(used.err, /--profile `x` cannot be used while .*config\.toml contains legacy `profile = "x"` or `\[profiles\.x\]` config; move those settings into .*x\.config\.toml and remove the legacy profile selector\/table\./);
  assert.equal(lintWorld(used.sb, { profile: "x" }).find("profile-legacy")[0].severity, "error");
  const idle = await exec({ label: "e2e-legacy-3", userTables: LEGACY_PROFILE });
  assert.equal(idle.code, 0, idle.err);
  assert.deepEqual(noise(idle.err), [], "a table nothing uses is accepted in silence");
  assert.deepEqual(lintWorld(idle.sb).find("profile-legacy").map((f) => f.severity), ["note"]);
});

test("profile-missing: --profile with no file starts without it, in silence; a name that is not plain is refused", opts, async () => {
  const r = await exec({ label: "e2e-profile-missing", args: ["--profile", "nope"] });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(noise(r.err), []);
  assert.equal(r.requests.length, 1);
  assert.equal(lintWorld(r.sb, { profile: "nope" }).find("profile-missing").length, 1);
  const bad = await exec({ label: "e2e-profile-bad", args: ["--profile", "../evil"] });
  assert.equal(bad.code, 2);
  assert.match(bad.err, /invalid --profile value `\.\.\/evil`; pass a plain name such as `work`/);
  assert.match(lintWorld(bad.sb, { profile: "../evil" }).find("profile-missing")[0].message, /not a plain name/);
  const good = await exec({ label: "e2e-profile-good", files: { "codex-home/work.config.toml": 'model = "gpt-5.4"\n' }, args: ["--profile", "work"] });
  assert.equal(good.model, "gpt-5.4");
  assert.equal(lintWorld(good.sb, { profile: "work" }).find("profile-missing").length, 0);
});

test("approval-deprecated: untrusted stops Codex; on-failure starts and gives the model the text of on-request", opts, async () => {
  const bad = await exec({ label: "e2e-approval", userTop: 'approval_policy = "untrusted"\n' });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /approval_policy = "untrusted" is no longer supported; remove this setting/);
  assert.equal(lintWorld(bad.sb).find("approval-deprecated")[0].severity, "error");
  const texts = {};
  for (const policy of ["on-failure", "on-request"]) {
    const sb = sandbox("e2e-approval-text");
    const api = await fakeApi([]);
    try {
      writeUserConfig(sb, api, { top: `approval_policy = "${policy}"\nsandbox_mode = "read-only"\n` });
      const r = await promptInput(sb, {});
      assert.equal(r.code, 0, r.err);
      texts[policy] = r.texts.find((t) => /^<permissions instructions>/.test(t));
      if (policy === "on-failure") assert.equal(lintWorld(sb).find("approval-deprecated")[0].severity, "warning");
    } finally { await api.close(); }
  }
  assert.ok(texts["on-failure"] && texts["on-request"]);
  assert.equal(texts["on-failure"].length, texts["on-request"].length, "the same permissions text, character for character in size");
});

test("feature-alias, feature-unknown, feature-removed, feature-deprecated: what Codex prints for each", opts, async () => {
  const alias = await exec({ label: "e2e-feat-alias", userTables: "[features]\ncodex_hooks = true\n" });
  assert.match(alias.err, /deprecated: `\[features\]\.codex_hooks` is deprecated\. Use `\[features\]\.hooks` instead\./);
  assert.equal(lintWorld(alias.sb).find("feature-alias").length, 1);
  const unknown = await exec({ label: "e2e-feat-unknown", userTables: "[features]\nhoks = true\n" });
  assert.match(unknown.err, /`features\.hoks` is ignored/);
  const removed = await exec({ label: "e2e-feat-removed", userTables: "[features]\njs_repl = true\nelevated_windows_sandbox = true\ntool_search = false\n" });
  assert.equal(removed.code, 0, removed.err);
  assert.deepEqual(noise(removed.err).filter((l) => /deprecat|unrecognized|ignored/i.test(l)), [], "Codex accepts removed flags in silence");
  assert.equal(lintWorld(removed.sb).find("feature-removed").length, 3);
  const deprecated = await exec({ label: "e2e-feat-deprecated", userTables: "[features]\nweb_search_request = true\n" });
  assert.match(deprecated.err, /deprecated: `\[features\]\.web_search_request` is deprecated because web search is enabled by default\./);
  assert.equal(lintWorld(deprecated.sb).find("feature-deprecated").length, 1);
});

test("env-policy-mix: filters together with exclude or include_only stop Codex", opts, async () => {
  const r = await exec({ label: "e2e-env-mix", userTables: '[shell_environment_policy]\ninclude_only = ["PATH"]\n[shell_environment_policy.filters]\n"B*" = "exclude"\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /config\.toml:\d+:\d+: cannot mix `filters` with legacy `exclude` or `include_only`/);
  assert.equal(lintWorld(r.sb).find("env-policy-mix").length, 1);
  const alone = await exec({ label: "e2e-env-alone", userTables: '[shell_environment_policy]\ninclude_only = ["PATH"]\n' });
  assert.equal(alone.code, 0, alone.err);
  assert.equal(lintWorld(alone.sb).find("env-policy-mix").length, 0);
});

void gitInit;
void shellCall;
