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
async function observe({ rules = "", command, approval = "on-request", sandbox = "workspace-write", select = true, answer, extraFiles = {}, wrote = (root) => fs.existsSync(path.join(root, "outside.txt")) }) {
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
  else if (/AskForApproval is set to Never|blocked by policy|style commands are not permitted/.test(out)) seen = "refused";
  else if (/rejected: /.test(out)) seen = "forbidden";
  else if (wrote(r.sb.root)) seen = "outside";
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
// Commands that Codex finds dangerous: with no rule it asks (whatever the sandbox), and with approval never it refuses. The lists are the
// ones in src/danger.mjs: for bash and zsh, rm with a force option wherever it is in the script (git reset and git rm are not on the list of
// this Codex); for PowerShell, Remove-Item and its aliases with -Force, and Start-Process with a web address.
if (!IS_WIN) {
  ROWS.push(
    { name: "dangerous: rm -f asks", command: "rm -f x.txt" },
    { name: "dangerous: rm -rf asks", command: "rm -rf build" },
    { name: "dangerous: rm -fr asks", command: "rm -fr build" },
    { name: "dangerous: rm -r -f asks", command: "rm -r -f build" },
    { name: "dangerous: a force option after the operand asks", command: "rm x.txt -f" },
    { name: "dangerous: rm --force asks", command: "rm --force x.txt" },
    { name: "dangerous: a group of options with an f asks (-rfv)", command: "rm -rfv build" },
    { name: "dangerous: a group of options with an f asks (-Rf)", command: "rm -Rf build" },
    { name: "dangerous: rm by its path asks", command: "/bin/rm -rf build" },
    { name: "dangerous: rm --recursive without a force option runs", command: "rm --recursive build" },
    { name: "dangerous: git clean runs", command: "git clean -fd" },
    { name: "dangerous: git push --force runs", command: "git push --force" },
    { name: "dangerous: find -exec rm -rf is not looked into, it runs", command: "find . -exec rm -rf {} +" },
    { name: "dangerous: plain rm runs", command: "rm x.txt" },
    { name: "dangerous: rm -r without a force option runs", command: "rm -r build" },
    { name: "dangerous: git reset is not on the list of this Codex, it runs", command: "git reset --hard" },
    { name: "dangerous: git rm is not on the list of this Codex, it runs", command: "git rm x.txt" },
    { name: "dangerous: git status runs", command: "git status" },
    { name: "dangerous: a part of a list asks for the whole", command: "echo hi && rm -f x.txt" },
    { name: "dangerous: sudo in front of rm -rf asks", command: "sudo rm -rf build" },
    { name: "dangerous: env in front of rm -rf asks", command: "env rm -rf build" },
    { name: "dangerous: a variable in front of rm -rf asks", command: "FOO=1 rm -rf build" },
    { name: "dangerous: xargs rm -rf is not looked into, it runs", command: "xargs rm -rf" },
    { name: "dangerous: rm as an argument of echo runs", command: "echo $(date) rm -rf build" },
    // a script that Codex does not split is looked into all the same: the rm in it is found
    { name: "dangerous: a substitution and a list: the rm is found", command: "echo $(date) && rm -rf build" },
    { name: "dangerous: a loop: the rm is found", command: "if true; then rm -rf build; fi" },
    { name: "dangerous: a subshell: the rm is found", command: "(rm -rf build)" },
    { name: "dangerous: a redirection: the rm is found", command: "rm -rf build > out.txt" },
    { name: "dangerous: the script of bash -c: the rm is found", command: 'bash -c "rm -rf build"' },
    { name: "dangerous: with approval never it is refused", command: "rm -rf build", approval: "never" },
    { name: "dangerous: a script that is not split is refused too with approval never", command: "echo $(date) && rm -rf build", approval: "never" },
    { name: "dangerous: it asks in danger-full-access too", command: "rm -rf build", sandbox: "danger-full-access" },
    // the command removes a file outside the project, which only a command that runs outside the sandbox can do
    { name: "dangerous: a longer allow rule wins over the list, and runs outside the sandbox", rules: allow("rm", "-rf"), command: "rm -rf ../victim.txt", extraFiles: { "victim.txt": "x" }, wrote: (root) => !fs.existsSync(path.join(root, "victim.txt")) },
    { name: "dangerous: an allow rule for rm alone is ignored, so it asks", rules: allow("rm"), command: "rm -rf build" },
  );
}
if (IS_WIN) {
  ROWS.push(
    { name: "dangerous: PowerShell Remove-Item -Force asks", command: "Remove-Item -Force x.txt" },
    { name: "dangerous: PowerShell rm -Force asks", command: "rm -Force x.txt" },
    { name: "dangerous: PowerShell Remove-Item -Recurse runs", command: "Remove-Item -Recurse build" },
    { name: "dangerous: PowerShell Start-Process with a web address asks", command: "Start-Process https://example.com" },
    { name: "dangerous: PowerShell rm -rf is not on the list, it runs", command: "rm -rf build" },
    { name: "dangerous: PowerShell git reset --hard is not on the list, it runs", command: "git reset --hard" },
    { name: "dangerous: PowerShell Remove-Item -Force with approval never is refused", command: "Remove-Item -Force x.txt", approval: "never" },
  );
}
if (!IS_WIN) {
  // bash is the shell on Linux and macOS: the separators it splits on, the shapes it does not split, and a script that is already bash -lc
  const both = allow("node", "write.mjs") + allow("echo", "done");
  ROWS.push(
    { name: "bash: && between two allowed commands: outside", rules: both, command: "node write.mjs && echo done" },
    { name: "bash: || between two allowed commands: outside", rules: both, command: "node write.mjs || echo done" },
    { name: "bash: a pipe between two allowed commands: outside", rules: allow("node", "write.mjs") + allow("cat"), command: "node write.mjs | cat" },
    { name: "bash: && with a part that has no rule: the whole stays inside", rules: allow("node", "write.mjs"), command: "node write.mjs && echo done" },
    { name: "bash: a forbidden part refuses the whole", rules: allow("node", "write.mjs") + 'prefix_rule(pattern=["echo"], decision="forbidden", justification="no echo")\n', command: "node write.mjs && echo done" },
    { name: "bash: a redirection is not split, and its rule does not match", rules: allow("node", "write.mjs"), command: "node write.mjs > out.txt" },
    { name: "bash: a variable is not split, and its rule does not match", rules: allow("node", "write.mjs"), command: "node write.mjs $HOME" },
    { name: "bash: a wildcard is not split, and its rule does not match", rules: allow("node", "write.mjs"), command: "node write.mjs *.txt" },
    { name: "bash: control flow is not split, and its rule does not match", rules: allow("node", "write.mjs"), command: "if true; then node write.mjs; fi" },
    { name: "bash -lc is not opened: the rules for the commands inside do not match, so it stays inside", rules: both, command: 'bash -lc "node write.mjs && echo done"' },
  );
}
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

// Linux and macOS: the real programs of the machine, each run with an allow rule for the banned prefix and with one for a longer pattern. A
// command that Codex runs outside the sandbox writes outside the project (a file, a deleted file, a new repository); inside the sandbox it
// cannot (on a runner where the sandbox cannot start at all, such as GitHub's Linux runners, "inside" is a failure to start, which is not
// writing either). node is in the rows above. The Windows check above puts all 88 prefixes to the binary; these put the same table to the
// Linux and macOS binaries by example.
const WRITE_PY = 'open("../outside.txt", "w").write("x")\nprint("WROTE-OUTSIDE")\n';
const UNIX_ROWS = [
  { prefix: ["env"], longer: ["env", "node"], command: "env node write.mjs" },
  { prefix: ["python3"], longer: ["python3", "write.py"], command: "python3 write.py" },
  { prefix: ["rm"], longer: ["rm", "../victim.txt"], command: "rm ../victim.txt", victim: true },
  { prefix: ["git"], longer: ["git", "init"], command: "git init ../outside-repo", repo: true },
];

test("banned prefixes, Linux and macOS: env, python3, rm and git run outside the sandbox only with a longer pattern", { skip: skip() || (IS_WIN && "this check is for Linux and macOS: the Windows check above asks every prefix") }, async () => {
  const wroteWhere = (row) => (root) => (row.victim ? !fs.existsSync(path.join(root, "victim.txt")) : row.repo ? fs.existsSync(path.join(root, "outside-repo")) : fs.existsSync(path.join(root, "outside.txt")));
  const jobs = UNIX_ROWS.flatMap((row) => [{ row, honoured: false, pattern: row.prefix }, { row, honoured: true, pattern: row.longer }]);
  const results = await pool(jobs, PARALLEL, async ({ row, honoured, pattern }) => {
    const { seen, said, r } = await observe({
      rules: allow(...pattern),
      command: row.command,
      approval: "never",
      extraFiles: { "work/write.py": WRITE_PY, ...(row.victim ? { "victim.txt": "x" } : {}) },
      wrote: wroteWhere(row),
    });
    return { rule: pattern.join(" "), command: row.command, honoured, seen, said: said.outcome, out: String(r.outputs[0] || "").replace(/\s+/g, " ").slice(0, 160) };
  });
  const wrong = results.filter((x) => x.seen !== (x.honoured ? "outside" : "inside") || SAME[x.said] !== x.seen);
  assert.deepEqual(wrong.map((x) => `allow [${x.rule}] for "${x.command}": Codex ${x.seen}, why ${x.said}, honoured ${x.honoured}: ${x.out}`), []);
});
