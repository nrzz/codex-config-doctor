// `why`, put to the real Codex: a shell command is run by a thread of the app server (what the terminal UI is built on) against the fake
// Responses API, under the approval policy, the sandbox and the rules of the world, and what happened to it (it was refused, the client
// was asked, it ran inside the sandbox, it ran outside) is compared with what `why` says for the same folder. A command that writes a file
// outside the project folder tells the two kinds of run apart: the sandbox does not let it, an allow rule or danger-full-access does.
// The second half puts every prefix of the table of banned prefixes (src/knowledge.mjs, read from the binary by test/banned.mjs) to the
// binary: an allow rule for it is ignored, and a longer pattern is honoured.
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { collect } from "../src/collect.mjs";
import { BANNED_PREFIXES } from "../src/knowledge.mjs";
import { why } from "../src/why.mjs";
import { thread, sysFor } from "./behave.mjs";
import { bannedFromPe, findWindowsExe } from "./banned.mjs";
import { PARALLEL, pool } from "./ask.mjs";
import { CODEX, IS_WIN, shellCall, skip } from "./codex-sandbox.mjs";

const opts = { skip: skip() };
const WRITE_OUTSIDE = 'import fs from "node:fs";\nimport path from "node:path";\ntry {\n  fs.writeFileSync(path.join(process.cwd(), "..", "outside.txt"), "x");\n  console.log("WROTE-OUTSIDE");\n} catch (e) {\n  console.log("DENIED " + e.code);\n  process.exitCode = 3;\n}\n';
// on Windows no command runs inside a sandbox until one is selected; the rows select the unelevated one. The sandbox lets a command write
// to the temporary folders as well as the project, and the worlds are in the temporary folder: they are left out of the writable roots
// (otherwise "outside the project" would still be writable)
const SELECTED = `${IS_WIN ? '[windows]\nsandbox = "unelevated"\n' : ""}[sandbox_workspace_write]\nexclude_tmpdir_env_var = true\nexclude_slash_tmp = true\n`;

/**
 * Runs a command in a world and reports what happened to it: "forbidden", "asked", "refused", "inside" (it ran and could not write outside
 * the project) or "outside" (it wrote there).
 */
async function observe({ rules = "", command, approval = "on-request", sandbox = "workspace-write", select = true, answer, extraFiles = {} }) {
  const top = `approval_policy = "${approval}"\nsandbox_mode = "${sandbox}"\n`;
  const r = await thread({
    label: "e2e-why",
    userTop: top,
    userTables: select ? SELECTED : "",
    files: { "work/write.mjs": WRITE_OUTSIDE, ...(rules ? { "codex-home/rules/default.rules": rules } : {}), ...extraFiles },
    script: [shellCall(command), { text: "DONE" }],
    approval,
    sandbox,
    answer,
  });
  const out = r.outputs[0] || "";
  let seen;
  if (r.asked.length) seen = "asked";
  else if (/AskForApproval is set to Never|blocked by policy/.test(out)) seen = "refused";
  else if (/rejected: /.test(out)) seen = "forbidden";
  else if (fs.existsSync(path.join(r.sb.root, "outside.txt"))) seen = "outside";
  else seen = "inside";
  const c = collect(sysFor(r.sb), { project: r.sb.work });
  return { seen, r, said: why(c, command) };
}

const SAME = { forbidden: "forbidden", asks: "asked", refused: "refused", "outside-sandbox": "outside", unsandboxed: "outside", sandboxed: "inside" };
const allow = (...p) => `prefix_rule(pattern=${JSON.stringify(p)}, decision="allow")\n`;

