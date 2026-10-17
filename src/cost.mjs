// What the first request of a session carries before the user's words, and how much of it is yours. Figures marked `computed` come from your
// files and are exact (the AGENTS.md message and the skills block are put to the real Codex in test/e2e-cost.test.mjs, character for
// character); figures marked `recorded` are what Codex 0.163.0 sent with a default configuration (src/recorded.mjs) and move with
// the Codex version, the model and the feature flags. A token is estimated as four characters.
import {
  BASE_INSTRUCTIONS_CHARS, BY_SYSTEM, RECORDED_CODEX, RECORDED_MODEL, RECORDED_ON,
  MCP_TOOLS, SKILLS_BUNDLED, SKILLS_HEAD, SKILLS_LIST_HEAD, SKILLS_TAIL,
} from "./recorded.mjs";
import { SKILL_DESCRIPTION_CAP } from "./knowledge.mjs";

export const tokens = (chars) => Math.round(chars / 4);

/**
 * The figures that were recorded on the system the command runs on (win32, linux or darwin): the tool definitions, the permissions block and the
 * environment block differ from one system to another. Any other system takes the Linux figures; `exact` says whether they are its own.
 */
export function recordedFor(platform) {
  const key = BY_SYSTEM[platform] ? platform : BY_SYSTEM.linux ? "linux" : Object.keys(BY_SYSTEM)[0];
  return { system: key, exact: key === platform, ...BY_SYSTEM[key] };
}

/** The name and description of a SKILL.md, read the way Codex lists them (a front matter of simple YAML), or null when Codex would not list it. */
export function parseSkill(text, dirName) {
  const m = /^\ufeff?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const get = (key) => {
    const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    if (i < 0) return null;
    let v = lines[i].slice(key.length + 1).trim();
    if (v === ">" || v === "|" || v === ">-" || v === "|-") {
      const parts = [];
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) parts.push(lines[j].trim());
      return parts.join(" ");
    }
    const parts = [v];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) parts.push(lines[j].trim());
    v = parts.join(" ");
    if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) v = v.slice(1, -1);
    return v;
  };
  const description = get("description");
  if (description === null || description === "") return null;
  const name = get("name") || dirName;
  // a description of more than 1,024 characters is listed as its first 1,021 characters and "..." (characters, not bytes: put to Codex 0.163.0)
  const chars = Array.from(description);
  return { name, description: chars.length > SKILL_DESCRIPTION_CAP ? `${chars.slice(0, SKILL_DESCRIPTION_CAP - 3).join("")}...` : description };
}

/**
 * Every SKILL.md below a root: [{ rel, name, description }]. Codex looks in every folder below the root except those that start with a dot,
 * for a file named exactly SKILL.md (a SKILL.MD is not one, also on Windows), and lists it when it has a description.
 */
function scan(sys, root) {
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 6) return;
    const names = (sys.readdir(dir) || []).sort();
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = sys.path.join(dir, name);
      if (!sys.isDir(full)) continue;
      if ((sys.readdir(full) || []).includes("SKILL.md")) {
        const skill = parseSkill(sys.readText(sys.path.join(full, "SKILL.md")) || "", name);
        if (skill) out.push({ rel: `${rel}${name}/SKILL.md`, ...skill });
      }
      walk(full, `${rel}${name}/`, depth + 1);
    }
  };
  walk(root, "", 0);
  return out;
}

const fwd = (p) => String(p).split("\\").join("/");
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The skills block as Codex builds it (put to Codex 0.163.0, character for character, in test/e2e-cost.test.mjs). The table of roots lists, in
 * this order, the `.codex/skills` folder of each project folder from the working folder up to the project root, the Codex home's `skills`,
 * `~/.agents/skills`, the Codex home's `skills/.system` (where the four bundled skills are) and the `.agents/skills` folder of each project
 * folder from the root down to the working folder; a root that holds no skill is left out, except the bundled one. The list has the bundled
 * skills first, then the skills of the project folders (by name), then yours, those of the Codex home and of `~/.agents/skills` together (by
 * name). The folders that start with a dot are not read; the project's `.codex/skills` is read whether or not the project is trusted.
 * Returns { text, chars, yours: [..], roots: [..], bundled }.
 */
