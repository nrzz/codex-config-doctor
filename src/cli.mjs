// The command line: the options, the help, the exit codes. 0 ok, 1 findings or a refusal, 2 a usage error.
import { collect } from "./collect.mjs";
import { cost } from "./cost.mjs";
import { listPages, nearIds, pageFor } from "./explain.mjs";
import { IDS } from "./catalog.mjs";
import { lint } from "./lint.mjs";
import { agentsDoc, agentsText, costDoc, costText, explainDoc, explainListDoc, explainListText, explainText, lintDoc, lintMarkdown, lintText, showDoc, showText, whyDoc, whyText } from "./report.mjs";
import { makeSys } from "./sys.mjs";
import { VERSION } from "./version.mjs";
import { why } from "./why.mjs";

export const HELP = `Usage: codex-config-doctor <command> [options]

It reads your Codex CLI configuration and changes nothing. Zero tokens: it runs outside Codex.

  show     [--project <dir>] [--profile <name>]
           every layer Codex loads for this project, in the order it applies them, each read,
           missing, skipped (a project you have not trusted) or broken; the merged configuration
           with the layer each key came from; the keys a project may not set; the AGENTS.md files
           against their cap; the rules files; the hooks and whether Codex trusts them; the MCP
           servers and whether their programs are found; the model provider; the Windows sandbox
  lint     [--project <dir>] [--profile <name>] [--markdown]
           what is wrong: each finding has an id, a severity (error, warning, note), the file and
           line, what Codex does about it, and the fix. Exit 1 on an error or a warning.
           --markdown is the short form to paste into an agent (at most 12 findings)
  why      <command> [--project <dir>] [--profile <name>] [--shell bash|powershell]
           what Codex does with this shell command under the approval policy, the sandbox and the
           rules: runs inside the sandbox, asks first, runs outside the sandbox through an allow
           rule, is forbidden, or is split into parts that are judged separately. Exit 1 when
           Codex would refuse it. Quote the command: why "git status && rm -rf build"
  agents   [--project <dir>] [--print]
           the AGENTS.md files in order, each included, cut or left out against
           project_doc_max_bytes, and the size of the text; --print prints that text exactly as
           Codex sends it. Exit 1 when a file is cut or left out
  cost     [--project <dir>]
           what the first request of a session carries before your words: base instructions,
           skills, permissions, AGENTS.md, tool definitions; yours are computed, Codex's recorded
  explain  [--list] <finding-id>
           what a finding means, what Codex does in that case (each line marked verified,
           documented or not verified), and the fix

Options:
  --json            one JSON document on stdout (every command)
  --project <dir>   the folder Codex starts in (default: the folder you are in)
  --profile <name>  the profile file you start Codex with: $CODEX_HOME/<name>.config.toml
  -h, --help        this text
  -v, --version     the version

Exit codes: 0 ok; 1 findings, or Codex would refuse the command; 2 a usage error.
Environment: CODEX_HOME (Codex's folder, as Codex reads it), USERPROFILE or HOME (the default, ~/.codex),
ProgramData (the system folder on Windows; /etc/codex elsewhere), PATH and PATHEXT.
It reads files and the environment and starts no program. It writes nothing, opens no connection
and sends nothing anywhere.
`;

const COMMANDS = {
  show: { options: ["project", "profile", "json"], positional: 0 },
  lint: { options: ["project", "profile", "json", "markdown"], positional: 0 },
  why: { options: ["project", "profile", "json", "shell"], positional: 1 },
  agents: { options: ["project", "json", "print"], positional: 0 },
  cost: { options: ["project", "json"], positional: 0 },
  explain: { options: ["json", "list"], positional: 1 },
};

const FLAGS = { "--json": "json", "--markdown": "markdown", "--print": "print", "--list": "list", "-h": "help", "--help": "help", "-v": "version", "--version": "version" };
const VALUES = { "--project": "project", "--profile": "profile", "--shell": "shell" };

class UsageError extends Error {}

