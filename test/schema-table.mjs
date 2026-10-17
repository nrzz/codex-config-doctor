// The keys of config.toml the tool knows (src/knowledge.mjs) put to Codex. GROUPS are config.toml files that set every key of the schema with a
// value of its type (the keys that cannot stand in one file with the rest have a group of their own); Codex's app server lists the keys it
// ignores in a `configWarning` notification, and there must be none. TYPOS are keys Codex must list. WRONG is, for each key of the schema, a value of the
// wrong type; Codex must refuse the file. test/record-oracles.mjs writes the answers to test/fixtures/schema-oracle.json.
import { FEATURES, SCHEMA_LINES } from "../src/knowledge.mjs";

/** Keys that stay out of the groups, and why. */
export const EXCLUDED = {
  profile: "the old profile form stops Codex whatever it holds",
  "profiles.**": "the old profile form",
  approval_policy: "its type is a word or a table: tested on its own",
  model_instructions_file: "must name a file that exists",
  model_catalog_json: "must name a file that exists",
  experimental_compact_prompt_file: "must name a file that exists",
  forced_chatgpt_workspace_id: "must be a workspace id",
  forced_login_method: "changes how Codex signs in",
  notify: "starts a program",
  default_permissions: "must name a permissions profile that exists",
  oss_provider: "changes the provider",
  model_provider: "must name a provider that exists",
  "agents.max_threads": "the old name of agents.max_concurrent_threads_per_session: both in one file is an error (the alias group holds it)",
  "memories.no_memories_if_mcp_or_web_search": "the old name of memories.disable_on_external_context: both in one file is an error (the alias group holds it)",
};

const ABSOLUTE = process.platform === "win32" ? "C:\\ccd-x" : "/ccd-x";
/** Keys Codex reads as an absolute path: a relative value is refused ("AbsolutePathBuf deserialized without a base path"). */
const ABSOLUTE_PATHS = new Set(["log_dir", "sqlite_home", "js_repl_node_path", "js_repl_node_module_dirs"]);
const sample = (type, path = "") => {
  if (ABSOLUTE_PATHS.has(path) && type === "s") return ABSOLUTE;
  if (ABSOLUTE_PATHS.has(path) && type === "a:s") return [ABSOLUTE];
  if (type === "s") return "x";
  if (type === "b") return true;
  if (type === "i" || type === "u") return 1;
  if (type === "n") return 1;
  if (type === "t") return {};
  if (type === "a:s") return ["x"];
  if (type === "a:t") return [{}];
  if (type === "bs") return true;
  if (type.startsWith("e:")) return type.slice(2).split("|")[0];
  return "x";
};

/** A value of the wrong type for the type (and one more that is outside the allowed words for an enum). */
export function wrongSamples(type) {
  if (type === "s") return [1];
  if (type === "b") return ["yes"];
  if (type === "i") return ["x", 1.5];
  if (type === "u") return ["x", -1];
  if (type === "n") return ["x"];
  if (type === "t") return ["x"];
  if (type === "a:s") return ["x", [1]];
  if (type === "a:t") return ["x"];
  if (type === "bs") return [1];
  if (type.startsWith("e:")) return ["bogus-word", 1];
  return [];
}

const set = (obj, path, value) => {
  let at = obj;
  for (let i = 0; i < path.length - 1; i++) { at[path[i]] = at[path[i]] && typeof at[path[i]] === "object" && !Array.isArray(at[path[i]]) ? at[path[i]] : {}; at = at[path[i]]; }
  at[path[path.length - 1]] = value;
};

