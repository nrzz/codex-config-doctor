// A stand-in MCP server over standard input and output, for the checks that need a server Codex can start: it answers `initialize` and
// `tools/list` (newline-delimited JSON-RPC) with the tools named in the arguments, and `tools/call` with a short text. It is started by
// Codex, never by `node --test`: without arguments this file does nothing.
//   node mcp-stub.mjs <tool name> [<tool name> ...]
import readline from "node:readline";

const names = process.argv.slice(2);
if (names.length === 0) process.exit(0);

const tools = names.map((name) => ({ name, description: `The ${name} tool of the stand-in server.`, inputSchema: { type: "object", properties: { text: { type: "string", description: "Text to echo." } }, required: ["text"] } }));
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1.0.0" } } });
  else if (m.method === "tools/list") send({ id: m.id, result: { tools } });
  else if (m.method === "tools/call") send({ id: m.id, result: { content: [{ type: "text", text: "stub answered" }] } });
  else if (m.id !== undefined && m.method) send({ id: m.id, result: {} });
});
rl.on("close", () => process.exit(0));
