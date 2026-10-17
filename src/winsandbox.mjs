// The Windows sandbox: which implementation Codex picks, and what that does to sandbox_mode. Put to Codex 0.163.0 on Windows 11
// (test/e2e-windows.test.mjs):
//   - `windows.sandbox` names the implementation (mxc, elevated or unelevated), and an explicit "mxc" is selected whether or not MXC is
//     available; `features.prefer_mxc = true` selects mxc only when it is available (the log says "MXC availability: true"); on Windows Server 2025
//     build 26100 it said false and the selection was "disabled", not a fallback; with neither, no implementation is selected
//     ("Windows sandbox selection: disabled" in the sandbox log);
//   - with none selected, `sandbox_mode = "workspace-write"` (the default of a trusted project) becomes `read-only` in the prompt the model
//     gets, and nothing can run inside a sandbox: with approval_policy on-request every command that no rule allows asks first, with
//     never it is refused ("blocked by policy");
//   - the log CODEX_HOME/.sandbox/sandbox.<date>.log says what Codex found: "MXC availability: true|false" and "Windows sandbox selection: ...".
// The build MXC needs (Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278) and the administrator setup of `elevated` are from the
// documentation; `elevated` needs an administrator, which the tests never use.
import { MXC_MINIMUM } from "./knowledge.mjs";
import { windowsBuild } from "./sys.mjs";

/** The last "MXC availability" and "Windows sandbox selection" lines of the newest sandbox log. */
export function readSandboxLog(sys, codexHomeDir) {
  const dir = sys.path.join(codexHomeDir, ".sandbox");
  const names = (sys.readdir(dir) || []).filter((n) => /^sandbox\..*\.log$/.test(n)).sort();
  if (!names.length) return null;
  const file = sys.path.join(dir, names[names.length - 1]);
  const text = sys.readText(file) || "";
  const lines = text.split(/\r?\n/);
  let mxc = null;
  let selection = null;
  let at = null;
  for (const line of lines) {
    let m = /^\[([^\]]*?)\s+\S+\]\s+MXC availability:\s*(true|false)/.exec(line);
    if (m) { mxc = m[2] === "true"; at = m[1]; }
    m = /^\[([^\]]*?)\s+\S+\]\s+Windows sandbox selection:\s*(\S+)/.exec(line);
    if (m) { selection = m[2]; at = m[1]; }
  }
  return { path: file, mxcAvailable: mxc, lastSelection: selection, at };
}

/**
 * @param merged the merged configuration; trusted whether the project is trusted (it decides the default sandbox_mode)
 */
export function windowsSandbox(sys, merged, { codexHomeDir, trusted }) {
  const features = merged.features && typeof merged.features === "object" ? merged.features : {};
  const configured = merged.windows && typeof merged.windows === "object" && typeof merged.windows.sandbox === "string" ? merged.windows.sandbox : null;
  const preferMxc = features.prefer_mxc === true;
  const build = sys.isWin ? windowsBuild(sys.release) : null;
  const log = sys.isWin ? readSandboxLog(sys, codexHomeDir) : null;
  // a build that cannot have MXC: Windows 11 24H2 (26100) and 25H2 (26200) need the update revision of the documentation; older builds cannot
  const mxcBuild = build === null ? null : build < 26100 ? "too-old" : build === 26100 || build === 26200 ? "check-update" : "ok";
  // prefer_mxc picks MXC when there is one; the log of the last run says whether there was, else the build does
  const preferUnavailable = preferMxc && !configured && (log && log.mxcAvailable !== null ? log.mxcAvailable === false : mxcBuild === "too-old");
  const selection = configured || (preferMxc && !preferUnavailable ? "mxc" : "none");
  const asked = typeof merged.sandbox_mode === "string" ? merged.sandbox_mode : null;
  const wanted = asked || (trusted ? "workspace-write" : "read-only");
  const effective = sys.isWin && selection === "none" && wanted === "workspace-write" ? "read-only" : wanted;
  const out = {
    applicable: sys.isWin,
    configured,
    preferMxc,
    selection,
    selectionHow: configured ? "windows.sandbox" : preferMxc ? (preferUnavailable ? "features.prefer_mxc, with no MXC to pick" : "features.prefer_mxc") : "nothing is set",
    preferUnavailable: Boolean(preferUnavailable),
    sandboxMode: { asked, wanted, effective, downgraded: effective !== wanted },
    build,
    release: sys.isWin ? sys.release : null,
    mxcMinimum: MXC_MINIMUM,
    log,
    mxcBuild,
  };
  return out;
}
