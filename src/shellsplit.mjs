// How Codex turns the command string a model writes into the commands it judges. The model's `cmd` runs in the user's shell (a login
// bash or zsh on Linux and macOS, PowerShell on Windows). Codex reads the script: when it is a plain list of commands joined by &&,
// ||, ; and |, each command is judged on its own and the strictest answer counts; when it has redirections, substitutions, variables,
// wildcards or control flow, the whole script is one command. Put to Codex 0.163.0 on Windows with PowerShell (a rule on `node`
// rejected `echo a; node ...` and `echo a | node ...`; a redirection kept the script whole) and, for bash, to the Linux and macOS binaries in CI
// (&&, ||, ;, a pipe, a redirection, a variable, a wildcard, control flow, and a script that starts with `bash -lc`, which is not opened). The documentation says
// the same: https://learn.chatgpt.com/docs/agent-configuration/rules.md.
//
//   splitBash(script)       -> { plain: true, commands: [[word, ...], ...] } | { plain: false, reason }
//   splitPowerShell(script) -> the same for a PowerShell script
//   splitCommandLine(text)  -> the words of one command, quotes removed (a POSIX shell's reading)

const CONTROL_WORDS = new Set(["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "select", "function", "time", "coproc", "!", "[[", "((", "{", "}"]);

/** The words of one simple command with the quotes removed, or null when the text is not a plain command. */
export function splitCommandLine(text) {
  const r = splitBash(text);
  return r.plain && r.commands.length === 1 ? r.commands[0] : null;
}

export function splitBash(script) {
  const s = String(script);
  const commands = [];
  let words = [];
  let cur = "";
  let inWord = false;
  let i = 0;
  const fail = (reason) => ({ plain: false, reason });
  const endWord = () => { if (inWord) { words.push(cur); cur = ""; inWord = false; } };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] === "\n") { i += 2; continue; }
      if (i + 1 >= s.length) return fail("a trailing backslash");
      cur += s[i + 1]; inWord = true; i += 2;
      continue;
    }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return fail("an unterminated quote");
      cur += s.slice(i + 1, j); inWord = true; i = j + 1;
      continue;
    }
    if (c === '"') {
      i++; inWord = true;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "$" || s[i] === "`") return fail(s[i] === "$" ? "a variable or substitution" : "a command substitution");
        if (s[i] === "\\" && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) { if (s[i + 1] !== "\n") cur += s[i + 1]; i += 2; continue; }
        cur += s[i]; i++;
      }
      if (i >= s.length) return fail("an unterminated quote");
      i++;
      continue;
    }
    if (c === " " || c === "\t") { endWord(); i++; continue; }
    if (c === "\n") { endCommand(); i++; continue; }
    if (c === "#" && !inWord) { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === ";") { if (s[i + 1] === ";") return fail("control flow"); endCommand(); i++; continue; }
    if (c === "&") {
      if (s[i + 1] === "&") { endCommand(); i += 2; continue; }
      return fail(s[i + 1] === ">" ? "a redirection" : "a background command");
    }
    if (c === "|") {
      if (s[i + 1] === "&") return fail("a redirection");
      endCommand(); i += s[i + 1] === "|" ? 2 : 1;
      continue;
    }
    if (c === "<" || c === ">") return fail("a redirection");
    if (c === "$") return fail("a variable or substitution");
    if (c === "`") return fail("a command substitution");
    if (c === "(" || c === ")") return fail("a subshell or substitution");
    if (c === "*" || c === "?" || c === "[") return fail("a wildcard");
    if (c === "{" && !inWord) return fail("control flow");
    cur += c; inWord = true; i++;
  }
  endCommand();
  if (!commands.length) return fail("no command");
  for (const w of commands) {
    if (CONTROL_WORDS.has(w[0])) return fail("control flow");
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) return fail("an environment variable assignment");
  }
  return { plain: true, commands };
}

export function splitPowerShell(script) {
  const s = String(script);
  const commands = [];
  let words = [];
  let cur = "";
  let inWord = false;
  let i = 0;
  const fail = (reason) => ({ plain: false, reason });
  const endWord = () => { if (inWord) { words.push(cur); cur = ""; inWord = false; } };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      i++; inWord = true;
      for (;;) {
        if (i >= s.length) return fail("an unterminated quote");
        if (s[i] === "'") { if (s[i + 1] === "'") { cur += "'"; i += 2; continue; } i++; break; }
        cur += s[i]; i++;
      }
      continue;
    }
    if (c === '"') {
      i++; inWord = true;
      for (;;) {
        if (i >= s.length) return fail("an unterminated quote");
        if (s[i] === "$") return fail("a variable or subexpression");
        if (s[i] === "`") return fail("an escape sequence");
        if (s[i] === '"') { if (s[i + 1] === '"') { cur += '"'; i += 2; continue; } i++; break; }
        cur += s[i]; i++;
      }
      continue;
    }
    if (c === " " || c === "\t") { endWord(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { endCommand(); i++; continue; }
    if (c === "#" && !inWord) { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === ";") { endCommand(); i++; continue; }
    if (c === "|") { endCommand(); i += s[i + 1] === "|" ? 2 : 1; continue; }
    if (c === "&") { if (s[i + 1] === "&") { endCommand(); i += 2; continue; } return fail("the call operator or a background job"); }
    if (c === "<" || c === ">") return fail("a redirection");
    if (c === "$") return fail("a variable or subexpression");
    if (c === "`") return fail("an escape sequence");
    if (c === "(" || c === ")" || c === "{" || c === "}") return fail("a subexpression, script block or group");
    if (c === "@") return fail("splatting or an array expression");
    cur += c; inWord = true; i++;
  }
  endCommand();
  if (!commands.length) return fail("no command");
  const keywords = new Set(["if", "foreach", "for", "while", "do", "switch", "function", "param", "try", "trap", "return", "break", "continue", "throw", "filter", "workflow"]);
  for (const w of commands) if (keywords.has(w[0].toLowerCase())) return fail("control flow");
  return { plain: true, commands };
}

/** The commands Codex judges for a script on this platform: a list of token lists, and whether the script was split. */
export function judgedCommands(script, platform, shell = null) {
  const win = platform === "win32";
  // a script that starts with `bash -lc "..."` is one command of three words, bash, -lc and the script: Codex wraps the model's command in a
  // `bash -lc` of its own and does not open the inner one, so a rule for what is inside does not match it (put to Codex 0.163.0 on Linux and macOS)
  const which = shell || (win ? "powershell" : "bash");
  const r = which === "powershell" ? splitPowerShell(script) : splitBash(script);
  if (r.plain) return { shell: which, split: r.commands.length > 1, plain: true, commands: r.commands, wrapper: null };
  return { shell: which, split: false, plain: false, reason: r.reason, commands: [[which === "powershell" ? "powershell.exe" : "bash", which === "powershell" ? "-Command" : "-lc", String(script)]], wrapper: null };
}
