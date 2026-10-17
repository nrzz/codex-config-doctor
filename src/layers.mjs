// The configuration layers Codex loads for a project, in the order it applies them, and what each one is worth: read, missing,
// skipped (a project the user has not trusted) or broken. Put to Codex 0.163.0 (test/e2e-tables.test.mjs compares this with the
// app-server's `config/read`, and test/e2e-config.test.mjs puts the errors and the trust to `codex exec`):
//   - from the lowest layer to the highest: the system config.toml, the user's config.toml, the profile file (`--profile x` reads
//     x.config.toml next to config.toml), then the .codex/config.toml of each folder from the project root down to the working folder
//     (the closest wins);
//   - a project layer applies only when `projects.<path>.trust_level = "trusted"` is in the user config for that folder or for the Git root
//     of the project (the path is compared as the operating system spells it; on Windows without regard to case); a layer that is not
//     trusted is not opened, so it is not used, its hooks and rules are not either, and a syntax error in it does not stop Codex;
//   - ten keys are ignored in a project layer, with a warning;
//   - tables merge key by key; arrays and values are replaced.
import { IGNORED_IN_PROJECT } from "./knowledge.mjs";
import { parseToml } from "./toml.mjs";

/** The folder Codex keeps its files in: CODEX_HOME (when it is not empty), else ~/.codex. */
export function codexHome(sys) {
  const set = sys.getEnv("CODEX_HOME");
  if (set !== undefined && set !== "") {
    const dir = sys.resolve(set);
    const st = sys.stat(dir);
    return { dir, source: "CODEX_HOME", problem: !st ? "missing" : st.isDir ? null : "not-a-directory", given: set };
  }
  return { dir: sys.path.join(sys.home, ".codex"), source: "default", problem: null, given: null };
}

/** Where the system-wide files are: config.toml, requirements.toml, rules/. */
export function systemDir(sys) {
  if (sys.isWin) {
    const base = sys.getEnv("ProgramData") || sys.getEnv("ALLUSERSPROFILE") || "C:\\ProgramData";
    return sys.path.join(base, "OpenAI", "Codex");
  }
  return "/etc/codex";
}

/** A folder's path the way an entry of `projects` is written: as the system spells it (backslashes on Windows), without a trailing separator. */
export function trustPath(sys, dir) {
  const real = sys.realpath ? sys.realpath(dir) : dir;
  let p = sys.path.normalize(real);
  if (sys.isWin) p = p.replace(/^\\\\\?\\/, "");
  const root = sys.path.parse(p).root;
  if (p.length > root.length) p = p.replace(/[\\/]+$/, "");
  return p;
}

/** How Codex looks a folder up in `projects`: the folder's path as the system spells it, lower-cased on Windows. */
export function trustKey(sys, dir) {
  const p = trustPath(sys, dir);
  return sys.isWin ? p.toLowerCase() : p;
}

