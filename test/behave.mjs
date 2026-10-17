// What the real Codex does in a world, and what this tool says about the same world on the same disk. The e2e checks of the findings
// (test/e2e-config.test.mjs and friends) run `codex exec` against the fake Responses API in a throwaway world, and then run `lint` (or
// another command) on that very folder, so that a finding is held to the behaviour it describes. Importing this file starts nothing.
import path from "node:path";
import { collect } from "../src/collect.mjs";
import { lint } from "../src/lint.mjs";
import { makeSys } from "../src/sys.mjs";
import { withAppServer } from "./app-server.mjs";
import { fakeApi, gitInit, hookRecords, isMachineNoise, put, runCodex, sandbox, toolOutputs, writeUserConfig } from "./codex-sandbox.mjs";

/**
 * `codex exec` in a new world, against the fake API. The spec:
 *   userTop / userTables   more user config (top-level keys; tables) after the provider of the fake API
 *   rawUser                the whole user config.toml instead (text or Buffer); the fake provider is not written
 *   (nothing is set but the fake provider: `codex exec` with sandbox_mode "danger-full-access" writes a trusted entry for the working
 *   folder into the user config.toml, so a world that needs that setting says so in userTop)
 *   trust                  the project folder is trusted in the user config
 *   project                the text of work/.codex/config.toml
 *   files                  { path relative to the world's root (work/x, codex-home/y): text }
 *   script                 the fake API's script (shellCall(...), { text })
 *   args / top             arguments after `exec` / before it; prompt, env, path, timeout, git (false: no repository)
 * Resolves { sb, code, out, err, ms, requests, model, hookRuns }.
 */
export async function exec(spec = {}) {
  const sb = sandbox(spec.label || "behave");
  if (spec.git !== false) gitInit(sb);
  const api = await fakeApi(spec.script || []);
  try {
    const trustTable = spec.trust ? `[projects.'${sb.work}']\ntrust_level = "trusted"\n` : "";
    const val = (x) => (typeof x === "function" ? x(sb) : x);
    if (spec.rawUser !== undefined) put(sb.user, val(spec.rawUser));
    else writeUserConfig(sb, api, { top: val(spec.userTop) || "", tables: `${trustTable}${val(spec.userTables) || ""}` });
    if (spec.project !== undefined) put(path.join(sb.work, ".codex", "config.toml"), val(spec.project));
    for (const [rel, text] of Object.entries(spec.files || {})) put(path.join(sb.root, ...rel.split("/")), val(text));
    if (spec.before) await spec.before(sb, api);
    const cwd = spec.cwd || sb.work;
    const args = [...(spec.top || []), "exec", "--skip-git-repo-check", "-C", cwd, ...(spec.args || []), spec.prompt || "hello"];
    // a raw user config has no fake provider (it cannot have one, or it is the thing being tested): such a run must fail before any request,
    // and every proxy variable of the run names a closed port in case it does not
    const r = await runCodex(sb, args, { cwd, env: spec.env, path: val(spec.path), timeout: spec.timeout, online: spec.rawUser !== undefined });
    return { sb, code: r.code, out: r.out, err: r.err, ms: r.ms, requests: api.requests, model: api.requests[0] && api.requests[0].model, hookRuns: hookRecords(sb.hookLog) };
  } finally { await api.close(); }
}

/** The sys of this tool for a world made by exec(): its folders, its PATH, and no system folder of the machine. */
export function sysFor(sb, extraEnv = {}) {
  const env = { CODEX_HOME: sb.codexHome, HOME: sb.home, USERPROFILE: sb.home, ProgramData: path.join(sb.root, "program-data"), PATH: process.env.PATH || process.env.Path || "", ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}), ...extraEnv };
  return makeSys({ env, cwd: sb.work });
}

/** What this tool collects and lints for the world on disk. Resolves { c, result, ids, find(id) }. */
export function lintWorld(sb, { profile, project = sb.work, env } = {}) {
  const c = collect(sysFor(sb, env), { project, profile });
  const result = lint(c);
  return { c, result, ids: result.findings.map((f) => f.id), find: (id) => result.findings.filter((f) => f.id === id) };
}

/** The stderr of a run without the lines of the header and the model's answer: the warnings and errors. */
export const noise = (err) => String(err).split(/\r?\n/).filter((l) => l && !/^(Reading additional input|OpenAI Codex v|-{4,}|workdir:|model:|provider:|approval:|sandbox:|reasoning|session id:|user$|hello$|codex$|PROBE-DONE|tokens used|\d[\d,]*$)/.test(l));

/**
 * A thread of the app server (what the terminal UI is built on) with one turn against the fake API, in a new world. The spec is the one of
 * exec(), with approval and sandbox for the thread (default on-request and workspace-write), and `answer(request)` for the questions the
 * server asks the client (default: decline). Resolves { sb, requests, asked (the server's requests), warnings, outputs (the tool results
 * the model was given, in order), items (the notifications of the turn) }.
 */
export async function thread(spec = {}) {
  const sb = sandbox(spec.label || "behave-thread");
  if (spec.git !== false) gitInit(sb);
  const api = await fakeApi(spec.script || []);
  try {
    const trustTable = spec.trust ? `[projects.'${sb.work}']\ntrust_level = "trusted"\n` : "";
    const val = (x) => (typeof x === "function" ? x(sb) : x);
    writeUserConfig(sb, api, { top: val(spec.userTop) || "", tables: `${trustTable}${val(spec.userTables) || ""}` });
    if (spec.project !== undefined) put(path.join(sb.work, ".codex", "config.toml"), val(spec.project));
    for (const [rel, text] of Object.entries(spec.files || {})) put(path.join(sb.root, ...rel.split("/")), val(text));
    if (spec.before) await spec.before(sb, api);
    const asked = [];
    let warnings = [];
    let items = [];
    await withAppServer(sb, { cwd: sb.work, env: spec.env, path: val(spec.path) }, async (s) => {
      s.onServerRequest = (msg) => { asked.push(msg); return spec.answer ? spec.answer(msg) : { decision: "decline" }; };
      const t = await s.request("thread/start", { cwd: sb.work, approvalPolicy: spec.approval || "on-request", sandbox: spec.sandbox || "workspace-write", ephemeral: true, ...(spec.threadParams || {}) });
      await s.request("turn/start", { threadId: t.thread.id, input: [{ type: "text", text: spec.prompt || "hello", text_elements: [] }] });
      await s.waitFor("turn/completed", () => true, spec.timeout || 90000);
      warnings = s.notifications.filter((n) => n.method === "configWarning" || n.method === "warning").map((n) => (n.params && (n.params.summary || n.params.message)) || n.method).filter((w) => !isMachineNoise(w));
      items = s.notifications.map((n) => ({ method: n.method, params: n.params }));
    });
    const outputs = [];
    for (const r of api.requests) for (const o of toolOutputs(r)) if (!outputs.some((x) => x.call_id === o.call_id)) outputs.push(o);
    return { sb, requests: api.requests, asked, warnings, outputs: outputs.map((o) => o.output), items };
  } finally { await api.close(); }
}
