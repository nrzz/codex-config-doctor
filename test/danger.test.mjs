// Commands that Codex finds dangerous, and what `why` says about them. The lists are what Codex 0.163.0 did (test/e2e-why.test.mjs puts the
// same rows to the binary on Windows, Linux and macOS); here the lists and the outcomes on pretend machines.
import test from "node:test";
import assert from "node:assert/strict";
import { commandsOfScript, dangerOf } from "../src/danger.mjs";
import { why } from "../src/why.mjs";
import { world } from "./world.mjs";

test("bash and zsh: rm with a force option, wherever the command is in the script", () => {
  for (const [tokens, what] of [
    [["rm", "-f", "x"], "rm -f"], [["rm", "-rf", "build"], "rm -rf"], [["rm", "-fr", "x"], "rm -fr"], [["rm", "-rfv", "x"], "rm -rfv"], [["rm", "-Rf", "x"], "rm -Rf"],
    [["rm", "-r", "-f", "x"], "rm -f"], [["rm", "x", "-f"], "rm -f"], [["rm", "--force", "x"], "rm --force"], [["rm", "--recursive", "--force", "x"], "rm --force"],
    [["/bin/rm", "-rf", "x"], "rm -rf"], [["sudo", "rm", "-rf", "x"], "rm -rf"], [["env", "rm", "-rf", "x"], "rm -rf"], [["FOO=1", "rm", "-rf", "x"], "rm -rf"],
    [["sudo", "-n", "rm", "-f", "x"], "rm -f"], [["sudo", "env", "A=1", "rm", "-f", "x"], "rm -f"],
    // a script that Codex does not split is one command of three words, bash, -lc and the script: the commands in it are looked at all the same
    [["bash", "-lc", "echo $(date) && rm -rf x"], "rm -rf"], [["bash", "-lc", "if true; then rm -rf x; fi"], "rm -rf"], [["bash", "-lc", "(rm -rf x)"], "rm -rf"],
    [["bash", "-lc", "rm -rf x > out.txt"], "rm -rf"], [["bash", "-lc", "echo hi | rm -rf x"], "rm -rf"], [["bash", "-lc", "for f in a b; do rm -rf $f; done"], "rm -rf"],
    [["bash", "-lc", "echo `rm -rf x`"], "rm -rf"], [["bash", "-c", "rm -rf x"], "rm -rf"], [["sh", "-c", "rm -rf x"], "rm -rf"], [["bash", "-lc", "bash -c 'rm -rf x'"], "rm -rf"],
  ]) assert.equal(dangerOf(tokens, "bash"), what, tokens.join(" "));
  for (const tokens of [
    ["rm", "x"], ["rm", "-r", "x"], ["rm", "--recursive", "x"], ["rm", "-v", "x"], ["rm", "-i", "x"], ["xargs", "rm", "-rf"], ["find", ".", "-exec", "rm", "-rf", "{}", "+"], ["find", ".", "-delete"],
    ["git", "reset", "--hard"], ["git", "rm", "x"], ["git", "clean", "-fd"], ["git", "push", "--force"], ["sudo", "ls"], ["ls", "-f"], ["echo", "rm", "-rf", "x"], ["bash", "-lc", "echo rm -rf x"], ["bash", "-lc", "ls -f"], [],
  ]) assert.equal(dangerOf(tokens, "bash"), null, tokens.join(" "));
});

test("the words of a script: lists, pipes, subshells, substitutions, quotes, redirections and loops", () => {
  assert.deepEqual(commandsOfScript("a b && c | d; e\nf"), [["a", "b"], ["c"], ["d"], ["e"], ["f"]]);
  assert.deepEqual(commandsOfScript("echo $(date +%s) \"a b\" 'c d' > out.txt && ls"), [["date", "+%s"], ["echo", "a b", "c d"], ["ls"]]);
  assert.deepEqual(commandsOfScript("echo `date` rm -rf x"), [["date"], ["echo", "rm", "-rf", "x"]], "the words after a substitution go on with the command");
  assert.deepEqual(commandsOfScript("echo $(date) rm -rf x"), [["date"], ["echo", "rm", "-rf", "x"]]);
  assert.deepEqual(commandsOfScript("if true; then rm -rf x; fi"), [["if", "true"], ["then", "rm", "-rf", "x"], ["fi"]]);
  assert.deepEqual(commandsOfScript("# a comment\nls # another"), [["ls"]]);
});

