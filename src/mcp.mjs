// The MCP servers of the merged configuration: how each is reached, whether it is on, and whether its program can be found.
// Put to Codex 0.163.0 (test/e2e-mcp.test.mjs): a server with a `command` is a stdio server and one with a `url` is an HTTP server; both
// at once, or neither, is a configuration error that stops Codex; a stdio server whose program is not found is skipped without a word
// unless `required = true`, which stops Codex with "program not found".
import { which } from "./pathsearch.mjs";

const isTable = (v) => v && typeof v === "object" && !Array.isArray(v);

export function servers(sys, merged, { cwd } = {}) {
  const table = isTable(merged.mcp_servers) ? merged.mcp_servers : {};
  const out = [];
  for (const [id, cfg] of Object.entries(table)) {
    if (!isTable(cfg)) continue;
    const hasCommand = typeof cfg.command === "string";
    const hasUrl = typeof cfg.url === "string";
    const problems = [];
    let transport = "invalid";
    if (hasCommand && hasUrl) problems.push({ kind: "both", message: "url is not supported for stdio: a server has a `command` or a `url`, not both" });
    else if (hasCommand) transport = "stdio";
    else if (hasUrl) transport = "http";
    else problems.push({ kind: "neither", message: "invalid transport: the server has neither a `command` nor a `url`" });
    if (transport === "stdio") {
      for (const k of ["bearer_token_env_var", "http_headers", "env_http_headers"]) if (cfg[k] !== undefined) problems.push({ kind: "stdio-option", key: k, message: `${k} is not supported for stdio` });
    }
    const enabled = cfg.enabled !== false;
    const required = cfg.required === true;
    const startup = typeof cfg.startup_timeout_sec === "number" ? cfg.startup_timeout_sec : typeof cfg.startup_timeout_ms === "number" ? cfg.startup_timeout_ms / 1000 : 10;
    const server = {
      id,
      transport,
      command: hasCommand ? cfg.command : null,
      args: Array.isArray(cfg.args) ? cfg.args : [],
      url: hasUrl ? cfg.url : null,
      enabled,
      required,
      startupTimeoutSec: startup,
      toolTimeoutSec: typeof cfg.tool_timeout_sec === "number" ? cfg.tool_timeout_sec : 60,
      enabledTools: Array.isArray(cfg.enabled_tools) ? cfg.enabled_tools : null,
      disabledTools: Array.isArray(cfg.disabled_tools) ? cfg.disabled_tools : null,
      resolved: null,
      problems,
      argsInCommand: false,
    };
    if (transport === "stdio") {
      server.resolved = which(sys, cfg.command, { cwd: typeof cfg.cwd === "string" ? sys.resolve(cfg.cwd) : cwd });
      // `command = "node -e 0"`: a command line in the command. Codex looks for a program of that whole name ("program not found")
      const first = cfg.command.trim().split(/\s+/)[0];
      server.argsInCommand = !server.resolved.found && /\s/.test(cfg.command.trim()) && which(sys, first, { cwd }).found;
    }
    out.push(server);
  }
  return out;
}
