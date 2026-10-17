// Loading the rules files of the layers. Put to Codex 0.163.0 (test/e2e-rules.test.mjs): Codex reads the files named *.rules (the extension in
// lower case) that lie directly in the `rules` folder next to a layer's config.toml: the Codex home, a trusted project's .codex folder, the
// system folder. A folder inside `rules`, a file with another extension and a file outside `rules` are not read. A rules file that does not
// parse, or whose examples disagree with its rules, stops Codex at start.
import { checkExamples } from "./execpolicy.mjs";
import { runRules } from "./starlark.mjs";

/**
 * @returns { files: [{ path, folder, layerKind, skipped, bytes, bom, ok, error, rules, hosts }], rules (those of the files Codex would load),
 *            exampleProblems, unevaluated (files this tool could not run) }
 */
export function loadRules(sys, world) {
  const files = [];
  for (const layer of [...world.layers].reverse()) {
    if (layer.kind === "profile") continue;
    const base = layer.kind === "project" ? layer.dotCodex : layer.scope;
    const dir = sys.path.join(base, "rules");
    const names = (sys.readdir(dir) || []).filter((n) => n.endsWith(".rules")).sort();
    for (const name of names) {
      const file = sys.path.join(dir, name);
      if (!sys.isFile(file)) continue;
      const skipped = layer.kind === "project" && !layer.trusted;
      const buf = sys.readFile(file) || Buffer.alloc(0);
      const text = Buffer.from(buf).toString("utf8");
      const result = runRules(text);
      const rec = { path: file, folder: dir, layerKind: layer.kind, skipped, bytes: buf.length, bom: text.charCodeAt(0) === 0xfeff, ok: result.ok, error: result.ok ? null : result.error, rules: [], hosts: [] };
      if (result.ok) {
        rec.rules = result.rules.map((r) => ({ ...r, file, layerKind: layer.kind }));
        rec.hosts = result.hosts;
      }
      files.push(rec);
    }
  }
  const loaded = files.filter((f) => f.ok && !f.skipped);
  const rules = loaded.flatMap((f) => f.rules);
  const exampleProblems = checkExamples(rules).map((p) => ({ ...p, file: p.rule.file, line: p.rule.line }));
  return {
    files,
    rules,
    exampleProblems,
    unevaluated: files.filter((f) => !f.ok && f.error.kind === "unsupported"),
    broken: files.filter((f) => !f.ok && f.error.kind !== "unsupported"),
  };
}
