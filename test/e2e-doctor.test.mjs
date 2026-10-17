// What the built-in `codex doctor` says about the worlds this tool has findings for, so that the README can say what it covers and what it
// does not. `codex doctor --json` is run in each world (every proxy variable names a closed port, so its network checks fail at once and
// nothing is sent); the status of its `config.load` and `mcp.config` checks is compared with the findings of `lint` for the same folder.
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { lintWorld } from "./behave.mjs";
import { fakeApi, gitInit, put, runCodex, sandbox, skip, writeUserConfig } from "./codex-sandbox.mjs";

const opts = { skip: skip() };

/** Builds the world, runs `codex doctor --json` in it, and lints it: { config, mcp, ids }. */
async function world({ top = "", tables = "", files = {} }) {
  const sb = sandbox("e2e-doctor");
  gitInit(sb);
  const api = await fakeApi([]);
  try {
    writeUserConfig(sb, api, { top, tables });
    for (const [rel, text] of Object.entries(files)) put(path.join(sb.root, ...rel.split("/")), text);
    const r = await runCodex(sb, ["doctor", "--json"], { timeout: 120000, online: true });
    const doc = JSON.parse(r.out);
    return { config: doc.checks["config.load"], mcp: doc.checks["mcp.config"], ids: lintWorld(sb).ids, overall: doc.overallStatus };
  } finally { await api.close(); }
}

const ROWS = [
  { name: "a clean configuration", world: {}, config: "ok", mcp: "ok", lints: [] },
  { name: "a key it does not know", world: { top: 'aproval_policy = "never"\n' }, config: "warning", mcp: "ok", lints: ["unknown-key"] },
  { name: "a TOML syntax error", world: { top: "foo bar = 1\n" }, config: "fail", mcp: undefined, lints: ["toml-error"] },
  { name: "the legacy profile selector", world: { top: 'profile = "x"\n' }, config: "fail", mcp: undefined, lints: ["profile-legacy"] },
  { name: "a rules file that does not load", world: { files: { "codex-home/rules/default.rules": 'prefix_rule(pattern=["ls"], decision="allow"\n' } }, config: "ok", mcp: "ok", lints: ["rules-syntax"] },
  { name: "a project's .codex folder that is ignored because the project is not trusted", world: { files: { "work/.codex/config.toml": 'model = "x"\nnotify = ["a"]\n' } }, config: "ok", mcp: "ok", lints: ["untrusted-project"] },
  { name: "an MCP server whose program is not found", world: { tables: '[mcp_servers.x]\ncommand = "nosuchprogxyz"\n' }, config: "ok", mcp: "warning", lints: ["mcp-command-missing"] },
  { name: "a hook that has no trust record", world: { tables: '[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "echo x"\n' }, config: "ok", mcp: "ok", lints: ["hook-untrusted"] },
  { name: "an AGENTS.md that is cut by project_doc_max_bytes", world: { top: "project_doc_max_bytes = 10\n", files: { "work/AGENTS.md": "x".repeat(100) } }, config: "ok", mcp: "ok", lints: ["agents-md-over-cap"] },
];

for (const row of ROWS) {
  test(`codex doctor and lint: ${row.name}`, opts, async () => {
    const w = await world(row.world);
    assert.equal(w.config.status, row.config, `config.load: ${w.config.status} (${w.config.summary})`);
    if (row.mcp) assert.equal(w.mcp.status, row.mcp, `mcp.config: ${w.mcp.status} (${w.mcp.summary})`);
    for (const id of row.lints) assert.ok(w.ids.includes(id), `lint finds ${id}: ${w.ids}`);
    if (row.name === "an MCP server whose program is not found") assert.match(JSON.stringify(w.mcp.details), /stdio command \\"nosuchprogxyz\\" is not resolvable \(not found on PATH\)/);
    if (row.name === "a TOML syntax error") assert.match(w.config.summary, /config could not be loaded/);
  });
}
