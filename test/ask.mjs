// Putting the tables of cases to the real Codex. Each function builds a throwaway world for a case, asks the binary and returns the record of
// its answer. test/record-oracles.mjs writes the records to test/fixtures/*.json; the unit tests hold the code to those records without
// Codex; the e2e tests (test/e2e-*.test.mjs) call the same functions again and compare the live answers with the records, so that a Codex
// that answers differently shows up as a failing check and not as a wrong claim. Importing this file starts nothing.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppServer } from "./app-server.mjs";
import { codexInfo, gitInit, isMachineNoise, promptInput, put, runCodex, sandbox, writeUserConfig } from "./codex-sandbox.mjs";

/** Runs fn(item, index) over the items, `size` at a time; the results are in the order of the items. */
export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/** How many binaries run at once. */
export const PARALLEL = Number(process.env.CCD_PARALLEL) || 4;

export const stamp = () => ({ codex: codexInfo().number, recorded: new Date().toISOString().slice(0, 10) });
/** A path or a message with the throwaway root replaced by <root>, also in the lower-case spelling of Codex's trust warning (c:\users\...). */
const norm = (s, root) => String(s).split(root).join("<root>").split(root.toLowerCase()).join("<root>").replace(/\\/g, "/");

// ---- toml ------------------------------------------------------------------------------------------------------------------

/** What Codex does with a config.toml: { name, valid: true } or { name, valid: false, line, column, message }. */
export async function askToml(name, text) {
  const sb = sandbox("ask-toml");
  fs.writeFileSync(sb.user, text);
  const r = await promptInput(sb, {});
  const err = r.err || "";
  const m = /config\.toml:(\d+):(\d+): (.*)/.exec(err) || /line (\d+), column (\d+)/.exec(err);
  return r.code === 0 ? { name, valid: true } : { name, valid: false, line: m ? Number(m[1]) : null, column: m ? Number(m[2]) : null, message: (m && m[3] ? m[3] : err.split("\n").find((l) => l.trim()) || "").trim() };
}

export async function recordToml(progress = () => {}) {
  const { CASES } = await import("./toml-table.mjs");
  const cases = await pool(CASES, PARALLEL, async ([name, text]) => { const r = await askToml(name, text); progress(r.valid); return r; });
  return { ...stamp(), cases };
}

// ---- rules -----------------------------------------------------------------------------------------------------------------

/** The files of the policies of the rules table, written once in a sandbox: { sb, filesOf }. */
export async function rulesWorld() {
  const { POLICIES } = await import("./rules-table.mjs");
  const sb = sandbox("ask-rules");
  const filesOf = {};
  for (const [name, p] of Object.entries(POLICIES)) filesOf[name] = put(path.join(sb.root, `${name}.rules`), p.text);
  return { sb, filesOf };
}

export async function askRulesCase(world, c) {
  const r = await runCodex(world.sb, ["execpolicy", "check", "--rules", world.filesOf[c.policy], "--", ...c.tokens]);
  if (r.code !== 0) throw new Error(`execpolicy check failed for ${c.policy} ${JSON.stringify(c.tokens)}: ${r.err}`);
  return { policy: c.policy, tokens: c.tokens, answer: JSON.parse(r.out) };
}

/**
 * What Codex does with a rules file. `execpolicy check` loads it and prints the answer for `ls`, or the error with the line (`line`: for a
 * bracket that is never closed it says line 1). A file that does not load is also put in the rules folder of a Codex home and `codex exec`
 * is started: it stops with "Error loading rules:" and a line of its own (`execLine`: the line after the last one for an unclosed bracket),
 * the line a user sees. The app server starts anyway, warns and applies no custom rule at all (test/e2e-rules.test.mjs).
 */
