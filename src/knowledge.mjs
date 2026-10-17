// What Codex CLI 0.163.0 knows about its own configuration: the keys of config.toml and the type each takes, the feature flags, the
// hook events, the keys a project layer may not set. It was collected from the configuration reference, from `codex features list`
// and from putting keys to the real binary (test/e2e-schema.test.mjs does that on every run with E2E_CODEX set). A newer Codex may
// know more: a finding about a key says so.
export const CHECKED_AGAINST = "0.163.0";

// ---- the keys of config.toml ----------------------------------------------------------------------------------------------------
//
// One line per key: "path type". A path is dotted; `*` stands for any name, and `**` for anything below (a table this tool does not
// list key by key). Types:
//   s string   b boolean   i integer   u integer >= 0   n integer or float
//   t table    x anything  bs boolean or array of strings   bt boolean or table
//   a:s array of strings   a:t array of tables   e:one|two|three  one of these strings
export const SCHEMA_LINES = `
model s
review_model s
model_provider s
openai_base_url s
chatgpt_base_url s
apps_mcp_product_sku s
model_context_window i
model_auto_compact_token_limit n
model_auto_compact_token_limit_scope e:total|body_after_prefix
model_post_turn_compact_threshold_percent n
model_catalog_json s
oss_provider e:lmstudio|ollama
approval_policy x
approvals_reviewer e:user|auto_review|guardian_subagent
auto_review.** x
allow_login_shell b
allow_symlinked_codex_home b
sandbox_mode e:read-only|workspace-write|danger-full-access
sandbox_workspace_write.writable_roots a:s
sandbox_workspace_write.network_access b
sandbox_workspace_write.exclude_tmpdir_env_var b
sandbox_workspace_write.exclude_slash_tmp b
default_permissions s
permissions.** x
windows.sandbox e:mxc|elevated|unelevated
windows_wsl_setup_acknowledged x
browser_use.** x
computer_use.** x
notify a:s
check_for_update_on_startup b
feedback.enabled b
analytics.enabled b
instructions s
developer_instructions s
include_permissions_instructions b
include_apps_instructions b
include_collaboration_mode_instructions b
include_environment_context b
include_environment_context_time b
log_dir s
sqlite_home s
compact_prompt s
model_instructions_file s
experimental_compact_prompt_file s
personality e:none|friendly|pragmatic
service_tier s
skills.** x
apps.** x
tool_suggest.** x
goals.** x
cloud.** x
daybreak.** x
orchestrator.** x
realtime.** x
audio.** x
ghost_snapshot.** x
features.** x
hooks.** x
mcp_optional_startup_grace_ms n
mcp_oauth_credentials_store e:auto|file|keyring
mcp_oauth_callback_port i
mcp_oauth_callback_url s
mcp_enterprise_managed_auth x
mcp_servers.*.command s
mcp_servers.*.args a:s
mcp_servers.*.env t
mcp_servers.*.env.* s
mcp_servers.*.env_vars x
mcp_servers.*.cwd s
mcp_servers.*.url s
mcp_servers.*.auth e:oauth|chatgpt
mcp_servers.*.oauth.client_id s
mcp_servers.*.oauth.client_secret s
mcp_servers.*.oauth.callback_url s
mcp_servers.*.oauth.callback_port i
mcp_servers.*.bearer_token_env_var s
mcp_servers.*.http_headers t
mcp_servers.*.http_headers.* s
mcp_servers.*.http_headers_helper s
mcp_servers.*.env_http_headers t
mcp_servers.*.env_http_headers.* s
mcp_servers.*.enabled b
mcp_servers.*.required b
mcp_servers.*.startup_timeout_sec n
mcp_servers.*.startup_timeout_ms n
mcp_servers.*.tool_timeout_sec n
mcp_servers.*.enabled_tools a:s
mcp_servers.*.disabled_tools a:s
mcp_servers.*.default_tools_approval_mode e:auto|prompt|writes|approve
mcp_servers.*.tools.** x
mcp_servers.*.scopes a:s
mcp_servers.*.oauth_resource s
agents.enabled b
agents.max_concurrent_threads_per_session n
agents.max_threads n
agents.max_depth n
agents.default_subagent_model s
agents.default_subagent_reasoning_effort s
agents.job_max_runtime_seconds n
agents.interrupt_message b
agents.*.description s
agents.*.config_file s
agents.*.nickname_candidates a:s
agents.*.* x
memories.generate_memories b
memories.use_memories b
memories.disable_on_external_context b
memories.no_memories_if_mcp_or_web_search b
memories.max_raw_memories_for_consolidation n
memories.max_unused_days n
memories.max_rollout_age_days n
memories.max_rollouts_per_startup n
memories.min_rollout_idle_hours n
memories.min_rate_limit_remaining_percent n
memories.extract_model s
memories.consolidation_model s
model_providers.*.name s
model_providers.*.base_url s
model_providers.*.model_catalog_url s
model_providers.*.capabilities.** x
model_providers.*.env_key s
model_providers.*.env_key_instructions s
model_providers.*.experimental_bearer_token s
model_providers.*.requires_openai_auth b
model_providers.*.wire_api e:responses
model_providers.*.query_params t
model_providers.*.query_params.* s
model_providers.*.http_headers t
model_providers.*.http_headers.* s
model_providers.*.env_http_headers t
model_providers.*.env_http_headers.* s
model_providers.*.request_max_retries n
model_providers.*.stream_max_retries n
model_providers.*.stream_idle_timeout_ms n
model_providers.*.websocket_connect_timeout_ms n
model_providers.*.supports_websockets b
model_providers.*.supports_standalone_web_search b
model_providers.*.auth.** x
model_providers.*.gateway_oauth.** x
model_providers.*.aws.** x
model_reasoning_effort s
plan_mode_reasoning_effort s
model_reasoning_summary e:auto|concise|detailed|none
model_verbosity e:low|medium|high
model_supports_reasoning_summaries x
shell_environment_policy.inherit e:all|core|none
shell_environment_policy.ignore_default_excludes b
shell_environment_policy.filters t
shell_environment_policy.filters.* e:include|exclude
shell_environment_policy.exclude a:s
shell_environment_policy.include_only a:s
shell_environment_policy.set t
shell_environment_policy.set.* s
shell_environment_policy.experimental_use_profile b
project_root_markers a:s
project_doc_max_bytes u
project_doc_fallback_filenames a:s
history.persistence e:save-all|none
history.max_bytes u
tool_output_token_limit n
background_terminal_max_timeout n
thread_unload_delay_secs n
js_repl_node_path s
js_repl_node_module_dirs a:s
responses_api_metadata x
file_opener e:vscode|vscode-insiders|windsurf|cursor|none
otel.** x
desktop.** x
tui.notifications bs
tui.notification_method e:auto|osc9|bel
tui.notification_condition e:unfocused|always
tui.animations b
tui.disable_paste_burst b
tui.alternate_screen e:auto|always|never
tui.resume_cwd e:current|session
tui.vim_mode_default b
tui.raw_output_mode b
tui.show_tooltips b
tui.auto_recap b
tui.show_server_version_notice b
tui.status_line a:s
tui.terminal_title a:s
tui.theme s
tui.keymap.** x
tui.* x
tui.*.** x
tui.model_availability_nux.** x
marketplaces.** x
plugins.** x
hide_agent_reasoning b
show_raw_agent_reasoning b
disable_paste_burst b
cli_auth_credentials_store e:file|keyring|auto|ephemeral
experimental_use_unified_exec_tool b
experimental_realtime_ws_base_url s
experimental_realtime_webrtc_call_base_url s
experimental_realtime_ws_model s
experimental_realtime_ws_backend_prompt s
experimental_realtime_ws_startup_context s
experimental_realtime_start_instructions s
experimental_thread_store_endpoint x
experimental_thread_store x
tools.** x
web_search e:disabled|cached|indexed|live
projects.*.trust_level e:trusted|untrusted
notice.** x
forced_login_method e:chatgpt|api
forced_chatgpt_workspace_id s
suppress_unstable_features_warning b
profile s
profiles.** x
`.trim().split("\n");

