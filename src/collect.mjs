// Everything the commands need to know about a project, collected once: the layers and the merged configuration, the AGENTS.md chain, the
// rules, the hooks, the MCP servers, the model provider and the Windows sandbox. The commands (show, lint, why, agents, cost) only read
// this and say it.
import { assemble } from "./agents.mjs";
import { discoverHooks } from "./hooks.mjs";
import { discover, leaves, mergeLayers } from "./layers.mjs";
import { servers } from "./mcp.mjs";
import { providers } from "./providers.mjs";
import { loadRules } from "./rules.mjs";
import { checkEntries } from "./schema.mjs";
import { windowsSandbox } from "./winsandbox.mjs";

export function collect(sys, opts = {}) {
  const world = discover(sys, { project: opts.project, profile: opts.profile });
  const applying = world.layers.filter((l) => l.applies);
  const merged = mergeLayers([...applying].reverse());
  const mergedValue = merged.value;
  const projectLayerHere = world.layers.find((l) => l.kind === "project" && sys.path.relative(l.scope, world.dir) === "");
  const trusted = Boolean(projectLayerHere && projectLayerHere.trusted)
    || world.trust.dir.level === "trusted"
    || (world.trust.dir.level === null && Boolean(world.trust.root) && world.trust.root.level === "trusted");
  const agents = assemble(sys, world.dir, mergedValue);
  const rules = loadRules(sys, world);
  const hooks = discoverHooks(sys, world, mergedValue);
  const mcp = servers(sys, mergedValue, { cwd: world.dir });
  const provider = providers(sys, mergedValue);
  const windows = windowsSandbox(sys, mergedValue, { codexHomeDir: world.codexHome.dir, trusted });
  // problems of the keys of each layer that has been read
  const keyProblems = [];
  for (const layer of world.layers) if (layer.entries) for (const p of checkEntries(layer.entries)) keyProblems.push({ ...p, layer });
  const approvalRaw = mergedValue.approval_policy;
  const approval = typeof approvalRaw === "string" ? approvalRaw : approvalRaw && typeof approvalRaw === "object" ? "granular" : "on-request";
  return {
    sys,
    opts,
    world,
    applying,
    merged,
    value: mergedValue,
    leaves: leaves(merged),
    trusted,
    agents,
    rules,
    hooks,
    mcp,
    provider,
    windows,
    keyProblems,
    effective: { approval, sandbox: windows.sandboxMode.effective, sandboxAsked: windows.sandboxMode.asked, model: typeof mergedValue.model === "string" ? mergedValue.model : null },
  };
}
