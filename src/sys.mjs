// The machine as the commands see it: the platform, the environment, the working folder, the home folder, the files. Everything that
// reads the disk goes through a `sys`, so that the tests can pretend to be Windows, Linux or macOS on any system (test/fakesys.mjs),
// and so that this is the one file that imports node:fs. Nothing here writes, and nothing starts a program.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The text of a file the way Codex reads it: UTF-8, invalid bytes replaced. */
export const decode = (buf) => (buf === null || buf === undefined ? null : Buffer.from(buf).toString("utf8"));

/**
 * The real machine. `opts` replaces parts of it (the tests of the CLI use { env, cwd }):
 *   { platform, env, cwd, home, release }
 */
export function makeSys(opts = {}) {
  const platform = opts.platform || process.platform;
  const isWin = platform === "win32";
  const p = isWin ? path.win32 : path.posix;
  const env = opts.env || process.env;
  const lower = new Map(Object.keys(env).map((k) => [k.toLowerCase(), k]));
  const getEnv = (name) => {
    if (Object.prototype.hasOwnProperty.call(env, name)) return env[name];
    if (isWin) { const k = lower.get(String(name).toLowerCase()); return k === undefined ? undefined : env[k]; }
    return undefined;
  };
  const cwd = opts.cwd || process.cwd();
  // Codex reads %USERPROFILE% for ~ on Windows and $HOME elsewhere
  const home = opts.home || (isWin ? getEnv("USERPROFILE") || getEnv("HOME") : getEnv("HOME")) || os.homedir();
  const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  return {
    real: true,
    platform,
    isWin,
    path: p,
    env,
    getEnv,
    cwd,
    home,
    release: opts.release || (platform === process.platform ? os.release() : ""),
    resolve(target) { return p.isAbsolute(target) ? p.normalize(target) : p.normalize(p.join(cwd, target)); },
    readFile(file) { return safe(() => fs.readFileSync(file)); },
    readText(file) { return decode(safe(() => fs.readFileSync(file))); },
    stat(file) {
      const s = safe(() => fs.statSync(file));
      return s ? { isFile: s.isFile(), isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs, executable: isWin ? true : (s.mode & 0o111) !== 0 } : null;
    },
    exists(file) { return safe(() => fs.existsSync(file), false); },
    isFile(file) { const s = safe(() => fs.statSync(file)); return Boolean(s && s.isFile()); },
    isDir(file) { const s = safe(() => fs.statSync(file)); return Boolean(s && s.isDirectory()); },
    readdir(dir) { return safe(() => fs.readdirSync(dir)); },
    realpath(file) { return safe(() => (fs.realpathSync.native || fs.realpathSync)(file), file); },
  };
}

/** The Windows build number from os.release() ("10.0.26300" -> 26300), or null. */
export function windowsBuild(release) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(release || ""));
  return m ? Number(m[3]) : null;
}
