// What Codex 0.163.0 sent in the first request of a session, recorded with the fake API of test/codex-sandbox.mjs
// (`E2E_CODEX=... node test/record-oracles.mjs recorded` writes this file again; test/measure.mjs does the measuring). `cost` uses these
// where it cannot compute a figure from your files, and says so; test/e2e-cost.test.mjs compares them with a real first request.
export const RECORDED_ON = "2026-10-17";
export const RECORDED_CODEX = "0.163.0";
export const RECORDED_MODEL = "gpt-5.5";

/** The base instructions: the first developer message (characters). */
export const BASE_INSTRUCTIONS_CHARS = 21299;

/**
 * What differs from one system to another, recorded on each: the tool definitions of the first request (the JSON characters of each, with the
 * default configuration; exec_command and apply_patch are described differently on Windows), the permissions block (characters, by approval
 * policy and sandbox mode; `codex exec` always runs with approval "never", the other figures are those of an app-server thread, which the
 * terminal UI is built on; the workspace-write block names the writable folders, so its figure moves with the length of their paths), and the
 * environment block (characters at a working folder of cwdChars characters: the folder's path appears twice, seven times with workspace-write).
 */
export const BY_SYSTEM = {
  win32: {"on":"2026-10-17","tools":[["exec_command",2635],["write_stdin",784],["request_user_input",1355],["apply_patch",884],["view_image",526],["get_goal",281],["create_goal",760],["update_goal",2172],["tool_search",804],["web_search",89]],"permissions":{"never":{"read-only":342,"workspace-write":534,"danger-full-access":363},"on-request":{"read-only":3939,"workspace-write":4131,"danger-full-access":3960}},"environment":{"read-only":519,"workspace-write":1180,"danger-full-access":457},"cwdChars":62},
};

/**
 * What an enabled MCP server adds to the first request (put to Codex 0.163.0): these tools, after write_stdin, and a line "- <id>" in the
 * description of tool_search for a server that starts. The tools of the server itself are not in the request: Codex defers them behind
 * tool_search (2, 3, 30 and 60 tools gave the same request).
 */
export const MCP_TOOLS = [["list_mcp_resources",628],["list_mcp_resource_templates",717],["read_mcp_resource",526]];

// The skills block, as Codex builds it: the head, one line for each root (`rN`), the entries, the tail. The four skills Codex bundles are
// in $CODEX_HOME/skills/.system; the entries below name that root @R.
export const SKILLS_HEAD = "<skills_instructions>\n## Skills\nA skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and a short path that can be expanded into an absolute path using the skill roots table.\n### Skill roots\n";
export const SKILLS_LIST_HEAD = "### Available skills\n";
export const SKILLS_BUNDLED = [
  "- imagegen: Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when Codex should create a brand-new image, transform an existing image, or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas. (file: @R/imagegen/SKILL.md)",
  "- openai-docs: Use for Codex models/pricing, scheduled tasks, skills, settings, setup, troubleshooting, customization, automations, and self-knowledge—including 'you,' 'your,' 'this app,' or 'this coding agent' when they refer to Codex—and for OpenAI APIs/products and ChatGPT Work. Also use for model choice/migration, prompting, SDKs, Responses, Realtime, agents, evals, and Chat/Work/Codex comparisons. Do not use for generic app/software tasks that merely mention Codex. (file: @R/openai-docs/SKILL.md)",
  "- skill-creator: Create or update a Codex skill with appropriately scoped instructions and any needed supporting resources. (file: @R/skill-creator/SKILL.md)",
  "- skill-installer: Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). (file: @R/skill-installer/SKILL.md)"
];
export const SKILLS_TAIL = "### How to use skills\n- Discovery: The list above is the skills available in this session (name + description + short path). Skill bodies live on disk at the listed paths after expanding the matching alias from `### Skill roots`.\n- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.\n- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.\n- How to use a skill (progressive disclosure):\n  1) After deciding to use a skill, the main agent must expand the listed short `path` with the matching alias from `### Skill roots`, then open and read its `SKILL.md` completely before taking task actions. If a read is truncated or paginated, continue until EOF.\n  2) When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the directory containing that expanded `SKILL.md` first, and only consider other paths if needed.\n  3) If `SKILL.md` points to extra folders such as `references/`, use its routing instructions to identify the files required for the task. The main agent must read each required instruction or reference file itself before acting on it. Do not delegate reading, summarizing, or interpreting skill instructions to a subagent. Subagents may still perform task work when the selected skill allows it.\n  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.\n  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.\n- Coordination and sequencing:\n  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.\n  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.\n- Context hygiene:\n  - Progressive disclosure applies to selecting relevant files, not partially reading a selected instruction file. Do not load unrelated references, scripts, or assets.\n  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.\n  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.\n- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.\n</skills_instructions>";
