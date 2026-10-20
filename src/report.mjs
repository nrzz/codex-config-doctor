// The reports: text, JSON and markdown for each command. A report is built from the collected facts and says nothing that was not read.
import { CATALOG } from "./catalog.mjs";
import { VERSION } from "./version.mjs";
import { dottedKey } from "./layers.mjs";

export const MARKDOWN_MAX_FINDINGS = 12;
export const MARKDOWN_LINE_CHARS = 500;

const n = (x) => x.toLocaleString("en-US");
const pad = (s, w) => String(s) + " ".repeat(Math.max(0, w - String(s).length));
const short = (s, w) => (String(s).length > w ? `${String(s).slice(0, Math.max(0, w - 3))}...` : String(s));
const indent = (text, by) => String(text).split("\n").map((l, i) => (i === 0 ? l : `${" ".repeat(by)}${l}`)).join("\n");

function show1(value) {
  if (typeof value === "string") return short(JSON.stringify(value), 70);
  if (Array.isArray(value)) return short(JSON.stringify(value), 70);
  return short(JSON.stringify(value), 70);
}

// ---- show -------------------------------------------------------------------------------------------------------------------

export function showDoc(c) {
  const w = c.world;
  const layers = w.layers.map((l, i) => ({
    index: i + 1, kind: l.kind, path: l.path, status: l.status, applies: Boolean(l.applies), bytes: l.bytes || 0,
    keys: l.entries ? new Set(l.entries.map((e) => e.path.join("\u0000"))).size : 0,
    trusted: l.kind === "project" ? Boolean(l.trusted) : null,
    reason: l.kind === "project" && l.status === "skipped" ? `the project is not trusted (${w.trust.dir.level === null ? "no entry in projects" : `trust_level ${w.trust.dir.level}`})` : null,
    error: l.error || null,
    ignoredKeys: l.ignoredKeys || [],
  }));
  const config = c.leaves.map((lf) => {
    const layer = c.applying[0] && lfLayer(c, lf);
    return { key: dottedKey(lf.path), value: lf.value, layer: layer ? layer.kind : null, file: layer ? layer.path : null };
  });
  return {
    ok: !(w.codexHome.problem || w.layers.some((l) => l.status === "broken")),
    tool: "codex-config-doctor", version: VERSION, command: "show",
    platform: c.sys.platform,
    project: w.dir,
    codexHome: { dir: w.codexHome.dir, source: w.codexHome.source, problem: w.codexHome.problem },
    profile: w.profile ? { name: w.profile.name, path: w.profile.path, exists: w.profile.exists } : null,
    trust: { level: w.trust.dir.level !== null ? w.trust.dir.level : w.trust.root ? w.trust.root.level : null, by: w.trust.dir.level !== null ? "this folder" : w.trust.root && w.trust.root.level !== null ? "the Git root" : null, entry: w.trust.dir.entry || (w.trust.root && w.trust.root.entry) || null, key: w.trust.key, gitRoot: w.gitRoot, projectRoot: w.projectRoot, projectRootMarker: w.projectRootMarker },
    layers,
    requirements: { path: w.requirements.path, status: w.requirements.status, keys: w.requirements.entries ? w.requirements.entries.length : 0 },
    config,
    ignoredInProject: w.layers.filter((l) => l.kind === "project" && l.ignoredKeys && l.ignoredKeys.length).map((l) => ({ file: l.path, keys: l.ignoredKeys, applies: Boolean(l.applies) })),
    effective: c.effective,
    agents: agentsSummary(c.agents),
    rules: { count: c.rules.rules.length, files: c.rules.files.map((f) => ({ path: f.path, layer: f.layerKind, skipped: f.skipped, ok: f.ok, count: f.rules.length, error: f.error })) },
    hooks: { featureOff: c.hooks.featureOff, bothFormats: c.hooks.bothFormats, items: c.hooks.hooks.map((h) => ({ event: h.event, matcher: h.matcher, source: h.source, format: h.format, type: h.type || null, command: h.command || null, server: h.server || null, tool: h.tool || null, timeout: h.timeout || null, key: h.key, hash: h.hash || null, status: h.status, runs: Boolean(h.runs) })) },
    mcp: c.mcp.map((s) => ({ id: s.id, transport: s.transport, command: s.command, url: s.url, enabled: s.enabled, required: s.required, found: s.resolved ? s.resolved.found : null, path: s.resolved ? s.resolved.path : null, startupTimeoutSec: s.startupTimeoutSec })),
    provider: { selected: c.provider.selected, defined: c.provider.selectedDefined, builtIn: c.provider.builtIn, providers: c.provider.list.map((p) => ({ id: p.id, baseUrl: p.baseUrl, wireApi: p.wireApi, envKey: p.envKey, envKeySet: p.envKeySet })) },
    windows: c.windows.applicable ? { selection: c.windows.selection, how: c.windows.selectionHow, sandboxMode: c.windows.sandboxMode, build: c.windows.build, mxcBuild: c.windows.mxcBuild, log: c.windows.log } : null,
  };
}