// ---- feature flags (codex features list) ---------------------------------------------------------------------------------------
//
// name:stage then + (on by default) or - (off). Stages: s stable, e experimental, u under development, r removed, d deprecated.
const FEATURE_TABLE = [
  "agent_message_board:u- analytics_plan_history:e- api_key_cyber_access_programs:s+ api_key_model_discovery:s+",
  "apply_patch_freeform:r- apply_patch_preserve_line_endings:r- apply_patch_streaming_events:u- apps:s+",
  "apps_mcp_path_override:r- artifact:u- async_compaction:u- auth_elicitation:s+",
  "background_paginated_rollout_migration:u- bedrock_setup_wizard:u- browser_annotation_api:s+ browser_use:s+",
  "browser_use_external:s+ browser_use_full_cdp_access:s+ chronicle:u- cli_daybreak:s+ code_mode:u-",
  "code_mode_buffered_exec:r- code_mode_host:s+ code_mode_host_grpc:u- code_mode_interrupt:s+ code_mode_only:u-",
  "code_mode_only_strict_3p_tools:u- code_mode_prewarm:u- code_mode_tool_description_first:u-",
  "code_mode_tool_search:u- codex_apps_mcp_2026_07_28:u- codex_git_commit:r- collaboration_modes:r+",
  "compaction_image_budget:s+ computer_use:s+ concurrent_reasoning_summaries:u- content_item_kinds:s+",
  "context_management:u- credential_masking:u- current_time_reminder:u- cwd_relative_turn_diffs:u-",
  "daemon_auto_start:s+ default_mode_request_user_input:u- defer_mailbox_preemption:u- deferred_executor:u-",
  "deferred_tool_world_state:u- elevated_windows_sandbox:r- enable_fanout:r- enable_mcp_apps:u-",
  "enable_request_compression:s+ exec_permission_approvals:u- executed_tool_call_metadata:u-",
  "executor_capability_discovery:u- experimental_windows_sandbox:r- external_agent_memory_import:u-",
  "external_migration:r- fast_mode:s+ goals:s+ guardian_approval:s+ guardian_conversation_history_tools:u-",
  "guardian_enhanced_node_repl_transcripts:u- guardian_ext:r- guardian_node_repl_transcript_images:u-",
  "guardian_reuse_parent_compaction:s+ guardian_root_handoff_context:u-",
  "guardian_trust_orchestrator_connectors:u- guardianv2:u- guardianv2.thread_context:r-",
  "guardianv2_decisions_comparison:u- hooks:s+ image_detail_original:r- image_generation:s+",
  "image_resize_notice:u- in_app_browser:s+ in_app_chat:s+ in_app_dictation:s+ in_app_local_automation:s+",
  "in_app_updates:s+ in_app_voice:s+ incremental_tools:u- instant_interrupt:u+ item_ids:r+ js_repl:r-",
  "js_repl_tools_only:r- local_thread_store_compression:u- local_thread_store_shared_compression:r-",
  "login_shell_package_path:e- mcp_2026_07_28:u- mcp_oauth_refresh_coordination:u- memories:s- mentions_v2:s+",
  "model_catalog_in_context:u- multi_agent:s+ multi_agent_mode:r- multi_agent_v2:s-",
  "multi_agent_v2_dynamic_tools:u- network_proxy:e- non_prefixed_mcp_tool_names:u-",
  "nonfatal_clock_read_errors:u- omit_app_server_notification_media:u- output_token_replay:u- personality:r-",
  "plugin_hooks:r- plugin_sharing:s+ plugins:s+ powershell_shell_version:u- prefer_mxc:u- prevent_idle_sleep:e-",
  "psp:u- realtime_conversation:s+ reasoning_effort_override:u- recommended_plugins:s- remote_compaction_v2:r-",
  "remote_control:r- remote_models:r- remote_plugin:s+ request_permissions_tool:u- request_rule:r-",
  "resize_all_images:r+ respect_system_proxy:u- responses_websockets:r- responses_websockets_v2:r-",
  "retain_client_developer_messages:u- retain_client_tool_outputs:u- rollout_budget:u- runtime_metrics:u-",
  "search_tool:r- secret_auth_storage:s+ send_async_message:r- send_message_to_user_async:u- shell_snapshot:s+",
  "shell_snapshot_v2:u- shell_tool:s+ shell_zsh_fork:r- skill_env_var_dependency_prompt:r-",
  "skill_mcp_dependency_install:s+ skill_search:s+ skip_host_skill_discovery:u- sleep_tool:s+ sqlite:r+",
  "stable_environment_tools:u- standalone_web_search:u- steer:r+ step_model_switching:u-",
  "subagent_default_context_limits:u- system_proxy_fallback:s+ terminal_resize_reflow:r+",
  "terminal_visualization_instructions:u- token_budget:u- tool_call_mcp_elicitation:s+ tool_search:r-",
  "tool_search_always_defer_mcp_tools:r+ tool_suggest:s+ transcript_v2:d- tui_app_server:r+ ultrafast_mode:s+",
  "unavailable_dummy_tools:r- unbounded_connection_retries:s+ undo:r- unified_exec:s+ unified_exec_tty:s+",
  "unified_exec_zsh_fork:r- unified_image_budget:u- use_agent_identity:u- use_legacy_landlock:d-",
  "use_linux_sandbox_bwrap:r- use_xaa:u- view_image:s+ web_search_cached:d- web_search_request:d-",
  "windows_sandbox_service:u- workspace_dependencies:s+ workspace_owner_usage_nudge:r- worktrees:s+",
  "write_stdin_approval:s+"
];

