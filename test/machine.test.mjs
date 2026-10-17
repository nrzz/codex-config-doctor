// The machine the commands read: the real one (src/sys.mjs) on a throwaway folder, and the pretend ones (test/fakesys.mjs) for the
// search for a program (src/pathsearch.mjs), the MCP servers (src/mcp.mjs), the model providers (src/providers.mjs) and the Windows
// sandbox log (src/winsandbox.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decode, makeSys, windowsBuild } from "../src/sys.mjs";
import { splitList, which } from "../src/pathsearch.mjs";
import { servers } from "../src/mcp.mjs";
import { providers } from "../src/providers.mjs";
import { readSandboxLog, windowsSandbox } from "../src/winsandbox.mjs";
import { LINUX, MAC, WIN } from "./fakesys.mjs";
import { put, tmpDir } from "./helpers.mjs";

test("the real machine reads files, folders and the environment, and says null for what is not there", () => {
  const dir = tmpDir("ccd-sys-");
  put(path.join(dir, "a", "b.txt"), "hello\n");
  fs.writeFileSync(path.join(dir, "bad.bin"), Buffer.from([0x68, 0x69, 0xff, 0x21]));
  const sys = makeSys({ env: { HOME: dir, Path: "x" }, cwd: dir });
  assert.equal(sys.readText(path.join(dir, "a", "b.txt")), "hello\n");
  assert.equal(sys.readText(path.join(dir, "bad.bin")), "hi\ufffd!");
  assert.equal(sys.readFile(path.join(dir, "nope")), null);
  assert.equal(sys.readText(path.join(dir, "nope")), null);
  assert.equal(sys.isFile(path.join(dir, "a", "b.txt")), true);
  assert.equal(sys.isDir(path.join(dir, "a")), true);
  assert.equal(sys.isFile(path.join(dir, "a")), false);
  assert.equal(sys.exists(path.join(dir, "zz")), false);
  assert.deepEqual(sys.readdir(path.join(dir, "a")), ["b.txt"]);
  assert.equal(sys.readdir(path.join(dir, "nope")), null);
  assert.equal(sys.stat(path.join(dir, "a", "b.txt")).size, 6);
  assert.equal(sys.stat(path.join(dir, "nope")), null);
  assert.equal(sys.cwd, dir);
  assert.equal(sys.resolve("a"), path.join(dir, "a"));
  assert.equal(sys.resolve(dir), dir);
  assert.equal(sys.realpath(path.join(dir, "nope")), path.join(dir, "nope"));
  assert.equal(sys.getEnv("HOME"), dir);
  assert.equal(typeof sys.platform, "string");
});

test("on a Windows machine the environment is looked up without regard to case, and the home folder is USERPROFILE", () => {
  const sys = makeSys({ platform: "win32", env: { Path: "C:\\x", USERPROFILE: "C:\\Users\\me", HOME: "C:\\other" }, cwd: "C:\\w" });
  assert.equal(sys.getEnv("PATH"), "C:\\x");
  assert.equal(sys.getEnv("path"), "C:\\x");
  assert.equal(sys.home, "C:\\Users\\me");
  assert.equal(sys.isWin, true);
  const linux = makeSys({ platform: "linux", env: { Path: "x", HOME: "/home/me", USERPROFILE: "/not" }, cwd: "/w" });
  assert.equal(linux.getEnv("PATH"), undefined);
  assert.equal(linux.home, "/home/me");
});

test("decode replaces invalid bytes the way Codex does; the Windows build is the third number", () => {
  assert.equal(decode(Buffer.from("abc")), "abc");
  assert.equal(decode(null), null);
  assert.equal(decode(Buffer.from([0xc3, 0x28])), "\ufffd(");
  assert.equal(windowsBuild("10.0.26300"), 26300);
  assert.equal(windowsBuild("10.0.22631"), 22631);
  assert.equal(windowsBuild("6.1.7601"), 7601);
  assert.equal(windowsBuild(""), null);
});