function lfLayer(c, lf) {
  return lf.layerIndex === undefined ? null : c.merged.layers[lf.layerIndex];
}

function agentsSummary(a) {
  return {
    cap: a.cap, total: a.total, chars: a.chars, bytes: a.bytesOfText, root: a.root,
    global: a.global ? { path: a.global.path, bytes: a.global.bytes } : null,
    files: a.files.map((f) => ({ path: f.path, bytes: f.bytes, status: f.status, includedBytes: f.includedBytes, cutBytes: f.cutBytes })),
    shadowed: a.shadowed,
  };
}

export function showText(c, doc) {
  const w = c.world;
  const L = [];
  L.push(`codex-config-doctor ${VERSION}  what Codex will do with this configuration`);
  L.push(`project   ${w.dir}`);
  L.push(`codex     ${w.codexHome.dir}  (${w.codexHome.source === "CODEX_HOME" ? "CODEX_HOME" : "the default, ~/.codex"})${w.codexHome.problem ? `  PROBLEM: ${w.codexHome.problem === "missing" ? "that folder does not exist" : "that is not a folder"}` : ""}`);
  if (w.profile) L.push(`profile   ${w.profile.name}  ${w.profile.path}  (${w.profile.exists ? "found" : "NOT FOUND: Codex starts without it, in silence"})`);
  const t = doc.trust;
  L.push(`trust     ${t.level === "trusted" ? `trusted, by the entry for ${t.by} (${t.entry})` : t.level === "untrusted" ? `untrusted, by the entry for ${t.by} (${t.entry})` : "not trusted: no entry in [projects] for this folder or its Git root"}`);
  L.push(`root      ${w.projectRoot ? `${w.projectRoot}  (found by ${w.projectRootMarker})` : "no project root found: only the working folder is looked at"}${w.gitRoot && w.gitRoot !== w.projectRoot ? `  Git root ${w.gitRoot}` : ""}`);
  L.push("");
  L.push("Layers, the one that wins first");
  const wk = Math.max(...doc.layers.map((l) => l.kind.length), 7);
  const wp = Math.max(...doc.layers.map((l) => l.path.length), 20);
  for (const l of doc.layers) {
    const state = l.status === "read" ? "read" : l.status === "skipped" ? "skipped" : l.status === "missing" ? "missing" : l.status === "broken" ? "BROKEN" : l.status;
    const extra = l.status === "read" ? `${l.keys} key${l.keys === 1 ? "" : "s"}, ${n(l.bytes)} bytes` : l.status === "skipped" ? `${l.reason}${l.error ? `; it also does not parse (line ${l.error.line}): ${l.error.message}` : ""}` : l.status === "broken" ? `${l.error.message} (line ${l.error.line})` : "";
    L.push(`  ${l.index}  ${pad(l.kind, wk)}  ${pad(l.path, wp)}  ${pad(state, 8)}${extra}`);
    if (l.ignoredKeys.length) L.push(`     ${" ".repeat(wk + 2)}ignored here, with a warning: ${l.ignoredKeys.join(", ")}`);
  }
  L.push(`     requirements.toml  ${doc.requirements.path}  ${doc.requirements.status}${doc.requirements.status === "read" ? ` (${doc.requirements.keys} keys; this tool lists it and does not merge it)` : ""}`);
  L.push("");
  L.push(`What Codex uses: ${c.leaves.length} settings`);
  if (c.leaves.length) {
    const wkey = Math.min(48, Math.max(...doc.config.map((x) => x.key.length)));
    const wval = Math.min(40, Math.max(...doc.config.map((x) => show1(x.value).length)));
    for (const x of doc.config) L.push(`  ${pad(short(x.key, wkey), wkey)}  ${pad(show1(x.value), wval)}  ${x.layer || "?"}`);
  }
  const e = c.effective;
  const unset = [];
  if (c.value.approval_policy === undefined) unset.push(`approval_policy ${e.approval}`);
  if (!e.sandboxAsked) unset.push(`sandbox_mode ${e.sandbox}`);
  if (unset.length) L.push(`  (not set, so Codex uses its defaults: ${unset.join("; ")})`);
  L.push("");
  const a = doc.agents;
  L.push(`AGENTS.md: ${a.chars ? `${n(a.chars)} characters reach the model` : "nothing reaches the model"}; the cap is ${n(a.cap)} bytes`);
  if (a.global) L.push(`  global   ${a.global.path}  ${n(a.global.bytes)} bytes (not counted against the cap)`);
  let running = 0;
  for (const f of a.files) {
    running += f.includedBytes;
    L.push(`  ${f.status === "included" ? "included" : f.status === "cut" ? "CUT" : f.status === "left-out" ? "LEFT OUT" : "empty"}  ${f.path}  ${n(f.bytes)} bytes${f.status === "cut" ? `, ${n(f.includedBytes)} read` : ""}  (${n(running)} of ${n(a.cap)})`);
  }
  if (!a.global && !a.files.length) L.push("  no AGENTS.md or AGENTS.override.md found");
  L.push("");
  L.push(`Rules: ${doc.rules.count} rule${doc.rules.count === 1 ? "" : "s"} in ${doc.rules.files.length} file${doc.rules.files.length === 1 ? "" : "s"}`);
  for (const f of doc.rules.files) L.push(`  ${f.skipped ? "skipped (untrusted project)" : f.ok ? `${f.count} rule${f.count === 1 ? "" : "s"}` : f.error.kind === "unsupported" ? "not run (see lint)" : "DOES NOT LOAD"}  ${f.path}`);
  L.push("");
  L.push(`Hooks: ${doc.hooks.items.length}${doc.hooks.featureOff ? " (features.hooks is false: none runs)" : ""}`);
  for (const h of doc.hooks.items) L.push(`  ${pad(h.status, 9)}  ${h.event}${h.matcher ? ` ${h.matcher}` : ""}  ${h.type === "command" ? short(h.command, 60) : h.type === "mcp_tool" ? `${h.server}.${h.tool}` : h.type || "?"}  (${h.format === "json" ? "hooks.json" : "config.toml"} in ${c.sys.path.dirname(h.source)})`);
  for (const b of doc.hooks.bothFormats) L.push(`  both formats in one layer: ${b.json} and ${b.toml}`);
  L.push("");
  L.push(`MCP servers: ${doc.mcp.length}`);
  for (const s of doc.mcp) L.push(`  ${s.id}  ${s.transport}${s.enabled ? "" : ", disabled"}${s.required ? ", required" : ""}  ${s.transport === "stdio" ? `${short(s.command, 40)}  ${s.found ? `found: ${s.path}` : "NOT FOUND on PATH"}` : s.url || ""}`);
  L.push("");
  const p = doc.provider;
  L.push(`Model provider: ${p.selected}${p.builtIn ? " (built in)" : p.defined ? "" : "  NOT DEFINED"}${c.effective.model ? `, model ${c.effective.model}` : ""}`);
  for (const q of p.providers) L.push(`  ${q.id}  ${q.baseUrl || "(no base_url: https://api.openai.com/v1)"}  wire_api ${q.wireApi}${q.envKey ? `  key from ${q.envKey}${q.envKeySet ? " (set)" : " (NOT SET here)"}` : ""}`);
  if (doc.windows) {
    const ws = doc.windows;
    L.push("");
    L.push(`Windows sandbox: ${ws.selection === "none" ? "none selected" : ws.selection} (${ws.how}); sandbox_mode ${ws.sandboxMode.effective}${ws.sandboxMode.downgraded ? ` (${ws.sandboxMode.wanted} asked for, read-only given: no sandbox to run it in)` : ""}; Windows build ${ws.build}${ws.log ? `; the sandbox log says: MXC availability ${ws.log.mxcAvailable}, selection ${ws.log.lastSelection}` : ""}`);
  }
  L.push("");
  L.push("Run `codex-config-doctor lint` for what is wrong with it.");
  return `${L.map((l) => l.trimEnd()).join("\n")}\n`;
}

