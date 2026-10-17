// The hook worlds the discovery is held to. A scenario: hooks in the user's config.toml (`user`), in the user's hooks.json (`userJson`), in the project's
// config.toml (`project`) and hooks.json (`projectJson`), whether the project is trusted, and which trust records the user's config.toml holds
// (`state`: none, all, wrong, disabled, mixed). test/record-oracles.mjs builds each on disk and asks Codex's app server (`hooks/list`) for the key,
// the hash and the trust status of every hook; the record is test/fixtures/hooks-oracle.json. test/hooks.test.mjs holds src/hooks.mjs to it;
// test/e2e-hooks.test.mjs asks Codex again, and runs the hooks that are trusted, and not those that are not.
const cmd = (name, extra = "") => `[[hooks.${name}]]\n[[hooks.${name}.hooks]]\ntype = "command"\ncommand = "echo ${name}"\n${extra}`;
const group = (name, matcher, handlers) => `[[hooks.${name}]]\n${matcher ? `matcher = ${JSON.stringify(matcher)}\n` : ""}${handlers.map((h) => `[[hooks.${name}.hooks]]\n${h}`).join("")}`;

export const EVENTS = ["PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SessionStart", "SessionEnd", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop", "Interrupt"];

const json = (obj) => obj;
const jsonHooks = (event, matcher, handlers) => json({ hooks: { [event]: [{ ...(matcher ? { matcher } : {}), hooks: handlers }] } });

export const SCENARIOS = [
  { name: "one command hook, no record", user: cmd("SessionStart"), state: "none" },
  { name: "one command hook, trusted", user: cmd("SessionStart"), state: "all" },
  { name: "one command hook, record with a wrong hash", user: cmd("SessionStart"), state: "wrong" },
  { name: "one command hook, record that disables it", user: cmd("SessionStart"), state: "disabled" },
  ...EVENTS.map((e) => ({ name: `the ${e} event`, user: cmd(e), state: "none" })),
  { name: "a matcher", user: group("PreToolUse", "^Bash$", ['type = "command"\ncommand = "echo m"\n']), state: "none" },
  { name: "a star matcher", user: group("PostToolUse", "*", ['type = "command"\ncommand = "echo m"\n']), state: "none" },
  { name: "a timeout", user: group("PreToolUse", "*", ['type = "command"\ncommand = "echo t"\ntimeout = 30\n']), state: "none" },
  { name: "a timeout that is a float", user: group("PreToolUse", "*", ['type = "command"\ncommand = "echo t"\ntimeout = 2.5\n']), state: "none" },
  { name: "async", user: group("PostToolUse", "*", ['type = "command"\ncommand = "echo a"\nasync = true\ntimeout = 5\n']), state: "none" },
  { name: "a status message", user: group("PostToolUse", "Bash", ['type = "command"\ncommand = "echo s"\nstatusMessage = "Working"\n']), state: "none" },
  { name: "additionalContextLimit", user: group("UserPromptSubmit", null, ['type = "command"\ncommand = "echo c"\nadditionalContextLimit = 100\n']), state: "none" },
  { name: "additionalContextLimit 0", user: group("UserPromptSubmit", null, ['type = "command"\ncommand = "echo c"\nadditionalContextLimit = 0\n']), state: "none" },
  { name: "two handlers in one group", user: group("PostToolUse", "Bash", ['type = "command"\ncommand = "echo one"\n', 'type = "command"\ncommand = "echo two"\nasync = true\ntimeout = 5\n']), state: "all" },
  { name: "two groups of one event", user: `${group("SessionEnd", null, ['type = "command"\ncommand = "echo f"\n'])}${group("SessionEnd", null, ['type = "command"\ncommand = "echo g"\n'])}`, state: "mixed" },
  { name: "a command with quotes and a backslash", user: group("PreToolUse", "*", ['type = "command"\ncommand = "echo \\"a b\\" \\\\ c"\n']), state: "none" },
  { name: "a command with unicode", user: group("PreToolUse", "*", ['type = "command"\ncommand = "echo café 日本"\n']), state: "none" },
  { name: "an mcp_tool handler", user: group("PermissionRequest", "^Bash$", ['type = "mcp_tool"\nserver = "srv"\ntool = "tl"\n']), state: "none" },
  { name: "an mcp_tool handler with input", user: group("PermissionRequest", "^Bash$", ['type = "mcp_tool"\nserver = "srv"\ntool = "tl"\ninput = { a = 1, b = "two", c = [3, 4] }\n']), state: "none" },
  { name: "hooks.json with one hook", userJson: jsonHooks("SessionStart", null, [{ type: "command", command: "echo json" }]), state: "none" },
  { name: "hooks.json with a matcher, a timeout and a status message", userJson: jsonHooks("PreToolUse", "^Bash$", [{ type: "command", command: "echo json", timeout: 12, statusMessage: "Checking" }]), state: "all" },
  { name: "hooks.json and config.toml together", user: cmd("SessionStart"), userJson: jsonHooks("Stop", null, [{ type: "command", command: "echo json" }]), state: "none" },
  { name: "a project config.toml hook, project trusted", project: cmd("SessionStart"), trustProject: true, state: "none" },
  { name: "a project config.toml hook, trusted by record", project: cmd("SessionStart"), trustProject: true, state: "all" },
  { name: "a project hooks.json hook, project trusted", projectJson: jsonHooks("SessionStart", null, [{ type: "command", command: "echo pj" }]), trustProject: true, state: "none" },
  { name: "a project hook, project not trusted", project: cmd("SessionStart"), trustProject: false, state: "none" },
  { name: "user and project hooks of one event", user: cmd("SessionStart"), project: cmd("SessionStart"), trustProject: true, state: "mixed" },
  { name: "a prompt handler is read and not run", user: group("Stop", null, ['type = "prompt"\n']), state: "none" },
  { name: "an unknown event under hooks.json", userJson: { hooks: { SessionBegin: [{ hooks: [{ type: "command", command: "echo x" }] }] } }, state: "none" },
  { name: "a handler with a Windows command", user: group("PreToolUse", "*", ['type = "command"\ncommand = "echo posix"\ncommandWindows = "echo windows"\n']), state: "none", windowsOnly: true },
];

/** The contents of the trust records for a state, given the hooks Codex listed first: [{ key, trusted_hash, enabled? }]. */
export function records(state, listed) {
  const out = [];
  listed.forEach((h, i) => {
    if (state === "all") out.push({ key: h.key, trusted_hash: h.currentHash });
    else if (state === "wrong") out.push({ key: h.key, trusted_hash: `sha256:${"0".repeat(64)}` });
    else if (state === "disabled") out.push({ key: h.key, trusted_hash: h.currentHash, enabled: false });
    else if (state === "mixed" && i % 2 === 0) out.push({ key: h.key, trusted_hash: h.currentHash });
  });
  return out;
}
