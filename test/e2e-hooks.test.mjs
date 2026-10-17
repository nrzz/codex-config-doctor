// Hooks, put to the real Codex: the keys, hashes and trust statuses of the hooks of every world of test/hooks-table.mjs (asked of the app
// server, and compared with the record the unit tests hold the code to), and what Codex does in the worlds of the hook findings: both
// formats, a hooks.json that does not parse, an event that does not exist, a program that is not there, a hook that is not trusted or has
// changed, features.hooks = false, and a hook that answers "ask". The hook that records its runs is test/record-hook.mjs.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { askHooks, pool, PARALLEL } from "./ask.mjs";
import { exec, lintWorld, noise } from "./behave.mjs";
import { AppServer } from "./app-server.mjs";
import { hookHash } from "../src/hooks.mjs";
import { IS_WIN, fakeApi, gitInit, sandbox, shellCall, skip, writeUserConfig } from "./codex-sandbox.mjs";
import { ROOT, fwd } from "./helpers.mjs";
import { SCENARIOS } from "./hooks-table.mjs";

const opts = { skip: skip() };
const HOOK = fwd(path.join(ROOT, "test", "record-hook.mjs"));
const BYPASS = "--dangerously-bypass-hook-trust";
const cmd = (sb, event, mode = "") => `node "${HOOK}" ${event} "${fwd(sb.hookLog)}"${mode ? ` ${mode}` : ""}`;
const toml = (sb, event = "SessionStart", mode = "") => `[[hooks.${event}]]\n[[hooks.${event}.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(cmd(sb, event, mode))}\ntimeout = 30\n`;
const json = (sb, event = "SessionStart") => JSON.stringify({ hooks: { [event]: [{ hooks: [{ type: "command", command: cmd(sb, `${event}Json`), timeout: 30 }] }] } });
const ran = (r) => r.hookRuns.map((h) => h.event);

test("the hooks Codex lists in every world of the table are the recorded ones: keys, hashes, statuses", opts, async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "hooks-oracle.json"), "utf8"));
  // the scenario with a commandWindows is the Windows one: elsewhere Codex lists the command, and the next test holds that
  const usable = SCENARIOS.filter((s) => !s.windowsOnly || IS_WIN);
  const live = await pool(usable, PARALLEL, askHooks);
  const wrong = [];
  for (const s of live) {
    const want = fixture.scenarios.find((x) => x.name === s.name);
    if (!want) { wrong.push(`${s.name}: not in the record`); continue; }
    if (JSON.stringify(s) !== JSON.stringify(want)) {
      const a = JSON.stringify(s);
      const b = JSON.stringify(want);
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      wrong.push(`${s.name}: live ...${a.slice(Math.max(0, i - 40), i + 80)} / record ...${b.slice(Math.max(0, i - 40), i + 80)}`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.equal(live.length, usable.length);
});

test("a handler with commandWindows: off Windows Codex lists the command, and its hash is the one this tool computes", { skip: skip() || (IS_WIN && "this check is for Linux and macOS: the recorded scenario is the Windows one") }, async () => {
  const live = await askHooks(SCENARIOS.find((s) => s.windowsOnly));
  assert.equal(live.hooks.length, 1);
  assert.equal(live.hooks[0].command, "echo posix");
  assert.equal(live.hooks[0].hash, hookHash("PreToolUse", "*", { async: false, command: "echo posix", timeout: 600, type: "command" }));
});

test("hooks-both-formats: a layer with a hooks.json and a [hooks] table loads both and warns", opts, async () => {
  const r = await exec({ label: "e2e-hooks-both", userTables: (sb) => toml(sb), files: { "codex-home/hooks.json": (sb) => json(sb) }, args: [BYPASS] });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /warning: loading hooks from both .*hooks\.json and .*config\.toml; prefer a single representation for this layer/);
  assert.deepEqual(ran(r).sort(), ["SessionStart", "SessionStartJson"], "both sets run");
  const l = lintWorld(r.sb);
  assert.equal(l.find("hooks-both-formats").length, 1);
});

