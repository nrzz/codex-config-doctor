// The pages of `explain <finding-id>`: what a finding means, what Codex does in that case (each line marked verified, documented or not
// verified), the fix, and the documentation. "verified" means the line was put to Codex 0.163.0 (test/e2e-*.test.mjs run the cases against the real
// binary; the words in quotes are what it printed); "documented" means the documentation says so and the binary was not asked.
import { CATALOG, IDS } from "./catalog.mjs";

const V = "verified";
const D = "documented";
const N = "not verified";

const DOC = {
  config: "https://learn.chatgpt.com/docs/config-file/config-reference.md",
  advanced: "https://learn.chatgpt.com/docs/config-file/config-advanced.md",
  agents: "https://learn.chatgpt.com/docs/agent-configuration/agents-md.md",
  rules: "https://learn.chatgpt.com/docs/agent-configuration/rules.md",
  hooks: "https://learn.chatgpt.com/docs/hooks.md",
  winsandbox: "https://learn.chatgpt.com/docs/windows/windows-sandbox.md",
  mcp: "https://learn.chatgpt.com/docs/extend/mcp.md",
};

export const PAGES = {
  "codex-home": {
    means: "CODEX_HOME is set, and the folder it names does not exist or is a file. Codex keeps its configuration, AGENTS.md, rules and hooks in that folder.",
    does: [
      [V, "Codex stops at start (exit code 1) with: CODEX_HOME points to \"<path>\", but that path does not exist (or: but that path is not a directory)."],
      [V, "An empty CODEX_HOME counts as unset: Codex uses ~/.codex. A relative path is taken from the working folder; a path with spaces, a trailing separator or forward slashes works."],
      [V, "With CODEX_HOME unset, Codex on Windows opens the profile folder that Windows reports for the user, not the one in USERPROFILE: a test that only changes HOME and USERPROFILE reaches the real ~/.codex."],
    ],
    fix: ["Create the folder, or unset CODEX_HOME."],
    docs: [DOC.advanced],
  },
  "toml-error": {
    means: "A configuration file (the user's config.toml, a profile file, a project's .codex/config.toml, the system config.toml) is not valid TOML.",
    does: [
      [V, "Codex does not start. For the user's config.toml and for a profile file it prints \"Error loading config.toml:\", then the path with the line and the column, the line itself and a caret, for example: <path>:2:5: key with no value, expected `=`."],
      [V, "A trusted project's .codex/config.toml with a syntax error stops Codex too: \"Error loading config.toml: Error parsing project config file <path>: TOML parse error at line 2, column 5\" (exit code 1)."],
      [V, "An untrusted project's file is not opened: Codex starts and ignores it in silence, so lint reports the syntax error as a warning. The error is met the moment the folder is trusted, and a session with sandbox_mode \"danger-full-access\" trusts the folder first: \"Error: thread/start: thread/start failed: failed to load configuration: Error parsing project config file <path>: TOML parse error at line 2, column 5\" (exit code 1)."],
      [V, "A byte order mark at the start of a config.toml does not matter; CRLF line endings do not matter."],
    ],
    fix: ["Correct the syntax at the line the finding names. This tool reports the line from its own TOML reader, which agrees with Codex's on the cases in test/toml-table.mjs."],
    docs: [DOC.config],
  },
  "config-encoding": {
    means: "A configuration file is not UTF-8. The usual cause on Windows is a file written by Windows PowerShell 5.1 with > or Out-File (UTF-16 with a byte order mark).",
    does: [
      [V, "Codex does not start: \"Failed to read config file <path>: invalid utf-8 sequence of 1 bytes from index 0\" (exit code 1)."],
    ],
    fix: ["Save the file as UTF-8. In PowerShell 5.1 use Set-Content -Encoding utf8 (a UTF-8 file with a byte order mark is accepted for config.toml)."],
    docs: [DOC.config],
  },
  "unknown-key": {
    means: "The file sets a key that Codex does not know: a typo (aproval_policy), a key that moved, a key from a newer or older Codex, or a top-level key written under a [table] header (keys after a header belong to that table).",
    does: [
      [V, "Codex ignores the key and prints: \"warning: Codex is ignoring 1 unrecognized configuration setting. Check for typos or deprecated settings.\" and a line `user (<path>): `foo` is ignored.` in the terminal UI and in `codex exec`."],
      [V, "`codex exec --json` prints nothing on stderr; the same text arrives in the event stream as an `item.completed` event whose item has the type `error` (twice). A project's file and a profile file are treated the same."],
      [V, "`codex --strict-config exec` refuses to start: \"Error loading config.toml:\" <path>:5:1: unknown configuration field `foo`."],
      [V, "A feature flag that does not exist is reported as `features.hoks` is ignored; `--enable nosuch` stops with \"Error: Unknown feature flag: nosuch\"."],
      [N, "Keys that a Codex newer than 0.163.0 added are reported here as unknown; the list this tool checks against is Codex 0.163.0's."],
    ],
    fix: ["Correct the name, move a top-level key above the first [table] header, or delete the line."],
    docs: [DOC.config],
  },
  "wrong-type": {
    means: "A value has the wrong type (a string where a boolean goes), is out of range (a negative size), or is not one of the allowed words.",
    does: [
      [V, "Codex does not start (exit code 1). Examples it printed: \"Error loading config.toml: invalid type: string \"yes\", expected a boolean\" with \"in `features`\"; \"invalid type: integer `5`, expected a string in `review_model`\"; \"invalid value: integer `-1`, expected usize in `project_doc_max_bytes`\"; \"unknown variant `bogus`, expected one of `read-only`, `workspace-write`, `danger-full-access` in `sandbox_mode`\"."],
      [V, "`approval_policy = { granular = { ... } }` needs all five keys (sandbox_approval, rules, mcp_elicitations, request_permissions, skill_approval): with only sandbox_approval Codex prints \"missing field `rules`\"."],
      [V, "model_reasoning_effort takes any string; Codex does not check the word."],
    ],
    fix: ["Give the key a value of the type the finding names."],
    docs: [DOC.config],
  },
  "key-removed": {
    means: "The file sets a key that Codex 0.163.0 still lists in its schema and refuses with a message of its own. The only one it refuses this way is experimental_thread_store_endpoint.",
    does: [
      [V, "Codex does not start (exit code 1): \"Error: `experimental_thread_store_endpoint` is no longer supported; remove it from config.toml\"."],
      [V, "The key is not a typo: Codex knows it, so `--strict-config` has nothing to add and the unknown-key warning never appears. Only the check at start catches it."],
      [N, "A newer Codex may refuse more keys this way, or none; this tool lists the keys of 0.163.0."],
    ],
    fix: ["Delete the line."],
    docs: [DOC.config],
  },
  "ignored-in-project": {
    means: "A project's .codex/config.toml sets a key that only the user's config.toml may set. The ten keys are openai_base_url, chatgpt_base_url, apps_mcp_product_sku, model_provider, model_providers, notify, profile, profiles, experimental_realtime_ws_base_url and otel.",
    does: [
      [V, "Codex ignores those keys and uses the rest of the file. In `codex exec` it prints: \"warning: Ignored unsupported project-local config keys in <path>: model_provider, notify. If you want these settings to apply, manually set them in your user-level config.toml.\""],
      [V, "`codex exec --json` prints nothing on stderr; the warning arrives in the event stream as an `item.completed` event whose item has the type `error`. The keys are also left out of the merged configuration that the app server reports."],
    ],
    fix: ["Move the keys to the user's config.toml (the finding names it)."],
    docs: [DOC.advanced],
  },
  "untrusted-project": {
    means: "The project has a .codex folder (config.toml, hooks.json or rules) and the user's config.toml does not say the project is trusted, so Codex does not load any of it.",
    does: [
      [V, "Codex uses the user's configuration only. The project's config.toml, hooks and rules are ignored. `codex exec` prints nothing about it. The app server (which the terminal UI is built on) sends a warning: \"Project-local config, hooks, and exec policies are disabled in the following folders until the project is trusted, but skills still load.\" with, for each folder, \"To load project-local config, hooks, and exec policies, add <the folder, lower-cased on Windows> as a trusted project in <config.toml>.\""],
      [V, "`trust_level = \"untrusted\"` gives another sentence: \"<folder> is marked as untrusted in the effective configuration. To load project-local config, hooks, and exec policies, update its trust setting.\""],
      [V, "Skills in the project's .codex folder still load whether or not the project is trusted."],
      [V, "Trust is looked up by the folder's own entry, else by the entry of the Git root: with the Git root trusted, every .codex folder below it loads; trusting only a subfolder loads that folder's layer and not the root's. An entry for a parent of the repository does nothing. `trust_level = \"untrusted\"` is the same as no entry."],
      [V, "AGENTS.md files are read whether the project is trusted or not."],
      [V, "A syntax error in an untrusted project's config.toml does not stop Codex: the file is not opened."],
      [V, "`codex exec` with the sandbox set to danger-full-access (sandbox_mode in the file, --sandbox, -c, or --dangerously-bypass-approvals-and-sandbox) trusts the working folder by itself: after the run, the user's config.toml has a [projects.\"<folder>\"] table with trust_level = \"trusted\" (Codex writes the key in single quotes on Windows, where the folder is lower case with backslashes, and in double quotes elsewhere). `--sandbox workspace-write` does the same on Linux and macOS, where a sandbox can run it; on Windows with no sandbox selected it is read-only and writes nothing. The run that wrote it did not load the folder's file; the next run does, with its hooks and rules. An entry that is already there, even \"untrusted\", is left alone, and read-only and the default write nothing."],
    ],
    fix: ["Add [projects.'<path of the Git root>'] with trust_level = \"trusted\" to the user's config.toml, or trust the folder when Codex asks."],
    docs: [DOC.advanced],
  },
  "trust-key-spelling": {
    means: "The user's config.toml has a [projects.\"...\"] entry for this project that Codex does not match to the folder, because the text is not the one it compares.",
    does: [
      [V, "Codex compares the entry with the folder's path as Windows spells it: backslashes, no trailing separator, no \\\\?\\ prefix. On Windows case does not matter. An entry with forward slashes, a trailing backslash or a \\\\?\\ prefix matches nothing, and the project stays untrusted without a word."],
      [V, "The warning the app server sends for an untrusted project names the entry to add in lower case, with backslashes (add c:\\users\\you\\work as a trusted project), and an entry written exactly so trusts the folder. `codex exec` with danger-full-access writes the same spelling."],
      [N, "On Linux and macOS the entry that Codex wrote for a real path trusted the folder (checked on Ubuntu 24.04 and macOS 26 in CI); a folder reached through a symbolic link was not tried, and this tool resolves the path before it looks the entry up."],
    ],
    fix: ["Write the entry with the path exactly as `show` prints it."],
    docs: [DOC.advanced],
  },
  "profile-legacy": {
    means: "The configuration uses the old way of profiles: a top-level `profile = \"x\"` and `[profiles.x]` tables. Since Codex 0.134.0 a profile is a file, $CODEX_HOME/x.config.toml, chosen with --profile x.",
    does: [
      [V, "`profile = \"x\"` at the top level stops Codex: \"Error: legacy `profile = \"x\"` config is no longer supported; use `--profile x` with `x.config.toml` instead\"."],
      [V, "`--profile x` with a `[profiles.x]` table in config.toml stops Codex: \"--profile `x` cannot be used while <config.toml> contains legacy `profile = \"x\"` or `[profiles.x]` config; move those settings into <x.config.toml> and remove the legacy profile selector/table.\""],
      [V, "A `[profiles.x]` table that nothing uses is accepted in silence and does nothing."],
    ],
    fix: ["Move the settings into $CODEX_HOME/x.config.toml as top-level keys and delete the old table and selector."],
    docs: [DOC.advanced],
  },
  "profile-missing": {
    means: "--profile names a profile file that does not exist.",
    does: [
      [V, "Codex starts without a profile: exit code 0 and no message, so every setting that was to come from the file is missing."],
      [V, "A name that is not plain (../evil, a dot, a slash) is refused by the option parser: \"invalid --profile value `../evil`; pass a plain name such as `work`\" (exit code 2)."],
    ],
    fix: ["Create $CODEX_HOME/<name>.config.toml, or correct the name. This tool reads --profile from its own --profile option: pass the same name."],
    docs: [DOC.advanced],
  },
  "approval-deprecated": {
    means: "approval_policy is \"untrusted\" (no longer supported) or \"on-failure\" (deprecated).",
    does: [
      [V, "\"untrusted\": Codex stops: \"Error: approval_policy = \"untrusted\" is no longer supported; remove this setting\" (exit code 1)."],
      [V, "\"on-failure\": Codex starts. The permissions text it gives the model is the same as for \"on-request\" (same characters), and `codex exec` printed no warning."],
      [D, "The documentation calls \"on-failure\" deprecated and lists on-request, never and { granular = { ... } } as the values."],
      [V, "`codex exec` always runs with approval \"never\", whatever the file says; the setting counts in the terminal UI and in the app server."],
    ],
    fix: ["Use \"on-request\" or \"never\"."],
    docs: [DOC.config],
  },
  "feature-alias": {
    means: "A feature flag is set under its old name: features.codex_hooks is the old name of features.hooks.",
    does: [
      [V, "Codex honours it and prints: \"deprecated: `[features].codex_hooks` is deprecated. Use `[features].hooks` instead.\" and \"Enable it with `--enable hooks` or `[features].hooks` in config.toml.\""],
    ],
    fix: ["Rename the key to hooks."],
    docs: [DOC.config],
  },
  "feature-unknown": {
    means: "[features] names a flag that `codex features list` does not list: a typo, or a flag from another version.",
    does: [
      [V, "Codex ignores it and prints the unrecognized-setting warning (`features.hoks` is ignored); `--enable nosuch` stops with \"Error: Unknown feature flag: nosuch\"."],
      [N, "The list is Codex 0.163.0's (175 flags); a newer Codex may have more."],
    ],
    fix: ["Correct the name (the finding suggests the nearest one) or run `codex features list`."],
    docs: [DOC.config],
  },
  "feature-removed": {
    means: "[features] sets a flag that Codex has removed. `codex features list` shows it with the stage \"removed\" (42 of the 175 flags of Codex 0.163.0, among them js_repl, elevated_windows_sandbox, experimental_windows_sandbox, use_linux_sandbox_bwrap and tool_search).",
    does: [
      [V, "Codex accepts the line and does nothing with it: js_repl, elevated_windows_sandbox and tool_search set to true or false printed no warning in `codex exec`. A setting that people copy from old guides, such as elevated_windows_sandbox, looks as if it worked."],
    ],
    fix: ["Delete the line. For the Windows sandbox set `[windows] sandbox = \"unelevated\"` (or \"mxc\", or \"elevated\")."],
    docs: [DOC.config],
  },
  "feature-deprecated": {
    means: "[features] sets a flag that Codex lists as deprecated (web_search_request, web_search_cached, use_legacy_landlock, transcript_v2).",
    does: [
      [V, "Codex honours it and prints a notice such as: \"deprecated: `[features].web_search_request` is deprecated because web search is enabled by default.\""],
    ],
    fix: ["Follow the notice, or delete the line."],
    docs: [DOC.config],
  },
  "env-policy-mix": {
    means: "[shell_environment_policy] has `filters` and also `exclude` or `include_only` in the same file.",
    does: [
      [V, "Codex stops: \"Error loading config.toml: <path>:8:1: cannot mix `filters` with legacy `exclude` or `include_only`\" (exit code 1)."],
      [D, "The legacy arrays still work alone, and filter keys merge across layers."],
    ],
    fix: ["Use the filters table alone, or the arrays alone."],
    docs: [DOC.advanced],
  },
  "hooks-both-formats": {
    means: "A layer has hooks in its hooks.json and in an inline [hooks] table of its config.toml.",
    does: [
      [V, "Codex loads both and prints: \"warning: loading hooks from both <hooks.json> and <config.toml>; prefer a single representation for this layer\". Both sets run (when trusted)."],
      [V, "Each hook is trusted by its key, which names the file: moving a hook from one file to the other makes it a new hook that has to be trusted again."],
    ],
    fix: ["Keep the hooks of the layer in one file."],
    docs: [DOC.hooks],
  },
  "hooks-json-error": {
    means: "A hooks.json does not parse as JSON, or starts with a byte order mark (Windows PowerShell 5.1 writes one with Set-Content -Encoding UTF8).",
    does: [
      [V, "Codex prints \"warning: failed to parse hooks config <path>: key must be a string at line 1 column 3\" (for `{ not json`; the JSON error differs with the mistake) and loads none of the file's hooks. It starts, with exit code 0."],
      [V, "A byte order mark in front of valid JSON gives \"expected value at line 1 column 1\" and the same result."],
    ],
    fix: ["Correct the JSON; save it as UTF-8 without a byte order mark."],
    docs: [DOC.hooks],
  },
  "hook-field-unknown": {
    means: "A hook handler has a field Codex does not read, usually a misspelt one: timeout_sec or timeoutSec for timeout, status_message for statusMessage, additional_context_limit for additionalContextLimit.",
    does: [
      [V, "Codex drops the field in silence: `hooks/list` of the app server shows the handler without it, and neither `codex exec` nor the app server prints a warning. A timeout written as timeout_sec or timeoutSec leaves the default, 600 seconds (1 second for SessionEnd and Interrupt), so a hook meant to be killed after 5 seconds runs for ten minutes."],
      [V, "A command handler reads type, command, commandWindows (or command_windows), timeout, async, statusMessage and additionalContextLimit. An mcp_tool handler reads type, server, tool, input, timeout and statusMessage. The names are those of Codex's own handler type in the binary, and each was put to the app server."],
      [N, "Other handler types (prompt, agent) are not checked."],
    ],
    fix: ["Rename the field to the one Codex reads (the finding says which), or delete it."],
    docs: [DOC.hooks],
  },
  "hook-event-unknown": {
    means: "A hooks.json names an event that is not one of SessionStart, SessionEnd, SubagentStart, SubagentStop, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, Stop, Interrupt.",
    does: [
      [V, "Codex ignores the entry in silence: no warning, and the hooks under it never run. (An unknown event under [hooks] in config.toml is reported by `lint` as an unknown key.)"],
    ],
    fix: ["Use one of the event names; they are case sensitive."],
    docs: [DOC.hooks],
  },
  "hook-command-missing": {
    means: "A hook's command starts a program that is not found (not in PATH, not at the path given).",
    does: [
      [V, "The hook fails: Codex prints \"hook: PreToolUse\" and \"hook: PreToolUse Failed\" and goes on. A failing PreToolUse hook does not stop the tool call."],
      [V, "On Windows a hook command runs in PowerShell: a PowerShell cmdlet works, and `&&` does not work in Windows PowerShell 5.1."],
      [N, "This tool looks for the first word of the command in PATH (with PATHEXT) and skips shell builtins and cmdlets; a program that a shell finds some other way is reported."],
    ],
    fix: ["Install the program, fix PATH, or give the full path."],
    docs: [DOC.hooks],
  },
  "hook-untrusted": {
    means: "A hook has no trust record. Codex runs a non-managed hook only after it has been reviewed and trusted.",
    does: [
      [V, "Codex skips the hook. In `codex exec` it says nothing at all. The trust is a record in the user's config.toml: [hooks.state.\"<key>\"] trusted_hash = \"sha256:...\", where the key is <path of the file>:<event>:<group>:<handler>."],
      [V, "The app server reports the hook as \"untrusted\"; `--dangerously-bypass-hook-trust` runs hooks without the record (and also runs the hooks of a project that is not trusted)."],
      [D, "In the terminal UI, /hooks lists the hooks for review."],
    ],
    fix: ["Review and trust the hook with /hooks, or add the record the finding prints (its hash is the SHA-256 of the hook's canonical JSON; `show` prints each hook's key and hash)."],
    docs: [DOC.hooks],
  },
  "hook-modified": {
    means: "A hook was trusted, and its definition changed since: the hash in the record no longer matches.",
    does: [
      [V, "The app server reports the hook as \"modified\" and Codex skips it. `codex exec` says nothing."],
      [V, "Any change to the command, the timeout, async, the status message, the matcher or the event changes the hash."],
    ],
    fix: ["Review the hook again with /hooks, or update trusted_hash to the hash the finding prints."],
    docs: [DOC.hooks],
  },
  "hook-ask-unsupported": {
    means: "A hook script answers permissionDecision \"ask\" for a tool call.",
    does: [
      [D, "The documentation says Codex parses \"ask\" and does not support it; using it marks the hook run as failed."],
      [V, "A PreToolUse hook that printed permissionDecision \"ask\" changed nothing: the command ran, with no question and no message. \"deny\" and { \"decision\": \"block\" } stopped it: \"Command blocked by PreToolUse hook: <reason>. Command: <command>\" (the model gets the same text)."],
      [N, "This tool looks for the word in the script a hook command runs (a file it can read); the binary was not asked about other scripts. That the hook run is marked as failed is the documentation's word; Codex printed nothing about it."],
    ],
    fix: ["Answer allow or deny, and leave asking to approval_policy and the rules."],
    docs: [DOC.hooks],
  },
  "hooks-feature-off": {
    means: "[features] hooks = false while hooks are defined.",
    does: [
      [V, "Codex starts and runs none of the hooks, in silence."],
    ],
    fix: ["Remove hooks = false, or delete the hooks."],
    docs: [DOC.hooks],
  },
  "agents-md-over-cap": {
    means: "The AGENTS.md files of the project add up to more than project_doc_max_bytes (32768 by default).",
    does: [
      [V, "Codex reads the files from the project root down to the working folder, one per folder, until the cap is used. The file that crosses it is cut at the byte (a character split in the middle becomes U+FFFD); the files after it are left out."],
      [V, "Nothing is printed in `codex exec`; the terminal UI was not driven. The global AGENTS.md is not counted against the cap. Separators are not counted. A file with only white space is skipped and costs nothing."],
      [V, "The files nearest the working folder come last, so they are the ones that are cut."],
    ],
    fix: ["Raise project_doc_max_bytes, shorten the files, or move guidance down into the folders it is about."],
    docs: [DOC.agents],
  },
  "agents-md-empty": {
    means: "An AGENTS.md has no text (empty, or white space only).",
    does: [[V, "Codex skips it; it adds nothing and takes none of the cap."]],
    fix: ["Delete it or write it."],
    docs: [DOC.agents],
  },
  "agents-md-shadowed": {
    means: "Two instruction files are in one folder and Codex reads one: AGENTS.override.md hides AGENTS.md, and AGENTS.md hides the names in project_doc_fallback_filenames.",
    does: [
      [V, "Codex takes the first file it finds in a folder in that order, as a file (a folder named AGENTS.md is passed over), and reads that one. If it has no text, the folder adds nothing: an empty AGENTS.override.md hides a full AGENTS.md."],
      [V, "In the Codex home, the first file with text wins: an empty AGENTS.override.md there does not hide AGENTS.md."],
    ],
    fix: ["Delete the file you do not mean, or merge them."],
    docs: [DOC.agents],
  },
  "agents-md-encoding": {
    means: "An instruction file is UTF-16 (Windows PowerShell 5.1 writes UTF-16 with > and Out-File), has NUL bytes, is not valid UTF-8, or starts with a byte order mark.",
    does: [
      [V, "Codex reads it as UTF-8 without checking: UTF-16 reaches the model as replacement characters and NUL characters between the letters; an invalid byte becomes U+FFFD; a byte order mark stays as the first character."],
    ],
    fix: ["Save the file as UTF-8 (without a byte order mark)."],
    docs: [DOC.agents],
  },
  "rules-syntax": {
    means: "A .rules file in a rules folder does not load: a syntax error, a call Codex rejects (a decision other than allow, prompt or forbidden, an empty pattern, an unknown argument), or a byte order mark.",
    does: [
      [V, "`codex exec` does not start. It prints \"Error loading rules:\" and <file>:<line>: starlark error: ... (exit code 1), for example \"Parse error: unexpected new line, expected symbol ')'\" or \"invalid input `\\ufeff`\" for a byte order mark. For a bracket that is never closed the line is the one after the last line of the file."],
      [V, "The app server, which the terminal UI is built on, starts the session anyway and sends the warning \"Error parsing rules; custom rules not applied.\" It applies none of your rules, in any file: with a forbidden rule in one file and a syntax error in another, the command the forbidden rule blocks ran. A session that has this warning is not protected by your rules."],
      [V, "Only files named *.rules (lower case) directly in the rules folder are read; a subfolder, another extension, UPPER.RULES and a file outside rules/ are not. `codex execpolicy check --rules <file> -- <command>` loads a file and prints the same errors."],
    ],
    fix: ["Correct the file; save it without a byte order mark."],
    docs: [DOC.rules],
  },
  "rules-example-fails": {
    means: "A match example matches no rule, or a not_match example matches the rule it is written in.",
    does: [
      [V, "`codex exec` does not start: \"Error loading rules:\" with \"expected every example to match at least one rule ... unmatched examples: [\"git push\"]\" or \"expected example to not match rule `PrefixRuleMatch { ... }`: git pull x\" (exit code 1)."],
      [V, "The app server, which the terminal UI is built on, starts the session and sends the warning \"Error parsing rules; custom rules not applied.\": none of your rules applies, in any file."],
      [V, "Every example is held to the rule it is written in: a match example that only another rule matches (in the same file or in another) fails like one that nothing matches, and a not_match example must not match its own rule."],
    ],
    fix: ["Correct the example or the pattern."],
    docs: [DOC.rules],
  },
  "rules-shadowed": {
    means: "An allow rule that a prompt or forbidden rule always overrides, because the stricter rule's pattern is a prefix of the allow rule's.",
    does: [
      [V, "When several rules match, the strictest decision wins (forbidden, then prompt, then allow). `codex execpolicy check` prints every matched rule and the decision of the strictest."],
    ],
    fix: ["Delete the allow rule or narrow the stricter one."],
    docs: [DOC.rules],
  },
  "rules-allow-ignored": {
    means: "An allow rule whose whole pattern is one of the 88 prefixes Codex keeps in a table of its own: a shell alone or with -c or -lc (bash, sh, zsh, fish, dash, ksh, cmd, powershell, pwsh ...), an interpreter alone or with -e, -c or -r (python, node, perl, ruby, php, lua, deno, bun, julia ...), git, env, rm, sudo, osascript, Rscript, and `npm run`, `pnpm run`, `yarn run`, `bun run`, `py -3`.",
    does: [
      [V, "Codex does not honour the rule: the command is handled as if no rule matched. With no Windows sandbox selected (where every command asks) `git --version` under prefix_rule(pattern=[\"git\"], decision=\"allow\") was refused with approval never, and asked with on-request; a script that needs to write outside the project stayed in the sandbox."],
      [V, "Only the whole pattern counts: [\"git\", \"status\"], [\"node\", \"build.mjs\"], [\"deno\", \"run\"], [\"rm\", \"-rf\"], [\"npm\"], [\"npm\", \"exec\"], [\"powershell\", \"-ec\"] are honoured, and a prompt or forbidden rule on a banned prefix is honoured. The table is in the binary (the model is told not to suggest these prefixes); test/banned.mjs reads it from the Windows executable and test/e2e-why.test.mjs puts every prefix to the binary."],
    ],
    fix: ["Make the pattern longer, for example [\"git\", \"status\"], or write the exact command you mean."],
    docs: [DOC.rules],
  },
  "rules-unevaluated": {
    means: "A .rules file uses a Starlark construct this tool does not run (lambda, while, load, *args, slice steps, a method it does not have). Codex runs the whole language.",
    does: [
      [D, "The rules file is a Starlark program, evaluated when Codex starts."],
      [N, "This tool runs assignments, if and for statements, list and dict comprehensions, def with plain parameters, string formatting and the common methods; it reports the rest as unevaluated and says nothing about the rules in that file."],
    ],
    fix: ["Test the file with `codex execpolicy check --rules <file> -- <command>`."],
    docs: [DOC.rules],
  },
  "mcp-command-missing": {
    means: "An MCP server with a `command` whose program is not found. A common cause is a command line in `command` (\"node server.js\"): `command` is the program, `args` the arguments.",
    does: [
      [V, "Codex skips the server and says nothing in `codex exec` (exit code 0). The model never sees its tools; the request still carries the three resource tools that any enabled MCP server brings."],
      [V, "With `required = true` Codex stops (exit code 1). On Windows it says \"required MCP servers failed to initialize: x: program not found\"; on Linux and macOS, \"required MCP servers failed to initialize: x: No such file or directory (os error 2)\"."],
      [V, "On Windows `tool` finds tool.cmd and tool.bat through PATHEXT, and a full path without the extension is completed the same way; tool.ps1 and a file with no extension are not found."],
    ],
    fix: ["Install the program, fix PATH, split command and args."],
    docs: [DOC.mcp],
  },
  "mcp-invalid": {
    means: "An [mcp_servers.x] table with both a command and a url, with neither, or with an option that goes with the other transport.",
    does: [
      [V, "Codex stops: \"Error loading config.toml: url is not supported for stdio ... in `mcp_servers.x`\"; \"invalid transport\" for none; \"bearer_token_env_var is not supported for stdio\" for a command with a bearer token variable."],
    ],
    fix: ["Use a command (a program Codex starts) or a url (a server it connects to)."],
    docs: [DOC.mcp],
  },
  "provider-reserved-id": {
    means: "[model_providers.openai], [model_providers.ollama] or [model_providers.lmstudio]: the three ids Codex has built in.",
    does: [
      [V, "Codex stops: \"model_providers contains reserved built-in provider IDs: `openai`. Built-in providers cannot be overridden. Rename your custom provider (for example, `openai-custom`).\""],
    ],
    fix: ["Rename the provider and set model_provider to the new id."],
    docs: [DOC.config],
  },
  "provider-wire-api": {
    means: "A provider with wire_api other than \"responses\".",
    does: [
      [V, "Codex stops. For \"chat\": \"`wire_api = \"chat\"` is no longer supported. How to fix: set `wire_api = \"responses\"` in your provider config.\" For any other word: \"unknown variant `banana`, expected `responses`\"."],
    ],
    fix: ["Set wire_api = \"responses\"; the server must speak the Responses API."],
    docs: [DOC.config],
  },
  "provider-undefined": {
    means: "model_provider names a provider that is neither built in nor defined in [model_providers].",
    does: [[V, "Codex stops: \"Error: Model provider `nope` not found\"."]],
    fix: ["Define the provider in the user's config.toml. A project's config.toml may not set model_provider or model_providers (ignored-in-project)."],
    docs: [DOC.config],
  },
  "provider-env-key-unset": {
    means: "The selected provider reads its API key from the variable named in env_key, and that variable is not set (or is empty) where this tool runs.",
    does: [[V, "Codex stops at the first request: \"ERROR: Missing environment variable: `FAKE_API_KEY`.\" (exit code 1)."], [N, "This tool looks at its own environment: a desktop app or an editor may start Codex with another one."]],
    fix: ["Set the variable in the environment Codex starts in."],
    docs: [DOC.config],
  },
  "provider-base-url": {
    means: "A custom provider with no base_url.",
    does: [[V, "Codex connects to https://api.openai.com/ whatever the provider is called: with RUST_LOG=reqwest=debug the connection log names that host for a provider with no base_url, and the provider's own address for one that has one."]],
    fix: ["Add base_url."],
    docs: [DOC.config],
  },
  "provider-conflict": {
    means: "A provider with no name, or with an auth table and an env_key.",
    does: [[V, "Codex stops: \"model_providers.fake: provider name must not be empty\"; \"model_providers.fake: provider auth cannot be combined with env_key\"."]],
    fix: ["Add the name; keep auth or env_key."],
    docs: [DOC.config],
  },
  "windows-sandbox": {
    means: "On Windows no sandbox implementation is selected (windows.sandbox is not set and features.prefer_mxc is not true), or the one selected cannot work on this machine.",
    does: [
      [V, "Codex has no sandbox to run commands in. The sandbox log says \"Windows sandbox selection: disabled\"."],
      [V, "sandbox_mode = \"workspace-write\" (also the default of a trusted project) becomes read-only in the prompt the model gets: \"`sandbox_mode` is `read-only`\". An untrusted project is read-only by default."],
      [V, "With approval_policy on-request every command that no allow rule covers asks first, even `echo hi`; with never it is refused: \"rejected: ... blocked by policy\"."],
      [V, "With windows.sandbox = \"unelevated\", or \"mxc\" on a Windows that has MXC, the same commands run inside the sandbox without asking (a write outside the project fails with EPERM)."],
      [V, "features.prefer_mxc = true picks MXC only when there is one: the sandbox log says \"MXC availability: true\" and \"Windows sandbox selection: mxc\". Where it says \"MXC availability: false\" (Windows Server 2025, build 26100) the selection is \"disabled\": Codex does not fall back to unelevated. An explicit windows.sandbox = \"mxc\" is selected whether or not MXC is available."],
      [V, "`windows.sandbox = \"bogus\"` stops Codex: \"unknown variant `bogus`, expected one of `elevated`, `unelevated`, `mxc`\"."],
      [D, "MXC needs Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278 or newer; \"elevated\" needs administrator-approved setup once; \"unelevated\" is a weaker fallback."],
      [N, "Elevated setup needs an administrator and was not run. The Linux and macOS sandboxes are not covered by this finding."],
    ],
    fix: ["Add [windows] sandbox = \"unelevated\" to config.toml (no administrator needed), or \"mxc\" on a supported build; probe it with: codex -c windows.sandbox=mxc sandbox --include-managed-config --permission-profile :workspace -- cmd.exe /d /c echo MXC_OK"],
    docs: [DOC.winsandbox],
  },
};

export { IDS };

/** Every page with its id, title, and basis. */
export function pageFor(id) {
  const key = String(id || "").toLowerCase();
  if (!PAGES[key]) return null;
  const meta = CATALOG[key];
  return { id: key, title: meta.title, severity: meta.severity, basis: meta.basis, ...PAGES[key] };
}

export function listPages() {
  return IDS.map((id) => ({ id, title: CATALOG[id].title, severity: CATALOG[id].severity, basis: CATALOG[id].basis }));
}

/** The ids nearest to a name that is not one. */
export function nearIds(text) {
  const t = String(text || "").toLowerCase();
  const scored = IDS.map((id) => ({ id, score: id.includes(t) || t.includes(id) ? 0 : distance(id, t) })).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return scored.filter((x) => x.score <= Math.max(3, Math.floor(t.length / 3))).slice(0, 4).map((x) => x.id);
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
