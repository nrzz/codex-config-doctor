// Measuring the first request Codex sends, with the fake Responses API: the parts that are not the user's words (the base instructions, the
// skills block, the permissions, the AGENTS.md message, the environment, the tool definitions). `cost` (src/cost.mjs) computes what it can
// from the user's files and uses the figures of src/recorded.mjs for the rest; test/e2e-cost.test.mjs captures a real first request and
// holds both to it, and `node test/record-oracles.mjs recorded` writes src/recorded.mjs again from captures made here.
// `codex exec` always runs with approval_policy "never"; the permissions text for the other policies is what a thread of the app server
// (which the terminal UI is built on) sends, so those come from a thread.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withAppServer } from "./app-server.mjs";
import { codexInfo, execArgs, fakeApi, gitInit, put, runCodex, sandbox, writeUserConfig } from "./codex-sandbox.mjs";

export const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"];
/** Today's date in UTC (YYYY-MM-DD). */
export const today = () => new Date().toISOString().slice(0, 10);
export const REFERENCE_CWD_CHARS = 62;

const textsOf = (request) => ((request && request.input) || []).flatMap((i) => (Array.isArray(i.content) ? i.content : [i.content]).map((c) => ({ role: i.role, text: typeof c === "string" ? c : (c && c.text) || "" })));

