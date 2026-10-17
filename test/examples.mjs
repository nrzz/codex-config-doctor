// The example world of the README: examples/codex-home is a Codex home and examples/shop a project, loaded into a pretend Linux machine
// at /home/runner/.codex and /home/runner/shop, so that the commands of the README print the same thing on every system. `node --test`
// runs this file too; it holds no test.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.mjs";
import { fakeSys } from "./fakesys.mjs";

const HOME = "/home/runner";

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** The pretend machine: `home` holds the Codex home, the project is /home/runner/shop (a Git repository), and node, git and npm are on PATH. */
export function exampleMachine({ files = {} } = {}) {
  const sys = fakeSys({ platform: "linux", home: HOME, cwd: `${HOME}/shop`, env: { HOME, PATH: "/usr/local/bin:/usr/bin:/bin" } });
  for (const [from, to] of [["examples/codex-home", `${HOME}/.codex`], ["examples/shop", `${HOME}/shop`]]) {
    const base = path.join(ROOT, ...from.split("/"));
    // a checkout on Windows may turn line feeds into CRLF, and the byte counts of the examples are those of the files as they are in the index
    for (const file of walk(base)) sys.add(`${to}/${path.relative(base, file).split(path.sep).join("/")}`, String(fs.readFileSync(file, "utf8")).replace(/\r\n/g, "\n"));
  }
  sys.add(`${HOME}/shop/.git/HEAD`, "ref: refs/heads/main\n");
  for (const exe of ["node", "git", "npm"]) sys.add(`/usr/bin/${exe}`, "#!/bin/sh\n");
  for (const [rel, text] of Object.entries(files)) sys.add(rel.startsWith("/") ? rel : `${HOME}/${rel}`, text);
  return sys;
}

/**
 * A pretend Windows 11 machine (build 26100) for the two Windows examples of the README: the user is `me`, the project C:\Users\me\shop (a Git
 * repository, trusted by the entry Codex's own warning spells), and the Codex home asks for workspace-write and selects no Windows sandbox.
 */
export function exampleWindows() {
  const sys = fakeSys({
    platform: "win32", home: "C:\\Users\\me", cwd: "C:\\Users\\me\\shop", release: "10.0.26100",
    env: { USERPROFILE: "C:\\Users\\me", ProgramData: "C:\\ProgramData", Path: "C:\\Windows\\System32;C:\\Windows", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
  });
  sys.add("C:\\Users\\me\\.codex\\config.toml", 'model = "gpt-5.5"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n\n[projects.\'c:\\users\\me\\shop\']\ntrust_level = "trusted"\n');
  sys.add("C:\\Users\\me\\shop\\.git\\HEAD", "ref: refs/heads/main\n");
  return sys;
}