/** The nearest folder at or above `dir` that holds one of the markers (default .git), or null. */
export function findRoot(sys, dir, markers) {
  if (!markers.length) return null;
  let cur = dir;
  for (;;) {
    for (const m of markers) if (sys.exists(sys.path.join(cur, m))) return { root: cur, marker: m };
    const up = sys.path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/** The folders from `root` down to `dir`, root first. */
function chain(sys, root, dir) {
  const out = [];
  let cur = dir;
  for (;;) {
    out.push(cur);
    if (sys.path.relative(root, cur) === "") break;
    const up = sys.path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return out.reverse();
}

/** Reads one TOML layer file. */
function readLayer(sys, file) {
  const buf = sys.readFile(file);
  if (buf === null) return { exists: sys.exists(file), read: false, status: sys.exists(file) ? "unreadable" : "missing", bytes: 0 };
  const out = { exists: true, read: true, bytes: buf.length, status: "read" };
  // UTF-16 or anything that is not UTF-8: Codex stops with "invalid utf-8 sequence"
  const text = Buffer.from(buf).toString("utf8");
  if (text.includes("\ufffd") && Buffer.from(text, "utf8").length !== buf.length) {
    out.status = "broken";
    out.error = { kind: "encoding", message: buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) ? "the file is UTF-16, not UTF-8" : "the file is not valid UTF-8", line: 1, column: 1 };
    out.text = text;
    return out;
  }
  out.text = text;
  const parsed = parseToml(text);
  if (!parsed.ok) { out.status = "broken"; out.error = { kind: "toml", ...parsed.error }; return out; }
  out.value = parsed.value;
  out.entries = parsed.entries;
  out.tables = parsed.tables;
  out.hasBom = text.charCodeAt(0) === 0xfeff;
  return out;
}

const topKeys = (layer) => (layer.entries ? [...new Set(layer.entries.map((e) => e.path[0]))] : []);

/**
 * Discovers and reads the layers for a project.
 *   opts: { project (a folder; default the working folder), profile (a name or undefined) }
 */
export function discover(sys, opts = {}) {
  const dir = sys.resolve(opts.project === undefined ? sys.cwd : opts.project);
  const home = codexHome(sys);
  const system = systemDir(sys);
  const layers = []; // lowest first while building
  const add = (layer) => { layers.push(layer); return layer; };

  const systemLayer = add({ kind: "system", label: "system config.toml", path: sys.path.join(system, "config.toml"), scope: system, ...readLayer(sys, sys.path.join(system, "config.toml")) });
  const userLayer = add({ kind: "user", label: "user config.toml", path: sys.path.join(home.dir, "config.toml"), scope: home.dir, ...readLayer(sys, sys.path.join(home.dir, "config.toml")) });
  let profile = null;
  if (opts.profile !== undefined && opts.profile !== null && opts.profile !== "") {
    const name = String(opts.profile);
    const file = sys.path.join(home.dir, `${name}.config.toml`);
    const valid = /^[A-Za-z0-9_-]+$/.test(name);
    const layer = add({ kind: "profile", label: `profile ${name}`, path: file, scope: home.dir, profileName: name, validName: valid, ...(valid ? readLayer(sys, file) : { exists: false, read: false, status: "missing", bytes: 0 }) });
    profile = { name, path: file, exists: layer.exists, valid, layer };
  }

  // settings that decide where the project layers are, and whether they apply: read from the layers below the project
  const lower = layers.filter((l) => l.status === "read");
  const merged = mergeLayers(lower, {}).value;
  const markers = Array.isArray(merged.project_root_markers) && merged.project_root_markers.every((m) => typeof m === "string") ? merged.project_root_markers : [".git"];
  const found = findRoot(sys, dir, markers);
  const gitFound = findRoot(sys, dir, [".git"]);
  const projectRoot = found ? found.root : null;
  const projects = merged.projects && typeof merged.projects === "object" ? merged.projects : {};
  const trustOf = (folder) => {
    const key = trustKey(sys, folder);
    for (const [k, v] of Object.entries(projects)) if (trustKeyOfEntry(sys, k) === key && v && typeof v === "object") return { level: v.trust_level || null, entry: k, key };
    return { level: null, entry: null, key };
  };
  const dirTrust = trustOf(dir);
  const rootTrust = gitFound ? trustOf(gitFound.root) : null;

  const folders = projectRoot ? chain(sys, projectRoot, dir) : [dir];
  const projectLayers = folders.map((folder) => {
    const own = trustOf(folder);
    const decision = own.level !== null ? { level: own.level, by: "this folder", entry: own.entry } : rootTrust && rootTrust.level !== null ? { level: rootTrust.level, by: "the Git root", entry: rootTrust.entry } : { level: null, by: null, entry: null };
    const dotCodex = sys.path.join(folder, ".codex");
    const file = sys.path.join(dotCodex, "config.toml");
    const trusted = decision.level === "trusted";
    const layer = { kind: "project", label: `project ${folder}`, path: file, scope: folder, dotCodex, trusted, trust: decision, ...readLayer(sys, file) };
    layer.hasDotCodex = sys.isDir(dotCodex);
    layer.ignoredKeys = layer.entries ? IGNORED_IN_PROJECT.filter((k) => topKeys(layer).includes(k)) : [];
    return layer;
  });
  // closest folder wins: lowest precedence is the project root
  for (const l of projectLayers) add(l);

  // highest precedence first
  const ordered = [...layers].reverse();
  for (const l of ordered) {
    if (l.kind === "project") {
      l.applies = l.status === "read" && l.trusted;
      // Codex does not open an untrusted project's file: a syntax error in it is not met until the folder is trusted (put to Codex 0.163.0)
      if ((l.status === "read" || l.status === "broken") && !l.trusted) {
        if (l.status === "broken") l.brokenWhenTrusted = true;
        l.status = "skipped";
      }
    } else l.applies = l.status === "read";
  }
  const requirementsPath = sys.path.join(system, "requirements.toml");
  const requirements = { path: requirementsPath, ...readLayer(sys, requirementsPath) };
  return {
    dir,
    codexHome: home,
    systemDir: system,
    profile,
    markers,
    projectRoot,
    projectRootMarker: found ? found.marker : null,
    gitRoot: gitFound ? gitFound.root : null,
    trust: { dir: dirTrust, root: rootTrust, key: dirTrust.key, rootKey: rootTrust ? rootTrust.key : null },
    layers: ordered,
    requirements,
  };
}

/** The key a `projects` entry of the user config stands for: its text, lower-cased on Windows. */
export function trustKeyOfEntry(sys, entryKey) {
  let p = String(entryKey);
  if (sys.isWin) p = p.toLowerCase();
  return p;
}

const isTable = (v) => v && typeof v === "object" && !Array.isArray(v);

/**
 * Merges layers (lowest first) the way Codex does: tables key by key, everything else replaced. Returns { value, origins }, where
 * origins maps a dotted path to the index (in `layers`) of the layer that last set it. A project layer leaves out the keys Codex ignores there.
 */
export function mergeLayers(layers, _unused) {
  const value = {};
  const origins = new Map();
  layers.forEach((layer, index) => {
    if (!layer.value) return;
    const skip = layer.kind === "project" ? new Set(IGNORED_IN_PROJECT) : new Set();
    const walk = (src, dst, path) => {
      for (const [k, v] of Object.entries(src)) {
        if (path.length === 0 && skip.has(k)) continue;
        const here = [...path, k];
        if (isTable(v)) {
          if (!isTable(dst[k])) dst[k] = {};
          walk(v, dst[k], here);
        } else {
          dst[k] = v;
          origins.set(here.join("\u0000"), index);
        }
      }
    };
    walk(layer.value, value, []);
  });
  return { value, origins, layers };
}

/** Every leaf of a merged value: [{ path, value, layerIndex }]. */
export function leaves(merged) {
  const out = [];
  const walk = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      const here = [...path, k];
      if (isTable(v) && Object.keys(v).length) walk(v, here);
      else out.push({ path: here, value: v, layerIndex: merged.origins.get(here.join("\u0000")) });
    }
  };
  walk(merged.value, []);
  return out;
}

/** A dotted key for display: a part that is not a bare key is quoted. */
export const dottedKey = (path) => path.map((p) => (/^[A-Za-z0-9_-]+$/.test(String(p)) ? String(p) : JSON.stringify(String(p)))).join(".");