test("PATH and PATHEXT are split by the platform's separator, and quotes are dropped", () => {
  assert.deepEqual(splitList(WIN(), 'C:\\a;"C:\\b c";;C:\\d'), ["C:\\a", "C:\\b c", "C:\\d"]);
  assert.deepEqual(splitList(LINUX(), "/a:/b::/c"), ["/a", "/b", "/c"]);
  assert.deepEqual(splitList(LINUX(), ""), []);
  assert.deepEqual(splitList(LINUX(), undefined), []);
});

test("a program on Linux and macOS: found on PATH when it has an execute bit; a path is taken from the working folder", () => {
  for (const make of [LINUX, MAC]) {
    const sys = make({ cwd: "/proj" });
    sys.add("/usr/bin/tool", "x");
    sys.add("/usr/bin/plain", "x", { executable: false });
    sys.add("/proj/bin/mine", "x");
    assert.deepEqual(which(sys, "tool"), { found: true, path: "/usr/bin/tool", how: "PATH" });
    assert.equal(which(sys, "plain").found, false, "no execute bit");
    assert.equal(which(sys, "nosuch").found, false);
    assert.deepEqual(which(sys, "./bin/mine", { cwd: "/proj" }), { found: true, path: "/proj/bin/mine", how: "path" });
    assert.equal(which(sys, "/usr/bin/tool").how, "path");
    assert.equal(which(sys, "").found, false);
  }
});

test("a program on Windows: the extensions of PATHEXT are tried; a .ps1 script or a file with no extension is not a program", () => {
  const sys = WIN({ cwd: "C:\\proj" });
  sys.add("C:\\Windows\\System32\\tool.cmd", "x");
  sys.add("C:\\Windows\\System32\\Both.BAT", "x");
  sys.add("C:\\Windows\\System32\\script.ps1", "x");
  sys.add("C:\\Windows\\System32\\bare", "x");
  sys.add("C:\\tools\\app.exe", "x");
  assert.equal(which(sys, "tool").found, true);
  assert.equal(which(sys, "tool.cmd").found, true);
  assert.equal(which(sys, "TOOL").found, true, "case does not matter");
  assert.equal(which(sys, "both").found, true);
  assert.equal(which(sys, "script").found, false);
  assert.equal(which(sys, "script.ps1").found, false);
  assert.equal(which(sys, "bare").found, false);
  assert.equal(which(sys, "C:\\tools\\app").found, true, "a path without its extension");
  assert.equal(which(sys, "C:/tools/app.exe").found, true, "forward slashes");
  assert.equal(which(sys, "..\\tools\\app", { cwd: "C:\\proj" }).found, true, "relative to the working folder");
});

test("MCP servers: stdio or http, enabled or not, required or not, and what is wrong with the table", () => {
  const sys = LINUX();
  sys.add("/usr/bin/node", "x");
  const list = servers(sys, {
    mcp_servers: {
      a: { command: "node", args: ["x.js"] },
      b: { url: "http://127.0.0.1:1/mcp", bearer_token_env_var: "T" },
      c: { command: "nosuch", required: true },
      d: { command: "node", enabled: false, startup_timeout_sec: 30, tool_timeout_sec: 5 },
      e: { command: "node", url: "http://x" },
      f: { args: [] },
      g: { command: "node", bearer_token_env_var: "T" },
      h: { command: "node -e 0" },
      i: "not a table",
    },
  }, { cwd: "/" });
  const by = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(by), ["a", "b", "c", "d", "e", "f", "g", "h"]);
  assert.deepEqual([by.a.transport, by.a.resolved.found, by.a.args, by.a.enabled, by.a.required], ["stdio", true, ["x.js"], true, false]);
  assert.deepEqual([by.b.transport, by.b.url, by.b.resolved, by.b.problems], ["http", "http://127.0.0.1:1/mcp", null, []]);
  assert.deepEqual([by.c.resolved.found, by.c.required], [false, true]);
  assert.deepEqual([by.d.enabled, by.d.startupTimeoutSec, by.d.toolTimeoutSec], [false, 30, 5]);
  assert.equal(by.a.startupTimeoutSec, 10);
  assert.equal(by.e.transport, "invalid");
  assert.equal(by.e.problems[0].kind, "both");
  assert.equal(by.f.problems[0].kind, "neither");
  assert.equal(by.g.problems[0].kind, "stdio-option");
  assert.equal(by.h.argsInCommand, true);
  assert.equal(by.a.argsInCommand, false);
  assert.deepEqual(servers(sys, {}), []);
  assert.deepEqual(servers(sys, { mcp_servers: "x" }), []);
});

