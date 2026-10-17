// Commands that Codex finds dangerous. When no rule covers such a command, Codex asks before it runs it, whatever the sandbox, and with
// approval_policy "never" it refuses it ("blocked by policy"). The lists are what Codex 0.163.0 did (test/e2e-why.test.mjs):
//   - for the POSIX shells (bash and zsh, so Linux and macOS): `rm -f` and `rm -rf` (the first argument is exactly -f or -rf: `rm -fr`,
//     `rm -r -f` and plain `rm` run), `git reset` and `git rm` with any arguments, and `sudo` in front of either;
//   - for PowerShell (Windows): Remove-Item and its aliases rm, ri and del with -Force in any position (-Force:$false counts), and
//     Start-Process with a web address. On Windows `rm -rf` and `git reset --hard` are not on the list: they ran.
// A script that Codex does not split (a redirection, a variable, a substitution) is one command whose first word is the shell, so nothing
// in it is looked at. Anything not named here is not known to be dangerous or safe by this tool.

/** The name of the dangerous thing a command does, or null: tokens are the words of one command. */
export function dangerOf(tokens, shell) {
  if (!Array.isArray(tokens) || !tokens.length) return null;
  return shell === "powershell" ? powershell(tokens) : posix(tokens);
}

function posix(tokens) {
  const [cmd, arg] = tokens;
  if (cmd === "rm" && (arg === "-f" || arg === "-rf")) return `rm ${arg}`;
  if ((cmd === "git" || cmd.endsWith("/git")) && (arg === "reset" || arg === "rm")) return `git ${arg}`;
  if (cmd === "sudo") return posix(tokens.slice(1));
  return null;
}

const REMOVE = new Set(["remove-item", "rm", "ri", "del"]);

function powershell(tokens) {
  const cmd = tokens[0].toLowerCase();
  const rest = tokens.slice(1);
  if (REMOVE.has(cmd) && rest.some((t) => /^-force(:|$)/i.test(t))) return `${tokens[0]} -Force`;
  if (cmd === "start-process" && rest.some((t) => /^https?:\/\//i.test(t))) return `${tokens[0]} with a web address`;
  return null;
}