/** Reads the argument list. Returns { command, positional, project, profile, shell, json, markdown, print, list, help, version, given } or throws a UsageError. */
export function parseArgs(argv) {
  const o = { command: null, positional: [], project: undefined, profile: undefined, shell: undefined, json: false, markdown: false, print: false, list: false, help: false, version: false, given: new Set() };
  const rest = [];
  let dashdash = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (dashdash) { rest.push(a); continue; }
    if (a === "--") { dashdash = true; continue; }
    const eq = /^(--[a-z-]+)=(.*)$/s.exec(a);
    const flag = eq ? eq[1] : a;
    if (Object.prototype.hasOwnProperty.call(VALUES, flag)) {
      const key = VALUES[flag];
      const value = eq ? eq[2] : argv[++i];
      if (value === undefined || (!eq && /^--?[A-Za-z]/.test(value) && key !== "project")) throw new UsageError(`${flag} needs a value`);
      o.given.add(key);
      o[key] = value;
    } else if (Object.prototype.hasOwnProperty.call(FLAGS, flag) && !eq) {
      o[FLAGS[flag]] = true;
      o.given.add(FLAGS[flag]);
    } else if (a.startsWith("-") && a !== "-") {
      throw new UsageError(`unknown option ${a}${rest[0] === "why" ? " (a command that starts with a dash goes after --: why -- \"-x\")" : ""}`);
    } else rest.push(a);
  }
  if (o.help || o.version) return o;
  if (!rest.length) throw new UsageError("no command given");
  o.command = rest[0];
  const spec = COMMANDS[o.command];
  if (!spec) throw new UsageError(`unknown command "${o.command}"`);
  for (const key of o.given) if (key !== "help" && key !== "version" && !spec.options.includes(key)) throw new UsageError(`${o.command} does not take --${key}`);
  o.positional = rest.slice(1);
  if (o.command === "explain" && o.list && o.positional.length) throw new UsageError("explain takes --list or one finding id, not both");
  if (o.command === "explain" && !o.list && o.positional.length === 0) throw new UsageError(`explain needs a finding id or --list (${IDS.slice(0, 5).join(", ")}, ...)`);
  if (o.command === "why" && o.positional.length === 0) throw new UsageError("why needs the command, in quotes: why \"git status\"");
  if (o.positional.length > spec.positional) {
    throw new UsageError(o.command === "why" ? `why takes one argument, the command in quotes: why "${o.positional.join(" ")}"` : `${o.command} takes ${spec.positional === 0 ? "no argument" : "one argument"}, not "${o.positional.join(" ")}"`);
  }
  if (o.shell !== undefined && !["bash", "powershell"].includes(o.shell)) throw new UsageError("--shell is bash or powershell");
  return o;
}

const errorDoc = (message) => ({ ok: false, error: message });

/**
 * Runs the command line. `io` replaces the machine for the tests: { sys, stdout: { write }, stderr: { write } }.
 * Returns the exit code.
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let o;
  try { o = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (argv.includes("--json")) stdout.write(`${JSON.stringify(errorDoc(e.message))}\n`);
    else stderr.write(`codex-config-doctor: ${e.message}\nRun codex-config-doctor --help for the commands.\n`);
    return 2;
  }
  if (o.help) { stdout.write(HELP); return 0; }
  if (o.version) { stdout.write(`codex-config-doctor ${VERSION}\n`); return 0; }
  const emit = (doc, text) => stdout.write(o.json ? `${JSON.stringify(doc, null, 2)}\n` : text);
  try {
    if (o.command === "explain") {
      if (o.list) {
        const pages = listPages();
        emit(explainListDoc(pages), explainListText(pages));
        return 0;
      }
      const page = pageFor(o.positional[0]);
      if (!page) {
        const near = nearIds(o.positional[0]);
        if (o.json) stdout.write(`${JSON.stringify({ ok: false, refused: `no finding called "${o.positional[0]}"`, ids: IDS, near }, null, 2)}\n`);
        else stderr.write(`codex-config-doctor: no finding called "${o.positional[0]}".${near.length ? ` Did you mean ${near.join(", ")}?` : ""}\nThe ids: ${IDS.join(", ")}\n`);
        return 1;
      }
      emit(explainDoc(page), explainText(page));
      return 0;
    }
    const sys = io.sys || makeSys(io.env ? { env: io.env } : {});
    const project = o.project === undefined ? undefined : sys.resolve(o.project);
    const c = collect(sys, { project, profile: o.profile });
    switch (o.command) {
      case "show": {
        const doc = showDoc(c);
        emit(doc, showText(c, doc));
        return doc.ok ? 0 : 1;
      }
      case "lint": {
        const result = lint(c);
        if (o.markdown && !o.json) stdout.write(lintMarkdown(c, result));
        else emit(lintDoc(c, result), lintText(c, result));
        return result.counts.error + result.counts.warning > 0 ? 1 : 0;
      }
      case "why": {
        const r = why(c, o.positional[0], { shell: o.shell });
        emit(whyDoc(c, r), whyText(c, r));
        return r.refused ? 1 : 0;
      }
      case "agents": {
        if (o.print && !o.json) {
          if (c.agents.text === null) { stderr.write("codex-config-doctor: no instruction file is found: Codex sends no AGENTS.md message.\n"); return 1; }
          stdout.write(`${c.agents.text}\n`);
          return 0;
        }
        emit(agentsDoc(c), agentsText(c));
        return c.agents.firstShort ? 1 : 0;
      }
      case "cost": {
        const r = cost(c);
        emit(costDoc(c, r), costText(c, r));
        return 0;
      }
      default: return 2;
    }
  } catch (e) {
    if (o.json) stdout.write(`${JSON.stringify(errorDoc(String(e && e.message ? e.message : e)))}\n`);
    else stderr.write(`codex-config-doctor: ${e && e.message ? e.message : e}\n`);
    return 2;
  }
}