test("providers: the selected one, the built-in ones, the key variable", () => {
  const sys = LINUX({ env: { PATH: "/bin", KEY_SET: "v", KEY_EMPTY: "" } });
  let p = providers(sys, {});
  assert.deepEqual([p.selected, p.selectedDefined, p.builtIn, p.list], ["openai", false, true, []]);
  p = providers(sys, { model_provider: "mine", model_providers: { mine: { name: "m", base_url: "http://127.0.0.1:1/v1", env_key: "KEY_SET" }, other: { name: "o", env_key: "KEY_EMPTY", wire_api: "chat" }, openai: { name: "x" }, third: { name: "t", env_key: "KEY_NONE", auth: { command: "x" } }, junk: "x" } });
  assert.deepEqual([p.selected, p.selectedDefined, p.builtIn], ["mine", true, false]);
  const by = Object.fromEntries(p.list.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(by), ["mine", "other", "openai", "third"]);
  assert.deepEqual([by.mine.selected, by.mine.envKeySet, by.mine.wireApi, by.mine.baseUrl], [true, true, "responses", "http://127.0.0.1:1/v1"]);
  assert.deepEqual([by.other.envKeySet, by.other.wireApi, by.other.selected], [false, "chat", false]);
  assert.equal(by.openai.reserved, true);
  assert.deepEqual([by.third.envKeySet, by.third.hasAuth], [false, true]);
  assert.equal(providers(sys, { model_provider: "ollama" }).builtIn, true);
  assert.equal(providers(sys, { model_provider: "nope" }).builtIn, false);
});

