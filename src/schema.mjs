// Checking the keys of a parsed config file against what Codex knows (src/knowledge.mjs): a key Codex does not know (it ignores it, with
// a warning that `codex exec --json` does not print), and a value of the wrong type or outside the allowed words (Codex stops at start).
import { CHECKED_AGAINST, FEATURES, FEATURE_ALIASES, HOOK_EVENTS, REMOVED_KEYS, SCHEMA_LINES, TABLE_FEATURES } from "./knowledge.mjs";

const node = () => ({ children: new Map(), wild: null, open: false, type: null });

function build() {
  const root = node();
  for (const line of SCHEMA_LINES) {
    const [path, type] = line.split(" ");
    let at = root;
    const parts = path.split(".");
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (seg === "**") { at.open = true; break; }
      if (seg === "*") { at.wild = at.wild || node(); at = at.wild; continue; }
      if (!at.children.has(seg)) at.children.set(seg, node());
      at = at.children.get(seg);
    }
    if (!path.endsWith("**")) at.type = type;
  }
  return root;
}
const TRIE = build();

/** The top-level keys Codex knows. */
export const TOP_LEVEL_KEYS = [...TRIE.children.keys()];

const PHRASE = {
  s: "a string", b: "a boolean", i: "an integer", u: "a non-negative integer", n: "a number", t: "a table",
  "a:s": "an array of strings", "a:t": "an array of tables", bs: "a boolean or an array of strings", bt: "a boolean or a table",
};
const expectedWords = (type) => (type.startsWith("e:") ? `one of ${type.slice(2).split("|").map((x) => `\`${x}\``).join(", ")}` : PHRASE[type] || "a different type");

const describe = (entry) => {
  switch (entry.type) {
    case "string": return `string "${String(entry.value).slice(0, 40)}"`;
    case "integer": return `integer \`${entry.value}\``;
    case "float": return `floating point \`${entry.value}\``;
    case "boolean": return `boolean \`${entry.value}\``;
    case "datetime": return "datetime";
    case "array": return "array";
    default: return "table";
  }
};

/** null when the entry has the type, else what was wrong. */
function typeProblem(type, entry) {
  const isNum = entry.type === "integer" || entry.type === "float";
  switch (type) {
    case "x": return null;
    case "s": return entry.type === "string" ? null : "type";
    case "b": return entry.type === "boolean" ? null : "type";
    case "i": return entry.type === "integer" ? null : "type";
    case "u": return entry.type !== "integer" ? "type" : entry.value < 0 ? "range" : null;
    case "n": return isNum ? null : "type";
    case "t": return entry.type === "table" ? null : "type";
    case "bs": return entry.type === "boolean" || (entry.type === "array" && entry.value.every((v) => typeof v === "string")) ? null : "type";
    case "bt": return entry.type === "boolean" || entry.type === "table" ? null : "type";
    case "a:s": return entry.type === "array" && entry.value.every((v) => typeof v === "string") ? null : "type";
    case "a:t": return entry.type === "array" && entry.value.every((v) => v && typeof v === "object" && !Array.isArray(v)) ? null : "type";
    default:
      if (type.startsWith("e:")) {
        if (entry.type !== "string") return "type";
        return type.slice(2).split("|").includes(entry.value) ? null : "variant";
      }
      return null;
  }
}

/** The shortest key of the same table that is close to `name`, or null. */
function nearest(name, names) {
  let best = null;
  let bestD = 3;
  for (const n of names) {
    // a name that is the start of another (`network` for `network_access`) is near, whatever the length of the rest
    const prefix = name.length >= 4 && n.length > name.length && n.startsWith(name);
    const d = prefix ? 1 : distance(name.toLowerCase(), n.toLowerCase());
    if (d < bestD) { best = n; bestD = d; }
  }
  return best;
}
function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const dotted = (path) => path.filter((s) => typeof s === "string").join(".");

/** Resolves a key path in the schema: { status: "ok", at } | { status: "open" } | { status: "unknown", index, siblings }. */
function resolve(path) {
  let at = TRIE;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (typeof seg === "number") continue;
    if (at.open) return { status: "open" };
    const next = at.children.get(seg) || at.wild;
    if (!next) return { status: "unknown", index: i, siblings: [...at.children.keys()] };
    at = next;
  }
  return { status: "ok", at };
}

