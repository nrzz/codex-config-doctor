// The AGENTS.md text Codex puts in front of the model, assembled the way Codex 0.163.0 does it (test/e2e-agents.test.mjs compares this,
// byte for byte, with the message in `codex debug prompt-input` and in the first request of `codex exec`):
//   - the global file: AGENTS.override.md in the Codex home if it has text, else AGENTS.md; leading and trailing white space is trimmed;
//   - the project files: from the project root down to the working folder, one file in each folder: AGENTS.override.md, else AGENTS.md,
//     else the names of project_doc_fallback_filenames, the first that is a file (a file with no text still takes the place);
//   - the project files are read in that order, at most project_doc_max_bytes bytes of them in all (default 32768): the file that
//     crosses the cap is cut at the byte, the files after it are left out, and a file with only white space is skipped and costs nothing;
//     the global file is not counted;
//   - the project files are joined with a blank line; the global text and the project text with `--- project-doc ---` between;
//   - the message is `# AGENTS.md instructions for <working folder>`, then <INSTRUCTIONS>, the text, </INSTRUCTIONS>.
import { AGENTS_NAMES, DEFAULT_PROJECT_DOC_MAX_BYTES } from "./knowledge.mjs";
import { codexHome, findRoot } from "./layers.mjs";

const SEPARATOR = "\n\n--- project-doc ---\n\n";

const lossy = (buf) => Buffer.from(buf).toString("utf8");

/** The cap in force, from the merged configuration. */
export function docCap(merged) {
  const v = merged && merged.project_doc_max_bytes;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : DEFAULT_PROJECT_DOC_MAX_BYTES;
}

/** A fallback name Codex accepts: a plain file name. */
const usableName = (n) => typeof n === "string" && n !== "" && n !== "." && n !== ".." && !/[\\/]/.test(n);

/**
 * @param sys     the machine
 * @param dir     the working folder
 * @param merged  the merged configuration (project_doc_max_bytes, project_doc_fallback_filenames, project_root_markers)
 */
export function assemble(sys, dir, merged = {}) {
  const cap = docCap(merged);
  const fallbacks = Array.isArray(merged.project_doc_fallback_filenames) ? merged.project_doc_fallback_filenames.filter(usableName) : [];
  const markers = Array.isArray(merged.project_root_markers) && merged.project_root_markers.every((m) => typeof m === "string") ? merged.project_root_markers : [".git"];
  const home = codexHome(sys);
  const out = { dir, cap, root: null, global: null, files: [], shadowed: [], total: 0, text: null, body: null, heading: null };

  // ---- the global file
  for (const name of [AGENTS_NAMES.override, AGENTS_NAMES.standard]) {
    const file = sys.path.join(home.dir, name);
    if (!sys.isFile(file)) continue;
    const buf = sys.readFile(file);
    const text = lossy(buf || Buffer.alloc(0)).trim();
    if (text === "") { out.shadowed.push({ path: file, reason: "empty" }); continue; }
    out.global = { path: file, name, bytes: buf.length, text, chars: text.length };
    break;
  }
  if (out.global) {
    for (const name of [AGENTS_NAMES.override, AGENTS_NAMES.standard]) {
      const file = sys.path.join(home.dir, name);
      if (file !== out.global.path && sys.isFile(file) && !out.shadowed.some((s) => s.path === file)) out.shadowed.push({ path: file, reason: "later" });
    }
  }

  // ---- the project files
  const found = findRoot(sys, dir, markers);
  out.root = found ? found.root : null;
  const folders = [];
  if (found) {
    let cur = dir;
    for (;;) {
      folders.push(cur);
      if (sys.path.relative(found.root, cur) === "") break;
      const up = sys.path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
    folders.reverse();
  } else folders.push(dir);
  const candidates = [AGENTS_NAMES.override, AGENTS_NAMES.standard, ...fallbacks];
  const picked = [];
  for (const folder of folders) {
    const hits = candidates.filter((n) => sys.isFile(sys.path.join(folder, n)));
    if (!hits.length) continue;
    const first = hits[0];
    picked.push({ folder, name: first, path: sys.path.join(folder, first) });
    for (const other of hits.slice(1)) out.shadowed.push({ path: sys.path.join(folder, other), reason: "same-folder", by: sys.path.join(folder, first) });
  }

  let remaining = cap;
  const parts = [];
  for (const p of picked) {
    const buf = sys.readFile(p.path) || Buffer.alloc(0);
    const rec = { path: p.path, folder: p.folder, name: p.name, bytes: buf.length, status: null, includedBytes: 0, cutBytes: 0 };
    out.files.push(rec);
    if (remaining === 0) { rec.status = "left-out"; continue; }
    const slice = buf.subarray(0, remaining);
    const text = lossy(slice);
    if (text.trim() === "") { rec.status = "empty"; rec.includedBytes = 0; rec.cutBytes = Math.max(0, buf.length - slice.length); continue; }
    parts.push(text);
    rec.includedBytes = slice.length;
    rec.cutBytes = buf.length - slice.length;
    rec.status = rec.cutBytes > 0 ? "cut" : "included";
    remaining -= slice.length;
  }
  out.total = cap - remaining;
  const project = parts.length ? parts.join("\n\n") : null;
  if (cap === 0) out.files.forEach((f) => { f.status = "left-out"; f.includedBytes = 0; f.cutBytes = f.bytes; });
  const globalText = out.global ? out.global.text : null;
  if (globalText !== null && project !== null) out.body = `${globalText}${SEPARATOR}${project}`;
  else out.body = globalText !== null ? globalText : project;
  if (out.body !== null) {
    out.heading = project !== null ? `# AGENTS.md instructions for ${dir}` : "# AGENTS.md instructions";
    out.text = `${out.heading}\n\n<INSTRUCTIONS>\n${out.body}\n</INSTRUCTIONS>`;
  }
  out.chars = out.text === null ? 0 : out.text.length;
  out.bytesOfText = out.text === null ? 0 : Buffer.byteLength(out.text);
  // the first file that is cut or left out
  out.firstShort = out.files.find((f) => f.status === "cut" || f.status === "left-out") || null;
  return out;
}