export function skillsBlock(sys, c) {
  const home = c.world.codexHome.dir;
  const projectRoot = c.world.projectRoot || c.world.dir;
  const chain = [];
  { let cur = c.world.dir; for (;;) { chain.unshift(cur); if (sys.path.relative(projectRoot, cur) === "") break; const up = sys.path.dirname(cur); if (up === cur) break; cur = up; } }
  const roots = [];
  const found = [];
  const consider = (dir, scope) => {
    const skills = sys.isDir(dir) ? scan(sys, dir) : [];
    if (!skills.length) return;
    const alias = `r${roots.length}`;
    roots.push({ alias, dir });
    for (const s of skills) found.push({ ...s, alias, scope });
  };
  for (const folder of [...chain].reverse()) consider(sys.path.join(folder, ".codex", "skills"), "project");
  consider(sys.path.join(home, "skills"), "user");
  consider(sys.path.join(sys.home, ".agents", "skills"), "user");
  const systemAlias = `r${roots.length}`;
  roots.push({ alias: systemAlias, dir: sys.path.join(home, "skills", ".system") });
  for (const folder of chain) consider(sys.path.join(folder, ".agents", "skills"), "project");
  const yours = [...found.filter((s) => s.scope === "project").sort(byName), ...found.filter((s) => s.scope === "user").sort(byName)];
  const bundled = SKILLS_BUNDLED.map((l) => l.replace("@R", systemAlias));
  const rootLines = roots.map((r) => `- \`${r.alias}\` = \`${fwd(r.dir)}\``);
  const own = yours.map((s) => `- ${s.name}: ${s.description} (file: ${s.alias}/${s.rel})`);
  const text = `${SKILLS_HEAD}${rootLines.join("\n")}\n${SKILLS_LIST_HEAD}${[...bundled, ...own].join("\n")}\n${SKILLS_TAIL}`;
  return { text, chars: text.length, yours, roots, bundled: bundled.length };
}

/** The environment block: recorded at a folder of a known length, and the folder's path appears twice (seven times with workspace-write). */
export function environmentChars(cwd, mode, platform) {
  const r = recordedFor(platform);
  const base = r.environment[mode] ?? r.environment["read-only"];
  const times = mode === "workspace-write" ? 7 : 2;
  return base + times * (cwd.length - r.cwdChars);
}

/** The permissions block: recorded at a working folder of a known length; the workspace-write block names the folder once. */
export function permissionsChars(cwd, approval, mode, platform) {
  const r = recordedFor(platform);
  const base = (r.permissions[approval] || r.permissions["on-request"])[mode] ?? r.permissions["on-request"]["read-only"];
  return mode === "workspace-write" ? base + (cwd.length - r.cwdChars) : base;
}

/**
 * The tool definitions of the first request: the recorded ones, with the web_search definition as the configuration makes it (put to Codex
 * 0.163.0): 89 characters for `cached`, which is the default outside danger-full-access; 88 for `live`, which is the default in
 * danger-full-access (there `cached` also gives the live one); 114 for `indexed`; and no definition at all for `disabled`.
 */
