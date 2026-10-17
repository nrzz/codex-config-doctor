// Running the real codex binary at zero cost, for the checks that need it (test/e2e-*.test.mjs).
//
// A check runs only when E2E_CODEX names a Codex CLI ("codex" on a CI machine after `npm install -g @openai/codex`, or the full path to
// codex.cmd, codex or codex.exe). Otherwise it is skipped, and `npm test` needs nothing but Node. The binary runs in a throwaway world
// with its own HOME, USERPROFILE and CODEX_HOME, with an environment scrubbed of every CODEX_*, OPENAI_*, CLAUDE_*, ANTHROPIC_*,
// COPILOT_* and GEMINI_* variable of the machine, and with a model provider ("fake") that points at a tiny server on 127.0.0.1 which
// answers the Responses API from a script. No request leaves the machine, no token is spent, no login is needed. The binary is started
// with spawn (asynchronous) and with stdin ignored: a spawnSync would block the event loop that the fake server lives in, and
// `codex exec` waits for input on an open stdin.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { HOME_VARS, homeEnv, tmpDir } from "./helpers.mjs";

export const IS_WIN = process.platform === "win32";
const USAGE = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

/**
 * The command the checks run: E2E_CODEX as it is when it is a path, else the first `codex` that where.exe or `which` finds, as a
 * full path (a name would be looked up in each run's own PATH). On Windows an npm install leaves codex, codex.cmd and codex.ps1 side by
 * side: the file with no extension is a shell script that cmd.exe cannot start, so .exe, .cmd and .bat are preferred.
 */
export function resolveCodex(name = process.env.E2E_CODEX || "") {
  if (!name) return "";
  if (/[\\/]/.test(name)) return name;
  const found = IS_WIN
    ? spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true }).stdout.split(/\r?\n/).filter(Boolean)
    : spawnSync("which", [name], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean);
  if (!found.length) return name;
  if (!IS_WIN) return found[0];
  return found.find((f) => /\.exe$/i.test(f)) || found.find((f) => /\.(cmd|bat)$/i.test(f)) || found[0];
}
export const CODEX = resolveCodex();
export const viaShell = () => IS_WIN && !/\.exe$/i.test(CODEX);

