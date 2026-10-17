// MCP servers, put to the real Codex with a stand-in server (test/mcp-stub.mjs): what an enabled server adds to the first request, what Codex
// does with a server whose program is not there, and the configuration errors. The first request is the one `cost` accounts for.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { collect } from "../src/collect.mjs";
import { cost, toolList } from "../src/cost.mjs";
import { MCP_TOOLS } from "../src/recorded.mjs";
import { exec, lintWorld, noise, sysFor } from "./behave.mjs";
import { IS_WIN, skip, toolNames } from "./codex-sandbox.mjs";
import { mcpServer, partsOf } from "./measure.mjs";

const opts = { skip: skip() };
const added = MCP_TOOLS.reduce((n, t) => n + t[1], 0);
const toolsOf = (r) => partsOf(r.requests[0]).tools;
const baseline = async () => toolsOf(await exec({ label: "e2e-mcp-base" }));
const size = (tools) => tools.reduce((n, t) => n + t[1], 0);

test("an enabled MCP server adds three resource tools and its name to tool_search; its own tools are not in the first request, however many it has", opts, async () => {
  const base = await baseline();
  const sizes = [];
  for (const n of [1, 2, 30, 60]) {
    const r = await exec({ label: "e2e-mcp-tools", userTables: mcpServer("stub", Array.from({ length: n }, (_, i) => `tool_${i}`)) });
    assert.equal(r.code, 0, r.err);
    const tools = toolsOf(r);
    sizes.push(size(tools));
    assert.deepEqual(tools.map((t) => t[0]).slice(0, 5), ["exec_command", "write_stdin", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);
    assert.ok(!toolNames(r.requests[0]).some((name) => /tool_\d|stub/.test(name)), `${n} tools: none of the server's tools is listed`);
    assert.equal(size(tools) - size(base), added + "stub".length + 4, `${n} tools: three resource tools and \"- stub\" in the description of tool_search`);
    const c = collect(sysFor(r.sb), { project: r.sb.work });
    assert.deepEqual(tools, toolList(c), `${n} tools: what cost lists`);
    assert.equal(cost(c).rows.find((x) => x.id === "tools").chars, partsOf(r.requests[0]).toolsJsonChars);
  }
  assert.equal(new Set(sizes).size, 1, `the request is the same size for 1, 2, 30 and 60 tools: ${sizes}`);
});

test("the name of each server that starts is added to tool_search; a server that is turned off adds nothing; one that cannot start adds the three tools and not its name", opts, async () => {
  const base = await baseline();
  const two = await exec({ label: "e2e-mcp-two", userTables: mcpServer("one", ["a"]) + mcpServer("longer-name", ["b"]) });
  assert.equal(size(toolsOf(two)) - size(base), added + ("one".length + 4) + ("longer-name".length + 4));
  const off = await exec({ label: "e2e-mcp-off", userTables: mcpServer("off", ["a"], "enabled = false\n") });
  assert.equal(size(toolsOf(off)), size(base));
  for (const [what, tables] of [
    ["a program that is not found", '[mcp_servers.gone]\ncommand = "nosuchprogxyz"\n'],
    ["a program that exits at once", '[mcp_servers.bad]\ncommand = "node"\nargs = ["-e", "process.exit(0)"]\n'],
    ["an http server nobody answers", '[mcp_servers.web]\nurl = "http://127.0.0.1:9/mcp"\n'],
  ]) {
    const r = await exec({ label: "e2e-mcp-fail", userTables: tables });
    assert.equal(r.code, 0, `${what}: ${r.err}`);
    assert.equal(size(toolsOf(r)) - size(base), added, what);
    const c = collect(sysFor(r.sb), { project: r.sb.work });
    // cost counts a server whose program is found as one that starts: a program that is not an MCP server, or an http server nobody answers, is counted with its name (3 characters here)
    const over = what === "a program that is not found" ? 0 : 3 + 4;
    assert.equal(cost(c).rows.find((x) => x.id === "tools").chars - over, partsOf(r.requests[0]).toolsJsonChars, `${what}: what cost lists`);
  }
});

test("mcp-command-missing: a server whose program is not found is skipped in silence and exits 0; with required = true Codex stops", opts, async () => {
  const r = await exec({ label: "e2e-mcp-missing", userTables: '[mcp_servers.x]\ncommand = "nosuchprogxyz"\n' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(noise(r.err).filter((l) => /mcp|x\b|program|not found/i.test(l)), []);
  const found = lintWorld(r.sb).find("mcp-command-missing");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warning");
  const header = fs.readFileSync(r.sb.user, "utf8").split("\n").findIndex((l) => l.trim() === "[mcp_servers.x]") + 1;
  assert.equal(found[0].line, header, "the line of the table header");
  const required = await exec({ label: "e2e-mcp-required", userTables: '[mcp_servers.x]\ncommand = "nosuchprogxyz"\nrequired = true\n' });
  assert.equal(required.code, 1);
  assert.match(required.err, /required MCP servers failed to initialize: x: program not found/);
  assert.equal(lintWorld(required.sb).find("mcp-command-missing")[0].severity, "error");
  // and no complaint when the program is there
  const ok = await exec({ label: "e2e-mcp-found", userTables: mcpServer("stub", ["a"]) });
  assert.equal(lintWorld(ok.sb).find("mcp-command-missing").length, 0);
  const command = await exec({ label: "e2e-mcp-cmdline", userTables: '[mcp_servers.x]\ncommand = "node -e 0"\n' });
  assert.equal(command.code, 0, command.err);
  assert.match(lintWorld(command.sb).find("mcp-command-missing")[0].fix, /command = "node" and args = \["-e","0"\]/);
});

test("mcp-invalid: a command and a url, neither, a bearer token with a command", opts, async () => {
  for (const [tables, message] of [
    ['[mcp_servers.x]\ncommand = "node"\nurl = "http://127.0.0.1:1/mcp"\n', /url is not supported for stdio/],
    ["[mcp_servers.x]\nargs = []\n", /invalid transport/],
    ['[mcp_servers.x]\ncommand = "node"\nbearer_token_env_var = "T"\n', /bearer_token_env_var is not supported for stdio/],
  ]) {
    const r = await exec({ label: "e2e-mcp-invalid", userTables: tables });
    assert.equal(r.code, 1);
    assert.match(r.err, message);
    assert.match(r.err, /in `mcp_servers\.x`/);
    assert.equal(lintWorld(r.sb).find("mcp-invalid").length, 1);
  }
});

test("mcp on Windows: tool.cmd and tool.bat are found through PATHEXT, a full path without the extension is completed, tool.ps1 and a file with no extension are not", { skip: skip() || (!IS_WIN && "this check is about Windows") }, async () => {
  const stub = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-stub.mjs");
  const launcher = `@echo off\r\nnode "${stub}" a\r\n`;
  const base = size(await baseline());
  const withName = async (label, files, command) => {
    const r = await exec({ label, files: Object.fromEntries(Object.entries(files).map(([name, text]) => [`bin/${name}`, text])), userTables: (sb) => `[mcp_servers.x]\ncommand = ${JSON.stringify(typeof command === "function" ? command(sb) : command)}\n`, path: (sb) => sb.bin });
    return { r, started: size(toolsOf(r)) - base === added + "x".length + 4, found: lintWorld(r.sb, { env: { PATH: [r.sb.bin, process.env.PATH || process.env.Path].join(path.delimiter) } }).find("mcp-command-missing").length === 0 };
  };
  const cmd = await withName("e2e-mcp-cmd", { "tool.cmd": launcher }, "tool");
  assert.deepEqual([cmd.started, cmd.found], [true, true], "tool.cmd");
  const bat = await withName("e2e-mcp-bat", { "tool.bat": launcher }, "tool");
  assert.deepEqual([bat.started, bat.found], [true, true], "tool.bat");
  const ps1 = await withName("e2e-mcp-ps1", { "tool.ps1": "node x\r\n" }, "tool");
  assert.deepEqual([ps1.started, ps1.found], [false, false], "tool.ps1");
  const bare = await withName("e2e-mcp-bare", { tool: "echo" }, "tool");
  assert.deepEqual([bare.started, bare.found], [false, false], "a file with no extension");
  const full = await withName("e2e-mcp-full", { "tool.cmd": launcher }, (sb) => path.join(sb.bin, "tool"));
  assert.deepEqual([full.started, full.found], [true, true], "a full path without the extension");
});