export const STAGE_NAMES = { s: "stable", e: "experimental", u: "under development", r: "removed", d: "deprecated" };

/** name -> { stage, on }: every feature `codex features list` printed on 0.163.0. */
export const FEATURES = Object.fromEntries(
  FEATURE_TABLE.join(" ").split(" ").filter(Boolean).map((x) => {
    const m = /^(.+):([serud])([+-])$/.exec(x);
    return [m[1], { stage: STAGE_NAMES[m[2]], on: m[3] === "+" }];
  }),
);

/** Names a feature has besides the one `codex features list` prints, and what Codex says about them. */
export const FEATURE_ALIASES = {
  codex_hooks: { use: "hooks", words: "deprecated: `[features].codex_hooks` is deprecated. Use `[features].hooks` instead." },
};

/** Feature flags whose value is a table (or a boolean). */
export const TABLE_FEATURES = new Set(["code_mode", "context_management", "rollout_budget", "network_proxy"]);

// ---- rules  -----------------------------------------------------------------------------------------------------------------

/**
 * The prefixes for which Codex does not honour an `allow` rule: a rule whose whole pattern is one of these is ignored, and the command is
 * handled as if no rule matched. It is the table the binary of Codex 0.163.0 also uses for the prefixes the model may not suggest (the
 * shells with -c and -lc, the interpreters with -e, -c and -r, git, env, rm, sudo, `npm run` ...), read from the executable by
 * test/banned.mjs and put to the binary one prefix at a time (test/e2e-why.test.mjs). A longer pattern, such as ["git", "status"], is honoured.
 */
