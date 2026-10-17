// The model provider of the merged configuration. Put to Codex 0.163.0 (test/e2e-providers.test.mjs):
//   - `model_providers.openai`, `.ollama` and `.lmstudio` are built in and cannot be redefined: Codex stops at start;
//   - `wire_api` takes `responses` and nothing else (`chat` has its own message); Codex stops at start;
//   - `model_provider = "x"` with no `[model_providers.x]` (and x not built in) stops Codex: "Model provider `x` not found";
//   - a provider with an `env_key` needs that variable in the environment: without it Codex stops with "Missing environment variable";
//   - a provider with no `base_url` talks to https://api.openai.com/v1, whatever its name says;
//   - a provider needs a `name`; `auth` cannot be combined with `env_key`.
import { RESERVED_PROVIDER_IDS } from "./knowledge.mjs";

const isTable = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Providers Codex has built in (the three that cannot be redefined, and the ones it lists as built in). */
export const BUILT_IN = [...RESERVED_PROVIDER_IDS, "amazon-bedrock"];

export function providers(sys, merged) {
  const table = isTable(merged.model_providers) ? merged.model_providers : {};
  const selected = typeof merged.model_provider === "string" ? merged.model_provider : "openai";
  const out = { selected, selectedDefined: Object.prototype.hasOwnProperty.call(table, selected), builtIn: BUILT_IN.includes(selected), list: [] };
  for (const [id, cfg] of Object.entries(table)) {
    if (!isTable(cfg)) continue;
    const envKey = typeof cfg.env_key === "string" ? cfg.env_key : null;
    out.list.push({
      id,
      reserved: RESERVED_PROVIDER_IDS.includes(id),
      name: typeof cfg.name === "string" ? cfg.name : null,
      baseUrl: typeof cfg.base_url === "string" ? cfg.base_url : null,
      wireApi: typeof cfg.wire_api === "string" ? cfg.wire_api : "responses",
      envKey,
      envKeySet: envKey === null ? null : sys.getEnv(envKey) !== undefined && sys.getEnv(envKey) !== "",
      hasAuth: isTable(cfg.auth),
      requiresOpenaiAuth: cfg.requires_openai_auth === true,
      selected: id === selected,
    });
  }
  return out;
}
