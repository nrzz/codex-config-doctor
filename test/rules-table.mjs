// The rules the engine is held to. POLICIES are rules files; for each, COMMANDS are token lists, and the cases are those commands put to
// that policy, with variations made from the rules themselves (the prefix, the prefix with more tokens, one token fewer, another case, a
// token in front). test/record-oracles.mjs puts every case to `codex execpolicy check --rules <file> -- <tokens>` and records the answer in
// test/fixtures/rules-oracle.json; test/execpolicy.test.mjs holds src/execpolicy.mjs to the record without Codex, and
// test/e2e-rules.test.mjs asks Codex again. FILES are rules files that load or do not.
import { runRules } from "../src/starlark.mjs";

export const POLICIES = {
  git: {
    text: `prefix_rule(pattern=["git", "status"], decision="allow")
prefix_rule(pattern=["git", "push"], decision="prompt", justification="pushes need a look")
prefix_rule(pattern=["git", "push", "--force"], decision="forbidden", justification="no force push")
prefix_rule(pattern=["rm", "-rf"], decision="forbidden")
prefix_rule(pattern=["ls"])
`,
    commands: [["git"], ["git", "status"], ["git", "status", "-sb"], ["git", "push"], ["git", "push", "origin", "main"], ["git", "push", "--force"], ["git", "push", "--force-with-lease"], ["git", "pull"], ["rm", "-rf", "/"], ["rm", "-r", "x"], ["rm"], ["ls"], ["ls", "-la", "/tmp"], ["LS"], ["/bin/ls"], ["sudo", "ls"], ["git", "-C", "x", "status"], ["git", "status", "&&", "git", "push"]],
  },
  alternatives: {
    text: `prefix_rule(pattern=["git", ["pull", "fetch"], "origin"], decision="prompt")
prefix_rule(pattern=[["npm", "pnpm", "yarn"], "install"], decision="allow")
prefix_rule(pattern=[["cat", "bat"]], decision="allow")
prefix_rule(pattern=[["python", "python3"], "-c"], decision="forbidden", justification="no inline python")
`,
    commands: [["git", "pull", "origin"], ["git", "fetch", "origin", "main"], ["git", "fetch", "upstream"], ["git", "pull"], ["npm", "install"], ["pnpm", "install", "left-pad"], ["yarn", "install"], ["npm", "i"], ["cat"], ["bat", "file"], ["cat", "a", "b"], ["python", "-c", "print(1)"], ["python3", "-c", "x"], ["python", "script.py"], ["python3.12", "-c", "x"]],
  },
  overlap: {
    text: `prefix_rule(pattern=["npm"], decision="allow")
prefix_rule(pattern=["npm", "publish"], decision="prompt", justification="publishing")
prefix_rule(pattern=["npm", "publish", "--access", "public"], decision="forbidden", justification="never public")
prefix_rule(pattern=["npm", "run"], decision="allow")
prefix_rule(pattern=["npm", "run", "build"], decision="allow", justification="build is fine")
prefix_rule(pattern=["npm", "run", "deploy"], decision="prompt")
`,
    commands: [["npm"], ["npm", "test"], ["npm", "publish"], ["npm", "publish", "--tag", "beta"], ["npm", "publish", "--access", "public"], ["npm", "publish", "--access", "restricted"], ["npm", "run"], ["npm", "run", "build"], ["npm", "run", "build", "--", "--watch"], ["npm", "run", "deploy"], ["npm", "run", "deploy", "prod"], ["npx", "npm"], ["NPM"], ["npm", "RUN", "build"]],
  },
  odd: {
    text: `prefix_rule(pattern=["echo", "a b"], decision="allow")
prefix_rule(pattern=["printf", ""], decision="prompt")
prefix_rule(pattern=["éclair", "ü"], decision="allow")
prefix_rule(pattern=["tool", "--flag=value"], decision="prompt", justification="a flag with a value")
prefix_rule(pattern=["a"], decision="allow")
prefix_rule(pattern=["a", "b"], decision="allow")
prefix_rule(pattern=["a", "b", "c"], decision="prompt")
`,
    commands: [["echo", "a b"], ["echo", "a", "b"], ["echo", "a b", "c"], ["echo"], ["printf", ""], ["printf"], ["printf", "x"], ["éclair", "ü"], ["éclair"], ["tool", "--flag=value"], ["tool", "--flag", "value"], ["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"], ["a", "c"], ["b"]],
  },
  paths: {
    text: `prefix_rule(pattern=["/usr/bin/env"], decision="prompt")
prefix_rule(pattern=["./run.sh"], decision="allow")
prefix_rule(pattern=["C:\\\\Windows\\\\System32\\\\cmd.exe"], decision="prompt")
prefix_rule(pattern=["cmd.exe", "/c"], decision="prompt")
prefix_rule(pattern=["powershell", "-Command"], decision="forbidden", justification="no powershell commands")
prefix_rule(pattern=["~/bin/tool"], decision="allow")
`,
    commands: [["/usr/bin/env", "bash"], ["env", "bash"], ["./run.sh"], ["./run.sh", "--fast"], ["run.sh"], ["C:\\Windows\\System32\\cmd.exe", "/c", "dir"], ["cmd.exe", "/c", "dir"], ["cmd.exe", "/C", "dir"], ["cmd", "/c", "dir"], ["powershell", "-Command", "ls"], ["powershell", "-command", "ls"], ["powershell", "-NoProfile", "-Command", "ls"], ["powershell.exe", "-Command", "ls"], ["~/bin/tool"], ["tool"]],
  },
  generated: {
    text: `SAFE = ["ls", "cat", "head", "tail", "wc"]
for p in SAFE:
    prefix_rule(pattern=[p], decision="allow")
RISKY = [["rm", "-rf"], ["dd", "if="], ["mkfs"], ["shutdown"]]
[prefix_rule(pattern=r, decision="forbidden", justification="risky: " + r[0]) for r in RISKY]
def ask(a, b=1):
    pass
prefix_rule(pattern=["git"] + ["reset", "--hard"], decision="prompt")
prefix_rule(pattern=["tool", "x" * 3], decision="allow")
`,
    commands: [["ls"], ["cat", "x"], ["head", "-n", "5", "x"], ["tail"], ["wc", "-l"], ["sort"], ["rm", "-rf", "x"], ["rm", "-fr", "x"], ["dd", "if="], ["dd", "if=/dev/zero"], ["mkfs"], ["mkfs.ext4", "/dev/sda"], ["shutdown", "-h", "now"], ["git", "reset", "--hard"], ["git", "reset", "--soft"], ["tool", "xxx"], ["tool", "x"]],
  },
  cases: {
    text: `prefix_rule(pattern=["LS"], decision="allow")
prefix_rule(pattern=["Git", "Status"], decision="prompt")
prefix_rule(pattern=["ls", "-L"], decision="forbidden")
`,
    commands: [["LS"], ["ls"], ["Ls"], ["Git", "Status"], ["git", "status"], ["GIT", "STATUS"], ["ls", "-L"], ["ls", "-l"], ["LS", "-L"]],
  },
  justification: {
    text: `prefix_rule(pattern=["a"], decision="prompt", justification="first")
prefix_rule(pattern=["a"], decision="prompt", justification="second")
prefix_rule(pattern=["a"], decision="allow")
prefix_rule(pattern=["b"], decision="forbidden", justification="because \\"quoted\\" and unicode é")
prefix_rule(pattern=["c"], decision="allow", justification="allowed")
`,
    commands: [["a"], ["a", "1"], ["b"], ["b", "x"], ["c"], ["c", "x"], ["d"]],
  },
  examples: {
    text: `prefix_rule(
    pattern = ["gh", "pr", "view"],
    decision = "prompt",
    justification = "Viewing GitHub PRs is allowed with approval",
    match = [
        ["gh", "pr", "view", "7888"],
        "gh pr view 7888 --repo openai/codex",
    ],
    not_match = [
        ["gh", "pr", "--repo", "openai/codex", "view", "7888"],
        "gh pr checkout 7888",
    ],
)
prefix_rule(pattern=["gh", "pr", "list"], decision="allow", match=["gh pr list --state open"])
`,
    commands: [["gh", "pr", "view"], ["gh", "pr", "view", "1"], ["gh", "pr", "list"], ["gh", "pr", "list", "--state", "open"], ["gh", "pr", "checkout", "1"], ["gh", "issue", "view"], ["gh"]],
  },
};

