// How a script is split into the commands that Codex judges: bash and zsh (the documentation), PowerShell (put to Codex 0.163.0 on Windows).
import test from "node:test";
import assert from "node:assert/strict";
import { judgedCommands, splitBash, splitCommandLine, splitPowerShell } from "../src/shellsplit.mjs";

const bash = (s) => { const r = splitBash(s); return r.plain ? r.commands : `not plain: ${r.reason}`; };
const ps = (s) => { const r = splitPowerShell(s); return r.plain ? r.commands : `not plain: ${r.reason}`; };

test("bash: commands joined by &&, ||, ; | and newlines are split, quotes are removed", () => {
  assert.deepEqual(bash("git pull && ls -la"), [["git", "pull"], ["ls", "-la"]]);
  assert.deepEqual(bash("a || b; c | d\ne"), [["a"], ["b"], ["c"], ["d"], ["e"]]);
  assert.deepEqual(bash("echo 'a b' \"c d\" e\\ f"), [["echo", "a b", "c d", "e f"]]);
  assert.deepEqual(bash("cd src && npm test -- --watch"), [["cd", "src"], ["npm", "test", "--", "--watch"]]);
  assert.deepEqual(bash("ls # list\n"), [["ls"]]);
  assert.deepEqual(bash("echo a#b"), [["echo", "a#b"]]);
});

test("bash: redirections, substitutions, variables, wildcards, control flow and assignments keep the script whole", () => {
  assert.match(bash("ls > out.txt"), /redirection/);
  assert.match(bash("cat < in.txt"), /redirection/);
  assert.match(bash("a 2>&1"), /redirection/);
  assert.match(bash("echo $(pwd)"), /variable or substitution/);
  assert.match(bash("echo `pwd`"), /substitution/);
  assert.match(bash("echo $HOME"), /variable/);
  assert.match(bash('echo "$HOME"'), /variable/);
  assert.match(bash("ls *.txt"), /wildcard/);
  assert.match(bash("ls file?.txt"), /wildcard/);
  assert.match(bash("(cd x && ls)"), /subshell/);
  assert.match(bash("if true; then ls; fi"), /control flow/);
  assert.match(bash("for f in a b; do echo x; done"), /control flow/);
  assert.match(bash("FOO=bar make"), /environment variable/);
  assert.match(bash("sleep 1 &"), /background/);
  assert.match(bash("echo 'unterminated"), /quote/);
  assert.match(bash(""), /no command/);
});

test("PowerShell: ; | && || and newlines split; quotes group; a redirection, a variable, a subexpression, a call operator or a block keeps it whole", () => {
  assert.deepEqual(ps("echo a; node -v"), [["echo", "a"], ["node", "-v"]]);
  assert.deepEqual(ps("echo a | node -e 1"), [["echo", "a"], ["node", "-e", "1"]]);
  assert.deepEqual(ps("git status && git log"), [["git", "status"], ["git", "log"]]);
  assert.deepEqual(ps("Get-ChildItem -Path 'C:\\a b' -Recurse"), [["Get-ChildItem", "-Path", "C:\\a b", "-Recurse"]]);
  assert.deepEqual(ps("echo \"say \"\"hi\"\"\""), [["echo", 'say "hi"']]);
  assert.match(ps("echo x > out.txt"), /redirection/);
  assert.match(ps("echo $env:PATH"), /variable/);
  assert.match(ps("echo \"$x\""), /variable/);
  assert.match(ps("(Get-Date).Year"), /subexpression/);
  assert.match(ps("& node x.js"), /call operator/);
  assert.match(ps("foreach ($i in 1..3) { echo $i }"), /variable|subexpression/);
  assert.match(ps("if (1) { 2 }"), /subexpression/);
});

test("splitCommandLine: the words of one command, or null", () => {
  assert.deepEqual(splitCommandLine("bash -lc 'git pull && ls'"), ["bash", "-lc", "git pull && ls"]);
  assert.equal(splitCommandLine("a && b"), null);
});

test("judgedCommands: the shell follows the platform; a command that already is `bash -lc` is read through", () => {
  const linux = judgedCommands("git pull && ls", "linux");
  assert.deepEqual([linux.shell, linux.split, linux.plain, linux.commands], ["bash", true, true, [["git", "pull"], ["ls"]]]);
  const win = judgedCommands("git pull; ls", "win32");
  assert.deepEqual([win.shell, win.split, win.commands], ["powershell", true, [["git", "pull"], ["ls"]]]);
  const whole = judgedCommands("ls > out.txt", "linux");
  assert.deepEqual([whole.plain, whole.split, whole.commands], [false, false, [["bash", "-lc", "ls > out.txt"]]]);
  const wrapped = judgedCommands("bash -lc 'git pull && ls'", "linux");
  assert.deepEqual([wrapped.shell, wrapped.split, wrapped.commands], ["bash", true, [["git", "pull"], ["ls"]]]);
  const wrappedWhole = judgedCommands("sh -c 'ls > x'", "linux");
  assert.deepEqual([wrappedWhole.plain, wrappedWhole.commands], [false, [["sh", "-c", "ls > x"]]]);
  assert.equal(judgedCommands("ls", "linux", "powershell").shell, "powershell");
});
