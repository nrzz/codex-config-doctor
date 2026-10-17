// A pretend machine for the tests: a platform, an environment, a working folder, a home folder and a table of files, with the same
// interface as makeSys() in src/sys.mjs. Windows machines compare paths without regard to case, as Windows does, and use the
// Windows path rules on any host. Nothing here touches the disk.
import path from "node:path";
import { decode } from "../src/sys.mjs";

/**
 *   fakeSys({ platform: "win32" | "linux" | "darwin", env, cwd, home, files: { path: text | Buffer }, dirs: [path], release })
 * The home folder, the working folder and every parent folder of a file are made folders. `env` entries with an undefined value are absent.
 */
export function fakeSys({ platform = "linux", env = {}, cwd, home, files = {}, dirs = [], release } = {}) {
  const isWin = platform === "win32";
  const p = isWin ? path.win32 : path.posix;
  const homeDir = home || (isWin ? "C:\\Users\\me" : "/home/me");
  const work = cwd || (isWin ? "C:\\Users\\me\\proj" : "/home/me/proj");
  const environment = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) environment[k] = v;
  const table = new Map();
  const key = (f) => { const n = p.normalize(f).replace(/[\\/]+$/, (m, off, s) => (s.length === m.length || /^[A-Za-z]:$/.test(s.slice(0, off)) ? m : "")); return isWin ? n.toLowerCase() : n; };
  const addDir = (d) => {
    let cur = p.normalize(d);
    for (;;) {
      const k = key(cur);
      if (!table.has(k)) table.set(k, { kind: "dir", name: cur });
      const up = p.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
  };
  const abs = (f) => (p.isAbsolute(f) ? p.normalize(f) : p.normalize(p.join(work, f)));
  addDir(homeDir);
  addDir(work);
  for (const d of dirs) addDir(abs(d));
  const sys = {
    real: false,
    platform,
    isWin,
    path: p,
    env: environment,
    getEnv(name) {
      if (Object.prototype.hasOwnProperty.call(environment, name)) return environment[name];
      if (isWin) { const k = Object.keys(environment).find((x) => x.toLowerCase() === String(name).toLowerCase()); return k === undefined ? undefined : environment[k]; }
      return undefined;
    },
    cwd: work,
    home: homeDir,
    release: release || (isWin ? "10.0.26100" : ""),
    resolve(target) { return abs(target); },
    readFile(file) { const e = table.get(key(abs(file))); return e && e.kind === "file" ? Buffer.from(e.data) : null; },
    readText(file) { return decode(sys.readFile(file)); },
    stat(file) {
      const e = table.get(key(abs(file)));
      if (!e) return null;
      return e.kind === "file" ? { isFile: true, isDir: false, size: e.data.length, mtimeMs: 0, executable: e.executable !== false } : { isFile: false, isDir: true, size: 0, mtimeMs: 0, executable: true };
    },
    exists(file) { return table.has(key(abs(file))); },
    isFile(file) { const e = table.get(key(abs(file))); return Boolean(e && e.kind === "file"); },
    isDir(file) { const e = table.get(key(abs(file))); return Boolean(e && e.kind === "dir"); },
    readdir(dir) {
      const base = key(abs(dir));
      const e = table.get(base);
      if (!e || e.kind !== "dir") return null;
      const out = [];
      for (const [k, v] of table) {
        if (k === base) continue;
        const parent = key(p.dirname(v.name));
        if (parent === base) out.push(p.basename(v.name));
      }
      return out;
    },
    realpath(file) { return abs(file); },
    // test helpers
    add(file, data, { executable } = {}) {
      const full = abs(file);
      addDir(p.dirname(full));
      table.set(key(full), { kind: "file", data: Buffer.from(data), name: full, executable });
      return sys;
    },
    remove(file) { table.delete(key(abs(file))); return sys; },
    files() { return [...table.values()].filter((e) => e.kind === "file").map((e) => e.name); },
  };
  for (const [f, data] of Object.entries(files)) sys.add(f, data);
  return sys;
}

/** A ready-made Windows machine and Linux machine, as the tests of the CLI use them. */
export const WIN = (o = {}) => fakeSys({ platform: "win32", ...o, env: { USERPROFILE: "C:\\Users\\me", ProgramData: "C:\\ProgramData", Path: "C:\\Windows\\System32;C:\\Windows", PATHEXT: ".COM;.EXE;.BAT;.CMD", ...(o.env || {}) } });
export const LINUX = (o = {}) => fakeSys({ platform: "linux", ...o, env: { HOME: "/home/me", PATH: "/usr/local/bin:/usr/bin:/bin", ...(o.env || {}) } });
export const MAC = (o = {}) => fakeSys({ platform: "darwin", home: "/Users/me", cwd: "/Users/me/proj", ...o, env: { HOME: "/Users/me", PATH: "/opt/homebrew/bin:/usr/bin:/bin", ...(o.env || {}) } });
