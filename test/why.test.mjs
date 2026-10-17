// `why`: what Codex does with one shell command. The rules part is held to `codex execpolicy check` in test/execpolicy.test.mjs and
// test/e2e-rules.test.mjs; here the outcome (forbidden, asks, refused, outside the sandbox, sandboxed, unsandboxed) and the way a script
// is split, on pretend machines.
import test from "node:test";
import assert from "node:assert/strict";
import { why } from "../src/why.mjs";
import { whyDoc, whyText } from "../src/report.mjs";
import { world } from "./world.mjs";

const RULES = [
  'prefix_rule(pattern=["git", "status"], decision="allow")',
  'prefix_rule(pattern=["ls"], decision="allow")',
  'prefix_rule(pattern=["rm", "-rf"], decision="forbidden", justification="never delete a tree")',
  'prefix_rule(pattern=["npm", ["install", "publish"]], decision="prompt", justification="changes the lock file")',
  'prefix_rule(pattern=["bash"], decision="allow")',
].join("\n");

const ask = (script, files = {}, o = {}, opts) => {
  const { c } = world({ "config.toml": "", "rules/default.rules": RULES, ...files }, o);
  return why(c, script, opts);
};

test("a command no rule decides runs inside the sandbox when the sandbox is workspace-write (the default of a trusted project)", () => {
  const r = ask("echo hi");
  assert.equal(r.outcome, "sandboxed");
  assert.equal(r.refused, false);
  assert.equal(r.decision, null);
  assert.match(r.headline, /inside the workspace-write sandbox, without asking/);
  assert.deepEqual(r.parts.map((p) => p.tokens), [["echo", "hi"]]);
  assert.deepEqual(r.settings, { approval: "on-request", sandbox: "workspace-write", sandboxAsked: null, windowsSandbox: null });
});

test("an allow rule runs the command outside the sandbox without asking; one part without a rule keeps the whole command in the sandbox", () => {
  assert.equal(ask("git status").outcome, "outside-sandbox");
  assert.equal(ask("git status -sb").outcome, "outside-sandbox");
  assert.equal(ask("git status && ls -la").outcome, "outside-sandbox");
  assert.equal(ask("git status && echo hi").outcome, "sandboxed");
  assert.equal(ask("git log").outcome, "sandboxed");
});

