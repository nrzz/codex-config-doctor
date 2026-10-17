// Pretend machines for the tests of the reports (test/fakesys.mjs underneath): a Codex folder, a project with a Git folder, and the
// files a test puts in them. Nothing here touches the disk. `node --test` runs this file too; it holds no test.
import { fakeSys } from "./fakesys.mjs";
import { collect } from "../src/collect.mjs";

/**
 * A machine. `files` maps a name to its text: a name that starts with "work/" is under the project folder, "abs:" is an absolute path,
 * any other name is under the Codex home. Options: platform (linux, darwin or win32), env, trusted (the project has a `trusted` entry in
 * config.toml, the default), extra (more options for fakeSys, such as release). Returns { sys, root, j } where j joins path pieces under
 * the machine's root with its separator.
 */
export function machine(files = {}, { platform = "linux", env = {}, trusted = true, extra = {} } = {}) {
  const win = platform === "win32";
  const root = win ? "C:\\w" : "/w";
  const sep = win ? "\\" : "/";
  const j = (...p) => [root, ...p].join(sep);
  const sys = fakeSys({ platform, home: j("home"), cwd: j("work"), env: { CODEX_HOME: j("codex-home"), PATH: win ? "C:\\bin" : "/bin", ...(win ? { PATHEXT: ".COM;.EXE;.BAT;.CMD", ProgramData: "C:\\ProgramData" } : {}), ...env }, ...extra });
  sys.add(j("work", ".git", "HEAD"), "ref\n");
  if (trusted) sys.add(j("codex-home", "config.toml"), `[projects.'${j("work")}']\ntrust_level = "trusted"\n`);
  for (const [rel, text] of Object.entries(files)) {
    const file = rel.startsWith("work/") ? j(...rel.split("/")) : rel.startsWith("abs:") ? rel.slice(4) : j("codex-home", ...rel.split("/"));
    if (rel === "config.toml" && trusted) sys.add(file, `${text}\n[projects.'${j("work")}']\ntrust_level = "trusted"\n`);
    else sys.add(file, text);
  }
  return { sys, root, j };
}

/** A machine and what `collect` makes of it: { c, m }. `o.dir` is the working folder under the project ("a/b"), `o.profile` a profile name. */
export function world(files, o = {}) {
  const m = machine(files, o);
  const c = collect(m.sys, { project: m.j(...`work/${o.dir || ""}`.split("/").filter(Boolean)), profile: o.profile });
  return { c, m };
}