test("the Windows sandbox: what is selected, what sandbox_mode becomes, the build, and the last lines of the log", () => {
  const sys = WIN({ release: "10.0.26300" });
  const at = (merged, o = {}) => windowsSandbox(sys, merged, { codexHomeDir: "C:\\codex", trusted: true, ...o });
  let w = at({});
  assert.deepEqual([w.applicable, w.selection, w.selectionHow, w.build, w.mxcBuild], [true, "none", "nothing is set", 26300, "ok"]);
  assert.deepEqual(w.sandboxMode, { asked: null, wanted: "workspace-write", effective: "read-only", downgraded: true });
  assert.equal(at({}, { trusted: false }).sandboxMode.downgraded, false, "an untrusted project is read-only already");
  assert.equal(at({ sandbox_mode: "danger-full-access" }).sandboxMode.downgraded, false);
  assert.equal(at({ sandbox_mode: "workspace-write" }).sandboxMode.effective, "read-only");
  w = at({ windows: { sandbox: "unelevated" } });
  assert.deepEqual([w.selection, w.selectionHow, w.sandboxMode.effective], ["unelevated", "windows.sandbox", "workspace-write"]);
  w = at({ features: { prefer_mxc: true } });
  assert.deepEqual([w.selection, w.selectionHow], ["mxc", "features.prefer_mxc"]);
  // prefer_mxc picks MXC only when there is one, and Codex does not fall back to another sandbox: the log of the last run says whether there
  // was, else the build does (Windows Server 2025, build 26100, logged "MXC availability: false" and got "Windows sandbox selection: disabled")
  const prefer = (release, logged) => {
    const s = WIN({ release });
    if (logged !== undefined) s.add("C:\\codex\\.sandbox\\sandbox.2026-10-17.log", `[2026-10-17 09:00:00.100 codex.exe] MXC availability: ${logged}\n`);
    return windowsSandbox(s, { features: { prefer_mxc: true } }, { codexHomeDir: "C:\\codex", trusted: true });
  };
  w = prefer("10.0.26100", false);
  assert.deepEqual([w.selection, w.preferUnavailable, w.sandboxMode.effective], ["none", true, "read-only"]);
  assert.match(w.selectionHow, /no MXC to pick/);
  assert.deepEqual([prefer("10.0.26100", true).selection, prefer("10.0.26100", true).preferUnavailable], ["mxc", false]);
  assert.equal(prefer("10.0.22631").selection, "none", "a build too old for MXC, and no log");
  assert.equal(prefer("10.0.26300").selection, "mxc", "a build that has MXC, and no log yet");
  assert.equal(windowsSandbox(WIN({ release: "10.0.22631" }), { windows: { sandbox: "mxc" }, features: { prefer_mxc: true } }, { codexHomeDir: "C:\\codex", trusted: true }).selection, "mxc", "an explicit mxc is selected whether or not there is one");
  assert.equal(windowsSandbox(WIN({ release: "10.0.22631" }), { windows: { sandbox: "mxc" } }, { codexHomeDir: "C:\\c", trusted: true }).mxcBuild, "too-old");
  assert.equal(windowsSandbox(WIN({ release: "10.0.26100" }), { windows: { sandbox: "mxc" } }, { codexHomeDir: "C:\\c", trusted: true }).mxcBuild, "check-update");
  assert.equal(windowsSandbox(WIN({ release: "10.0.26200" }), { windows: { sandbox: "mxc" } }, { codexHomeDir: "C:\\c", trusted: true }).mxcBuild, "check-update");
  const lin = windowsSandbox(LINUX(), { windows: { sandbox: "mxc" } }, { codexHomeDir: "/c", trusted: true });
  assert.deepEqual([lin.applicable, lin.build, lin.log], [false, null, null]);
  assert.equal(lin.sandboxMode.downgraded, false);
});

test("the sandbox log: the newest file, the last MXC availability and the last selection", () => {
  const sys = WIN();
  assert.equal(readSandboxLog(sys, "C:\\codex"), null);
  sys.add("C:\\codex\\.sandbox\\sandbox.2026-10-16.log", "[2026-10-16 10:00:00.000 codex.exe] MXC availability: true\n");
  sys.add("C:\\codex\\.sandbox\\sandbox.2026-10-17.log", "[2026-10-17 09:00:00.100 codex.exe] MXC availability: true\r\n[2026-10-17 09:00:00.200 codex.exe] Windows sandbox selection: disabled\r\n[2026-10-17 23:51:02.106 codex.exe] MXC availability: false\r\n[2026-10-17 23:51:02.107 codex.exe] Windows sandbox selection: mxc\r\n");
  sys.add("C:\\codex\\.sandbox\\other.txt", "MXC availability: true");
  const log = readSandboxLog(sys, "C:\\codex");
  assert.equal(log.path, "C:\\codex\\.sandbox\\sandbox.2026-10-17.log");
  assert.deepEqual([log.mxcAvailable, log.lastSelection, log.at], [false, "mxc", "2026-10-17 23:51:02.107"]);
  const quiet = WIN();
  quiet.add("C:\\codex\\.sandbox\\sandbox.2026-10-17.log", "nothing of interest\n");
  assert.deepEqual(readSandboxLog(quiet, "C:\\codex"), { path: "C:\\codex\\.sandbox\\sandbox.2026-10-17.log", mxcAvailable: null, lastSelection: null, at: null });
});
