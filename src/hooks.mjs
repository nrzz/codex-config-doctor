// The hooks Codex would find, and whether it would run them. Codex 0.163.0 (test/e2e-hooks.test.mjs):
//   - hooks come from `[hooks]` in a layer's config.toml and from a `hooks.json` in the same folder (the Codex home, or a project's
//     .codex folder); both are read, and Codex warns when a layer has both; project hooks load only for a trusted project;
//   - a hook runs only if it is trusted. The trust is a record in the user's config.toml, `[hooks.state."<key>"] trusted_hash = "sha256:..."`,
//     where <key> is `<path of the file>:<event>:<group>:<handler>` and the hash is the SHA-256 of the hook's definition as canonical JSON
//     (see hookHash). A hook with no record, or with a hash that no longer matches, is skipped; in `codex exec` it is skipped in silence;
//   - a hook whose program is not found fails ("hook: PreToolUse Failed") and the tool call goes on.
import crypto from "node:crypto";
import { HOOK_DEFAULT_TIMEOUT, HOOK_EVENTS, HOOK_EVENT_SNAKE, HOOK_SHORT_TIMEOUT_EVENTS } from "./knowledge.mjs";
import { which } from "./pathsearch.mjs";

const isTable = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Compact JSON with the keys of every object in order. */
export function canonicalJson(value) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : isTable(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(value));
}

/**
 * The hash Codex records when a hook is trusted. `handler` is the normalised handler:
 *   { type: "command", command, timeout, async, statusMessage?, additionalContextLimit? } or { type: "mcp_tool", server, tool, input, timeout }
 */
