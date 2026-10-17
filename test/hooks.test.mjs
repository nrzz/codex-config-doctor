// Hook discovery: that the key, the hash and the trust status of every hook of test/hooks-table.mjs are Codex's (the record of
// test/fixtures/hooks-oracle.json, made from the app server's hooks/list), on a Linux and a Windows machine, and the small parts.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ROOT } from "./helpers.mjs";
import { fakeSys } from "./fakesys.mjs";
import { SCENARIOS } from "./hooks-table.mjs";
import { canonicalJson, commandWords, discoverHooks, hookHash, hookScript, programFound, programOf, scriptAsks } from "../src/hooks.mjs";
import { discover, mergeLayers } from "../src/layers.mjs";
import { parseToml } from "../src/toml.mjs";

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "hooks-oracle.json"), "utf8"));

/** The machine of a scenario with its state text (the trust records are rebuilt with this machine's paths). */
function world(platform, s, want) {
  const win = platform === "win32";
  const root = win ? "C:\\ccdroot" : "/ccdroot";
  const sep = win ? "\\" : "/";
  const j = (...p) => [root, ...p].join(sep);
  const sys = fakeSys({ platform, home: j("home"), cwd: j("work"), env: { CODEX_HOME: j("codex-home") } });
  const state = (want.stateEntries || []).map((r) => {
    const m = /^(.*):([a-z_]+):(\d+):(\d+)$/.exec(r.key);
    const file = m[1].replace("<root>", root).split("/").join(sep);
    return `[hooks.state.${JSON.stringify(`${file}:${m[2]}:${m[3]}:${m[4]}`)}]\ntrusted_hash = ${JSON.stringify(r.trusted_hash)}\n${r.enabled === false ? "enabled = false\n" : ""}`;
  }).join("\n");
  const trust = s.trustProject ? `[projects.'${j("work")}']\ntrust_level = "trusted"\n` : "";
  sys.add(j("codex-home", "config.toml"), `${state}\n${trust}${s.user ? `\n${s.user}` : ""}`);
  sys.add(j("work", ".git", "HEAD"), "ref\n");
  if (s.userJson) sys.add(j("codex-home", "hooks.json"), JSON.stringify(s.userJson));
  if (s.project) sys.add(j("work", ".codex", "config.toml"), s.project);
  if (s.projectJson) sys.add(j("work", ".codex", "hooks.json"), JSON.stringify(s.projectJson));
  return { sys, root, sep };
}

const normKey = (k, root) => k.split(root).join("<root>").replace(/\\/g, "/");

for (const platform of ["linux", "win32"]) {
  test(`${platform}: the key, the hash and the trust status of every hook are Codex's, for the ${SCENARIOS.length} worlds of the table`, () => {
    assert.equal(fixture.scenarios.length, SCENARIOS.length, "the record is for this table: run test/record-oracles.mjs hooks");
    const wrong = [];
    let compared = 0;
    for (const s of SCENARIOS) {
      if (s.windowsOnly && platform !== "win32") continue;
      const want = fixture.scenarios.find((x) => x.name === s.name);
      assert.ok(want, s.name);
      const { sys, root } = world(platform, s, want);
      const w = discover(sys, { project: sys.cwd });
      const merged = mergeLayers([...w.layers.filter((l) => l.applies)].reverse()).value;
      const found = discoverHooks(sys, w, merged);
      const mine = found.hooks.filter((h) => !h.skippedLayer && !h.problem && !h.skipped);
      const theirs = want.hooks;
      if (want.errors > 0) { if (found.hooks.some((h) => h.problem)) continue; wrong.push(`${s.name}: Codex reports an error and this finds no problem`); continue; }
      // the hash of an mcp_tool handler with an input table is not reproduced: its key is compared and not its hash
      const unknownHash = new Set(mine.filter((h) => h.hash === undefined).map((h) => normKey(h.key, root)));
      const a = mine.map((h) => `${normKey(h.key, root)} ${h.hash === undefined ? "?" : h.hash}`).sort();
      const b = theirs.filter((h) => h.handler === "command" || h.handler === "mcpTool").map((h) => `${h.key} ${unknownHash.has(h.key) ? "?" : h.hash}`).sort();
      if (JSON.stringify(a) !== JSON.stringify(b)) { wrong.push(`${s.name}: keys and hashes differ\n   this:  ${a.join("\n          ")}\n   Codex: ${b.join("\n          ")}`); continue; }
      for (const h of mine) {
        const t = theirs.find((x) => x.key === normKey(h.key, root));
        const status = !t.enabled ? "disabled" : t.status;
        if (h.status !== status) wrong.push(`${s.name}: ${normKey(h.key, root)} is ${h.status}, Codex says ${status}`);
        if (h.event.toLowerCase() !== t.event.toLowerCase()) wrong.push(`${s.name}: event ${h.event} against ${t.event}`);
        if ((h.matcher || null) !== (t.matcher || null)) wrong.push(`${s.name}: matcher ${h.matcher} against ${t.matcher}`);
      }
      compared += mine.length;
    }
    assert.deepEqual(wrong, []);
    assert.ok(compared >= 38, `${compared} hooks compared`);
  });
}