// ---- lint -------------------------------------------------------------------------------------------------------------------

export function lintDoc(c, result) {
  return { ok: result.counts.error + result.counts.warning === 0, tool: "codex-config-doctor", version: VERSION, command: "lint", platform: c.sys.platform, project: c.world.dir, codexHome: c.world.codexHome.dir, profile: c.world.profile ? c.world.profile.name : null, counts: result.counts, findings: result.findings };
}

export function lintText(c, result) {
  const L = [];
  L.push(`codex-config-doctor ${VERSION}  lint`);
  L.push(`project   ${c.world.dir}`);
  L.push(`codex     ${c.world.codexHome.dir}${c.world.profile ? `   profile ${c.world.profile.name}` : ""}`);
  L.push("");
  if (!result.findings.length) L.push("Nothing to report.");
  for (const f of result.findings) {
    const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
    L.push(`${pad(f.severity.toUpperCase(), 8)}${f.id}${where ? `   ${where}` : ""}`);
    L.push(`  ${indent(f.message, 2)}`);
    L.push(`  Codex: ${indent(f.effect, 9)}`);
    L.push(`  Fix:   ${indent(f.fix, 9)}`);
    L.push("");
  }
  L.push(`${result.counts.error} error${result.counts.error === 1 ? "" : "s"}, ${result.counts.warning} warning${result.counts.warning === 1 ? "" : "s"}, ${result.counts.note} note${result.counts.note === 1 ? "" : "s"}.${result.findings.length ? " `codex-config-doctor explain <id>` says what Codex does, line by line." : ""}`);
  return `${L.join("\n")}\n`;
}