test("a forbidden rule refuses the command, whatever the approval policy and the sandbox", () => {
  for (const top of ['approval_policy = "on-request"\n', 'approval_policy = "never"\n', 'sandbox_mode = "danger-full-access"\n', 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n']) {
    const r = ask("rm -rf build", { "config.toml": top });
    assert.equal(r.outcome, "forbidden", top);
    assert.equal(r.refused, true);
    assert.match(r.headline, /forbidden rule matches `rm -rf`/);
    assert.match(r.lines[0].text, /rejected: never delete a tree/);
  }
  // the strictest part decides
  assert.equal(ask("git status && rm -rf build").outcome, "forbidden");
  assert.equal(ask("rm -rf build && git status").decision, "forbidden");
});

test("a prompt rule asks, in every sandbox; with approval_policy never there is nobody to ask and the command is refused", () => {
  let r = ask("npm install left-pad");
  assert.deepEqual([r.outcome, r.refused], ["asks", false]);
  assert.match(r.lines[0].text, /requires approval: changes the lock file/);
  assert.equal(ask("npm publish").outcome, "asks");
  assert.equal(ask("npm test").outcome, "sandboxed");
  r = ask("npm install left-pad", { "config.toml": 'sandbox_mode = "danger-full-access"\n' });
  assert.equal(r.outcome, "asks");
  r = ask("npm install left-pad", { "config.toml": 'approval_policy = "never"\n' });
  assert.deepEqual([r.outcome, r.refused], ["refused", true]);
  assert.match(r.lines[0].text, /approval required by policy, but AskForApproval is set to Never/);
});

test("danger-full-access: nothing is sandboxed, an allow rule changes nothing", () => {
  const r = ask("echo hi", { "config.toml": 'sandbox_mode = "danger-full-access"\n' });
  assert.equal(r.outcome, "unsandboxed");
  assert.equal(ask("git status", { "config.toml": 'sandbox_mode = "danger-full-access"\n' }).outcome, "unsandboxed");
});

test("read-only says what the sandbox allows; approval never refuses a request for more", () => {
  const r = ask("echo hi", { "config.toml": 'sandbox_mode = "read-only"\napproval_policy = "never"\n' });
  assert.equal(r.outcome, "sandboxed");
  assert.match(r.lines[0].text, /read files and nothing else/);
  assert.match(r.lines[1].text, /approval policy is Never; reject command/);
});

test("the strictest answer wins: a prompt rule beats an allow rule in the same command", () => {
  const r = ask("git status && npm install");
  assert.equal(r.decision, "prompt");
  assert.equal(r.outcome, "asks");
  assert.equal(r.parts.length, 2);
});

test("Codex ignores a bare allow rule for a shell or an interpreter, and says so", () => {
  const r = ask("bash build.sh");
  const ignored = r.parts.flatMap((p) => p.ignored);
  assert.ok(ignored.length >= 1, JSON.stringify(r.parts));
  assert.ok(r.lines.some((l) => /is not honoured: Codex ignores an allow rule for bash, so this part is handled as if no rule matched/.test(l.text)));
  assert.notEqual(r.outcome, "outside-sandbox");
  // a script given with -c is not opened (Codex wraps the command in a bash -lc of its own): the command is bash, -c and the script
  assert.deepEqual(ask("bash -c 'echo hi'").parts[0].tokens, ["bash", "-c", "echo hi"]);
});

test("a plain list of commands is split; a script with a loop or a variable is judged whole", () => {
  const split = ask("git status; ls; echo done");
  assert.equal(split.split, true);
  assert.equal(split.parts.length, 3);
  assert.match(split.lines[0].text, /plain list of 3 commands/);
  const whole = ask('for f in a b; do echo "$f"; done');
  assert.equal(whole.split, false);
  assert.equal(whole.plain, false);
  assert.equal(whole.parts.length, 1);
  assert.match(whole.lines[0].text, /does not split it: the whole script is judged as one command/);
  assert.ok(whole.reason);
});

test("a command that starts with bash -lc is one command, and the rules for what is inside it do not match (Codex does not open it)", () => {
  const r = ask('bash -lc "git status && ls"');
  assert.equal(r.parts.length, 1);
  assert.deepEqual(r.parts[0].tokens, ["bash", "-lc", "git status && ls"]);
  assert.equal(r.outcome, "sandboxed");
});

test("the shell can be forced: a PowerShell script on Linux, a bash script on Windows", () => {
  const ps = ask("git status; ls", {}, {}, { shell: "powershell" });
  assert.equal(ps.shell, "powershell");
  assert.equal(ps.parts.length, 2);
  const win = ask("git status", {}, { platform: "win32", extra: { release: "10.0.26300" } }, { shell: "bash" });
  assert.equal(win.shell, "bash");
});

test("Windows with no sandbox selected: every command that no rule allows asks, and with approval never it is refused", () => {
  const w = { platform: "win32", extra: { release: "10.0.26300" } };
  let r = ask("echo hi", {}, w);
  assert.deepEqual([r.outcome, r.refused], ["asks", false]);
  assert.match(r.headline, /no Windows sandbox is selected/);
  assert.equal(r.settings.windowsSandbox, "none");
  r = ask("echo hi", { "config.toml": 'approval_policy = "never"\n' }, w);
  assert.deepEqual([r.outcome, r.refused], ["refused", true]);
  // an allow rule still runs it; a sandbox selected runs it inside
  assert.equal(ask("git status", {}, w).outcome, "outside-sandbox");
  r = ask("echo hi", { "config.toml": '[windows]\nsandbox = "unelevated"\n' }, w);
  assert.equal(r.outcome, "sandboxed");
  assert.equal(r.settings.windowsSandbox, "unelevated");
  // full access needs no sandbox
  assert.equal(ask("echo hi", { "config.toml": 'sandbox_mode = "danger-full-access"\n' }, w).outcome, "unsandboxed");
});

test("without any rules file nothing matches and the lines say so", () => {
  const { c } = world({ "config.toml": "" });
  const r = why(c, "git status");
  assert.equal(r.outcome, "sandboxed");
  assert.ok(r.lines.some((l) => /No rule matches any part of it/.test(l.text)));
});

test("the text and the JSON of a verdict", () => {
  const { c } = world({ "config.toml": "", "rules/default.rules": RULES });
  const r = why(c, "git status && rm -rf x");
  const doc = whyDoc(c, r);
  assert.equal(doc.ok, false);
  assert.equal(doc.command, "why");
  assert.equal(doc.shellCommand, "git status && rm -rf x");
  assert.equal(doc.outcome, "forbidden");
  assert.ok(Array.isArray(doc.parts) && Array.isArray(doc.lines));
  const text = whyText(c, r);
  assert.match(text, /^codex-config-doctor .*\n?why\n/m);
  assert.match(text, /command {3}git status && rm -rf x/);
  assert.match(text, /forbidden\["rm", "-rf"\] {2}default\.rules:3 {2}"never delete a tree"/);
  assert.match(text, /\(verified\)/);
  for (const line of text.split("\n")) assert.ok(line.length < 400, line);
});
