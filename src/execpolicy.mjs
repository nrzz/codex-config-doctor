// The rules engine: which rules match a command's tokens, and what the strictest decision is. This is what `codex execpolicy check
// --rules <file> -- <tokens>` answers; test/e2e-rules.test.mjs puts several hundred commands to the real binary and compares. A rule
// is { pattern: [[token, ...], ...], decision, justification, file, line }: each position of the pattern is a list of the tokens that
// are accepted there, and a rule matches a command when the pattern is a prefix of its tokens.

import { BANNED_PREFIXES } from "./knowledge.mjs";

export const STRICTNESS = { allow: 0, prompt: 1, forbidden: 2 };

/** The first tokens of the command that the rule's pattern matches, or null. */
export function matchRule(rule, tokens) {
  if (tokens.length < rule.pattern.length) return null;
  for (let i = 0; i < rule.pattern.length; i++) if (!rule.pattern[i].includes(tokens[i])) return null;
  return tokens.slice(0, rule.pattern.length);
}

/**
 * All the rules that match, in the order they were defined, and the strictest decision among them (null when none matched).
 *   -> { matched: [{ matchedPrefix, decision, justification, file, line, rule }], decision }
 */
export function evaluate(rules, tokens) {
  const matched = [];
  for (const rule of rules) {
    const prefix = matchRule(rule, tokens);
    if (prefix) matched.push({ matchedPrefix: prefix, decision: rule.decision, justification: rule.justification, file: rule.file, line: rule.line, rule });
  }
  let decision = null;
  for (const m of matched) if (decision === null || STRICTNESS[m.decision] > STRICTNESS[decision]) decision = m.decision;
  return { matched, decision };
}

/** The result in the shape `codex execpolicy check` prints it. */
export function asCheckJson(result) {
  const out = {
    matchedRules: result.matched.map((m) => ({ prefixRuleMatch: { matchedPrefix: m.matchedPrefix, decision: m.decision, ...(m.justification ? { justification: m.justification } : {}) } })),
  };
  if (result.decision) out.decision = result.decision;
  return out;
}

/**
 * The examples of match and not_match, checked the way Codex checks them when it loads the rules (put to Codex 0.163.0, test/e2e-rules.test.mjs):
 * a `match` example must match the rule it is written in (another rule of the file does not count), and so a `not_match` example must not.
 * Returns [{ kind: "match" | "not_match", example, rule }].
 */
export function checkExamples(rules) {
  const problems = [];
  for (const rule of rules) {
    for (const ex of rule.matchExamples || []) {
      if (!matchRule(rule, ex.tokens)) problems.push({ kind: "match", example: ex.text, tokens: ex.tokens, rule });
    }
    for (const ex of rule.notMatchExamples || []) {
      if (matchRule(rule, ex.tokens)) problems.push({ kind: "not_match", example: ex.text, tokens: ex.tokens, rule });
    }
  }
  return problems;
}

const BANNED = new Set(BANNED_PREFIXES.map((p) => JSON.stringify(p)));

/** Whether a prefix of command tokens is one Codex will not honour an allow rule for (the table of src/knowledge.mjs). */
export function isBannedPrefix(tokens) {
  return BANNED.has(JSON.stringify(tokens));
}

/**
 * Whether Codex ignores an allow rule that matched a command: the prefix it matched is one of the banned prefixes (put to Codex 0.163.0,
 * prefix by prefix: with prefix_rule(pattern=["git"], decision="allow") the command asked or ran inside the sandbox as if there were no
 * rule; ["git", "status"] is honoured, and so is a prompt or forbidden rule on the banned prefix).
 */
export function isUnhonoured(rule, matchedPrefix) {
  return rule.decision === "allow" && isBannedPrefix(matchedPrefix);
}

/** The concrete patterns of a rule: every way to pick one token at each position (at most 256). */
export function expandPattern(rule) {
  let out = [[]];
  for (const alts of rule.pattern) {
    const next = [];
    for (const p of out) for (const a of alts) { if (next.length < 256) next.push([...p, a]); }
    out = next;
  }
  return out;
}

/** The decision Codex acts on for one command: the rules that count (allow rules for a banned prefix are dropped) and their strictest decision. */
export function effective(rules, tokens) {
  const all = evaluate(rules, tokens);
  const counted = all.matched.filter((m) => !isUnhonoured(m.rule, m.matchedPrefix));
  let decision = null;
  for (const m of counted) if (decision === null || STRICTNESS[m.decision] > STRICTNESS[decision]) decision = m.decision;
  return { matched: all.matched, counted, ignored: all.matched.filter((m) => isUnhonoured(m.rule, m.matchedPrefix)), decision };
}

/** Allow rules that a stricter rule always overrides: every command the allow rule matches is also matched by a prompt or forbidden rule. */
export function shadowedRules(rules) {
  const out = [];
  for (const rule of rules) {
    if (rule.decision !== "allow") continue;
    for (const other of rules) {
      if (other === rule || STRICTNESS[other.decision] <= STRICTNESS[rule.decision]) continue;
      // the other pattern is a prefix of this one at every position: any command matching `rule` matches `other`
      if (other.pattern.length > rule.pattern.length) continue;
      const covers = other.pattern.every((alts, i) => rule.pattern[i].every((t) => alts.includes(t)));
      if (covers) { out.push({ rule, by: other }); break; }
    }
  }
  return out;
}