/** The short form: at most 12 findings, 500 characters a line, for people who paste it into an agent. */
export function lintMarkdown(c, result) {
  const L = [];
  L.push(`## codex-config-doctor lint: ${c.world.dir}`);
  const shown = result.findings.slice(0, MARKDOWN_MAX_FINDINGS);
  for (const f of shown) {
    const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : "";
    const fixLines = f.fix.split("\n");
    const fix = fixLines.length > 1 ? `${fixLines[0].replace(/:$/, "")} (the lines to add: run \`codex-config-doctor lint\`)` : fixLines[0];
    const head = `- ${f.severity.toUpperCase()} ${f.id}${where}: `;
    const tail = ` Fix: ${short(fix, 200)}`;
    const msg = f.message.replace(/\s*\n\s*/g, " ");
    const room = MARKDOWN_LINE_CHARS - head.length - tail.length;
    L.push(`${head}${room >= msg.length ? msg : short(msg, Math.max(20, room))}${tail}`.slice(0, MARKDOWN_LINE_CHARS));
  }
  if (!result.findings.length) L.push("- Nothing to report.");
  if (result.findings.length > shown.length) L.push(`- ... and ${result.findings.length - shown.length} more (run \`codex-config-doctor lint\`)`);
  return `${L.join("\n")}\n`;
}

/** The most characters a markdown report can have. */
export function markdownBound(projectLength = 0) {
  return `## codex-config-doctor lint: `.length + projectLength + 1 + MARKDOWN_MAX_FINDINGS * (MARKDOWN_LINE_CHARS + 1) + `- ... and 999 more (run \`codex-config-doctor lint\`)\n`.length;
}

// ---- why --------------------------------------------------------------------------------------------------------------------

export function whyDoc(c, r) {
  const { command, ...rest } = r;
  return { ok: !r.refused, tool: "codex-config-doctor", version: VERSION, command: "why", shellCommand: command, platform: c.sys.platform, project: c.world.dir, ...rest };
}