/** Variations of a command list made from the rules of a policy: the prefix of each rule, with more tokens, one fewer, in another case, behind another token. */
export function cases() {
  const out = [];
  const seen = new Set();
  const add = (policy, tokens) => {
    const key = `${policy}\u0000${JSON.stringify(tokens)}`;
    if (!seen.has(key) && tokens.length) { seen.add(key); out.push({ policy, tokens }); }
  };
  for (const [name, p] of Object.entries(POLICIES)) {
    for (const c of p.commands) add(name, c);
    const run = runRules(p.text);
    if (!run.ok) throw new Error(`policy ${name} does not run: ${run.error.message}`);
    for (const rule of run.rules) {
      const prefix = rule.pattern.map((alts) => alts[0]);
      add(name, prefix);
      add(name, [...prefix, "extra"]);
      add(name, [...prefix, "--flag", "value"]);
      if (prefix.length > 1) add(name, prefix.slice(0, -1));
      add(name, [prefix[0].toUpperCase(), ...prefix.slice(1)]);
      add(name, ["env", ...prefix]);
      if (rule.pattern.length === 1 && rule.pattern[0].length > 1) add(name, [rule.pattern[0][rule.pattern[0].length - 1]]);
    }
  }
  return out;
}

/** Rules files, with whether Codex loads them. */
export const FILES = {
  "empty": "",
  "comment only": "# nothing here\n",
  "one rule": "prefix_rule(pattern=[\"ls\"], decision=\"allow\")\n",
  "no newline at the end": "prefix_rule(pattern=[\"ls\"], decision=\"allow\")",
  "crlf": "prefix_rule(pattern=[\"ls\"],\r\n  decision=\"allow\")\r\n",
  "tabs for indentation": "for p in [\"ls\"]:\n\tprefix_rule(pattern=[p], decision=\"allow\")\n",
  "byte order mark": "\ufeffprefix_rule(pattern=[\"ls\"], decision=\"allow\")\n",
  "unclosed paren": "prefix_rule(pattern=[\"ls\"], decision=\"allow\"\n",
  "unclosed list": "prefix_rule(pattern=[\"ls\", decision=\"allow\")\n",
  "missing comma": "prefix_rule(pattern=[\"ls\"] decision=\"allow\")\n",
  "bad decision": "prefix_rule(pattern=[\"ls\"], decision=\"yes\")\n",
  "decision not a string": "prefix_rule(pattern=[\"ls\"], decision=1)\n",
  "empty pattern": "prefix_rule(pattern=[], decision=\"allow\")\n",
  "no pattern": "prefix_rule(decision=\"allow\")\n",
  "pattern is a string": "prefix_rule(pattern=\"ls\", decision=\"allow\")\n",
  "pattern holds a number": "prefix_rule(pattern=[\"ls\", 1], decision=\"allow\")\n",
  "pattern holds an empty list": "prefix_rule(pattern=[\"ls\", []], decision=\"allow\")\n",
  "unknown keyword": "prefix_rule(pattern=[\"ls\"], decision=\"allow\", bogus=1)\n",
  "positional arguments": "prefix_rule([\"ls\"], \"allow\")\n",
  "unknown function": "foo(pattern=[\"ls\"])\n",
  "justification not a string": "prefix_rule(pattern=[\"ls\"], justification=1)\n",
  "empty justification": "prefix_rule(pattern=[\"ls\"], justification=\"\")\n",
  "match example that matches": "prefix_rule(pattern=[\"git\", \"pull\"], match=[\"git pull origin\"])\n",
  "match example that does not match": "prefix_rule(pattern=[\"git\", \"pull\"], match=[\"git push\"])\n",
  "match example matched by another rule": "prefix_rule(pattern=[\"git\", \"pull\"], match=[\"git push\"])\nprefix_rule(pattern=[\"git\", \"push\"])\n",
  "match example matched by a later rule": "prefix_rule(pattern=[\"git\", \"pull\"], match=[\"git push\"])\nprefix_rule(pattern=[\"git\", \"push\"], decision=\"prompt\")\n",
  "not_match example that matches": "prefix_rule(pattern=[\"git\", \"pull\"], not_match=[\"git pull x\"])\n",
  "not_match example that does not match": "prefix_rule(pattern=[\"git\", \"pull\"], not_match=[\"git push\"])\n",
  "not_match matched by another rule only": "prefix_rule(pattern=[\"git\", \"pull\"], not_match=[\"git push\"])\nprefix_rule(pattern=[\"git\", \"push\"])\n",
  "match example as a list": "prefix_rule(pattern=[\"git\", \"pull\"], match=[[\"git\", \"pull\", \"x\"]])\n",
  "match example is a number": "prefix_rule(pattern=[\"git\", \"pull\"], match=[1])\n",
  "match is a string": "prefix_rule(pattern=[\"git\", \"pull\"], match=\"git pull\")\n",
  "example with an unterminated quote": "prefix_rule(pattern=[\"git\", \"pull\"], match=[\"git 'pull\"])\n",
  "variable": "X = \"ls\"\nprefix_rule(pattern=[X], decision=\"allow\")\n",
  "undefined variable": "prefix_rule(pattern=[Y], decision=\"allow\")\n",
  "for loop": "for c in [\"ls\", \"cat\"]:\n    prefix_rule(pattern=[c], decision=\"allow\")\n",
  "list comprehension": "[prefix_rule(pattern=[c]) for c in [\"ls\", \"cat\"]]\n",
  "function": "def f(x):\n    prefix_rule(pattern=[x], decision=\"allow\")\nf(\"ls\")\n",
  "function with a default": "def f(x, d=\"prompt\"):\n    prefix_rule(pattern=[x], decision=d)\nf(\"ls\")\n",
  "function with a missing argument": "def f(x):\n    prefix_rule(pattern=[x])\nf()\n",
  "if statement": "if True:\n    prefix_rule(pattern=[\"ls\"])\nelse:\n    prefix_rule(pattern=[\"cat\"])\n",
  "string concatenation": "prefix_rule(pattern=[\"l\" + \"s\"])\n",
  "string format": "prefix_rule(pattern=[\"{}s\".format(\"l\")])\n",
  "percent format": "prefix_rule(pattern=[\"%ss\" % \"l\"])\n",
  "list multiplication": "prefix_rule(pattern=[\"ls\"] * 2)\n",
  "lambda": "f = lambda x: x\nprefix_rule(pattern=[f(\"ls\")])\n",
  "while": "while True:\n    pass\n",
  "indentation error": "prefix_rule(pattern=[\"ls\"])\n    prefix_rule(pattern=[\"cat\"])\n",
  "unexpected indent first line": "  prefix_rule(pattern=[\"ls\"])\n",
  "tuple pattern": "prefix_rule(pattern=(\"ls\",), decision=\"allow\")\n",
  "single quoted strings": "prefix_rule(pattern=['ls'], decision='allow')\n",
  "triple quoted justification": "prefix_rule(pattern=[\"ls\"], justification=\"\"\"long\ntext\"\"\")\n",
  "raw string": "prefix_rule(pattern=[r\"C:\\x\"])\n",
  "unicode escape": "prefix_rule(pattern=[\"\\u00e9\"])\n",
  "bad escape": "prefix_rule(pattern=[\"\\q\"])\n",
  "semicolons": "prefix_rule(pattern=[\"ls\"]); prefix_rule(pattern=[\"cat\"])\n",
  "dict": "d = {\"a\": \"ls\"}\nprefix_rule(pattern=[d[\"a\"]])\n",
  "len and range": "for i in range(len([1, 2])):\n    prefix_rule(pattern=[\"x\" + str(i)])\n",
  "load statement": "load(\"x.rules\", \"y\")\n",
  "print": "print(\"hello\")\nprefix_rule(pattern=[\"ls\"])\n",
  "assert": "assert 1 == 1\n",
  "return outside a function": "return 1\n",
  "integer division": "prefix_rule(pattern=[\"a\" * (4 // 2)])\n",
};