export function hookHash(event, matcher, handler) {
  const outer = { event_name: HOOK_EVENT_SNAKE[event], hooks: [handler] };
  if (typeof matcher === "string") outer.matcher = matcher;
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(outer)).digest("hex")}`;
}

const pick = (obj, ...names) => { for (const n of names) if (obj[n] !== undefined) return obj[n]; return undefined; };

/**
 * The fields Codex 0.163.0 reads in a handler (its HookHandlerConfig: the names of the fields in the binary, each put to the app server).
 * Any other field is dropped in silence: `timeout_sec` and `timeoutSec` leave the timeout at its default, `status_message` and
 * `additional_context_limit` do nothing. `command_windows` and `commandWindows` are both read.
 */
export const HANDLER_FIELDS = {
  command: ["type", "command", "commandWindows", "command_windows", "timeout", "async", "statusMessage", "additionalContextLimit"],
  mcp_tool: ["type", "server", "tool", "input", "timeout", "statusMessage"],
};
/** The spelling Codex reads for a field it does not read, when there is an obvious one. */
export const FIELD_HINTS = { timeout_sec: "timeout", timeoutSec: "timeout", timeout_seconds: "timeout", status_message: "statusMessage", additional_context_limit: "additionalContextLimit", statusmessage: "statusMessage", Timeout: "timeout", Command: "command", Async: "async" };

/** The fields of a handler that Codex does not read. */
export function unknownFields(handler) {
  const known = HANDLER_FIELDS[handler && handler.type];
  if (!known || !isTable(handler)) return [];
  return Object.keys(handler).filter((k) => !known.includes(k));
}

/** One handler of a hook group, normalised, or a problem. */
function normalise(sys, event, handler) {
  if (!isTable(handler)) return { problem: "a handler must be a table" };
  const type = handler.type;
  if (type !== "command" && type !== "mcp_tool" && type !== "prompt" && type !== "agent") return { problem: `a handler needs a type: command, mcp_tool, prompt or agent (found ${type === undefined ? "none" : JSON.stringify(type)})` };
  if (handler.timeout !== undefined && !(Number.isInteger(handler.timeout) && handler.timeout >= 0)) return { problem: "`timeout` is a whole number of seconds" };
  const timeout = typeof handler.timeout === "number" ? handler.timeout : HOOK_SHORT_TIMEOUT_EVENTS.has(event) ? 1 : HOOK_DEFAULT_TIMEOUT;
  if (type === "command") {
    const windows = pick(handler, "commandWindows", "command_windows");
    const command = sys.isWin && typeof windows === "string" ? windows : handler.command;
    if (typeof command !== "string" || command === "") return { problem: "a command handler needs a `command`" };
    const norm = { async: handler.async === true, command, timeout, type: "command" };
    if (typeof handler.statusMessage === "string") norm.statusMessage = handler.statusMessage;
    if (typeof handler.additionalContextLimit === "number") norm.additionalContextLimit = handler.additionalContextLimit;
    return { type, normalised: norm, command, timeout, async: norm.async };
  }
  if (type === "mcp_tool") {
    if (typeof handler.server !== "string" || typeof handler.tool !== "string") return { problem: "an mcp_tool handler needs a `server` and a `tool`" };
    // the hash of an mcp_tool handler with an input table was not reproduced (Codex's list does not show the input): it is left out
    const hasInput = isTable(handler.input) && Object.keys(handler.input).length > 0;
    return { type, normalised: { input: isTable(handler.input) ? handler.input : {}, server: handler.server, timeout, tool: handler.tool, type: "mcp_tool" }, hashUnknown: hasInput, server: handler.server, tool: handler.tool, timeout };
  }
  return { type, skipped: true, timeout };
}

/** The hooks of one source (a `hooks` object: event -> groups). */
function fromObject(sys, source, hooksObj, out) {
  if (!isTable(hooksObj)) return;
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (event === "state") continue;
    if (!HOOK_EVENTS.includes(event)) { out.unknownEvents.push({ event, source: source.path }); continue; }
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      if (!isTable(group)) return;
      const matcher = typeof group.matcher === "string" ? group.matcher : null;
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];
      handlers.forEach((h, hi) => {
        const n = normalise(sys, event, h);
        const key = `${source.keyPath}:${HOOK_EVENT_SNAKE[event]}:${gi}:${hi}`;
        const hook = { event, matcher, group: gi, index: hi, key, source: source.path, layerKind: source.layerKind, format: source.format, skippedLayer: source.skipped, unknownFields: unknownFields(h), ...n };
        if (n.normalised && !n.hashUnknown) hook.hash = hookHash(event, matcher, n.normalised);
        out.hooks.push(hook);
      });
    });
  }
}

/**
 * Finds every hook of the layers and judges it against the trust records of `merged`.
 *   world: the result of discover(); merged: the merged configuration value
 */
export function discoverHooks(sys, world, merged) {
  const out = { hooks: [], bothFormats: [], jsonErrors: [], unknownEvents: [], featureOff: false };
  out.featureOff = Boolean(merged.features && merged.features.hooks === false);
  const state = isTable(merged.hooks) && isTable(merged.hooks.state) ? merged.hooks.state : {};
  const folders = [];
  for (const layer of [...world.layers].reverse()) {
    if (layer.kind === "profile") continue;
    const folder = layer.kind === "project" ? layer.dotCodex : layer.scope;
    folders.push({ layer, folder });
  }
  for (const { layer, folder } of folders) {
    const skipped = layer.kind === "project" && !layer.trusted;
    const tomlSource = { path: layer.path, keyPath: realKey(sys, layer.path), layerKind: layer.kind, format: "toml", skipped };
    const before = out.hooks.length;
    if (layer.value && isTable(layer.value.hooks)) fromObject(sys, tomlSource, layer.value.hooks, out);
    const tomlCount = out.hooks.length - before;
    const jsonPath = sys.path.join(folder, "hooks.json");
    if (sys.isFile(jsonPath)) {
      const text = sys.readText(jsonPath);
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { out.jsonErrors.push({ path: jsonPath, message: String(e.message || e), bom: typeof text === "string" && text.charCodeAt(0) === 0xfeff, layerKind: layer.kind, skipped }); }
      if (parsed) {
        const mid = out.hooks.length;
        fromObject(sys, { path: jsonPath, keyPath: realKey(sys, jsonPath), layerKind: layer.kind, format: "json", skipped }, isTable(parsed) && isTable(parsed.hooks) ? parsed.hooks : {}, out);
        if (tomlCount > 0 && out.hooks.length > mid) out.bothFormats.push({ layerKind: layer.kind, json: jsonPath, toml: layer.path, skipped });
      }
    }
  }
  for (const hook of out.hooks) {
    const rec = isTable(state[hook.key]) ? state[hook.key] : null;
    hook.record = rec ? { trustedHash: typeof rec.trusted_hash === "string" ? rec.trusted_hash : null, enabled: rec.enabled !== false } : null;
    if (hook.skippedLayer) hook.status = "skipped";
    else if (hook.skipped) hook.status = "unsupported-handler";
    else if (hook.problem) hook.status = "invalid";
    else if (hook.record && hook.record.enabled === false) hook.status = "disabled";
    else if (!hook.record || !hook.record.trustedHash) hook.status = "untrusted";
    else if (hook.hashUnknown) hook.status = "recorded";
    else hook.status = hook.record.trustedHash === hook.hash ? "trusted" : "modified";
    hook.runs = hook.status === "trusted" && !out.featureOff;
  }
  return out;
}

/** The key Codex builds from a path: the folder as the system resolves it, then the file name. */
function realKey(sys, file) {
  const dir = sys.realpath(sys.path.dirname(file));
  return sys.path.join(dir, sys.path.basename(file));
}

/** The words of a hook command: double and single quotes group, nothing is unescaped (a Windows path keeps its backslashes). */
export function commandWords(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

const SHELL_WORDS = new Set(["echo", "cd", "exit", "test", "[", "true", "false", "set", "export", "printf", "read", "source", ".", "exec", "eval", "type", "command", "ulimit", "umask", "cat", "ls", "dir", "cp", "mv", "rm", "mkdir", "type", "sleep", "sort", "where", "select", "write", "foreach", "%", "?", "copy", "del", "move", "md", "rd", "cls", "ver", "start", "call", "rem", "pwd", "popd", "pushd", "ni", "sc", "gc", "gci", "sls", "iex", "sleep", "kill", "ps", "man", "clear", "curl", "wget", "tee", "touch"]);

/** Whether the first word of a hook command is a program we should be able to find (not a shell builtin, alias or cmdlet). */
export function programOf(sys, command) {
  const words = commandWords(command.trim());
  if (!words.length) return null;
  let first = words[0];
  if (first === "&" && words[1]) first = words[1];
  if (sys.isWin && /^[A-Za-z]+-[A-Za-z]+$/.test(first)) return { name: first, builtin: true };
  if (/[$(){}|;&<>`]/.test(first)) return { name: first, builtin: true };
  if (SHELL_WORDS.has(first.toLowerCase()) && !/[\\/]/.test(first)) return { name: first, builtin: true };
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) return { name: first, builtin: true };
  return { name: first, builtin: false };
}