/** Quote one argument for cmd.exe (a command run through a shell is one string). */
export const quoteArg = (a) => (/[\s"&|<>^]/.test(a) || a === "" ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));

/** Sets a variable whatever the case of an existing spelling (Windows keeps `Path`); an undefined value removes it. */
export function setVar(env, name, value) {
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(env)) if (k.toLowerCase() === lower) delete env[k];
  if (value !== undefined && value !== null) env[name] = value;
  return env;
}

/**
 * Every proxy variable of a run names a closed port on this machine: a request to anything but the fake API (which is on 127.0.0.1, in
 * NO_PROXY) fails at once and leaves nothing behind, even if a world is built wrong and a run would otherwise go to the real service.
 */
const DEAD_PROXY = "http://127.0.0.1:9";

/** The environment of a run: none of the machine's agent variables, every agent folder inside the world. `extra` entries win; an undefined value removes the variable. */
export function baseEnv(sb, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CODEX|OPENAI|CLAUDE|ANTHROPIC|COPILOT|GEMINI|AI_AGENT)/i.test(k)) env[k] = v;
  Object.assign(env, homeEnv(sb.home, sb.codexHome), { FAKE_API_KEY: "fake", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", HTTPS_PROXY: DEAD_PROXY, https_proxy: DEAD_PROXY, HTTP_PROXY: DEAD_PROXY, http_proxy: DEAD_PROXY, ALL_PROXY: DEAD_PROXY, all_proxy: DEAD_PROXY });
  for (const [k, v] of Object.entries(extra)) {
    // The folders an agent keeps its files in may only be changed to another throwaway folder: with CODEX_HOME unset or empty, Codex on
    // Windows ignores USERPROFILE and HOME and opens the real profile folder, so a run that drops it would reach the real ~/.codex.
    if (HOME_VARS.some((h) => h.toLowerCase() === k.toLowerCase())) {
      const resolved = v === undefined || v === null || v === "" ? null : path.resolve(sb.work, v);
      if (!resolved || !isInside(resolved, sb.root)) throw new Error(`refusing to set ${k} to ${JSON.stringify(v)}: it must name a folder inside the sandbox (${sb.root})`);
    }
    setVar(env, k, v);
  }
  return env;
}

const isInside = (child, parent) => { const rel = path.relative(parent, child); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };

let info;
/** { ok, version, number, reason }: whether E2E_CODEX names a codex that runs, and the version it prints. */
export function codexInfo() {
  if (info) return info;
  if (!CODEX) return (info = { ok: false, version: "", number: "", reason: "E2E_CODEX is not set (point it at a codex command to run the checks against the real thing)" });
  const root = tmpDir("ccd-e2e-probe-");
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const r = spawnSync(viaShell() ? [CODEX, "--version"].map(quoteArg).join(" ") : CODEX, viaShell() ? [] : ["--version"], { encoding: "utf8", timeout: 60000, windowsHide: true, shell: viaShell(), input: "", env: baseEnv({ home, codexHome: path.join(root, "codex-home") }) });
  const version = (r.stdout || "").trim();
  info = r.status === 0 && version ? { ok: true, version, number: (/\d+\.\d+\.\d+(?:-[\w.]+)?/.exec(version) || [""])[0], reason: "" } : { ok: false, version: "", number: "", reason: `E2E_CODEX (${CODEX}) did not run: ${(r.error && r.error.message) || (r.stderr || "").trim().slice(0, 120)}` };
  return info;
}
/** The value for node:test's `skip` option: false when the binary is there, else the reason. */
export const skip = () => (codexInfo().ok ? false : codexInfo().reason);
/** The same for the checks that need Windows. */
export const skipUnlessWindows = () => skip() || (!IS_WIN && "this check is about Windows");

/**
 * A throwaway world for the binary:
 *   root/home        HOME and USERPROFILE
 *   root/codex-home  CODEX_HOME (config.toml, AGENTS.md, rules/)
 *   root/work        the project folder (put a `.git` folder in it to make it a project root)
 *   root/bin         stand-in programs; put it on PATH with `path: sb.bin`
 */
export function sandbox(label) {
  const root = tmpDir(`ccd-e2e-${label}-`);
  const sb = {
    root,
    home: path.join(root, "home"),
    codexHome: path.join(root, "codex-home"),
    work: path.join(root, "work"),
    bin: path.join(root, "bin"),
    hookLog: path.join(root, "hooks.jsonl"),
  };
  for (const d of [sb.home, sb.codexHome, sb.work, sb.bin]) fs.mkdirSync(d, { recursive: true });
  sb.user = path.join(sb.codexHome, "config.toml");
  return sb;
}

/** Write a file; an object as JSON, a string or a Buffer as it is. */
export function put(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`);
  if (mode !== undefined) fs.chmodSync(file, mode);
  return file;
}

/** The TOML for the fake model provider: top-level keys (they must come before any table) and the provider table. */
export function providerToml(port, { model = "gpt-5.5", wireApi = "responses", name = "fake", id = "fake" } = {}) {
  return {
    top: `model = "${model}"\nmodel_provider = "${id}"\n`,
    table: `[model_providers.${id}]\nname = "${name}"\nbase_url = "http://127.0.0.1:${port}/v1"\nenv_key = "FAKE_API_KEY"\nwire_api = "${wireApi}"\n`,
  };
}

/**
 * Write the user config: `top` (more top-level keys) and `tables` (more tables) around the provider of the fake API.
 * Pass `provider: false` to write `top` and `tables` as they are.
 */
export function writeUserConfig(sb, api, { top = "", tables = "", provider = true, model } = {}) {
  const p = provider && api ? providerToml(api.port, model ? { model } : {}) : { top: "", table: "" };
  const text = `${p.top}${top}${top && !top.endsWith("\n") ? "\n" : ""}\n${p.table}\n${tables}`;
  put(sb.user, text);
  return text;
}

// ---- the fake Responses API ----------------------------------------------------------------------------------------------

const sse = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

/** A shell call by the model, as the Responses API carries it. `args` is the arguments object (exec_command takes cmd, workdir, sandbox_permissions, justification, prefix_rule ...). */
export const shellCall = (cmd, extra = {}, name = "exec_command") => ({ call: { name, args: { cmd, ...extra } } });

/** How many tool results the script's steps before `index` consume. A step is { text }, { call } or { calls: [call, ...] }. */
const consumed = (script, index) => script.slice(0, index).reduce((n, s) => n + (s.calls ? s.calls.length : s.call ? 1 : 0), 0);

/**
 * The fake Responses API. Every request is recorded, whole (`requests` holds the POSTs to /responses, `all` every request). The
 * conversation is answered from `script`: step k answers the request that carries as many tool results as the steps before k
 * asked for, and the answer after the last step is the text PROBE-DONE. A step: { text }, { call: { name, args } } or
 * { calls: [ ... ] }; { status: 500, body } answers with an error. Returns { port, requests, all, close() }.
 */
export function fakeApi(script = []) {
  const requests = [];
  const all = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let j = null;
      try { j = JSON.parse(body); } catch { /* not json */ }
      all.push({ method: req.method, url: req.url, headers: req.headers, body: j });
      if (!(req.method === "POST" && /\/responses(\?|$)/.test(req.url))) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `fake API: no route ${req.method} ${req.url}` } }));
        return;
      }
      requests.push(j || {});
      const n = requests.length;
      const outputs = ((j && j.input) || []).filter((i) => i && (i.type === "function_call_output" || i.type === "custom_tool_call_output")).length;
      const index = script.findIndex((_, k) => consumed(script, k) === outputs);
      const step = index >= 0 ? script[index] : null;
      if (step && step.status) {
        res.writeHead(step.status, { "content-type": "application/json" });
        res.end(typeof step.body === "string" ? step.body : JSON.stringify(step.body || { error: { message: "fake API: error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      sse(res, "response.created", { type: "response.created", response: { id: `resp_${n}`, status: "in_progress", output: [] } });
      const calls = step && step.calls ? step.calls : step && step.call ? [step] : [];
      if (calls.length) {
        const items = calls.map((c, k) => ({ type: "function_call", id: `fc_${n}_${k}`, call_id: `call_${n}_${k}`, name: c.call.name, arguments: JSON.stringify(c.call.args || {}), status: "completed" }));
        items.forEach((item, k) => {
          sse(res, "response.output_item.added", { type: "response.output_item.added", output_index: k, item });
          sse(res, "response.output_item.done", { type: "response.output_item.done", output_index: k, item });
        });
        sse(res, "response.completed", { type: "response.completed", response: { id: `resp_${n}`, status: "completed", output: items, usage: USAGE } });
      } else {
        const text = (step && step.text) || "PROBE-DONE";
        const msg = { type: "message", id: `msg_${n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
        sse(res, "response.output_item.added", { type: "response.output_item.added", output_index: 0, item: msg });
        sse(res, "response.output_text.delta", { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text });
        sse(res, "response.output_item.done", { type: "response.output_item.done", output_index: 0, item: msg });
        sse(res, "response.completed", { type: "response.completed", response: { id: `resp_${n}`, status: "completed", output: [msg], usage: USAGE } });
      }
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    resolve({ port: server.address().port, requests, all, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
  }));
}

