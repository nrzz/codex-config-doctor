// Commands that Codex finds dangerous. When no rule covers such a command, Codex asks before it runs it, whatever the sandbox, and with
// approval_policy "never" it refuses it. The lists are what Codex 0.163.0 did, on Linux and macOS (the same on both, 84 commands each) and
// on Windows (test/e2e-why.test.mjs puts rows of them to the binary on each system):
//   - for bash and zsh: `rm` with a force option: -f, --force, or a group of short options that holds an f (-rf, -fr, -rfv, -Rf), as
//     one word or as `-r -f`, before or after the operands. `rm x`, `rm -r x`, `rm -v x` run. The command is found wherever it is in the
//     script: in a list, a pipe, a subshell, a `$( )`, a loop or an `if`, after `VAR=1`, `env` or `sudo`, by its path (/bin/rm), and in the
//     script of `bash -c` and `sh -c`. `xargs rm -rf` and `find -exec rm -rf` are not found. `git reset`, `git rm`, `git clean`,
//     `git push --force` and `sudo ls` run: they are not on the list of this Codex.
//   - for PowerShell (Windows): Remove-Item and its aliases rm, ri and del with -Force in any position (-Force:$false counts), and
//     Start-Process with a web address. On Windows `rm -rf` and `git reset --hard` run (PowerShell is read by its own rules).
// Anything not named here is not known to be dangerous by this tool.

/** The name of the dangerous thing a command does, or null: tokens are the words of one command (for bash, the whole script may be one word). */
export function dangerOf(tokens, shell) {
  if (!Array.isArray(tokens) || !tokens.length) return null;
  return shell === "powershell" ? powershell(tokens) : posixCommand(tokens, 0);
}

// ---- bash and zsh ----------------------------------------------------------------------------------------------------------------

const base = (word) => String(word).replace(/^.*\//, "");
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const LEADING = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "time", "{", "}"]);
const SHELLS = new Set(["bash", "sh", "zsh"]);

/**
 * The words of a script, split into commands at the list separators, pipes and parentheses, with the quotes honoured. A `$( )` or a pair of
 * backticks is a command of its own, and the words around it go on as one command.
 */
export function commandsOfScript(script) {
  const s = String(script);
  const commands = [];
  const stack = [];
  let words = [];
  let word = "";
  let inWord = false;
  let skip = false;
  const endWord = () => {
    if (!inWord) return;
    if (skip) skip = false; else words.push(word);
    word = ""; inWord = false;
  };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  const open = (kind) => { endWord(); stack.push({ kind, words }); words = []; };
  const close = (kind) => {
    endWord();
    if (words.length) commands.push(words);
    words = stack.pop().words;
    return kind;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") { if (i + 1 < s.length) { word += s[i + 1]; inWord = true; } i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); const end = j < 0 ? s.length : j; word += s.slice(i + 1, end); inWord = true; i = end + 1; continue; }
    if (c === '"') {
      i++; inWord = true;
      while (i < s.length && s[i] !== '"') { if (s[i] === "\\" && i + 1 < s.length) { word += s[i + 1]; i += 2; } else { word += s[i]; i++; } }
      i++;
      continue;
    }
    if (c === " " || c === "\t") { endWord(); i++; continue; }
    if (c === "#" && !inWord) { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "$" && s[i + 1] === "(") { open("$("); i += s[i + 2] === "(" ? 3 : 2; continue; }
    if (c === "`") { if (stack.length && stack[stack.length - 1].kind === "`") close("`"); else open("`"); i++; continue; }
    if (c === ")") { if (stack.length && stack[stack.length - 1].kind === "$(") close("$("); else endCommand(); i++; continue; }
    if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "(") { endCommand(); i++; continue; }
    if (c === ">" || c === "<") { endWord(); i++; while (s[i] === ">" || s[i] === "<" || s[i] === "&") i++; skip = true; continue; }
    word += c; inWord = true; i++;
  }
  endCommand();
  for (const frame of stack) if (frame.words.length) commands.push(frame.words);
  return commands;
}

function posixCommand(tokens, depth) {
  const words = [...tokens];
  for (;;) {
    while (words.length && LEADING.has(words[0])) words.shift();
    while (words.length && ASSIGNMENT.test(words[0])) words.shift();
    const head = words.length ? base(words[0]) : "";
    if (head === "sudo" || head === "env") {
      words.shift();
      while (words.length && (words[0].startsWith("-") || ASSIGNMENT.test(words[0]))) words.shift();
      continue;
    }
    break;
  }
  if (!words.length) return null;
  const head = base(words[0]);
  if (head === "rm") {
    const force = words.slice(1).find((w) => w === "--force" || /^-[A-Za-z]*f[A-Za-z]*$/.test(w));
    return force ? `rm ${force}` : null;
  }
  if (SHELLS.has(head) && depth < 4) {
    const at = words.findIndex((w, k) => k > 0 && /^-[a-z]*c$/.test(w));
    if (at > 0 && words[at + 1] !== undefined) {
      for (const command of commandsOfScript(words[at + 1])) {
        const found = posixCommand(command, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

// ---- PowerShell ------------------------------------------------------------------------------------------------------------------

const REMOVE = new Set(["remove-item", "rm", "ri", "del"]);

function powershell(tokens) {
  const cmd = tokens[0].toLowerCase();
  const rest = tokens.slice(1);
  if (REMOVE.has(cmd) && rest.some((t) => /^-force(:|$)/i.test(t))) return `${tokens[0]} -Force`;
  if (cmd === "start-process" && rest.some((t) => /^https?:\/\//i.test(t))) return `${tokens[0]} with a web address`;
  return null;
}
