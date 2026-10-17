// The layer worlds the layering is held to. A scenario: the user's config.toml (`user`, with the trust entries added from `trust`), the project's
// .codex/config.toml at each folder (`project`: { "": toml, "a": toml }), the working folder (`cwd`), and `trust`: entries for [projects]. An
// entry: { of: "root" | "cwd" | "parent" | "a" ..., level, style } where the style is how the path is written (native, forward, trailing,
// upper, unc, hint). test/record-oracles.mjs builds each on disk and asks Codex's app server (`config/read`, with the layers) which layers it loaded,
// whether each is disabled, and what each key came from; the record is test/fixtures/layers-oracle.json. test/layers.test.mjs holds
// src/layers.mjs to it; test/e2e-tables.test.mjs asks Codex again.
export const KEYS = ["model", "model_verbosity", "model_reasoning_effort", "service_tier", "project_doc_max_bytes", "sandbox_mode", "approval_policy", "tool_output_token_limit", "file_opener"];

const T = (of = "root", level = "trusted", style = "native") => ({ of, level, style });

export const SCENARIOS = [
  { name: "user config only", user: 'model = "u"\nmodel_verbosity = "low"\n' },
  { name: "no config at all", user: "" },
  { name: "a project layer, project not trusted", user: 'model = "u"\n', project: { "": 'model = "p"\nmodel_verbosity = "high"\n' } },
  { name: "a project layer, project root trusted", user: 'model = "u"\n', project: { "": 'model = "p"\nmodel_verbosity = "high"\n' }, trust: [T()] },
  { name: "a project layer, trust_level untrusted", user: 'model = "u"\n', project: { "": 'model = "p"\n' }, trust: [T("root", "untrusted")] },
  { name: "layers at the root and in a/b, the root trusted", user: 'model = "u"\nproject_doc_max_bytes = 1000\n', project: { "": 'model = "r"\nproject_doc_max_bytes = 2000\n', "a/b": 'model = "ab"\nmodel_verbosity = "low"\n' }, cwd: "a/b", trust: [T()] },
  { name: "layers at the root, a and a/b, the root trusted", user: 'model = "u"\n', project: { "": 'model = "r"\n', a: 'model = "a"\nfile_opener = "cursor"\n', "a/b": 'model = "ab"\n' }, cwd: "a/b", trust: [T()] },
  { name: "only a is trusted", user: 'model = "u"\n', project: { "": 'model = "r"\n', a: 'model = "a"\n', "a/b": 'model = "ab"\n' }, cwd: "a/b", trust: [T("a")] },
  { name: "only the working folder is trusted", user: 'model = "u"\n', project: { "": 'model = "r"\n', a: 'model = "a"\n', "a/b": 'model = "ab"\n' }, cwd: "a/b", trust: [T("cwd")] },
  { name: "the root trusted, a marked untrusted", user: 'model = "u"\n', project: { "": 'model = "r"\n', a: 'model = "a"\n' }, cwd: "a", trust: [T(), T("a", "untrusted")] },
  { name: "the parent of the repository trusted", user: 'model = "u"\n', project: { "": 'model = "r"\n' }, trust: [T("parent")] },
  { name: "the ten keys a project may not set", user: 'model = "u"\n', project: { "": 'model = "p"\nnotify = ["x"]\nmodel_provider = "other"\nprofile = "z"\nopenai_base_url = "http://127.0.0.1:1/v1"\nchatgpt_base_url = "http://127.0.0.1:1/"\napps_mcp_product_sku = "s"\nexperimental_realtime_ws_base_url = "ws://127.0.0.1:1"\n[model_providers.other]\nname = "o"\nbase_url = "http://127.0.0.1:1/v1"\n[profiles.q]\nmodel = "y"\n[otel]\nenvironment = "dev"\n' }, trust: [T()] },
  { name: "a profile", user: 'model = "u"\nmodel_verbosity = "low"\n', profileFile: { name: "work", text: 'model = "w"\nservice_tier = "fast"\n' }, noAppServer: true },
  { name: "tables merge key by key and arrays are replaced", user: 'project_doc_fallback_filenames = ["one.md", "two.md"]\n[features]\nhooks = false\nmemories = true\n[sandbox_workspace_write]\nnetwork_access = false\n', project: { "": 'project_doc_fallback_filenames = ["three.md"]\n[features]\nhooks = true\n[sandbox_workspace_write]\nnetwork_access = true\n' }, trust: [T()], probes: ["features.hooks", "features.memories", "project_doc_fallback_filenames", "sandbox_workspace_write.network_access"] },
  { name: "project_root_markers decide where the layers start", user: 'project_root_markers = [".hg"]\n', project: { "": 'model = "r"\n', a: 'model = "a"\n' }, cwd: "a", hg: true, trust: [T()] },
  { name: "the trust key written with forward slashes", user: 'model = "u"\n', project: { "": 'model = "p"\n' }, trust: [T("root", "trusted", "forward")], windowsOnly: true },
  { name: "the trust key with a trailing separator", user: 'model = "u"\n', project: { "": 'model = "p"\n' }, trust: [T("root", "trusted", "trailing")], windowsOnly: true },
  { name: "the trust key in capital letters", user: 'model = "u"\n', project: { "": 'model = "p"\n' }, trust: [T("root", "trusted", "upper")], windowsOnly: true },
  { name: "the trust key as Codex's own warning spells it (lower case)", user: 'model = "u"\n', project: { "": 'model = "p"\n' }, trust: [T("root", "trusted", "hint")], windowsOnly: true },
  { name: "the trust key with the \\\\?\\ prefix", user: 'model = "u"\n', project: { "": 'model = "p"\n' }, trust: [T("root", "trusted", "unc")], windowsOnly: true },
];