export async function askRulesFile(world, name, text, i) {
  const file = put(path.join(world.sb.root, `file${i}.rules`), text);
  const r = await runCodex(world.sb, ["execpolicy", "check", "--rules", file, "--", "ls"]);
  const err = (r.err || "").replace(/\r/g, "");
  const m = /-->\s+\S+?:(\d+):\d+/.exec(err) || /\*\s+\S+?:(\d+), in </.exec(err);
  if (r.code === 0) return { name, ok: true, answer: JSON.parse(r.out) };
  const sb = sandbox("ask-rules-exec");
  writeUserConfig(sb, { port: 9 }, {}); // the fake provider is never reached: Codex stops while it loads the rules
  put(path.join(sb.codexHome, "rules", "default.rules"), text);
  const e = await runCodex(sb, ["exec", "--skip-git-repo-check", "-C", sb.work, "hello"], { cwd: sb.work });
  const em = /default\.rules:(\d+): /.exec((e.err || "").replace(/\r/g, ""));
  return { name, ok: false, line: m ? Number(m[1]) : null, execLine: em ? Number(em[1]) : null, execExit: e.code, message: err.split("\n").filter((l) => l.trim()).slice(0, 8).join(" | ").replace(/\S*file\d+\.rules/g, "<file>") };
}

export async function recordRules(progress = () => {}) {
  const { POLICIES, FILES, cases } = await import("./rules-table.mjs");
  const world = await rulesWorld();
  const out = { ...stamp(), policies: {}, cases: [], files: [] };
  for (const [name, p] of Object.entries(POLICIES)) out.policies[name] = p.text;
  out.cases = await pool(cases(), PARALLEL, async (c) => { const r = await askRulesCase(world, c); progress(true); return r; });
  out.files = await pool(Object.entries(FILES), PARALLEL, async ([name, text], i) => { const r = await askRulesFile(world, name, text, i); progress(r.ok); return r; });
  return out;
}

// ---- schema ----------------------------------------------------------------------------------------------------------------