/** The parts of a request, as texts and as sizes in characters. */
export function partsOf(request) {
  const texts = textsOf(request);
  const find = (re) => texts.find((t) => re.test(t.text));
  const base = find(/^You are Codex/);
  const skills = find(/^<skills_instructions>/);
  const permissions = find(/^<permissions instructions>/);
  const environment = find(/^<environment_context>/);
  const agents = find(/^# AGENTS\.md instructions/);
  const tools = (request.tools || []).map((t) => [t.name || t.type, JSON.stringify(t).length]);
  const text = (p) => (p ? p.text : null);
  return {
    model: request.model,
    text: { base: text(base), skills: text(skills), permissions: text(permissions), environment: text(environment), agents: text(agents) },
    chars: { base: base ? base.text.length : 0, skills: skills ? skills.text.length : 0, permissions: permissions ? permissions.text.length : 0, environment: environment ? environment.text.length : 0, agents: agents ? agents.text.length : 0 },
    tools,
    toolsChars: tools.reduce((n, t) => n + t[1], 0),
    toolsJsonChars: JSON.stringify(request.tools || []).length,
    requestChars: JSON.stringify(request).length,
  };
}

/** The first request of `codex exec` in a throwaway world. `setup(sb)` may add files; `config` is extra user config ({ top, tables }). */
export async function captureExec({ sandboxMode = "read-only", setup, config = {}, subdir, label = "measure" } = {}) {
  const sb = sandbox(label);
  gitInit(sb);
  const api = await fakeApi([]);
  try {
    writeUserConfig(sb, api, { top: `approval_policy = "never"\nsandbox_mode = "${sandboxMode}"\n${config.top || ""}`, tables: `[windows]\nsandbox = "unelevated"\n${config.tables || ""}` });
    if (setup) setup(sb);
    const cwd = subdir ? path.join(sb.work, ...subdir.split("/")) : sb.work;
    fs.mkdirSync(cwd, { recursive: true });
    const r = await runCodex(sb, execArgs("hello", ["-C", cwd, "--ephemeral"]), { cwd });
    if (!api.requests.length) throw new Error(`no request reached the fake API (exit ${r.code}): ${r.err}`);
    return { sb, request: api.requests[0], parts: partsOf(api.requests[0]), cwd };
  } finally { await api.close(); }
}

/** The first request of a thread of the app server with the approval policy and the sandbox given. */
export async function captureThread({ approval = "on-request", sandboxMode = "read-only", setup, config = {}, label = "measure-thread" } = {}) {
  const sb = sandbox(label);
  gitInit(sb);
  const api = await fakeApi([]);
  try {
    // the settings are in the file too (as well as in the call), so that `cost` can read them from the folder
    writeUserConfig(sb, api, { top: `approval_policy = "${approval}"\nsandbox_mode = "${sandboxMode}"\n${config.top || ""}`, tables: `[projects.'${sb.work}']\ntrust_level = "trusted"\n[windows]\nsandbox = "unelevated"\n${config.tables || ""}` });
    if (setup) setup(sb);
    await withAppServer(sb, { cwd: sb.work, online: false }, async (s) => {
      const t = await s.request("thread/start", { cwd: sb.work, approvalPolicy: approval, sandbox: sandboxMode, ephemeral: true });
      await s.request("turn/start", { threadId: t.thread.id, input: [{ type: "text", text: "hello", text_elements: [] }] });
      await s.waitFor("turn/completed", () => true, 90000);
    });
    if (!api.requests.length) throw new Error("no request reached the fake API");
    return { sb, request: api.requests[0], parts: partsOf(api.requests[0]), cwd: sb.work };
  } finally { await api.close(); }
}

/** Everything src/recorded.mjs holds, measured: { exec: { sandboxMode: capture }, thread: { sandboxMode: capture } }. */
export async function recordFirstRequest() {
  const exec = {};
  const thread = {};
  for (const mode of SANDBOX_MODES) exec[mode] = await captureExec({ sandboxMode: mode });
  for (const mode of SANDBOX_MODES) thread[mode] = await captureThread({ approval: "on-request", sandboxMode: mode });
  // an enabled MCP server that starts: the tools Codex adds to the first request, and what it adds to the tool_search description
  const mcp = await captureExec({ sandboxMode: "read-only", config: { tables: mcpServer("stub", ["echo", "shout"]) } });
  return { exec, thread, mcp, codex: codexInfo().number, on: today() };
}

/** The text of a [mcp_servers.<id>] table for the stand-in server (test/mcp-stub.mjs) with the tools named. */
export function mcpServer(id, toolNames, extra = "") {
  const stub = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-stub.mjs").split(path.sep).join("/");
  return `[mcp_servers.${id}]\ncommand = "node"\nargs = [${JSON.stringify(stub)}, ${toolNames.map((n) => JSON.stringify(n)).join(", ")}]\n${extra}`;
}

const TIMES_IN_ENVIRONMENT = { "read-only": 2, "workspace-write": 7, "danger-full-access": 2 };

/**
 * The text of src/recorded.mjs for a measurement made by recordFirstRequest() on this system. The figures that differ from one system to
 * another are kept for each system (`previous` is BY_SYSTEM of the file as it is now), and this system's are replaced by the measurement.
 */
export function recordedSource(m, previous = {}, platform = process.platform) {
  const ro = m.exec["read-only"];
  const skills = ro.parts.text.skills;
  const headEnd = skills.indexOf("### Skill roots\n") + "### Skill roots\n".length;
  const head = skills.slice(0, headEnd);
  const listAt = skills.indexOf("### Available skills\n");
  const entriesStart = listAt + "### Available skills\n".length;
  const tailStart = skills.indexOf("### How to use skills");
  const rootsText = skills.slice(headEnd, listAt);
  const entries = skills.slice(entriesStart, tailStart).replace(/\n$/, "").split("\n").map((l) => l.replace("(file: r0/", "(file: @R/"));
  const tail = skills.slice(tailStart);
  const rebuilt = `${head}${rootsText}### Available skills\n${entries.map((l) => l.replace("@R", "r0")).join("\n")}\n${tail}`;
  if (rebuilt !== skills) throw new Error("the skills block cannot be rebuilt from its parts");
  // the tools an enabled MCP server adds to the list, and the characters of the line it adds to the tool_search description ("- <id>")
  const base = new Set(ro.parts.tools.map((x) => x[0]));
  const mcpTools = m.mcp.parts.tools.filter((x) => !base.has(x[0]));
  const perms = { never: {}, "on-request": {} };
  const env = {};
  for (const mode of SANDBOX_MODES) {
    // the writable folders are named in the workspace-write block: set the figure to what it is at the reference length
    const at = (c) => (mode === "workspace-write" ? c.parts.chars.permissions - (c.cwd.length - REFERENCE_CWD_CHARS) : c.parts.chars.permissions);
    perms.never[mode] = at(m.exec[mode]);
    perms["on-request"][mode] = at(m.thread[mode]);
    // the folder's path is in the block several times: set the figure to what it is at the reference length
    env[mode] = m.exec[mode].parts.chars.environment - TIMES_IN_ENVIRONMENT[mode] * (m.exec[mode].cwd.length - REFERENCE_CWD_CHARS);
  }
  const bySystem = { ...previous, [platform]: { on: m.on, tools: ro.parts.tools, permissions: perms, environment: env, cwdChars: REFERENCE_CWD_CHARS } };
  const known = ["win32", "linux", "darwin"];
  const order = [...known, ...Object.keys(bySystem).filter((k) => !known.includes(k))].filter((k) => bySystem[k]);
  const bySystemText = order.map((k) => `  ${k}: ${JSON.stringify(bySystem[k])},`).join("\n");
  return `// What Codex ${m.codex} sent in the first request of a session, recorded with the fake API of test/codex-sandbox.mjs
// (\`E2E_CODEX=... node test/record-oracles.mjs recorded\` writes this file again; test/measure.mjs does the measuring). \`cost\` uses these
// where it cannot compute a figure from your files, and says so; test/e2e-cost.test.mjs compares them with a real first request.
export const RECORDED_ON = ${JSON.stringify(m.on)};
export const RECORDED_CODEX = ${JSON.stringify(m.codex)};
export const RECORDED_MODEL = ${JSON.stringify(ro.parts.model)};

/** The base instructions: the first developer message (characters). */
export const BASE_INSTRUCTIONS_CHARS = ${ro.parts.chars.base};

/**
 * What differs from one system to another, recorded on each: the tool definitions of the first request (the JSON characters of each, with the
 * default configuration; exec_command and apply_patch are described differently on Windows), the permissions block (characters, by approval
 * policy and sandbox mode; \`codex exec\` always runs with approval "never", the other figures are those of an app-server thread, which the
 * terminal UI is built on; the workspace-write block names the writable folders, so its figure moves with the length of their paths), and the
 * environment block (characters at a working folder of cwdChars characters: the folder's path appears twice, seven times with workspace-write).
 */
export const BY_SYSTEM = {
${bySystemText}
};

/**
 * What an enabled MCP server adds to the first request (put to Codex ${m.codex}): these tools, after write_stdin, and a line "- <id>" in the
 * description of tool_search for a server that starts. The tools of the server itself are not in the request: Codex defers them behind
 * tool_search (2, 3, 30 and 60 tools gave the same request).
 */
export const MCP_TOOLS = ${JSON.stringify(mcpTools)};

// The skills block, as Codex builds it: the head, one line for each root (\`rN\`), the entries, the tail. The four skills Codex bundles are
// in $CODEX_HOME/skills/.system; the entries below name that root @R.
export const SKILLS_HEAD = ${JSON.stringify(head)};
export const SKILLS_LIST_HEAD = ${JSON.stringify("### Available skills\n")};
export const SKILLS_BUNDLED = ${JSON.stringify(entries, null, 2)};
export const SKILLS_TAIL = ${JSON.stringify(tail)};
`;
}

/** Writes a skill under the Codex home of a sandbox (for the cost checks). */
export function writeSkill(dir, name, description) {
  return put(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nThe body of ${name} is not sent.\n`);
}

/** "" when the two texts are equal, else the first line where they differ (cut to 160 characters), for a failure message that fits a screen. */
export function firstDifference(actual, expected) {
  if (actual === expected) return "";
  const a = String(actual).split("\n");
  const b = String(expected).split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cut = (s) => (s === undefined ? "(no line)" : s.length > 160 ? `${s.slice(0, 160)}...` : s);
  return `line ${i + 1}: this tool has ${JSON.stringify(cut(a[i]))}, Codex has ${JSON.stringify(cut(b[i]))}`;
}
