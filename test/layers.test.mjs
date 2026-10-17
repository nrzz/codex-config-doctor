// The layers: that the files Codex loads, in the order it loads them, which of them it disables for lack of trust, and what each setting of the
// merged configuration comes from, are Codex's for every world of test/layers-table.mjs (the record of test/fixtures/layers-oracle.json, made from
// the app server's config/read), and the small parts: the Codex home, the trust keys, the project root, merging.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ROOT } from "./helpers.mjs";
import { fakeSys } from "./fakesys.mjs";
import { KEYS, SCENARIOS } from "./layers-table.mjs";
import { codexHome, discover, findRoot, leaves, mergeLayers, systemDir, trustKey } from "../src/layers.mjs";

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "layers-oracle.json"), "utf8"));

/** The machine of a scenario. */
function world(platform, s) {
  const win = platform === "win32";
  const root = win ? "C:\\ccdroot" : "/ccdroot";
  const sep = win ? "\\" : "/";
  const j = (...p) => [root, ...p].join(sep);
  const sys = fakeSys({ platform, home: j("home"), cwd: j("work"), env: { CODEX_HOME: j("codex-home") } });
  const cwd = s.cwd ? j("work", ...s.cwd.split("/")) : j("work");
  const where = { root: j("work"), cwd, parent: root, a: j("work", "a"), "a/b": j("work", "a", "b") };
  const spell = (p, style) => (style === "forward" ? p.replace(/\\/g, "/") : style === "trailing" ? `${p}${sep}` : style === "upper" ? p.toUpperCase() : style === "hint" ? p.toLowerCase() : style === "unc" ? `\\\\?\\${p}` : p);
  const trust = (s.trust || []).map((t) => `[projects.'${spell(where[t.of], t.style)}']\ntrust_level = "${t.level}"\n`).join("\n");
  sys.add(j("codex-home", "config.toml"), `${s.user || ""}\n${trust}`);
  sys.add(j("work", ".git", "HEAD"), "ref\n");
  if (s.hg) sys.add(j("work", ".hg", "keep"), "x");
  for (const [rel, text] of Object.entries(s.project || {})) sys.add(j("work", ...(rel ? rel.split("/") : []), ".codex", "config.toml"), text);
  if (!sys.isDir(cwd)) sys.add(`${cwd}${sep}.keep`, "");
  return { sys, root, cwd };
}

const rel = (p, root) => String(p).split(root).join("<root>").replace(/\\/g, "/");

for (const platform of ["linux", "win32"]) {
  test(`${platform}: the layers, which are disabled, and the origin of every setting are Codex's, for the ${SCENARIOS.filter((s) => !s.noAppServer).length} worlds of the table`, () => {
    assert.equal(fixture.scenarios.length, SCENARIOS.filter((s) => !s.noAppServer).length, "the record is for this table: run test/record-oracles.mjs layers");
    const wrong = [];
    for (const s of SCENARIOS) {
      if (s.noAppServer || (s.windowsOnly && platform !== "win32")) continue;
      const want = fixture.scenarios.find((x) => x.name === s.name);
      assert.ok(want && !want.error, `${s.name}: ${want && want.error}`);
      const { sys, root, cwd } = world(platform, s);
      const w = discover(sys, { project: cwd });
      const mine = w.layers.filter((l) => l.kind !== "system" && (l.kind !== "project" || l.hasDotCodex)).map((l) => ({ type: l.kind, path: rel(l.kind === "project" ? l.dotCodex : l.path, root), disabled: l.kind === "project" && !l.trusted }));
      if (JSON.stringify(mine) !== JSON.stringify(want.layers)) { wrong.push(`${s.name}: layers\n   this:  ${JSON.stringify(mine)}\n   Codex: ${JSON.stringify(want.layers)}`); continue; }
      const merged = mergeLayers([...w.layers.filter((l) => l.applies)].reverse());
      const all = leaves(merged);
      for (const v of want.values) {
        if (v.key.startsWith("projects.")) continue;
        const lf = all.find((x) => x.path.join(".") === v.key);
        if (!lf) { wrong.push(`${s.name}: ${v.key} is missing`); continue; }
        const layer = merged.layers[lf.layerIndex];
        const origin = { type: layer.kind, path: rel(layer.kind === "project" ? layer.dotCodex : layer.path, root) };
        if (JSON.stringify(lf.value) !== JSON.stringify(v.value)) wrong.push(`${s.name}: ${v.key} is ${JSON.stringify(lf.value)}, Codex has ${JSON.stringify(v.value)}`);
        if (origin.type !== v.origin.type || origin.path !== v.origin.path) wrong.push(`${s.name}: ${v.key} comes from ${JSON.stringify(origin)}, Codex says ${JSON.stringify(v.origin)}`);
      }
      // nothing in the merged configuration that Codex does not have, among the probed keys
      for (const k of [...KEYS, ...(s.probes || [])]) {
        const lf = all.find((x) => x.path.join(".") === k);
        if (lf && !want.values.some((v) => v.key === k)) wrong.push(`${s.name}: ${k} is set here and not in Codex's configuration`);
      }
    }
    assert.deepEqual(wrong, []);
  });
}

test("the ten keys a project layer may not set are left out of the merge and listed", () => {
  const s = SCENARIOS.find((x) => x.name === "the ten keys a project may not set");
  const { sys, cwd } = world("linux", s);
  const w = discover(sys, { project: cwd });
  const project = w.layers.find((l) => l.kind === "project" && l.hasDotCodex);
  assert.deepEqual(project.ignoredKeys, ["openai_base_url", "chatgpt_base_url", "apps_mcp_product_sku", "model_provider", "model_providers", "notify", "profile", "profiles", "experimental_realtime_ws_base_url", "otel"]);
  const merged = mergeLayers([...w.layers.filter((l) => l.applies)].reverse()).value;
  assert.deepEqual(Object.keys(merged).sort(), ["model", "projects"]);
});