/** A TOML text for a nested object. */
export function toToml(obj) {
  const lines = [];
  const scalar = (v) => (typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(scalar).join(", ")}]` : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${key(k)} = ${scalar(x)}`).join(", ")} }` : String(v));
  const key = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
  const emit = (o, prefix) => {
    const tables = [];
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) tables.push([k, v]);
      else lines.push(`${key(k)} = ${scalar(v)}`);
    }
    for (const [k, v] of tables) {
      const name = [...prefix, k];
      const hasScalar = Object.values(v).some((x) => !(x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length > 0));
      if (hasScalar) lines.push("", `[${name.map(key).join(".")}]`);
      emit(v, name);
    }
  };
  emit(obj, []);
  return `${lines.join("\n")}\n`;
}

/** The leaves of the schema that have a type that can be tested: [{ path (with * for any name), type }]. */
export function leaves() {
  const out = [];
  for (const line of SCHEMA_LINES) {
    const [path, type] = line.split(" ");
    if (path.endsWith("**") || type === "x") continue;
    if (Object.prototype.hasOwnProperty.call(EXCLUDED, path)) continue;
    out.push({ path, type });
  }
  return out;
}

/** The context a key needs to stand in a valid file. */
const CONTEXT = {
  mcp_servers: { name: "x", base: { command: "x" } },
  model_providers: { name: "p", base: { name: "p", base_url: "http://127.0.0.1:9/v1", env_key: "X" } },
  agents: { name: "x", base: {} },
};

/** The key path of a schema path with every `*` made a name that fits (p for providers, A* for environment filters, x otherwise). */
export const concretePath = (path) => path.split(".").map((s, i, all) => (s === "*" ? (all[0] === "model_providers" ? "p" : all[0] === "shell_environment_policy" ? "A*" : "x") : s));
const concrete = concretePath;

/** A config.toml that sets the key of the schema path to `value`, in the context the key needs to stand in a file. */
export function wrongToml(schemaPath, value) {
  const parts = concretePath(schemaPath);
  const o = {};
  let at = o;
  parts.forEach((p, i) => { if (i === parts.length - 1) at[p] = value; else { at[p] = {}; at = at[p]; } });
  if (parts[0] === "mcp_servers") o.mcp_servers[parts[1]].command = o.mcp_servers[parts[1]].command || "x";
  if (parts[0] === "model_providers") Object.assign(o.model_providers[parts[1]], { name: "p", ...o.model_providers[parts[1]] });
  return toToml(o);
}

/** The groups: [{ name, toml, covers: [path] }]. */
export function groups() {
  const g = { top: {}, mcp: {}, providers: {}, envfilters: {}, envlegacy: {} };
  const covers = { top: [], mcp: [], providers: [], envfilters: [], envlegacy: [] };
  for (const { path, type } of leaves()) {
    const parts = concrete(path);
    let where = "top";
    if (parts[0] === "mcp_servers") where = "mcp";
    else if (parts[0] === "model_providers") where = "providers";
    else if (parts[0] === "shell_environment_policy") where = parts[1] === "exclude" || parts[1] === "include_only" ? "envlegacy" : "envfilters";
    if (where === "mcp" && /^(oauth|bearer_token_env_var|http_headers|env_http_headers|url|auth|scopes|oauth_resource)/.test(parts.slice(2).join("."))) continue;
    set(g[where], parts, sample(type, path));
    covers[where].push(path);
  }
  g.mcp.mcp_servers = { x: { ...(g.mcp.mcp_servers ? g.mcp.mcp_servers.x : {}), ...CONTEXT.mcp_servers.base } };
  g.providers.model_providers = { p: { ...CONTEXT.model_providers.base, ...(g.providers.model_providers ? g.providers.model_providers.p : {}) } };
  const features = {};
  for (const name of Object.keys(FEATURES)) features[name] = false;
  const fg = { features };
  return [
    { name: "top-level keys and small tables", toml: toToml(g.top), covers: covers.top },
    { name: "an MCP server with a command", toml: toToml(g.mcp), covers: covers.mcp },
    { name: "a model provider", toml: toToml(g.providers), covers: covers.providers },
    { name: "the environment policy with filters", toml: toToml(g.envfilters), covers: covers.envfilters },
    { name: "the environment policy with the legacy arrays", toml: toToml(g.envlegacy), covers: covers.envlegacy },
    { name: "every feature flag", toml: toToml(fg), covers: Object.keys(FEATURES).map((n) => `features.${n}`) },
    { name: "the old names of two keys", toml: "[agents]\nmax_threads = 1\n\n[memories]\nno_memories_if_mcp_or_web_search = true\n", covers: ["agents.max_threads", "memories.no_memories_if_mcp_or_web_search"] },
  ];
}

/** Keys that are not Codex's: it must list each as ignored. */
export const TYPOS = [
  "aproval_policy = \"never\"", "sandbox-mode = \"read-only\"", "modle = \"gpt-5.5\"", "project_doc_max_byte = 100", "project_root_marker = []",
  "[features]\nhoks = true", "[features]\ncodex_hook = true", "[features]\nsandbox = true", "[windows]\nsandbx = \"mxc\"", "[tui]\nnotification = true",
  "[history]\npersistance = \"none\"", "[mcp_servers.x]\ncommand = \"x\"\nargz = []", "[mcp_servers.x]\ncommand = \"x\"\nenabeld = true",
  "[sandbox_workspace_write]\nnetwork = true", "[shell_environment_policy]\ninherits = \"all\"", "[model_providers.p]\nname = \"p\"\nbase_url = \"http://127.0.0.1:9/v1\"\nwire = \"responses\"",
  "[projects.'C:\\x']\ntrust = \"trusted\"", "foo = 1", "[foo]\nbar = 1", "[agents]\nenable = true", "[memories]\nuse_memory = true",
];

export { sample };