// ---- running the binary ----------------------------------------------------------------------------------------------------

export function killTree(child) {
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}


/** Start codex as a child with the sandbox's environment and the given stdio (default: stdin ignored). The caller owns the child. */
export function startCodex(sb, args, { env = {}, cwd, path: pathFirst, stdin = "ignore", online = false } = {}) {
  assertOffline(sb, args, online);
  const childEnv = baseEnv(sb, env);
  if (pathFirst) {
    const key = Object.keys(childEnv).find((k) => k.toLowerCase() === "path") || "PATH";
    childEnv[key] = [].concat(pathFirst).join(path.delimiter) + path.delimiter + (childEnv[key] || "");
  }
  const where = cwd || sb.work;
  const stdio = [stdin, "pipe", "pipe"];
  return viaShell()
    ? spawn([CODEX, ...args].map(quoteArg).join(" "), [], { cwd: where, env: childEnv, shell: true, windowsHide: true, stdio })
    : spawn(CODEX, args, { cwd: where, env: childEnv, windowsHide: true, stdio, detached: !IS_WIN });
}

/** The line Codex prints when its home is under the temporary folder, which it always is here. */
const TEMP_WARNING = /^WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir .*$/;
/** The line Codex prints on a Linux where bubblewrap is not on PATH (the CI runners): a fact about the machine, not about the configuration under test. */
const BWRAP_WARNING = /^(?:warning: )?Codex could not find bubblewrap on PATH\..*$/;
/** True for a warning that is about the machine the checks run on. */
export const isMachineNoise = (text) => BWRAP_WARNING.test(String(text).trim());
export const cleanStderr = (text) => String(text).split(/\r?\n/).filter((l) => !TEMP_WARNING.test(l) && !isMachineNoise(l)).join("\n").replace(/^\n+|\n+$/g, "");