const ROWS = [
  { name: "no rule, workspace-write: runs inside the sandbox", command: "node write.mjs" },
  { name: "an allow rule: runs outside the sandbox", rules: allow("node", "write.mjs"), command: "node write.mjs" },
  { name: "a list of two commands, one without a rule: the whole stays inside", rules: allow("node", "write.mjs"), command: "node write.mjs; echo done" },
  { name: "a list of two commands, both allowed: outside", rules: allow("node", "write.mjs") + allow("echo", "done"), command: "node write.mjs; echo done" },
  { name: "a forbidden rule: refused whatever the policy", rules: 'prefix_rule(pattern=["node", "write.mjs"], decision="forbidden", justification="no writes")\n', command: "node write.mjs" },
  { name: "a forbidden rule with approval never and full access", rules: 'prefix_rule(pattern=["node", "write.mjs"], decision="forbidden", justification="no writes")\n', command: "node write.mjs", approval: "never", sandbox: "danger-full-access" },
  { name: "a prompt rule: the client is asked", rules: 'prefix_rule(pattern=["node", "write.mjs"], decision="prompt")\n', command: "node write.mjs" },
  { name: "a prompt rule with approval never: nobody to ask", rules: 'prefix_rule(pattern=["node", "write.mjs"], decision="prompt")\n', command: "node write.mjs", approval: "never" },
  { name: "the strictest part decides: allow and prompt", rules: allow("node", "write.mjs") + 'prefix_rule(pattern=["echo"], decision="prompt")\n', command: "node write.mjs; echo hi" },
  { name: "danger-full-access: nothing is sandboxed", command: "node write.mjs", sandbox: "danger-full-access", approval: "never" },
  { name: "read-only: inside", command: "node write.mjs", sandbox: "read-only" },
  { name: "a command with a substitution is judged whole, and its rule does not match", rules: allow("node", "write.mjs"), command: "node write.mjs $(echo hi)" },
  { name: "a prompt rule on a banned prefix still asks", rules: 'prefix_rule(pattern=["node"], decision="prompt")\n', command: "node write.mjs" },
  { name: "an allow rule on a banned prefix is ignored: inside", rules: allow("node"), command: "node write.mjs" },
];
if (IS_WIN) {
  ROWS.push(
    { name: "Windows, no sandbox selected, on-request: every command asks", command: "node write.mjs", select: false },
    { name: "Windows, no sandbox selected, never: refused", command: "node write.mjs", select: false, approval: "never" },
    { name: "Windows, no sandbox selected, an allow rule: runs outside", rules: allow("node", "write.mjs"), command: "node write.mjs", select: false },
    { name: "Windows, no sandbox selected, danger-full-access: outside", command: "node write.mjs", select: false, sandbox: "danger-full-access", approval: "never" },
  );
}

for (const row of ROWS) {
  test(`why: ${row.name}`, opts, async () => {
    const { seen, said, r } = await observe(row);
    assert.equal(seen, SAME[said.outcome], `Codex: ${seen}; why: ${said.outcome} (${said.headline})\n${r.outputs[0]}`);
    assert.equal(said.refused, said.outcome === "forbidden" || said.outcome === "refused");
  });
}

test("why: the model gets the words the verdict quotes", opts, async () => {
  const forbidden = await observe({ rules: 'prefix_rule(pattern=["node", "write.mjs"], decision="forbidden", justification="no writes")\n', command: "node write.mjs" });
  assert.match(forbidden.r.outputs[0], /rejected: no writes/);
  assert.match(forbidden.said.lines[0].text, /rejected: no writes/);
  const never = await observe({ rules: 'prefix_rule(pattern=["node", "write.mjs"], decision="prompt")\n', command: "node write.mjs", approval: "never" });
  assert.match(never.r.outputs[0], /approval required by policy, but AskForApproval is set to Never/);
  const declined = await observe({ rules: 'prefix_rule(pattern=["node", "write.mjs"], decision="prompt", justification="check it")\n', command: "node write.mjs" });
  assert.match(declined.r.outputs[0], /rejected by user/);
  assert.equal(declined.r.asked.length, 1);
  assert.equal(declined.r.asked[0].method, "item/commandExecution/requestApproval");
  assert.match(declined.r.asked[0].params.reason, /check it/);
  const accepted = await observe({ rules: 'prefix_rule(pattern=["node", "write.mjs"], decision="prompt")\n', command: "node write.mjs", answer: () => ({ decision: "accept" }) });
  assert.match(accepted.r.outputs[0], /Process exited with code/);
});

// ---- the banned prefixes -----------------------------------------------------------------------------------------------------------------

test("the table of banned prefixes is the one in the Windows executable of the Codex that runs now", { skip: skip() || (!IS_WIN && "the table is read from the Windows executable") }, () => {
  const exe = findWindowsExe(CODEX);
  assert.ok(exe, `no codex.exe next to ${CODEX}`);
  const live = bannedFromPe(exe);
  assert.ok(live, "the table was not found in the executable");
  assert.deepEqual(live, BANNED_PREFIXES);
});