test("PowerShell: Remove-Item and its aliases rm, ri and del with -Force anywhere, and Start-Process with a web address; rm -rf and git reset are not", () => {
  for (const tokens of [["Remove-Item", "-Force", "x"], ["remove-item", "x", "-Force"], ["rm", "-Force", "x"], ["ri", "-force", "x"], ["del", "-Force", "x"], ["Remove-Item", "-Recurse", "-Force:$false", "x"]]) {
    assert.ok(dangerOf(tokens, "powershell"), tokens.join(" "));
  }
  assert.equal(dangerOf(["Start-Process", "https://example.com"], "powershell"), "Start-Process with a web address");
  for (const tokens of [["Remove-Item", "x"], ["Remove-Item", "-Recurse", "x"], ["rm", "-rf", "x"], ["git", "reset", "--hard"], ["Get-ChildItem"], ["Start-Process", "notepad"], ["cmd", "/c", "del", "/f", "x"]]) {
    assert.equal(dangerOf(tokens, "powershell"), null, tokens.join(" "));
  }
});

const ask = (script, files = {}, o = {}, opts) => why(world({ "config.toml": "", ...files }, o).c, script, opts);
const NEVER = 'approval_policy = "never"\n';

test("a dangerous command that no rule decides asks, whatever the sandbox; with approval never it is refused", () => {
  let r = ask("rm -f x");
  assert.deepEqual([r.outcome, r.refused, r.decision], ["asks", false, null]);
  assert.match(r.headline, /Codex asks you first: `rm -f` is a command it finds dangerous/);
  assert.equal(r.lines[0].source, "verified");
  r = ask("rm -rf build", { "config.toml": 'sandbox_mode = "danger-full-access"\n' });
  assert.equal(r.outcome, "asks");
  assert.match(r.lines[0].text, /also in danger-full-access/);
  r = ask("rm -rf build", { "config.toml": NEVER });
  assert.deepEqual([r.outcome, r.refused], ["refused", true]);
  assert.match(r.headline, /Codex refuses to run it: `rm -rf` is a command it finds dangerous, and approval_policy is "never"/);
  assert.match(r.lines[0].text, /"rejected: rm -f style commands are not permitted\. Use a safer approach"/);
  assert.equal(ask("rm -fr build").outcome, "asks");
  assert.equal(ask("echo hi && rm -f x").outcome, "asks", "a dangerous part makes the whole ask");
  assert.equal(ask("echo hi && rm -f x", { "config.toml": NEVER }).outcome, "refused");
  assert.equal(ask("echo $(date) && rm -rf build").outcome, "asks", "a script that is not split is looked into all the same");
  assert.equal(ask("rm x").outcome, "sandboxed");
  assert.equal(ask("rm -r build").outcome, "sandboxed", "only a force option counts");
  assert.equal(ask("git reset --hard").outcome, "sandboxed", "git reset is not on the list of this Codex");
  assert.equal(ask("xargs rm -rf").outcome, "sandboxed");
});

test("a rule decides before the list: an honoured allow rule runs it outside the sandbox, an ignored one changes nothing, a forbidden rule refuses", () => {
  const rules = (...lines) => ({ "rules/default.rules": lines.join("\n") });
  let r = ask("rm -rf build", rules('prefix_rule(pattern=["rm", "-rf"], decision="allow")'));
  assert.deepEqual([r.outcome, r.parts[0].danger], ["outside-sandbox", null]);
  r = ask("rm -rf build", rules('prefix_rule(pattern=["rm"], decision="allow")'));
  assert.equal(r.outcome, "asks", "an allow rule for rm alone is ignored, so the list decides");
  assert.equal(r.parts[0].danger, "rm -rf");
  assert.equal(ask("rm -rf build", rules('prefix_rule(pattern=["rm"], decision="allow")', 'prefix_rule(pattern=["rm", "-rf"], decision="forbidden")')).outcome, "forbidden");
  assert.equal(ask("rm -rf build", rules('prefix_rule(pattern=["rm", "-rf"], decision="prompt")')).outcome, "asks");
});

test("on Windows the list is PowerShell's, and a bash script given with --shell bash is documented, not verified", () => {
  const win = { platform: "win32", extra: { release: "10.0.26300" } };
  const sandbox = '[windows]\nsandbox = "unelevated"\n';
  let r = ask("Remove-Item -Force x.txt", { "config.toml": sandbox }, win);
  assert.deepEqual([r.outcome, r.shell], ["asks", "powershell"]);
  assert.equal(r.lines.find((l) => /Remove-Item -Force/.test(l.text)).source, "verified");
  assert.equal(ask("rm -rf build", { "config.toml": sandbox }, win).outcome, "sandboxed", "rm -rf runs on Windows");
  assert.equal(ask("git reset --hard", { "config.toml": sandbox }, win).outcome, "sandboxed");
  r = ask("rm -f x", { "config.toml": sandbox }, win, { shell: "bash" });
  assert.equal(r.outcome, "asks");
  assert.equal(r.lines.find((l) => /rm -f/.test(l.text)).source, "documented");
  r = ask("Remove-Item -Force x", { "config.toml": `${NEVER}${sandbox}` }, win);
  assert.equal(r.outcome, "refused");
  assert.match(r.lines[0].text, /"rejected: blocked by policy"/);
});