/** The JSON lines of `codex exec --json`, parsed; lines that are not JSON are skipped. */
export const parseEvents = (out) => String(out).split(/\r?\n/).filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Subcommands that never talk to a model provider. Anything else must have the fake provider (127.0.0.1) in the user config or in the
// arguments: a run without it would go to the real service.
const OFFLINE = new Set(["--version", "-V", "--help", "-h", "help", "features", "execpolicy", "sandbox", "debug", "completion"]);
const SUBCOMMANDS = new Set(["agents", "exec", "e", "review", "login", "logout", "mcp", "plugin", "app-server", "remote-control", "app", "completion", "update", "doctor", "sandbox", "debug", "apply", "a", "resume", "queue", "archive", "delete", "migrate-rollouts", "unarchive", "fork", "cloud", "exec-server", "features", "help", "execpolicy"]);
function assertOffline(sb, args, online) {
  if (online) return;
  const first = args.find((a) => SUBCOMMANDS.has(a) || a === "--version" || a === "-V" || a === "--help" || a === "-h");
  if (first && OFFLINE.has(first)) return;
  const has = (text) => /127.0.0.1/.test(text);
  let user = "";
  try { user = fs.readFileSync(sb.user, "utf8"); } catch { /* no config */ }
  if (has(user) || has(args.join(" "))) return;
  throw new Error(`refusing to run codex ${args.join(" ")}: the sandbox has no fake model provider on 127.0.0.1, so the run could reach the real service`);
}

/**
 * Run codex in a sandbox. Resolves { code, out, err, raw (stderr as printed), events, ms, env }.
 *   args     the arguments after `codex`
 *   env      entries that replace variables of the scrubbed environment (an undefined value removes one)
 *   path     a folder (or folders) to put in front of PATH
 *   cwd      the working folder (default: the sandbox's project folder)
 * The result's `err` has the temporary-folder warning removed; `raw` is stderr as it was.
 */
export function runCodex(sb, args, { timeout = 120000, env = {}, cwd, path: pathFirst, online = false } = {}) {
  assertOffline(sb, args, online);
  return new Promise((resolve) => {
    const childEnv = baseEnv(sb, env);
    if (pathFirst) {
      const key = Object.keys(childEnv).find((k) => k.toLowerCase() === "path") || "PATH";
      childEnv[key] = [].concat(pathFirst).join(path.delimiter) + path.delimiter + (childEnv[key] || "");
    }
    const where = cwd || sb.work;
    const started = Date.now();
    const child = viaShell()
      ? spawn([CODEX, ...args].map(quoteArg).join(" "), [], { cwd: where, env: childEnv, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(CODEX, args, { cwd: where, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: !IS_WIN });
    let out = "";
    let err = "";
    child.on("error", (e) => { err += String(e); });
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? "timeout" : code, out, err: cleanStderr(err), raw: err, events: parseEvents(out), ms: Date.now() - started, env: childEnv });
    });
  });
}