export function whyFileDoc(c, results, opts = {}) {
  const shell = results.length > 0 ? results[0].shell : (opts.shell || (c.sys.isWin ? "powershell" : "bash"));
  const settings = results.length > 0 ? results[0].settings : {
    approval: c.effective.approval,
    sandbox: c.effective.sandbox,
    sandboxAsked: c.effective.sandboxAsked,
    windowsSandbox: c.windows.applicable ? c.windows.selection : null,
  };
  return {
    ok: !results.some((r) => r.refused),
    tool: "codex-config-doctor",
    version: VERSION,
    command: "why",
    platform: c.sys.platform,
    project: c.world.dir,
    shell,
    settings,
    results: results.map((r) => whyDoc(c, r)),
  };
}

export function whyFileText(c, results) {
  const lines = [];
  const counts = new Map();
  for (const r of results) {
    lines.push(`${r.outcome.padEnd(18)}${r.command}`);
    counts.set(r.outcome, (counts.get(r.outcome) || 0) + 1);
  }
  lines.push("");
  const total = results.length;
  const parts = [];
  for (const o of ["sandboxed", "unsandboxed", "outside-sandbox", "asks", "refused", "forbidden"]) {
    if (counts.has(o)) parts.push(`${counts.get(o)} ${o}`);
  }
  lines.push(`${total} ${total === 1 ? "command" : "commands"}${parts.length ? `: ${parts.join(", ")}.` : "."}`);
  return `${lines.join("\n")}\n`;
}

export function whyText(c, r) {
  const L = [];
  L.push(`codex-config-doctor ${VERSION}  why`);
  L.push(`command   ${r.command}`);
  L.push(`settings  approval_policy ${r.settings.approval}; sandbox_mode ${r.settings.sandbox}${r.settings.windowsSandbox ? `; Windows sandbox ${r.settings.windowsSandbox === "none" ? "not selected" : r.settings.windowsSandbox}` : ""}; shell ${r.shell}`);
  L.push("");
  L.push(r.headline);
  L.push("");
  L.push(`Judged as ${r.parts.length} command${r.parts.length === 1 ? "" : "s"}${r.split ? " (the script was split)" : r.plain ? "" : ` (not split: ${r.reason})`}:`);
  for (const p of r.parts) {
    L.push(`  ${p.tokens.map((t) => (/\s/.test(t) ? JSON.stringify(t) : t)).join(" ")}`);
    if (!p.matched.length) L.push("      no rule matches");
    for (const m of p.matched) {
      const ignored = p.ignored.includes(m) || p.ignored.some((x) => x.file === m.file && x.line === m.line);
      L.push(`      ${m.decision.padEnd(9)}[${m.matchedPrefix.map((t) => JSON.stringify(t)).join(", ")}]  ${m.file ? `${c.sys.path.basename(m.file)}:${m.line}` : ""}${m.justification ? `  ${JSON.stringify(m.justification)}` : ""}${ignored ? "  (Codex ignores this allow rule)" : ""}`);
    }
  }
  L.push("");
  for (const line of r.lines) L.push(`  (${line.source}) ${line.text}`);
  return `${L.join("\n")}\n`;
}

// ---- agents -----------------------------------------------------------------------------------------------------------------

export function agentsDoc(c) {
  const a = c.agents;
  return { ok: !a.firstShort, tool: "codex-config-doctor", version: VERSION, command: "agents", platform: c.sys.platform, project: c.world.dir, ...agentsSummary(a), tokens: Math.round((a.chars || 0) / 4), text: a.text };
}

