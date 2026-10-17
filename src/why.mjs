// What Codex does with one shell command under the effective approval_policy, sandbox_mode and rules. The rules part is what
// `codex execpolicy check` answers (test/e2e-rules.test.mjs compares several hundred commands); how a script is split into the commands
// that are judged is shellsplit.mjs; the outcome (runs inside the sandbox, asks, runs outside, is refused) was put to Codex 0.163.0 through
// the app server and `codex exec` (test/e2e-why.test.mjs). Each line of the explanation says which: `verified` (put to the binary,
// on Windows 11 for the sandbox parts) or `documented`.
import { STRICTNESS, effective } from "./execpolicy.mjs";
import { judgedCommands } from "./shellsplit.mjs";

const V = "verified";
const D = "documented";

/**
 * @param c        the collected world
 * @param script   the command string a model would put in `cmd`
 * @param opts     { shell: "bash" | "powershell" } to override the shell
 */
export function why(c, script, opts = {}) {
  const sys = c.sys;
  const win = sys.isWin;
  const judged = judgedCommands(script, sys.platform, opts.shell || null);
  const rules = c.rules.rules;
  const segments = judged.commands.map((tokens) => {
    const e = effective(rules, tokens);
    return { tokens, matched: e.matched.map(brief), counted: e.counted.map(brief), ignored: e.ignored.map(brief), decision: e.decision };
  });
  let decision = null;
  for (const s of segments) if (s.decision && (decision === null || STRICTNESS[s.decision] > STRICTNESS[decision])) decision = s.decision;
  const allAllowed = segments.length > 0 && segments.every((s) => s.decision === "allow");
  const approval = c.effective.approval;
  const sandbox = c.effective.sandbox;
  const ws = c.windows;
  const noSandbox = ws.applicable && ws.selection === "none" && sandbox !== "danger-full-access";
  const lines = [];
  const say = (source, text) => lines.push({ source, text });
  const first = (d) => segments.find((s) => s.decision === d && s.counted.length);
  const ruleWords = (m) => `${patternOf(m)} (${shortFile(sys, m.file)}:${m.line})`;
  let outcome;
  let headline;
  if (judged.split) say(judged.shell === "powershell" ? V : D, `The script is a plain list of ${segments.length} commands (${segments.map((s) => s.tokens[0]).join(", ")}), so Codex judges each one on its own and the strictest answer counts.`);
  else if (!judged.plain) say(judged.shell === "powershell" ? V : D, `The script has ${judged.reason}, so Codex does not split it: the whole script is judged as one command.`);

  for (const s of segments) {
    for (const m of s.ignored) say(V, `The allow rule ${ruleWords(m)} is not honoured: Codex ignores an allow rule for ${m.matchedPrefix.join(" ")}, so this part is handled as if no rule matched.`);
  }

  if (decision === "forbidden") {
    const s = first("forbidden");
    const m = s.counted.find((x) => x.decision === "forbidden");
    outcome = "forbidden";
    headline = `Codex refuses to run it: a forbidden rule matches \`${s.tokens.slice(0, m.matchedPrefix.length).join(" ")}\`.`;
    say(V, `The rule ${ruleWords(m)} is forbidden${m.justification ? ` (${JSON.stringify(m.justification)})` : ""}: the model gets "rejected: ${m.justification || "blocked by policy"}" and the command does not start. The approval policy and the sandbox do not change that.`);
  } else if (decision === "prompt") {
    const s = first("prompt");
    const m = s.counted.find((x) => x.decision === "prompt");
    if (approval === "never") {
      outcome = "refused";
      headline = `Codex refuses to run it: a prompt rule matches and approval_policy is "never", so there is nobody to ask.`;
      say(V, `The rule ${ruleWords(m)} asks. With approval_policy "never" the model gets "approval required by policy, but AskForApproval is set to Never".`);
    } else {
      outcome = "asks";
      headline = `Codex asks you first: a prompt rule matches \`${s.tokens.slice(0, m.matchedPrefix.length).join(" ")}\`.`;
      say(V, `The rule ${ruleWords(m)} asks every time${m.justification ? `; the question says "requires approval: ${m.justification}"` : ""}, in the full-access sandbox as well.`);
    }
  } else if (allAllowed) {
    if (sandbox === "danger-full-access") {
      outcome = "unsandboxed";
      headline = "Codex runs it without a sandbox and without asking.";
      say(V, `sandbox_mode is "danger-full-access", so nothing is sandboxed; the allow rule${segments.length > 1 ? "s" : ""} change${segments.length > 1 ? "" : "s"} nothing.`);
    } else {
      outcome = "outside-sandbox";
      headline = "Codex runs it outside the sandbox, without asking: every part is allowed by a rule.";
      say(V, `${segments.length > 1 ? "Every part has" : "It has"} an allow rule (${segments.map((s) => ruleWords(s.counted.find((x) => x.decision === "allow"))).join("; ")}), so Codex skips the question and the sandbox (a command in which one part has no rule stays in the sandbox).`);
    }
  } else if (sandbox === "danger-full-access") {
    outcome = "unsandboxed";
    headline = "Codex runs it without a sandbox and without asking: sandbox_mode is \"danger-full-access\".";
    say(V, "No rule decides it, and nothing is sandboxed.");
  } else if (noSandbox) {
    if (approval === "never") {
      outcome = "refused";
      headline = "Codex refuses to run it: no Windows sandbox is selected, so nothing can run inside one, and approval_policy is \"never\".";
      say(V, "The model gets \"rejected: ... blocked by policy\". Select a sandbox with `[windows] sandbox = \"unelevated\"` (see `lint`, windows-sandbox).");
    } else {
      outcome = "asks";
      headline = "Codex asks you first: no Windows sandbox is selected, so there is nothing to run it in.";
      say(V, "Every command that no allow rule covers asks, even `echo hi`. Select a sandbox with `[windows] sandbox = \"unelevated\"` (see `lint`, windows-sandbox).");
    }
  } else {
    outcome = "sandboxed";
    headline = `Codex runs it inside the ${sandbox} sandbox, without asking.`;
    say(win ? V : D, sandbox === "read-only" ? "The sandbox lets it read files and nothing else: a write fails inside the sandbox." : "The sandbox lets it read files, and write under the project folder, the folders in writable_roots and the temporary folders (TMPDIR and /tmp, unless sandbox_workspace_write.exclude_tmpdir_env_var and exclude_slash_tmp are true); a write elsewhere fails inside the sandbox.");
    say(approval === "never" ? V : D, approval === "never" ? "A request for more (sandbox_permissions \"require_escalated\") is refused: \"approval policy is Never; reject command\"." : "If it needs more, the model can ask to run it outside the sandbox, and then you are asked.");
  }
  if (!segments.some((s) => s.matched.length) && decision === null) say(V, "No rule matches any part of it.");
  const out = {
    command: script,
    platform: sys.platform,
    shell: judged.shell,
    split: judged.split,
    plain: judged.plain,
    reason: judged.reason || null,
    parts: segments,
    decision,
    outcome,
    headline,
    lines,
    settings: { approval, sandbox, sandboxAsked: c.effective.sandboxAsked, windowsSandbox: ws.applicable ? ws.selection : null },
    refused: outcome === "forbidden" || outcome === "refused",
  };
  return out;
}

const brief = (m) => ({ matchedPrefix: m.matchedPrefix, decision: m.decision, justification: m.justification, file: m.file, line: m.line });
const patternOf = (m) => `[${m.matchedPrefix.map((t) => JSON.stringify(t)).join(", ")}]`;
const shortFile = (sys, f) => (f ? sys.path.basename(f) : "");
