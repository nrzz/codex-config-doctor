// Shared test helpers: throwaway worlds (a home folder, a Codex home, project folders, stand-in programs) and ways to run the CLI.
//
// SAFETY: nothing here reads or writes the real ~/.codex, ~/.claude, ~/.copilot, ~/.gemini or ~/.cursor. Importing this file points HOME,
// USERPROFILE, APPDATA, LOCALAPPDATA, CODEX_HOME, CLAUDE_CONFIG_DIR, COPILOT_HOME and GEMINI_CLI_HOME of the test process at an empty
// temporary folder, so even a test that forgets to pass its own environment cannot reach them. Every child process gets a world's
// environment, and runCli refuses to run with a Codex home or a home folder outside the OS temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "bin", "codex-config-doctor.mjs");
export const IS_WIN = process.platform === "win32";
export const NOW = Date.parse("2026-10-17T12:00:00.000Z");

const made = [];
export function tmpDir(prefix = "ccd-") {
  // the native real path: on Windows it also turns a short name (RUNNER~1) into the long one, which is what the tool and Codex see
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
process.on("exit", () => { if (process.env.CCD_KEEP_WORLDS) return; for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* the OS cleans the temp folder eventually */ } } });

// The variables that name a place where an agent keeps its files, and that every child of a test gets pointed at a throwaway folder.
export const HOME_VARS = ["HOME", "USERPROFILE", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "COPILOT_HOME", "GEMINI_CLI_HOME"];

/** The environment of a throwaway home: every variable that names an agent's folder points into `home`. */
export function homeEnv(home, codexHome = path.join(home, ".codex")) {
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    COPILOT_HOME: path.join(home, ".copilot"),
    GEMINI_CLI_HOME: home,
    NO_COLOR: "1",
  };
}

// The guard: an empty home for this process, and nothing of the machine's agents in its environment.
const guard = tmpDir("ccd-guard-");
export const GUARD = guard;
Object.assign(process.env, homeEnv(guard));
delete process.env.FORCE_COLOR;
for (const k of Object.keys(process.env)) if (/^(CODEX_|OPENAI_|CLAUDE_CODE_|ANTHROPIC_|CLAUDECODE|COPILOT_|GEMINI_)/i.test(k) && !HOME_VARS.includes(k)) delete process.env[k];

export const underTmp = (p) => path.resolve(p).toLowerCase().startsWith(fs.realpathSync.native(os.tmpdir()).toLowerCase());

const asText = (v) => (typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);
/** Write a file (an object as JSON, a string as it is), making the folder. */
export const put = (file, v, mode) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, asText(v)); if (mode !== undefined) fs.chmodSync(file, mode); return file; };
export const fwd = (p) => String(p).split(path.sep).join("/");
export const read = (file) => fs.readFileSync(file, "utf8");
export const exists = (file) => fs.existsSync(file);

/** Runs the real CLI in a child process. */
export function runCli(args, { cwd, env, input, timeout = 120000 } = {}) {
  const e = { ...process.env, ...env };
  if (!underTmp(e.CODEX_HOME || "") || !underTmp(e.HOME || "") || !underTmp(e.USERPROFILE || "")) {
    throw new Error("runCli needs an environment of a throwaway world: the Codex home and the home folder must be temporary");
  }
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: e, input: input ?? "", encoding: "utf8", windowsHide: true, timeout });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}