export function agentsText(c) {
  const a = c.agents;
  const L = [];
  L.push(`codex-config-doctor ${VERSION}  agents`);
  L.push(`project   ${c.world.dir}${a.root ? `  (root ${a.root})` : "  (no project root: only this folder is looked at)"}`);
  L.push(`cap       project_doc_max_bytes ${n(a.cap)}${c.value.project_doc_max_bytes === undefined ? " (the default)" : ""}`);
  L.push("");
  if (a.global) L.push(`  global    ${a.global.path}  ${n(a.global.bytes)} bytes  included (not counted against the cap)`);
  let running = 0;
  a.files.forEach((f, i) => {
    running += f.includedBytes;
    const what = f.status === "included" ? "included" : f.status === "cut" ? `CUT: ${n(f.includedBytes)} of ${n(f.bytes)} bytes read, ${n(f.cutBytes)} lost` : f.status === "left-out" ? "LEFT OUT" : "skipped (no text)";
    L.push(`  ${String(i + 1).padStart(2)}        ${f.path}  ${n(f.bytes)} bytes  ${what}  [${n(running)} of ${n(a.cap)}]`);
  });
  for (const s of a.shadowed.filter((x) => x.reason === "same-folder")) L.push(`  not read  ${s.path}  (hidden by ${s.by})`);
  if (!a.global && !a.files.length) L.push("  no instruction files found");
  L.push("");
  L.push(a.text === null ? "Nothing reaches the model." : `The text the model gets: ${n(a.chars)} characters (${n(a.bytesOfText)} bytes), about ${n(Math.round(a.chars / 4))} tokens by characters / 4. \`agents --print\` prints it.`);
  return `${L.join("\n")}\n`;
}

// ---- cost -------------------------------------------------------------------------------------------------------------------

export function costDoc(c, r) {
  return { ok: true, tool: "codex-config-doctor", version: VERSION, command: "cost", platform: c.sys.platform, project: c.world.dir, rows: r.rows, total: r.total, totalTokens: r.totalTokens, yours: r.yours, yoursTokens: r.yoursTokens, recorded: r.recorded };
}

export function costText(c, r) {
  const L = [];
  L.push(`codex-config-doctor ${VERSION}  cost`);
  L.push(`project   ${c.world.dir}`);
  L.push(`What the first request of a session carries before your words. Tokens are characters / 4, an estimate.`);
  const system = { win32: "Windows", linux: "Linux", darwin: "macOS" }[r.recorded.system] || r.recorded.system;
  L.push(`"computed" comes from your files; "recorded" is what Codex ${r.recorded.codex} sent with model ${r.recorded.model} on ${system} (${r.recorded.on}) and moves with the version, the model and the system${r.recorded.exact ? "" : " (there is no recording for this system: these are the ones for " + system + ")"}.`);
  L.push("");
  const w = Math.max(...r.rows.map((x) => x.label.length));
  L.push(`  ${pad("", w)}  characters  tokens  source`);
  for (const x of r.rows) L.push(`  ${pad(x.label, w)}  ${pad(x.chars === null ? "-" : n(x.chars), 10)}  ${pad(x.chars === null ? "-" : n(Math.round(x.chars / 4)), 6)}  ${x.source}${x.detail ? `: ${x.detail}` : ""}`);
  L.push(`  ${pad("Total", w)}  ${pad(n(r.total), 10)}  ${pad(n(r.totalTokens), 6)}`);
  L.push("");
  L.push(`Yours (AGENTS.md and your skills): ${n(r.yours)} characters, about ${n(r.yoursTokens)} tokens, on every request of the session.`);
  return `${L.join("\n")}\n`;
}

// ---- explain ----------------------------------------------------------------------------------------------------------------

export function explainDoc(page) {
  return { ok: true, id: page.id, title: page.title, severity: page.severity, basis: page.basis, means: page.means, does: page.does.map(([source, text]) => ({ source, text })), fix: page.fix, docs: page.docs };
}

export function explainText(page) {
  const L = [];
  L.push(`${page.id}   ${page.title}  [${page.severity}, ${page.basis}]`);
  L.push("");
  L.push(page.means);
  L.push("");
  L.push("What Codex does");
  for (const [source, text] of page.does) L.push(`  - (${source}) ${text}`);
  L.push("");
  L.push("The fix");
  for (const f of page.fix) L.push(`  - ${f}`);
  if (page.docs && page.docs.length) {
    L.push("");
    L.push("Documentation");
    for (const d of page.docs) L.push(`  ${d}`);
  }
  return `${L.join("\n")}\n`;
}

export function explainListDoc(pages) {
  return { ok: true, findings: pages.map((p) => ({ id: p.id, title: p.title, severity: p.severity, basis: p.basis })) };
}

export function explainListText(pages) {
  const w = Math.max(...pages.map((p) => p.id.length));
  return `${pages.map((p) => `${pad(p.id, w)}  ${pad(p.severity, 7)} ${pad(p.basis, 6)} ${p.title}`).join("\n")}\n`;
}

export { CATALOG };