// Codex's app server lists the keys it ignores in a configWarning notification when it reads the files; the keys it names are the unknown ones.
const unrecognized = (notifications) => {
  const keys = [];
  for (const n of notifications) {
    if (n.method !== "configWarning") continue;
    const s = (n.params && n.params.summary) || "";
    if (!/unrecognized configuration setting/.test(s)) continue;
    for (const m of s.matchAll(/`([^`]+)` is ignored/g)) keys.push(m[1]);
  }
  return keys.sort();
};

/** Reads a config.toml through the app server: { ok: true, unrecognized: [keys] } or { ok: false, error, stderr }. */
export async function warningsFor(toml) {
  const sb = sandbox("ask-schema");
  // the folders that some keys name are inside the sandbox (forward slashes are a path on every system)
  fs.writeFileSync(sb.user, toml.split("@SANDBOX@").join(sb.root.split(path.sep).join("/")));
  const s = new AppServer(sb, { cwd: sb.work, online: true });
  try {
    await s.start();
    await s.request("config/read", { cwd: sb.work, includeLayers: false });
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true, unrecognized: unrecognized(s.notifications) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 700), stderr: s.stderr.split("\n").filter((l) => l.trim() && !/^WARNING: proceeding/.test(l)).slice(0, 4).join(" | ").slice(0, 300) };
  } finally { await s.close(); }
}

/** Whether Codex refuses a value of the wrong type for a key: { path, type, value, refused, message }. */
export async function askWrong(schemaPath, type, value) {
  const { wrongToml } = await import("./schema-table.mjs");
  const sb = sandbox("ask-wrong");
  fs.writeFileSync(sb.user, wrongToml(schemaPath, value));
  const r = await promptInput(sb, {});
  return { path: schemaPath, type, value, refused: r.code !== 0, message: r.code === 0 ? null : (r.err || "").split("\n").filter((l) => l.trim())[0].replace(/^Error:\s*/, "").replace(/\S*config\.toml:\d+:\d+:\s*/, "").slice(0, 160) };
}

export async function recordSchema(progress = () => {}, { only } = {}) {
  const { TYPOS, groups, leaves, wrongSamples } = await import("./schema-table.mjs");
  const out = { ...stamp(), groups: [], typos: [], wrong: [] };
  out.groups = await pool(groups(), PARALLEL, async (g) => { const r = await warningsFor(g.toml); progress(r.ok); return { name: g.name, covers: g.covers.length, ...r }; });
  if (only === "groups") return out;
  out.typos = await pool(TYPOS, PARALLEL, async (t) => { const r = await warningsFor(t); progress(true); return { toml: t, ...r }; });
  const jobs = [];
  for (const { path: p, type } of leaves()) for (const bad of wrongSamples(type)) jobs.push([p, type, bad]);
  out.wrong = await pool(jobs, PARALLEL, async ([p, type, bad]) => { const r = await askWrong(p, type, bad); progress(true); return r; });
  return out;
}

// ---- agents ----------------------------------------------------------------------------------------------------------------

/** The AGENTS.md message Codex builds in a world of the agents table: { name, present, bytes, chars, sha256, head, tail }. */
export async function askAgents(s) {
  const { bytesOf } = await import("./agents-table.mjs");
  const sb = sandbox("ask-agents");
  if (s.git !== false) fs.mkdirSync(path.join(sb.work, ".git"), { recursive: true });
  for (const [rel, content] of Object.entries(s.files)) {
    const file = rel.startsWith("home:") ? path.join(sb.codexHome, rel.slice(5)) : path.join(sb.work, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytesOf(content));
  }
  if (s.config) fs.writeFileSync(sb.user, s.config);
  const cwd = s.cwd ? path.join(sb.work, s.cwd) : sb.work;
  fs.mkdirSync(cwd, { recursive: true });
  const r = await promptInput(sb, { cwd });
  if (r.code !== 0) throw new Error(`${s.name}: ${r.err}`);
  const text = r.agents === null ? null : r.agents.split(cwd).join("<cwd>");
  return { name: s.name, present: text !== null, ...(text === null ? {} : { bytes: Buffer.byteLength(text), chars: text.length, sha256: crypto.createHash("sha256").update(text).digest("hex"), head: text.slice(0, 60), tail: text.slice(-60) }) };
}

export async function recordAgents(progress = () => {}) {
  const { SCENARIOS } = await import("./agents-table.mjs");
  const scenarios = await pool(SCENARIOS, PARALLEL, async (s) => { const r = await askAgents(s); progress(true); return r; });
  return { ...stamp(), scenarios };
}

// ---- hooks (the app server) -----------------------------------------------------------------------------------------------

/** The hooks Codex lists in a world of the hooks table, with their keys, hashes and trust statuses. */
export async function askHooks(s) {
  const { records } = await import("./hooks-table.mjs");
  const sb = sandbox("ask-hooks");
  gitInit(sb);
  const trustText = s.trustProject ? `[projects.'${sb.work}']\ntrust_level = "trusted"\n` : "";
  const write = (state = "") => { fs.writeFileSync(sb.user, `${state}${trustText}${s.user ? `\n${s.user}` : ""}`); };
  write();
  if (s.userJson) put(path.join(sb.codexHome, "hooks.json"), s.userJson);
  if (s.project) put(path.join(sb.work, ".codex", "config.toml"), s.project);
  if (s.projectJson) put(path.join(sb.work, ".codex", "hooks.json"), s.projectJson);
  const list = async () => {
    const srv = new AppServer(sb, { cwd: sb.work, online: true });
    try { await srv.start(); const r = await srv.request("hooks/list", { cwds: [sb.work] }); return r.data[0]; } finally { await srv.close(); }
  };
  const first = await list();
  const recs = records(s.state, first.hooks);
  if (recs.length) {
    const stateText = recs.map((r) => `[hooks.state.${JSON.stringify(r.key)}]\ntrusted_hash = ${JSON.stringify(r.trusted_hash)}\n${r.enabled === false ? "enabled = false\n" : ""}`).join("\n");
    write(`${stateText}\n`);
  }
  const second = recs.length ? await list() : first;
  return {
    name: s.name,
    stateEntries: recs.map((r) => ({ key: norm(r.key, sb.root), trusted_hash: r.trusted_hash, enabled: r.enabled })),
    errors: second.errors.length,
    warnings: second.warnings.map((w) => norm(w, sb.root)),
    hooks: second.hooks.map((h) => ({ key: norm(h.key, sb.root), event: h.eventName, handler: h.handlerType, matcher: h.matcher, command: h.command || null, timeoutSec: h.timeoutSec, async: h.async === undefined ? null : h.async, statusMessage: h.statusMessage || null, source: h.source, sourcePath: norm(h.sourcePath, sb.root), enabled: h.enabled, hash: h.currentHash, status: h.trustStatus })),
  };
}

export async function recordHooks(progress = () => {}) {
  const { SCENARIOS } = await import("./hooks-table.mjs");
  const scenarios = await pool(SCENARIOS, PARALLEL, async (s) => { const r = await askHooks(s); progress(true); return r; });
  return { ...stamp(), scenarios };
}

// ---- layers (the app server) ----------------------------------------------------------------------------------------------

/** The layers Codex loads in a world of the layers table, what each key came from and the warnings it sent; null for a world that cannot be asked. */
export async function askLayers(s) {
  const { KEYS } = await import("./layers-table.mjs");
  if (s.noAppServer) return null;
  const sb = sandbox("ask-layers");
  gitInit(sb);
  if (s.hg) fs.mkdirSync(path.join(sb.work, ".hg"), { recursive: true });
  const cwd = s.cwd ? path.join(sb.work, s.cwd) : sb.work;
  fs.mkdirSync(cwd, { recursive: true });
  const where = { root: sb.work, cwd, parent: path.dirname(sb.work), a: path.join(sb.work, "a"), "a/b": path.join(sb.work, "a", "b") };
  const spell = (p, style) => (style === "forward" ? p.replace(/\\/g, "/") : style === "trailing" ? `${p}${path.sep}` : style === "upper" ? p.toUpperCase() : style === "hint" ? p.toLowerCase() : style === "unc" ? `\\\\?\\${p}` : p);
  const trust = (s.trust || []).map((t) => `[projects.'${spell(where[t.of], t.style)}']\ntrust_level = "${t.level}"\n`).join("\n");
  fs.writeFileSync(sb.user, `${s.user || ""}\n${trust}`);
  for (const [rel, text] of Object.entries(s.project || {})) put(path.join(sb.work, rel, ".codex", "config.toml"), text);
  const srv = new AppServer(sb, { cwd, online: true });
  try {
    await srv.start();
    const cfg = await srv.request("config/read", { cwd, includeLayers: true });
    const probes = [...KEYS, ...(s.probes || [])];
    const get = (obj, key) => key.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
    const layers = cfg.layers.filter((l) => l.name.type !== "system").map((l) => ({ type: l.name.type, path: norm(l.name.file || l.name.dotCodexFolder || "", sb.root), disabled: Boolean(l.disabledReason) }));
    const values = [];
    for (const key of probes) {
      // the origin of an array is listed for its first element (key.0)
      const o = cfg.origins[key] || cfg.origins[`${key}.0`];
      if (!o) continue;
      values.push({ key, value: get(cfg.config, key), origin: { type: o.name.type, path: norm(o.name.file || o.name.dotCodexFolder || "", sb.root) } });
    }
    return { name: s.name, layers, values, warnings: srv.notifications.filter((n) => n.method === "configWarning" && !isMachineNoise(n.params.summary)).map((n) => norm(n.params.summary, sb.root)) };
  } catch (e) {
    return { name: s.name, error: String(e.message || e).slice(0, 200), stderr: srv.stderr.slice(0, 300) };
  } finally { await srv.close(); }
}

export async function recordLayers(progress = () => {}) {
  const { SCENARIOS } = await import("./layers-table.mjs");
  const usable = SCENARIOS.filter((s) => !s.noAppServer && (!s.windowsOnly || process.platform === "win32"));
  const scenarios = (await pool(usable, PARALLEL, async (s) => { const r = await askLayers(s); progress(true); return r; })).filter(Boolean);
  return { ...stamp(), scenarios };
}