test("hookHash: the SHA-256 of the canonical JSON of the event and the handler, with the effective defaults", () => {
  const h = { async: false, command: "echo a", timeout: 600, type: "command" };
  assert.equal(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
  assert.equal(hookHash("SessionStart", null, h), "sha256:c79c3cd4c1ddac4d28e4768b0c1ad25ce54427c8ecf40f828141ab8273a5b365");
  assert.notEqual(hookHash("SessionStart", "*", h), hookHash("SessionStart", null, h), "the matcher is part of it");
  assert.notEqual(hookHash("SessionEnd", null, h), hookHash("SessionStart", null, h), "so is the event");
  assert.match(hookHash("Stop", null, h), /^sha256:[0-9a-f]{64}$/);
});

test("the defaults: a timeout of 600 seconds (1 for SessionEnd and Interrupt), async false", () => {
  const w = (toml) => {
    const sys = fakeSys({ platform: "linux", env: { CODEX_HOME: "/h/.codex" }, cwd: "/p" });
    sys.add("/h/.codex/config.toml", toml);
    const world = discover(sys, { project: "/p" });
    return discoverHooks(sys, world, mergeLayers([...world.layers.filter((l) => l.applies)].reverse()).value).hooks;
  };
  const hooks = w('[[hooks.SessionEnd]]\n[[hooks.SessionEnd.hooks]]\ntype = "command"\ncommand = "x"\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "y"\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "y"\ntimeout = 5\nasync = true\n');
  assert.deepEqual(hooks.map((h) => [h.event, h.timeout, h.async]), [["SessionEnd", 1, false], ["Stop", 600, false], ["Stop", 5, true]]);
  assert.equal(hooks[1].status, "untrusted");
  assert.deepEqual(hooks.map((h) => h.key.replace(/^.*config\.toml/, "")), [":session_end:0:0", ":stop:0:0", ":stop:0:1"]);
});

test("a hook that is invalid says why: no type, no command, an mcp_tool without a server, a timeout that is not whole", () => {
  const sys = fakeSys({ platform: "linux", env: { CODEX_HOME: "/h/.codex" }, cwd: "/p" });
  sys.add("/h/.codex/config.toml", '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = "x"\n[[hooks.Stop.hooks]]\ntype = "command"\n[[hooks.Stop.hooks]]\ntype = "mcp_tool"\ntool = "t"\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "x"\ntimeout = 1.5\n');
  const world = discover(sys, { project: "/p" });
  const hooks = discoverHooks(sys, world, {}).hooks;
  assert.deepEqual(hooks.map((h) => h.status), ["invalid", "invalid", "invalid", "invalid"]);
  assert.match(hooks[0].problem, /needs a type/);
  assert.match(hooks[1].problem, /needs a `command`/);
  assert.match(hooks[2].problem, /server/);
  assert.match(hooks[3].problem, /whole number/);
});

test("both formats in one layer, a hooks.json that does not parse, an event that does not exist, hooks turned off", () => {
  const sys = fakeSys({ platform: "linux", env: { CODEX_HOME: "/h/.codex" }, cwd: "/p" });
  sys.add("/h/.codex/config.toml", '[features]\nhooks = false\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "x"\n');
  sys.add("/h/.codex/hooks.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "y" }] }], SessionBegin: [{ hooks: [] }] } }));
  sys.add("/p/.git/HEAD", "x");
  sys.add("/p/.codex/hooks.json", "\ufeff{}");
  const world = discover(sys, { project: "/p" });
  const merged = mergeLayers([...world.layers.filter((l) => l.applies)].reverse()).value;
  const found = discoverHooks(sys, world, merged);
  assert.equal(found.featureOff, true);
  assert.deepEqual(found.bothFormats.map((b) => [b.layerKind, b.json, b.toml]), [["user", "/h/.codex/hooks.json", "/h/.codex/config.toml"]]);
  assert.deepEqual(found.unknownEvents.map((u) => u.event), ["SessionBegin"]);
  assert.equal(found.hooks.length, 2);
  assert.ok(found.hooks.every((h) => !h.runs), "with the feature off nothing runs");
  assert.deepEqual(found.jsonErrors.map((e) => [e.layerKind, e.skipped, e.bom]), [["project", true, true]], "the project is not trusted: its hooks.json is looked at and not reported");
});

test("commandWords and programOf: the first word of a hook command, shell builtins and cmdlets excepted", () => {
  assert.deepEqual(commandWords('node "C:\\a b\\x.mjs" PreToolUse \'c d\''), ["node", "C:\\a b\\x.mjs", "PreToolUse", "c d"]);
  const win = fakeSys({ platform: "win32" });
  const lin = fakeSys({ platform: "linux" });
  assert.deepEqual(programOf(lin, "node x.mjs"), { name: "node", builtin: false });
  assert.deepEqual(programOf(win, "Write-Output hi"), { name: "Write-Output", builtin: true });
  assert.equal(programOf(lin, "echo hi").builtin, true);
  assert.equal(programOf(lin, "FOO=bar node x").builtin, true);
  assert.equal(programOf(lin, "$HOME/bin/x").builtin, true);
  assert.equal(programOf(lin, "   "), null);
  const sys = fakeSys({ platform: "linux", env: { PATH: "/bin" }, files: { "/bin/node": "x" } });
  assert.equal(programFound(sys, "node x.mjs").found, true);
  assert.equal(programFound(sys, "nosuch x").found, false);
  assert.equal(programFound(sys, "echo hi").found, true);
});

test("hookScript and scriptAsks: the script a command runs, and whether it answers ask", () => {
  const sys = fakeSys({ platform: "linux", cwd: "/p", files: { "/p/hook.mjs": 'console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } }));', "/p/ok.mjs": 'permissionDecision: "deny"' } });
  const s = hookScript(sys, "node hook.mjs PreToolUse", "/p");
  assert.equal(s.path, "/p/hook.mjs");
  assert.equal(scriptAsks(s.text), true);
  assert.equal(scriptAsks(hookScript(sys, "node ok.mjs", "/p").text), false);
  assert.equal(hookScript(sys, "node missing.mjs", "/p"), null);
  assert.equal(hookScript(sys, "echo hi", "/p"), null);
});