// Windows: with no sandbox selected every command asks, so a command that an allow rule covers is told from one that it does not by
// "blocked by policy" (approval never): the banned prefixes are refused, everything else runs (or fails to start, which is not a refusal).
const HONOURED = [["git", "status"], ["git", "-C"], ["node", "script.js"], ["node", "build.mjs"], ["deno", "run"], ["rm", "-rf"], ["rm", "-f"], ["npm"], ["npm", "exec"], ["npx"], ["pnpm"], ["pnpm", "dlx"], ["yarn"], ["yarn", "dlx"], ["env", "bash"], ["sudo", "ls"], ["Rscript", "-e"], ["osascript", "-e"], ["powershell", "-ec"], ["pwsh", "-e", "x"], ["python3.12"], ["bash.exe"], ["pwsh.exe"], ["make"], ["curl"], ["docker"], ["echo"], ["ls"], ["eval"]];

test("banned prefixes, Windows: Codex ignores an allow rule for each of the 88, and honours longer patterns and the other programs", { skip: skip() || (!IS_WIN && "this check needs Windows: it relies on a machine with no sandbox selected") }, async () => {
  const askAbout = async (prefix) => {
    const r = await thread({ label: "e2e-banned", userTop: 'approval_policy = "never"\n', files: { "codex-home/rules/default.rules": allow(...prefix) }, script: [shellCall(`${prefix.join(" ")} --version`), { text: "DONE" }], approval: "never", sandbox: "workspace-write" });
    const out = (r.outputs[0] || "").replace(/\s+/g, " ");
    return { prefix, ignored: /blocked by policy|approval required by policy/.test(out), out: out.slice(0, 100) };
  };
  const banned = await pool(BANNED_PREFIXES, PARALLEL, askAbout);
  const honoured = await pool(HONOURED, PARALLEL, askAbout);
  assert.deepEqual(banned.filter((b) => !b.ignored).map((b) => b.prefix.join(" ")), [], "banned prefixes that Codex honoured");
  assert.deepEqual(honoured.filter((b) => b.ignored).map((b) => b.prefix.join(" ")), [], "prefixes that Codex ignored and the table does not list");
  assert.equal(banned.length, 88);
});

// Linux and macOS: a stand-in program writes outside the project when it runs; inside the sandbox it cannot, so it only does if the allow
// rule was honoured. Run on the systems whose sandbox the machine has; where there is none, "inside" still means "not run outside".
const STAND_INS = ["git", "rm", "sh", "bash", "env", "python3", "npm", "sudo", "deno", "yarn"];

test("banned prefixes, Linux and macOS: a stand-in program runs outside the sandbox only when the allow rule is honoured", { skip: skip() || (IS_WIN && "this check is for Linux and macOS: the Windows check above asks every prefix") }, async () => {
  const stand = (name) => `#!/bin/sh\nprintf x > "$PWD/../outside.txt"\necho "stand-in ${name}"\n`;
  const rows = [
    [["git"], false], [["rm"], false], [["sh", "-c"], false], [["bash", "-lc"], false], [["env"], false], [["python3", "-c"], false], [["npm", "run"], false], [["sudo"], false],
    [["git", "status"], true], [["rm", "-rf"], true], [["npm"], true], [["deno", "run"], true], [["yarn", "dlx"], true], [["env", "bash"], true],
  ];
  const results = await pool(rows, PARALLEL, async ([prefix, honoured]) => {
    const files = {};
    for (const name of STAND_INS) files[`bin/${name}`] = stand(name);
    const r = await thread({
      label: "e2e-banned-unix",
      userTop: 'approval_policy = "never"\nsandbox_mode = "workspace-write"\n',
      files: { ...files, "codex-home/rules/default.rules": allow(...prefix) },
      before: (sb) => { for (const name of STAND_INS) fs.chmodSync(path.join(sb.root, "bin", name), 0o755); },
      script: [shellCall(`${prefix.join(" ")} x`), { text: "DONE" }],
      approval: "never",
      sandbox: "workspace-write",
      path: (sb) => sb.bin,
    });
    return { prefix, honoured, outside: fs.existsSync(path.join(r.sb.root, "outside.txt")), out: (r.outputs[0] || "").slice(0, 120) };
  });
  assert.deepEqual(results.filter((x) => x.outside !== x.honoured).map((x) => `${x.prefix.join(" ")}: ${x.out}`), []);
});