/** Whether a hook command's program exists: { found, path }. Shell builtins count as found. */
export function programFound(sys, command, cwd) {
  const p = programOf(sys, command);
  if (!p) return { found: true, path: null, name: null };
  if (p.builtin) return { found: true, path: null, name: p.name, builtin: true };
  const hit = which(sys, p.name, { cwd });
  return { found: hit.found, path: hit.path, name: p.name };
}

/** The text of the script a hook command runs, when it is a file we can read (`node "hook.mjs" ...`): { path, text } or null. */
export function hookScript(sys, command, cwd) {
  for (const w of commandWords(command).slice(1, 6)) {
    if (!/\.(mjs|cjs|js|ts|py|sh|ps1|rb|pl|bat|cmd)$/i.test(w)) continue;
    const file = sys.path.isAbsolute(w) ? w : sys.path.join(cwd || sys.cwd, w);
    const st = sys.stat(file);
    if (st && st.isFile && st.size <= 262144) return { path: file, text: sys.readText(file) || "" };
  }
  return null;
}

/** Whether a hook script says it answers `ask` for a tool call (documented as parsed but not supported). */
export function scriptAsks(text) {
  return /permissionDecision["'`]?\s*[:=]\s*["'`]ask["'`]/.test(text) || /["'`]ask["'`]\s*[,)}\]]?\s*[\s\S]{0,40}permissionDecision/.test(text);
}