export const BANNED_PREFIXES = [
  ["/bin/bash"], ["/bin/bash","-c"], ["/bin/bash","-lc"], ["/bin/sh"], ["/bin/sh","-c"], ["/bin/sh","-lc"], ["/bin/zsh"],
  ["/bin/zsh","-c"], ["/bin/zsh","-lc"], ["Rscript"], ["bash"], ["bash","-c"], ["bash","-lc"], ["bun"], ["bun","-e"],
  ["bun","run"], ["cmd"], ["cmd","/c"], ["cmd","/k"], ["cmd.exe"], ["cmd.exe","/c"], ["cmd.exe","/k"], ["dash"],
  ["dash","-c"], ["deno"], ["deno","eval"], ["env"], ["fish"], ["fish","-c"], ["git"], ["julia"], ["julia","-e"], ["ksh"],
  ["ksh","-c"], ["lua"], ["lua","-e"], ["node"], ["node","-e"], ["nodejs"], ["nodejs","-e"], ["npm","run"], ["osascript"],
  ["perl"], ["perl","-e"], ["php"], ["php","-r"], ["pnpm","run"], ["powershell"], ["powershell","-Command"],
  ["powershell","-EncodedCommand"], ["powershell","-File"], ["powershell","-c"], ["powershell.exe"],
  ["powershell.exe","-Command"], ["powershell.exe","-EncodedCommand"], ["powershell.exe","-File"], ["powershell.exe","-c"],
  ["pwsh"], ["pwsh","-Command"], ["pwsh","-EncodedCommand"], ["pwsh","-File"], ["pwsh","-c"], ["pwsh","-e"],
  ["pwsh","-ec"], ["pwsh","-f"], ["py"], ["py","-3"], ["pypy"], ["pypy3"], ["python"], ["python","-"], ["python","-c"],
  ["python3"], ["python3","-"], ["python3","-c"], ["pythonw"], ["pyw"], ["rm"], ["ruby"], ["ruby","-e"], ["sh"],
  ["sh","-c"], ["sh","-lc"], ["sudo"], ["yarn","run"], ["zsh"], ["zsh","-c"], ["zsh","-lc"],
];