/** `codex exec` in the project folder, against the fake API, with the arguments every check shares. */
export const execArgs = (prompt = "hello", extra = []) => ["exec", "--skip-git-repo-check", "--json", ...extra, prompt];

// ---- reading what the binary sent -------------------------------------------------------------------------------------------

/** The names of the tools of a request. */
export const toolNames = (req) => ((req && req.tools) || []).map((t) => t.name || t.type);
/** The text of every input item of a request that has the role, in order. */
export const roleTexts = (req, role) => ((req && req.input) || []).filter((i) => i.role === role).flatMap((i) => (Array.isArray(i.content) ? i.content : [i.content]).map((c) => (typeof c === "string" ? c : (c && c.text) || "")));
/** All the text of the input of a request, joined. */
export const inputText = (req) => ((req && req.input) || []).flatMap((i) => (Array.isArray(i.content) ? i.content : [i.content]).map((c) => (typeof c === "string" ? c : (c && c.text) || ""))).join("\n");
/** The tool results Codex sent back in a request: [{ call_id, output }]. */
export const toolOutputs = (req) => ((req && req.input) || []).filter((i) => i.type === "function_call_output").map((i) => ({ call_id: i.call_id, output: typeof i.output === "string" ? i.output : JSON.stringify(i.output) }));
/** The hook records the recording hook wrote: [{ event, argv, env, stdin (parsed when it is JSON) }]. */
export function hookRecords(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
    const r = JSON.parse(l);
    try { r.input = JSON.parse(r.stdin); } catch { r.input = null; }
    return r;
  });
}

// ---- the prompt without a model ------------------------------------------------------------------------------------------------

/**
 * `codex debug prompt-input`: the model-visible input list as JSON, without a request to anyone (about half a second). Resolves
 * { code, items, err, agents (the text of the AGENTS.md message or null), texts (every text of every item) }.
 */
export async function promptInput(sb, { args = [], env = {}, cwd, prompt = "hello", timeout = 60000 } = {}) {
  const r = await runCodex(sb, ["debug", "prompt-input", ...args, prompt], { env, cwd, timeout });
  let items = null;
  try { items = JSON.parse(r.out); } catch { /* an error: r.err says which */ }
  const texts = (items || []).flatMap((i) => (Array.isArray(i.content) ? i.content : [i.content]).map((c) => (typeof c === "string" ? c : (c && c.text) || "")));
  const agents = texts.find((t) => /^# AGENTS.md instructions/.test(t)) || null;
  return { code: r.code, items, err: r.err, texts, agents, raw: r };
}

/** The text between <INSTRUCTIONS> and </INSTRUCTIONS> of the AGENTS.md message, or null. */
export function agentsBody(text) {
  if (!text) return null;
  const m = /<INSTRUCTIONS>\n([\s\S]*)\n<\/INSTRUCTIONS>$/.exec(text);
  return m ? m[1] : null;
}

// ---- a real Git repository --------------------------------------------------------------------------------------------------

/** `git init` in a folder of a sandbox (Codex asks Git for the project root when it decides about trust), with the sandbox's home. */
export function gitInit(sb, dir = sb.work) {
  fs.mkdirSync(dir, { recursive: true });
  const env = baseEnv(sb, { GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
  const r = spawnSync("git", ["init", "-q", "-b", "main", dir], { encoding: "utf8", windowsHide: true, env, input: "" });
  if (r.status !== 0) throw new Error(`git init failed: ${(r.stderr || "").trim() || (r.error && r.error.message)}`);
  return dir;
}
