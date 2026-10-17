// The AGENTS.md assembly: that it builds the message Codex builds for every world of test/agents-table.mjs (the record of
// test/fixtures/agents-oracle.json: size, hash and ends of the message `codex debug prompt-input` printed), on a Linux and a Windows machine,
// and what it says about each file (included, cut, left out, empty, hidden).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ROOT } from "./helpers.mjs";
import { fakeSys } from "./fakesys.mjs";
import { SCENARIOS, bytesOf } from "./agents-table.mjs";
import { assemble, docCap } from "../src/agents.mjs";
import { parseToml } from "../src/toml.mjs";

/** A machine of the platform with the files of a scenario; returns { sys, cwd }. */
export function agentsWorld(platform, s) {
  const win = platform === "win32";
  const root = win ? "C:\\w" : "/w";
  const sep = win ? "\\" : "/";
  const j = (...p) => [root, ...p].join(sep);
  const sys = fakeSys({ platform, home: j("home"), cwd: j("work"), env: { CODEX_HOME: j("codex-home") } });
  sys.add(j("codex-home", "config.toml"), s.config || "");
  if (s.git !== false) sys.add(j("work", ".git", "HEAD"), "ref: refs/heads/main\n");
  for (const [rel, content] of Object.entries(s.files)) {
    const file = rel.startsWith("home:") ? j("codex-home", ...rel.slice(5).split("/")) : j("work", ...rel.split("/"));
    sys.add(file, bytesOf(content));
  }
  const cwd = s.cwd ? j("work", ...s.cwd.split("/")) : j("work");
  if (!sys.isDir(cwd)) sys.add(path.join(cwd, ".keep").split(path.sep).join(sep), "");
  return { sys, cwd, merged: s.config ? parseToml(s.config).value : {} };
}

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "agents-oracle.json"), "utf8"));

for (const platform of ["linux", "win32"]) {
  test(`${platform}: the message is Codex's for every world of the table (size, hash, ends)`, () => {
    assert.equal(fixture.scenarios.length, SCENARIOS.length, "the record is for this table: run test/record-oracles.mjs agents");
    const wrong = [];
    for (const s of SCENARIOS) {
      const want = fixture.scenarios.find((x) => x.name === s.name);
      assert.ok(want, `${s.name} is in the record`);
      const { sys, cwd, merged } = agentsWorld(platform, s);
      const a = assemble(sys, cwd, merged);
      const text = a.text === null ? null : a.text.split(cwd).join("<cwd>");
      if ((text !== null) !== want.present) { wrong.push(`${s.name}: Codex ${want.present ? "sends" : "sends no"} message`); continue; }
      if (text === null) continue;
      const got = { bytes: Buffer.byteLength(text), chars: text.length, sha256: crypto.createHash("sha256").update(text).digest("hex"), head: text.slice(0, 60), tail: text.slice(-60) };
      for (const k of ["bytes", "chars", "sha256", "head", "tail"]) if (got[k] !== want[k]) { wrong.push(`${s.name}: ${k} is ${JSON.stringify(got[k])}, Codex's is ${JSON.stringify(want[k])}`); break; }
    }
    assert.deepEqual(wrong, []);
  });
}

test("the cap: the file that crosses it is cut at the byte, the files after it are left out, white space costs nothing", () => {
  const K = 1024;
  const s = SCENARIOS.find((x) => x.name === "the cap with 20K, 20K and 5K");
  const { sys, cwd, merged } = agentsWorld("linux", s);
  const a = assemble(sys, cwd, merged);
  assert.deepEqual(a.files.map((f) => [path.posix.basename(path.posix.dirname(f.path)), f.status, f.includedBytes, f.cutBytes]), [["work", "included", 20 * K, 0], ["a", "cut", 12 * K, 8 * K], ["b", "left-out", 0, 0]]);
  assert.equal(a.total, 32 * K);
  assert.equal(a.firstShort.path, path.posix.join(cwd, "..", "AGENTS.md"));
  const e = agentsWorld("linux", SCENARIOS.find((x) => x.name === "a project file with only white space"));
  const b = assemble(e.sys, e.cwd, e.merged);
  assert.deepEqual(b.files.map((f) => f.status), ["empty"]);
  assert.equal(b.firstShort, null);
});

test("the global file is trimmed, is not counted, and is used alone when the project has none", () => {
  const { sys, cwd, merged } = agentsWorld("linux", SCENARIOS.find((x) => x.name === "a global file only"));
  const a = assemble(sys, cwd, merged);
  assert.equal(a.heading, "# AGENTS.md instructions");
  assert.equal(a.text, "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nGLOBAL\n</INSTRUCTIONS>");
  assert.equal(a.total, 0);
  const both = agentsWorld("linux", SCENARIOS.find((x) => x.name === "a global file and a project file"));
  const b = assemble(both.sys, both.cwd, both.merged);
  assert.equal(b.text, `# AGENTS.md instructions for ${both.cwd}\n\n<INSTRUCTIONS>\nGLOBAL\n\n--- project-doc ---\n\nROOT\n\n</INSTRUCTIONS>`);
});

test("a file hidden by another in its folder is reported, and an empty override hides the standard file", () => {
  const w = agentsWorld("linux", SCENARIOS.find((x) => x.name === "an empty override in a project folder hides AGENTS.md"));
  const a = assemble(w.sys, w.cwd, w.merged);
  assert.equal(a.text, null);
  assert.deepEqual(a.shadowed.map((s) => [path.posix.basename(s.path), s.reason, path.posix.basename(s.by)]), [["AGENTS.md", "same-folder", "AGENTS.override.md"]]);
  assert.deepEqual(a.files.map((f) => [path.posix.basename(f.path), f.status]), [["AGENTS.override.md", "empty"]]);
});

test("docCap: the default, a number from the configuration, nothing else", () => {
  assert.equal(docCap({}), 32768);
  assert.equal(docCap({ project_doc_max_bytes: 100 }), 100);
  assert.equal(docCap({ project_doc_max_bytes: 0 }), 0);
  assert.equal(docCap({ project_doc_max_bytes: "100" }), 32768);
  assert.equal(docCap({ project_doc_max_bytes: -1 }), 32768);
});