test("codexHome: CODEX_HOME when it is not empty (a relative one from the working folder), else ~/.codex; a missing folder is a problem", () => {
  const lin = fakeSys({ platform: "linux", home: "/h", cwd: "/w", env: { HOME: "/h" }, dirs: ["/w/rel", "/alt"] });
  assert.deepEqual([codexHome(lin).dir, codexHome(lin).source], ["/h/.codex", "default"]);
  const set = (v) => fakeSys({ platform: "linux", home: "/h", cwd: "/w", env: { HOME: "/h", CODEX_HOME: v }, dirs: ["/w/rel", "/alt"], files: { "/alt/f": "x" } });
  assert.deepEqual([codexHome(set("/alt")).dir, codexHome(set("/alt")).problem], ["/alt", null]);
  assert.equal(codexHome(set("rel")).dir, "/w/rel");
  assert.equal(codexHome(set("")).source, "default");
  assert.equal(codexHome(set("/nope")).problem, "missing");
  assert.equal(codexHome(set("/alt/f")).problem, "not-a-directory");
  const win = fakeSys({ platform: "win32", env: { USERPROFILE: "C:\\Users\\me" } });
  assert.equal(codexHome(win).dir, "C:\\Users\\me\\.codex");
  assert.equal(codexHome(fakeSys({ platform: "win32", env: { USERPROFILE: "C:\\Users\\me", CODEX_HOME: "D:\\My Codex" }, dirs: ["D:\\My Codex"] })).dir, "D:\\My Codex");
});

test("systemDir and trustKey: the system folder per platform; the key is the folder's path, lower-cased on Windows, without a trailing separator", () => {
  assert.equal(systemDir(fakeSys({ platform: "linux" })), "/etc/codex");
  assert.equal(systemDir(fakeSys({ platform: "darwin" })), "/etc/codex");
  assert.equal(systemDir(fakeSys({ platform: "win32", env: { ProgramData: "D:\\PD" } })), "D:\\PD\\OpenAI\\Codex");
  const win = fakeSys({ platform: "win32", dirs: ["C:\\Users\\Me\\Shop"] });
  assert.equal(trustKey(win, "C:\\Users\\Me\\Shop\\"), "c:\\users\\me\\shop");
  assert.equal(trustKey(win, "\\\\?\\C:\\Users\\Me\\Shop"), "c:\\users\\me\\shop");
  assert.equal(trustKey(win, "C:\\"), "c:\\");
  const lin = fakeSys({ platform: "linux", dirs: ["/home/Me/Shop"] });
  assert.equal(trustKey(lin, "/home/Me/Shop/"), "/home/Me/Shop");
});

test("findRoot: the nearest folder with a marker, or none", () => {
  const sys = fakeSys({ platform: "linux", files: { "/p/.git/HEAD": "x", "/p/a/b/f": "x", "/q/f": "x" } });
  assert.deepEqual(findRoot(sys, "/p/a/b", [".git"]), { root: "/p", marker: ".git" });
  assert.equal(findRoot(sys, "/q", [".git"]), null);
  assert.equal(findRoot(sys, "/p/a", []), null);
});

test("mergeLayers: tables merge key by key, arrays and values are replaced, the later layer wins", () => {
  const m = mergeLayers([{ kind: "user", value: { a: 1, t: { x: 1, y: [1] }, arr: [1, 2] } }, { kind: "project", value: { a: 2, t: { y: [9], z: 3 }, arr: [3] } }]);
  assert.deepEqual(m.value, { a: 2, t: { x: 1, y: [9], z: 3 }, arr: [3] });
  assert.deepEqual(leaves(m).map((l) => [l.path.join("."), l.layerIndex]), [["a", 1], ["t.x", 0], ["t.y", 1], ["t.z", 1], ["arr", 1]]);
});

test("a profile file sits above the user's config.toml, and a name that is not plain is not read", () => {
  const sys = fakeSys({ platform: "linux", env: { CODEX_HOME: "/c" }, cwd: "/p", files: { "/c/config.toml": 'model = "u"\n', "/c/work.config.toml": 'model = "w"\n' } });
  const w = discover(sys, { project: "/p", profile: "work" });
  assert.deepEqual(w.layers.map((l) => l.kind), ["project", "profile", "user", "system"]);
  assert.equal(mergeLayers([...w.layers.filter((l) => l.applies)].reverse()).value.model, "w");
  assert.equal(w.profile.exists, true);
  const missing = discover(sys, { project: "/p", profile: "nope" });
  assert.equal(missing.profile.exists, false);
  assert.equal(missing.layers.find((l) => l.kind === "profile").status, "missing");
  const bad = discover(sys, { project: "/p", profile: "../evil" });
  assert.equal(bad.profile.valid, false);
});

test("a layer that does not parse is broken; in a project that is not trusted it is skipped, and remembers that it does not parse; a file that is not UTF-8 is broken too", () => {
  const sys = fakeSys({ platform: "linux", env: { CODEX_HOME: "/c" }, cwd: "/p", files: { "/c/config.toml": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('model = "x"\n', "utf16le")]), "/p/.git/HEAD": "x", "/p/.codex/config.toml": "foo bar = 1\n" } });
  const w = discover(sys, { project: "/p" });
  const user = w.layers.find((l) => l.kind === "user");
  const project = w.layers.find((l) => l.kind === "project");
  assert.deepEqual([user.status, user.error.kind], ["broken", "encoding"]);
  assert.deepEqual([project.status, project.error.kind, project.error.line, project.trusted, project.brokenWhenTrusted], ["skipped", "toml", 1, false, true]);
});
