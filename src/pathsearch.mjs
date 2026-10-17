// Finding a program the way Codex starts an MCP server: a name with no separator is looked up in PATH, a name with a separator is taken as
// a path (relative ones from the working folder). On Windows the extensions of PATHEXT are tried, so `tool` finds `tool.cmd` and `tool.bat`
// and a path without an extension finds the file with one; a `.ps1` script or a file with no extension is not a program (put to Codex 0.163.0
// on Windows: test/e2e-mcp.test.mjs). On Linux and macOS the file must have an execute bit.

/** Splits PATH (or PATHEXT) for the platform. */
export function splitList(sys, value) {
  if (!value) return [];
  return String(value).split(sys.isWin ? ";" : ":").map((x) => x.replace(/^"(.*)"$/, "$1")).filter((x) => x !== "");
}

function pathExts(sys) {
  const raw = sys.getEnv("PATHEXT");
  const list = raw ? splitList(sys, raw) : [".COM", ".EXE", ".BAT", ".CMD"];
  return list.map((e) => e.toLowerCase());
}

function probe(sys, base, name, exts) {
  const tries = [];
  const hasExt = exts.some((e) => name.toLowerCase().endsWith(e));
  if (sys.isWin) {
    if (hasExt) tries.push(base);
    for (const e of exts) tries.push(base + e);
  } else tries.push(base);
  for (const t of tries) {
    const st = sys.stat(t);
    if (st && st.isFile && (sys.isWin || st.executable)) return t;
  }
  return null;
}

/**
 * Looks a program up. Returns { found, path, how } where how is "path" (the name was a path) or "PATH" (the folder it was found in).
 * `cwd` is where a relative path starts (the session's working folder).
 */
export function which(sys, name, { cwd } = {}) {
  const text = String(name);
  if (text === "") return { found: false, path: null, how: null };
  const exts = pathExts(sys);
  const hasSep = sys.isWin ? /[\\/]/.test(text) : text.includes("/");
  if (hasSep || sys.path.isAbsolute(text)) {
    const abs = sys.path.isAbsolute(text) ? sys.path.normalize(text) : sys.path.normalize(sys.path.join(cwd || sys.cwd, text));
    const hit = probe(sys, abs, sys.path.basename(abs), exts);
    return { found: Boolean(hit), path: hit, how: "path" };
  }
  for (const dir of splitList(sys, sys.getEnv("PATH") || sys.getEnv("Path"))) {
    const hit = probe(sys, sys.path.join(dir, text), text, exts);
    if (hit) return { found: true, path: hit, how: "PATH" };
  }
  return { found: false, path: null, how: null };
}