test("hooks-json-error: a hooks.json that does not parse loads none of its hooks and warns", opts, async () => {
  const r = await exec({ label: "e2e-hooks-json", files: { "codex-home/hooks.json": "{ not json" }, args: [BYPASS] });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /warning: failed to parse hooks config .*hooks\.json: key must be a string at line 1 column 3/);
  assert.deepEqual(ran(r), []);
  assert.equal(lintWorld(r.sb).find("hooks-json-error").length, 1);
  // a byte order mark makes valid JSON unreadable for it (Windows PowerShell 5.1 writes one with Set-Content -Encoding UTF8)
  const bom = await exec({ label: "e2e-hooks-json-bom", files: { "codex-home/hooks.json": "\ufeff" + json({ hookLog: "x" }, "SessionStart") }, args: [BYPASS] });
  assert.match(bom.err, /warning: failed to parse hooks config .*hooks\.json: expected value at line 1 column 1/);
  assert.deepEqual(ran(bom), []);
  assert.match(lintWorld(bom.sb).find("hooks-json-error")[0].message, /byte order mark/);
});

test("hook-event-unknown: an event Codex does not have is ignored in silence", opts, async () => {
  const r = await exec({ label: "e2e-hooks-event", files: { "codex-home/hooks.json": (sb) => json(sb, "SessionBegin") }, args: [BYPASS] });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(noise(r.err).filter((l) => !/bypass-hook-trust/.test(l)), []);
  assert.deepEqual(ran(r), []);
  assert.equal(lintWorld(r.sb).find("hook-event-unknown").length, 1);
});

test("hook-command-missing: a hook whose program is not found fails and Codex goes on; a failing PreToolUse hook does not stop the call", opts, async () => {
  const table = (event) => `[[hooks.${event}]]\n[[hooks.${event}.hooks]]\ntype = "command"\ncommand = "nosuchprogxyz --flag"\ntimeout = 30\n`;
  const start = await exec({ label: "e2e-hooks-missing", userTables: table("SessionStart"), args: [BYPASS] });
  assert.equal(start.code, 0, start.err);
  assert.match(start.err, /hook: SessionStart\r?\nhook: SessionStart Failed/);
  assert.equal(lintWorld(start.sb).find("hook-command-missing").length, 1);
  const tool = await exec({ label: "e2e-hooks-missing-tool", userTables: table("PreToolUse"), userTop: 'sandbox_mode = "danger-full-access"\n', script: [shellCall("echo PROBE-HI"), { text: "DONE" }], args: [BYPASS] });
  assert.equal(tool.code, 0, tool.err);
  assert.match(tool.err, /hook: PreToolUse Failed/);
  assert.match(tool.err, /PROBE-HI/, "the command ran");
});

test("hook-untrusted and hook-modified: Codex skips a hook that has no record or a record of another hash; the key and hash lint prints are Codex's", opts, async () => {
  const first = await exec({ label: "e2e-hooks-trust", userTables: (sb) => toml(sb) });
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(ran(first), [], "no record: the hook is skipped");
  assert.deepEqual(noise(first.err), [], "and nothing is said");
  const found = lintWorld(first.sb).find("hook-untrusted");
  assert.equal(found.length, 1);
  const record = /\n(\[hooks\.state\.".*"\]\ntrusted_hash = "sha256:[0-9a-f]{64}")$/.exec(found[0].fix);
  assert.ok(record, found[0].fix);
  // the record lint printed, in the file, trusts the hook
  const withRecord = await exec({
    label: "e2e-hooks-trust-3",
    userTables: (sb) => toml(sb),
    before: async (sb) => {
      const l = lintWorld(sb).find("hook-untrusted")[0];
      const text = /\n(\[hooks\.state\.".*"\]\ntrusted_hash = "sha256:[0-9a-f]{64}")$/.exec(l.fix)[1];
      fs.appendFileSync(sb.user, `\n${text}\n`);
    },
  });
  assert.equal(withRecord.code, 0, withRecord.err);
  assert.deepEqual(ran(withRecord), ["SessionStart"], "with the record lint printed, the hook runs");
  assert.deepEqual(lintWorld(withRecord.sb).find("hook-untrusted"), []);
  assert.deepEqual(lintWorld(withRecord.sb).find("hook-modified"), []);
  // change the hook after it was trusted: the timeout is part of the hash
  const modified = await exec({
    label: "e2e-hooks-trust-4",
    userTables: (sb) => toml(sb),
    before: async (sb) => {
      const l = lintWorld(sb).find("hook-untrusted")[0];
      const text = /\n(\[hooks\.state\.".*"\]\ntrusted_hash = "sha256:[0-9a-f]{64}")$/.exec(l.fix)[1];
      fs.appendFileSync(sb.user, `\n${text}\n`);
      fs.writeFileSync(sb.user, fs.readFileSync(sb.user, "utf8").replace("timeout = 30", "timeout = 31"));
    },
  });
  assert.deepEqual(ran(modified), [], "a changed hook is skipped");
  assert.deepEqual(noise(modified.err), []);
  assert.equal(lintWorld(modified.sb).find("hook-modified").length, 1);
});