export function toolList(c) {
  const mode = typeof c.value.web_search === "string" ? c.value.web_search : null;
  const danger = c.effective.sandbox === "danger-full-access";
  const list = recordedFor(c.sys.platform).tools.map((t) => [...t]);
  const i = list.findIndex((t) => t[0] === "web_search");
  if (i >= 0) {
    if (mode === "disabled") list.splice(i, 1);
    else if (mode === "indexed") list[i][1] = 114;
    else if (mode === "live" || danger) list[i][1] = 88;
  }
  // an enabled MCP server, even one that does not start, adds three tools; one that starts adds its id to the description of tool_search
  const enabled = c.mcp.filter((s) => s.enabled && s.transport !== "invalid");
  if (enabled.length) {
    list.splice(list.findIndex((t) => t[0] === "write_stdin") + 1, 0, ...MCP_TOOLS.map((t) => [...t]));
    const search = list.find((t) => t[0] === "tool_search");
    if (search) for (const s of enabled) if (s.transport === "http" || (s.resolved && s.resolved.found)) search[1] += s.id.length + 4;
  }
  return list;
}

export function cost(c) {
  const sys = c.sys;
  const mode = c.effective.sandbox;
  const approval = c.effective.approval === "never" ? "never" : "on-request";
  const skills = skillsBlock(sys, c);
  const perm = permissionsChars(c.world.dir, approval, mode, sys.platform);
  // the definitions are a JSON array in the request: a comma between two and a bracket at each end
  const tools = toolList(c);
  const toolChars = tools.reduce((n, t) => n + t[1], 0) + tools.length + 1;
  const rows = [
    { id: "base", label: "Base instructions", chars: BASE_INSTRUCTIONS_CHARS, source: "recorded", detail: `Codex ${RECORDED_CODEX}, model ${RECORDED_MODEL}` },
    { id: "skills", label: "Skills", chars: skills.chars, source: skills.yours.length ? "computed" : "recorded", detail: `${skills.bundled} bundled skills${skills.yours.length ? ` and ${skills.yours.length} of yours (${skills.yours.map((s) => s.name).join(", ")})` : ""}; the how-to text is about 2,600 of the characters` },
    { id: "permissions", label: "Permissions", chars: perm, source: "recorded", detail: `approval ${c.effective.approval}, sandbox ${mode}` },
    { id: "agents", label: "AGENTS.md", chars: c.agents.chars, source: "computed", detail: c.agents.text === null ? "no AGENTS.md" : `${c.agents.files.length} project file${c.agents.files.length === 1 ? "" : "s"}${c.agents.global ? " and the global file" : ""}, ${c.agents.bytesOfText.toLocaleString("en-US")} bytes` },
    { id: "environment", label: "Environment", chars: environmentChars(c.world.dir, mode, sys.platform), source: "recorded", detail: "the folder, the shell, the date, the time zone and the sandbox; moves with the length of the folder's path (and by a few characters with the names of the shell and the time zone)" },
    { id: "tools", label: `Tool definitions (${tools.length})`, chars: toolChars, source: "recorded", detail: tools.map((t) => `${t[0]} ${t[1].toLocaleString("en-US")}`).join(", "), items: tools.map((t) => ({ name: t[0], chars: t[1] })) },
  ];
  const enabledServers = c.mcp.filter((s) => s.enabled);
  rows.push({ id: "mcp", label: `MCP servers (${enabledServers.length})`, chars: null, source: "not measured", detail: enabledServers.length ? `${enabledServers.map((s) => s.id).join(", ")}: the three resource tools they bring are counted under tool definitions; a server's own tools are not in the first request (Codex 0.163.0 defers them behind tool_search: 2, 3, 30 and 60 tools gave the same request), so they cost when the model loads them, which this tool does not measure because it starts no server` : "none configured" });
  const total = rows.reduce((n, r) => n + (r.chars || 0), 0);
  const yours = (c.agents.chars || 0) + skills.yours.reduce((n, s) => n + `- ${s.name}: ${s.description} (file: ${s.alias}/${s.rel})\n`.length, 0);
  return { rows, total, totalTokens: tokens(total), yours, yoursTokens: tokens(yours), recorded: { codex: RECORDED_CODEX, model: RECORDED_MODEL, on: recordedFor(sys.platform).on || RECORDED_ON, system: recordedFor(sys.platform).system, exact: recordedFor(sys.platform).exact }, skills };
}