// ---- layers -----------------------------------------------------------------------------------------------------------------

/** Keys Codex still lists in its schema and refuses at start, with the words it prints (put to Codex 0.163.0). */
export const REMOVED_KEYS = {
  experimental_thread_store_endpoint: "`experimental_thread_store_endpoint` is no longer supported; remove it from config.toml",
};

/** Keys Codex ignores in a project's .codex/config.toml, with a startup warning (the configuration reference, put to the binary). */
export const IGNORED_IN_PROJECT = [
  "openai_base_url", "chatgpt_base_url", "apps_mcp_product_sku", "model_provider", "model_providers", "notify", "profile", "profiles",
  "experimental_realtime_ws_base_url", "otel",
];

export const MXC_MINIMUM = { build24H2: "26100.9278", build25H2: "26200.9278" };

// ---- approval, sandbox ----------------------------------------------------------------------------------------------------------
export const APPROVAL_POLICIES = ["untrusted", "on-failure", "on-request", "granular", "never"];
export const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"];

// ---- hooks ----------------------------------------------------------------------------------------------------------------------
export const HOOK_EVENTS = ["PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SessionStart", "SessionEnd", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop", "Interrupt"];
export const HOOK_EVENT_SNAKE = Object.fromEntries(HOOK_EVENTS.map((e) => [e, e.replace(/[A-Z]/g, (c, i) => (i ? `_${c.toLowerCase()}` : c.toLowerCase()))]));
/** The default timeout of a hook in seconds, and the events that have 1 second. */
export const HOOK_DEFAULT_TIMEOUT = 600;
export const HOOK_SHORT_TIMEOUT_EVENTS = new Set(["SessionEnd", "Interrupt"]);

// ---- model providers --------------------------------------------------------------------------------------------------------------
export const RESERVED_PROVIDER_IDS = ["openai", "ollama", "lmstudio"];

// ---- AGENTS.md ------------------------------------------------------------------------------------------------------------------
export const DEFAULT_PROJECT_DOC_MAX_BYTES = 32768;
export const AGENTS_NAMES = { override: "AGENTS.override.md", standard: "AGENTS.md" };
export const SKILL_DESCRIPTION_CAP = 1024;