test("hook-untrusted: the bypass flag runs a hook without a record", opts, async () => {
  const r = await exec({ label: "e2e-hooks-bypass", userTables: (sb) => toml(sb), args: [BYPASS] });
  assert.deepEqual(ran(r), ["SessionStart"]);
  assert.match(r.err, /warning: `--dangerously-bypass-hook-trust` is enabled\. Enabled hooks may run without review for this invocation\./);
});

test("hooks-feature-off: features.hooks = false runs no hook, in silence", opts, async () => {
  const r = await exec({ label: "e2e-hooks-off", userTables: (sb) => `[features]\nhooks = false\n${toml(sb)}`, args: [BYPASS] });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(ran(r), []);
  assert.deepEqual(noise(r.err).filter((l) => !/bypass-hook-trust/.test(l)), []);
  assert.equal(lintWorld(r.sb).find("hooks-feature-off").length, 1);
});

test("hook-ask-unsupported: a PreToolUse hook that answers ask changes nothing; deny and block stop the command", opts, async () => {
  const run = (mode) => exec({ label: `e2e-hooks-${mode}`, userTables: (sb) => toml(sb, "PreToolUse", mode), userTop: 'sandbox_mode = "danger-full-access"\n', script: [shellCall("echo PROBE-HI"), { text: "DONE" }], args: [BYPASS, "--json"] });
  const items = (r) => r.out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)).filter((e) => e.item && e.item.type === "command_execution" && e.type === "item.completed");
  const ask = await run("ask");
  assert.deepEqual(ran(ask), ["PreToolUse"]);
  assert.equal(items(ask).length, 1, "the command ran");
  assert.equal(items(ask)[0].item.exit_code, 0);
  assert.equal(lintWorld(ask.sb).find("hook-ask-unsupported").length, 1);
  for (const mode of ["deny", "block"]) {
    const r = await run(mode);
    assert.equal(items(r).length, 0, `${mode}: the command did not run`);
    assert.match(r.err, new RegExp(`Command blocked by PreToolUse hook: recorded ${mode}\\. Command: echo PROBE-HI`));
  }
});

test("hook-field-unknown: a handler field Codex does not read is dropped in silence; the spelling it reads is honoured", opts, async () => {
  const listed = async (extra) => {
    const sb = sandbox("e2e-hooks-fields");
    gitInit(sb);
    const api = await fakeApi([]);
    try {
      writeUserConfig(sb, api, { tables: `[[hooks.UserPromptSubmit]]\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = "echo x"\n${extra}\n` });
      const srv = new AppServer(sb, { cwd: sb.work, online: true });
      try {
        await srv.start();
        const r = await srv.request("hooks/list", { cwds: [sb.work] });
        return { hook: r.data[0].hooks[0], warnings: r.data[0].warnings, errors: r.data[0].errors.length, ids: lintWorld(sb).ids };
      } finally { await srv.close(); }
    } finally { await api.close(); }
  };
  const base = await listed("");
  assert.equal(base.hook.timeoutSec, 600);
  for (const [field, extra, check] of [
    ["timeout_sec", "timeout_sec = 5", (h) => h.timeoutSec === 600],
    ["timeoutSec", "timeoutSec = 5", (h) => h.timeoutSec === 600],
    ["status_message", 'status_message = "hi"', (h) => h.statusMessage === null],
    ["additional_context_limit", "additional_context_limit = 10", (h) => h.currentHash === base.hook.currentHash],
    ["a field nobody reads", "whatever = 1", (h) => h.currentHash === base.hook.currentHash],
  ]) {
    const w = await listed(extra);
    assert.ok(check(w.hook), `${field}: dropped (${JSON.stringify({ timeoutSec: w.hook.timeoutSec, statusMessage: w.hook.statusMessage })})`);
    assert.deepEqual([w.warnings, w.errors], [[], 0], `${field}: in silence`);
    assert.ok(w.ids.includes("hook-field-unknown"), `${field}: lint says so`);
  }
  for (const [extra, check] of [["timeout = 5", (h) => h.timeoutSec === 5], ['statusMessage = "hi"', (h) => h.statusMessage === "hi"], ["additionalContextLimit = 10", (h) => h.currentHash !== base.hook.currentHash], ["async = true", (h) => h.async === true]]) {
    const w = await listed(extra);
    assert.ok(check(w.hook), extra);
    assert.ok(!w.ids.includes("hook-field-unknown"), `${extra}: not flagged`);
  }
});