/**
 * Checks the entries of one parsed file. Returns problems:
 *   { id: "unknown-key", path, key, line, column, message, hint? }
 *   { id: "wrong-type", path, key, line, column, message, expected, got }
 *   { id: "key-removed", path, key, line, column, message }   (a key Codex still lists and refuses: `experimental_thread_store_endpoint`)
 * `kind` is "config" for config.toml and the profile and project files; `features` and `hooks` have their own tables.
 */
export function checkEntries(entries) {
  const problems = [];
  const seenUnknown = new Set();
  for (const entry of entries) {
    const path = entry.path;
    const top = path[0];
    // feature flags: a name from `codex features list`, a boolean (a table for the few that have options)
    if (top === "features") {
      if (path.length < 2) continue;
      const name = path[1];
      const known = Object.prototype.hasOwnProperty.call(FEATURES, name) || Object.prototype.hasOwnProperty.call(FEATURE_ALIASES, name);
      if (!known) {
        const key = `features.${name}`;
        if (!seenUnknown.has(key)) {
          seenUnknown.add(key);
          const near = nearest(name, Object.keys(FEATURES));
          problems.push({ id: "feature-unknown", path: ["features", name], key, line: entry.line, column: entry.column, message: `\`${key}\` is not a feature flag Codex ${CHECKED_AGAINST} knows`, hint: near ? `Did you mean \`${near}\`?` : null });
        }
        continue;
      }
      if (path.length === 2 && !(entry.type === "boolean" || (TABLE_FEATURES.has(name) && entry.type === "table"))) {
        problems.push({ id: "wrong-type", path, key: dotted(path), line: entry.line, column: entry.column, message: `\`${dotted(path)}\` must be a boolean`, expected: "a boolean", got: describe(entry) });
      }
      continue;
    }
    // hooks: an event name, or `state`
    if (top === "hooks") {
      if (path.length < 2) continue;
      const second = path[1];
      if (second === "state") continue;
      if (!HOOK_EVENTS.includes(second)) {
        const key = `hooks.${second}`;
        if (!seenUnknown.has(key)) {
          seenUnknown.add(key);
          const near = nearest(second, HOOK_EVENTS);
          problems.push({ id: "unknown-key", path: ["hooks", second], key, line: entry.line, column: entry.column, message: `\`${key}\` is not a hook event`, hint: near ? `Did you mean \`${near}\`?` : null });
        }
      }
      continue;
    }
    if (path.length === 1 && Object.prototype.hasOwnProperty.call(REMOVED_KEYS, top)) {
      problems.push({ id: "key-removed", path, key: top, line: entry.line, column: entry.column, message: REMOVED_KEYS[top] });
      continue;
    }
    const r = resolve(path);
    if (r.status === "open") continue;
    if (r.status === "unknown") {
      const prefix = path.slice(0, r.index + 1);
      const key = dotted(prefix);
      if (seenUnknown.has(key)) continue;
      seenUnknown.add(key);
      const name = String(path[r.index]);
      const near = nearest(name, r.siblings);
      let hint = near ? `Did you mean \`${near}\`?` : null;
      if (r.index >= 1 && TOP_LEVEL_KEYS.includes(name)) hint = `\`${name}\` is a top-level key of config.toml, and a \`[table]\` header before it makes it a key of that table: move it above the first header`;
      problems.push({ id: "unknown-key", path: prefix, key, line: entry.line, column: entry.column, message: `\`${key}\` is not a key Codex knows`, hint });
      continue;
    }
    const type = r.at.type;
    if (!type) {
      // a key that is a table (it has keys of its own, or any name below it) given a value that is not a table
      if ((r.at.children.size > 0 || r.at.wild) && entry.type !== "table") {
        const key = dotted(path);
        problems.push({ id: "wrong-type", path, key, line: entry.line, column: entry.column, message: `\`${key}\` must be a table, not ${describe(entry)}`, expected: "a table", got: describe(entry) });
      }
      continue;
    }
    const bad = typeProblem(type, entry);
    if (!bad) continue;
    const key = dotted(path);
    const words = bad === "variant" ? `must be ${expectedWords(type)}, not \`${entry.value}\`` : bad === "range" ? `must be ${expectedWords(type)}, not \`${entry.value}\`` : `must be ${expectedWords(type)}, not ${describe(entry)}`;
    problems.push({ id: "wrong-type", path, key, line: entry.line, column: entry.column, message: `\`${key}\` ${words}`, expected: expectedWords(type), got: describe(entry) });
  }
  return problems;
}
