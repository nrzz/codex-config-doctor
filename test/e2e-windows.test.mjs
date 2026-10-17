// The Windows sandbox, put to the real Codex on Windows: what it does when no implementation is selected (the sandbox mode in the prompt
// becomes read-only), what the sandbox log says for each selection, and that `lint` agrees. Setting up `elevated` needs an administrator
// and is not run; whether MXC is available is read from the log Codex writes, because it depends on the build of Windows.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { collect } from "../src/collect.mjs";
import { readSandboxLog } from "../src/winsandbox.mjs";
import { exec, lintWorld, sysFor } from "./behave.mjs";
import { skipUnlessWindows } from "./codex-sandbox.mjs";

const opts = { skip: skipUnlessWindows() };
const MODE = 'sandbox_mode = "workspace-write"\n';
const lines = (sb) => {
  const dir = path.join(sb.codexHome, ".sandbox");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^sandbox\..*\.log$/.test(n)) : [];
  return names.flatMap((n) => fs.readFileSync(path.join(dir, n), "utf8").split(/\r?\n/)).filter((l) => /MXC availability|Windows sandbox selection/.test(l)).map((l) => l.replace(/^\[[^\]]*\]\s*/, ""));
};
const win = (sb) => lintWorld(sb).find("windows-sandbox");

test("windows-sandbox: with no implementation selected the sandbox is read-only and the log says so; lint says it", opts, async () => {
  const r = await exec({ label: "e2e-win-none", userTop: MODE });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /^sandbox: read-only$/m, "workspace-write was asked for, read-only is what the header says");
  assert.ok(lines(r.sb).includes("Windows sandbox selection: disabled"), lines(r.sb).join(" | "));
  const found = win(r.sb);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /No Windows sandbox is selected/);
  assert.match(found[0].message, /workspace-write becomes read-only/);
  const c = collect(sysFor(r.sb), { project: r.sb.work });
  assert.equal(c.windows.sandboxMode.effective, "read-only");
  assert.equal(readSandboxLog(c.sys, r.sb.codexHome).lastSelection, "disabled");
});

test("windows-sandbox: unelevated, mxc and prefer_mxc select an implementation; the log says which and lint says nothing about the first", opts, async () => {
  const unelevated = await exec({ label: "e2e-win-un", userTop: MODE, userTables: '[windows]\nsandbox = "unelevated"\n' });
  assert.match(unelevated.err, /^sandbox: workspace-write/m);
  assert.ok(lines(unelevated.sb).includes("Windows sandbox selection: unelevated"));
  assert.equal(win(unelevated.sb).length, 0);
  const mxc = await exec({ label: "e2e-win-mxc", userTop: MODE, userTables: '[windows]\nsandbox = "mxc"\n' });
  assert.ok(lines(mxc.sb).includes("Windows sandbox selection: mxc"), lines(mxc.sb).join(" | "));
  const prefer = await exec({ label: "e2e-win-prefer", userTop: MODE, userTables: "[features]\nprefer_mxc = true\n" });
  assert.ok(lines(prefer.sb).includes("Windows sandbox selection: mxc"), `prefer_mxc selects mxc: the log says ${lines(prefer.sb).join(" | ")}`);
  assert.equal(win(prefer.sb).length === 0, readSandboxLog(sysFor(prefer.sb), prefer.sb.codexHome).mxcAvailable !== false, "lint complains about mxc exactly when the log says MXC is not available (or the build is too old)");
  // lint reads the same log
  const available = lines(mxc.sb).includes("MXC availability: true");
  const flagged = win(mxc.sb).some((f) => f.severity !== "note");
  assert.equal(flagged, !available, `the log says MXC is ${available ? "" : "not "}available: lint ${flagged ? "complains" : "does not"}`);
});

test("windows-sandbox: elevated is selected without a word (its setup needs an administrator and is not run); a word that is not one stops Codex", opts, async () => {
  const elevated = await exec({ label: "e2e-win-el", userTop: MODE, userTables: '[windows]\nsandbox = "elevated"\n' });
  assert.equal(elevated.code, 0, elevated.err);
  assert.ok(lines(elevated.sb).includes("Windows sandbox selection: elevated"));
  assert.equal(win(elevated.sb).filter((f) => f.severity === "note").length, 1, "a note: the setup is for an administrator");
  const bogus = await exec({ label: "e2e-win-bogus", userTop: MODE, userTables: '[windows]\nsandbox = "bogus"\n' });
  assert.equal(bogus.code, 1);
  assert.match(bogus.err, /unknown variant `bogus`, expected one of `elevated`, `unelevated`, `mxc`/);
  assert.equal(lintWorld(bogus.sb).find("wrong-type").length, 1);
});
