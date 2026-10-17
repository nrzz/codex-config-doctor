// The findings: what is wrong with the configuration Codex will load, each with the file and line, what Codex does about it and the fix.
// A finding's `basis` says what it rests on: `binary` (put to Codex 0.163.0 in test/e2e-*.test.mjs, the words in `effect` are the ones Codex
// printed) or `docs` (the documentation says so). `explain <id>` has the page of each.
import { CATALOG } from "./catalog.mjs";
import { expandPattern, isBannedPrefix, shadowedRules } from "./execpolicy.mjs";
import { FIELD_HINTS, commandWords, hookScript, programFound, scriptAsks } from "./hooks.mjs";
import { dottedKey, trustKey, trustPath } from "./layers.mjs";
import { FEATURES, FEATURE_ALIASES, HOOK_EVENTS, RESERVED_PROVIDER_IDS } from "./knowledge.mjs";
import { BUILT_IN } from "./providers.mjs";

const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 };

function make(id, o) {
  const meta = CATALOG[id];
  return { id, severity: o.severity || meta.severity, basis: o.basis || meta.basis, file: o.file || null, line: o.line || null, column: o.column || null, message: o.message, effect: o.effect, fix: o.fix };
}

const entryOf = (layer, path) => (layer.entries || []).find((e) => e.path.length === path.length && e.path.every((p, i) => p === path[i]));
const isTable = (v) => v && typeof v === "object" && !Array.isArray(v);
/** The layer that sets something under `prefix` (the one that wins first), with the line of the table header or of the first key. */
const whereSet = (world, prefix) => {
  for (const layer of world.layers) {
    if (!layer.applies) continue;
    const entry = (layer.entries || []).find((e) => prefix.every((p, i) => e.path[i] === p));
    if (entry) return { file: layer.path, line: headerLine(layer, prefix, entry.line) };
  }
  return { file: null, line: null };
};
/** The line of a table's header, else `fallback`. */
const headerLine = (layer, path, fallback) => {
  const t = (layer.tables || []).find((x) => x.path.length === path.length && x.path.every((p, i) => p === path[i]));
  return t ? t.line : fallback;
};
const bytes = (n) => `${n.toLocaleString("en-US")} bytes`;

export function lint(c) {
  const { sys, world } = c;
  const out = [];
  const add = (id, o) => out.push(make(id, o));
  const win = sys.isWin;
  const userFile = sys.path.join(world.codexHome.dir, "config.toml");

  // ---- CODEX_HOME
  if (world.codexHome.problem) {
    const how = world.codexHome.problem === "missing" ? "that path does not exist" : "that path is not a directory";
    add("codex-home", { file: world.codexHome.dir, message: `CODEX_HOME is ${JSON.stringify(world.codexHome.given)}, and ${how}`, effect: `Codex does not start and prints: CODEX_HOME points to "${world.codexHome.dir}", but ${how}.`, fix: world.codexHome.problem === "missing" ? "Create the folder, or unset CODEX_HOME to use ~/.codex." : "Point CODEX_HOME at a folder, or unset it." });
  }

  // ---- the files of each layer
  for (const layer of world.layers) {
    if (layer.status !== "broken" && !layer.brokenWhenTrusted) continue;
    // an untrusted project's file is not opened: it does not stop Codex until the project is trusted
    const untrusted = layer.kind === "project" && !layer.trusted;
    const later = "Codex does not open an untrusted project's file, so it ignores this one for now. The moment the project is trusted, or a session starts with sandbox_mode \"danger-full-access\" (which trusts the folder first), Codex stops with the error";
    if (layer.error.kind === "toml") {
      const e = layer.error;
      add("toml-error", {
        severity: untrusted ? "warning" : undefined,
        file: layer.path, line: e.line, column: e.column,
        message: `${layer.path}:${e.line}:${e.column}: ${e.message}`,
        effect: untrusted ? `${later}: "Error parsing project config file ...: TOML parse error at line ${e.line}, column ${e.column}".` : "Codex does not start: it exits with code 1 and prints \"Error loading config.toml:\" with the path, the line and the column.",
        fix: "Correct the syntax at that line: TOML wants key = value, strings in quotes, a table header in [brackets]. Codex does not start until every layer parses.",
      });
    } else if (layer.error.kind === "encoding") {
      add("config-encoding", {
        severity: untrusted ? "warning" : undefined,
        file: layer.path, line: 1,
        message: `${layer.path}: ${layer.error.message}`,
        effect: untrusted ? `${later}.` : "Codex does not start and prints: Failed to read config file ...: invalid utf-8 sequence of 1 bytes from index 0 (exit code 1).",
        fix: win ? "Save the file as UTF-8. Windows PowerShell 5.1 writes UTF-16 with `>`, `Out-File` and `Set-Content` unless you add `-Encoding utf8`; an editor's \"Save as UTF-8\" works too." : "Save the file as UTF-8.",
      });
    }
  }

  // ---- the keys of each layer
  const seenFeature = new Set();
  for (const p of c.keyProblems) {
    const layer = p.layer;
    const untrusted = layer.kind === "project" && !layer.trusted;
    if (p.id === "unknown-key" || p.id === "feature-unknown") {
      if (untrusted) continue;
      add(p.id, {
        file: layer.path, line: p.line, column: p.column,
        message: `${p.message}${p.hint ? `. ${p.hint}` : ""}`,
        effect: `Codex ignores \`${p.key}\`. It prints "warning: Codex is ignoring 1 unrecognized configuration setting. Check for typos or deprecated settings." (in \`codex exec\`, and the app server that the terminal UI is built on sends it as a warning; with \`--json\` it is an error item in the event stream). \`--strict-config\` refuses to start.`,
        fix: p.hint && /^Did you mean/.test(p.hint) ? `${p.hint.replace(/\?$/, "")}, or remove the key.` : p.hint ? `${p.hint}.` : "Remove the key, or check the name in the configuration reference. A newer Codex may know it: this list is Codex 0.163.0's.",
      });
    } else if (p.id === "key-removed") {
      if (untrusted) continue;
      add("key-removed", {
        file: layer.path, line: p.line, column: p.column,
        message: `\`${p.key}\` is a key Codex no longer supports`,
        effect: `Codex does not start: it exits with code 1 and prints "Error: ${p.message}".`,
        fix: `Delete the \`${p.key}\` line.`,
      });
    } else if (p.id === "wrong-type") {
      // a wire_api word that is not "responses" is the provider-wire-api finding, with the words Codex prints for it
      if (/^model_providers\.[^.]+\.wire_api$/.test(p.key) && /^string/.test(p.got || "")) continue;
      add("wrong-type", {
        file: layer.path, line: p.line, column: p.column,
        message: p.message,
        effect: `Codex does not start: it exits with code 1 and prints "Error loading config.toml: invalid type ... in \`${p.key.split(".")[0]}\`" (an unknown word for a setting prints "unknown variant ... expected one of ...").`,
        fix: `Give \`${p.key}\` ${p.expected}.`,
      });
    }
  }

  // ---- project layers
  for (const layer of world.layers.filter((l) => l.kind === "project")) {
    if (layer.applies && layer.ignoredKeys.length) {
      const lines = (layer.entries || []).filter((e) => layer.ignoredKeys.includes(e.path[0])).map((e) => e.line);
      const first = lines.length ? { line: Math.min(...lines) } : null;
      add("ignored-in-project", {
        file: layer.path, line: first ? first.line : null,
        message: `${layer.path} sets ${layer.ignoredKeys.map((k) => `\`${k}\``).join(", ")}, which a project's config may not set`,
        effect: `Codex ignores ${layer.ignoredKeys.length === 1 ? "it" : "them"} and prints: "warning: Ignored unsupported project-local config keys in ${layer.path}: ${layer.ignoredKeys.join(", ")}. If you want these settings to apply, manually set them in your user-level config.toml." (with \`codex exec --json\` it is an error item in the event stream).`,
        fix: `Move ${layer.ignoredKeys.length === 1 ? "it" : "them"} to ${userFile}.`,
      });
    }
    const hasHooks = sys.isFile(sys.path.join(layer.dotCodex, "hooks.json"));
    const rulesDir = sys.path.join(layer.dotCodex, "rules");
    const hasRules = (sys.readdir(rulesDir) || []).some((n) => n.endsWith(".rules"));
    if (!layer.trusted && (layer.exists || hasHooks || hasRules)) {
      const what = [layer.exists ? "config.toml" : null, hasHooks ? "hooks.json" : null, hasRules ? "rules" : null].filter(Boolean).join(", ");
      // the entry to add: the Git root (every .codex folder below it loads), else the folder itself; spelled the way Codex compares it
      const marked = layer.trust && layer.trust.level === "untrusted" ? layer.trust.entry : null;
      const entry = trustPath(sys, world.gitRoot || layer.scope);
      add("untrusted-project", {
        file: layer.dotCodex,
        message: `${layer.dotCodex} holds ${what}, and Codex does not load it: ${marked ? `the project is marked untrusted ([projects.'${marked}'] has trust_level = "untrusted")` : "the project is not trusted"}`,
        effect: `Codex ignores that folder's config.toml, hooks and rules (skills in it still load). \`codex exec\` prints nothing about it; the app server, which the terminal UI is built on, warns: "Project-local config, hooks, and exec policies are disabled in the following folders until the project is trusted, but skills still load."`,
        fix: marked ? `Set trust_level = "trusted" in [projects.'${marked}'] of ${userFile}.` : `Add this to ${userFile}:\n[projects.'${entry}']\ntrust_level = "trusted"${win ? "\nWrite the path with backslashes, as here, without a trailing backslash: an entry with forward slashes or a \\\\?\\ prefix does not trust the folder." : ""}`,
      });
    }
  }

  // ---- trust entries that do not match
  {
    const wanted = new Set();
    for (const l of world.layers.filter((x) => x.kind === "project")) wanted.add(l.scope);
    if (world.gitRoot) wanted.add(world.gitRoot);
    const exact = new Set([...wanted].map((d) => trustKey(sys, d)));
    const loose = (s) => { let p = String(s).replace(/^\\\\\?\\/, ""); if (win) p = p.replace(/\//g, "\\"); p = p.replace(/[\\/]+$/, ""); return win ? p.toLowerCase() : p; };
    for (const layer of world.layers.filter((x) => x.kind === "user" || x.kind === "system" || x.kind === "profile")) {
      for (const e of layer.entries || []) {
        if (e.path[0] !== "projects" || e.path.length !== 3 || e.path[2] !== "trust_level") continue;
        const key = String(e.path[1]);
        const k = win ? key.toLowerCase() : key;
        if (exact.has(k)) continue;
        const same = [...wanted].find((d) => loose(d) === loose(key));
        if (!same) continue;
        add("trust-key-spelling", {
          file: layer.path, line: headerLine(layer, ["projects", key], e.line),
          message: `\`projects.${JSON.stringify(key)}\` names ${same}, but Codex does not match it to that folder`,
          effect: `Codex compares the entry with the folder's path as ${win ? "Windows spells it (backslashes, no trailing separator, no \\\\?\\ prefix; case does not matter)" : "the system spells it (no trailing slash)"}. This entry matches no folder, so the project stays untrusted and its .codex folder is ignored.`,
          fix: `Write the entry as [projects.'${sys.path.normalize(same)}'].`,
        });
      }
    }
  }

  // ---- profiles
  for (const layer of world.layers.filter((l) => l.kind === "user" || l.kind === "system" || l.kind === "profile")) {
    for (const e of layer.entries || []) {
      if (e.path.length === 1 && e.path[0] === "profile") {
        add("profile-legacy", {
          severity: "error", file: layer.path, line: e.line, column: e.column,
          message: `\`profile = ${JSON.stringify(e.value)}\` selects a profile the old way`,
          effect: `Codex does not start and prints: Error: legacy \`profile = "${e.value}"\` config is no longer supported; use \`--profile ${e.value}\` with \`${e.value}.config.toml\` instead`,
          fix: `Remove the line, move the settings of [profiles.${e.value}] into ${sys.path.join(world.codexHome.dir, `${e.value}.config.toml`)} (top-level keys, no table), and start Codex with --profile ${e.value}.`,
        });
      }
      if (e.path.length >= 2 && e.path[0] === "profiles") {
        const name = String(e.path[1]);
        if (layer.entries.find((x) => x === e) !== layer.entries.find((x) => x.path[0] === "profiles" && x.path[1] === name)) continue;
        const used = world.profile && world.profile.name === name;
        add("profile-legacy", {
          severity: used ? "error" : "note", file: layer.path, line: headerLine(layer, ["profiles", name], e.line), column: e.column,
          message: used ? `\`--profile ${name}\` cannot be used while ${layer.path} contains [profiles.${name}]` : `[profiles.${name}] is left over from the old profile form and does nothing`,
          effect: used ? `Codex does not start and prints: --profile \`${name}\` cannot be used while ${layer.path} contains legacy \`profile = "${name}"\` or \`[profiles.${name}]\` config; move those settings into ${sys.path.join(world.codexHome.dir, `${name}.config.toml`)} and remove the legacy profile selector/table.` : "Codex does not read the table (since 0.134.0) and does not complain until you start it with --profile and that name.",
          fix: `Move the settings into ${sys.path.join(world.codexHome.dir, `${name}.config.toml`)} as top-level keys, and delete the [profiles.${name}] table.`,
        });
      }
    }
  }
  if (world.profile && !world.profile.exists) {
    add("profile-missing", {
      file: world.profile.path,
      message: world.profile.valid ? `--profile ${world.profile.name} names ${world.profile.path}, which is not there` : `--profile ${world.profile.name} is not a plain name (letters, digits, hyphens and underscores only)`,
      effect: world.profile.valid ? "Codex starts without the profile: exit code 0 and no message, and every setting you meant to come from it is missing." : "Codex refuses the option: \"invalid --profile value ...; pass a plain name such as `work`\" (exit code 2).",
      fix: world.profile.valid ? `Create ${world.profile.path} with the settings that differ from config.toml, or fix the name.` : "Use a name of letters, digits, hyphens and underscores.",
    });
  }

  // ---- approval policy
  for (const layer of world.layers) {
    const e = entryOf(layer, ["approval_policy"]);
    if (!e || e.type !== "string") continue;
    if (e.value === "untrusted") {
      add("approval-deprecated", { severity: "error", file: layer.path, line: e.line, column: e.column, message: "`approval_policy = \"untrusted\"` is not supported any more", effect: "Codex does not start (exit code 1) and prints: Error: approval_policy = \"untrusted\" is no longer supported; remove this setting", fix: "Use \"on-request\" (the default) or \"never\"." });
    } else if (e.value === "on-failure") {
      add("approval-deprecated", { severity: "warning", file: layer.path, line: e.line, column: e.column, message: "`approval_policy = \"on-failure\"` is deprecated", effect: "Codex accepts it and builds the same prompt as for \"on-request\" (put to Codex 0.163.0: same permissions text, same size); the documentation calls it deprecated. `codex exec` printed no warning.", fix: "Use \"on-request\", which is what it already does, or \"never\"." });
    }
  }

  // ---- feature flags
  for (const layer of world.layers) {
    for (const e of layer.entries || []) {
      if (e.path[0] !== "features" || e.path.length < 2) continue;
      const name = String(e.path[1]);
      const key = `${layer.path}|${name}`;
      if (seenFeature.has(key)) continue;
      seenFeature.add(key);
      if (Object.prototype.hasOwnProperty.call(FEATURE_ALIASES, name)) {
        const alias = FEATURE_ALIASES[name];
        add("feature-alias", { file: layer.path, line: e.line, column: e.column, message: `\`features.${name}\` is the old name of \`features.${alias.use}\``, effect: `Codex honours it and prints: "${alias.words}"`, fix: `Rename it to \`${alias.use}\`.` });
        continue;
      }
      const f = FEATURES[name];
      if (!f) continue;
      if (f.stage === "removed") add("feature-removed", { file: layer.path, line: e.line, column: e.column, message: `\`features.${name}\` was removed from Codex`, effect: "Codex accepts the line in silence and it does nothing: no warning at start, in the terminal UI or in `codex exec`.", fix: `Delete the line.${name === "elevated_windows_sandbox" || name === "experimental_windows_sandbox" ? " The Windows sandbox is chosen with `windows.sandbox` now." : ""}` });
      else if (f.stage === "deprecated") add("feature-deprecated", { file: layer.path, line: e.line, column: e.column, message: `\`features.${name}\` is deprecated`, effect: `Codex honours it and prints a "deprecated: \`[features].${name}\` is deprecated" notice at start.`, fix: "Follow the replacement in Codex's notice, or delete the line." });
    }
  }

  // ---- the environment policy
  for (const layer of world.layers) {
    const has = (k) => (layer.entries || []).some((e) => e.path[0] === "shell_environment_policy" && e.path[1] === k);
    if ((has("exclude") || has("include_only")) && has("filters")) {
      const e = (layer.entries || []).find((x) => x.path[0] === "shell_environment_policy" && (x.path[1] === "exclude" || x.path[1] === "include_only"));
      add("env-policy-mix", { file: layer.path, line: e.line, message: "shell_environment_policy has `filters` together with `exclude` or `include_only` in one file", effect: "Codex does not start: \"cannot mix `filters` with legacy `exclude` or `include_only`\" (exit code 1).", fix: "Use `[shell_environment_policy.filters]` alone (a key per pattern, \"include\" or \"exclude\"), or the legacy arrays alone, in each file." });
    }
  }

  // ---- hooks
  const hooks = c.hooks;
  // the line of a handler field: from the entries of a config.toml, else the first line of a hooks.json that names it
  const handlerFieldLine = (h, field) => {
    if (h.format === "toml") {
      const layer = world.layers.find((l) => l.path === h.source);
      const e = layer && (layer.entries || []).find((x) => x.path.length === 6 && x.path[0] === "hooks" && x.path[1] === h.event && x.path[2] === h.group && x.path[3] === "hooks" && x.path[4] === h.index && x.path[5] === field);
      return e ? e.line : null;
    }
    const lines = String(sys.readText(h.source) || "").split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes(`"${field}"`));
    return i >= 0 ? i + 1 : null;
  };
  for (const b of hooks.bothFormats) {
    add("hooks-both-formats", { file: b.toml, message: `${b.json} and ${b.toml} both define hooks`, effect: `Codex loads both and prints: "warning: loading hooks from both ${b.json} and ${b.toml}; prefer a single representation for this layer".`, fix: "Keep the hooks in one place: move them all into hooks.json, or all into config.toml. Remember that each hook has to be trusted again after it moves: its key names the file." });
  }
  for (const j of hooks.jsonErrors) {
    if (j.skipped) continue;
    add("hooks-json-error", { file: j.path, message: `${j.path} does not parse: ${j.message}${j.bom ? " (it starts with a byte order mark)" : ""}`, effect: `Codex prints "warning: failed to parse hooks config ${j.path}: ..." and loads none of its hooks.`, fix: j.bom ? "Save the file as UTF-8 without a byte order mark." : "Correct the JSON." });
  }
  for (const u of hooks.unknownEvents) {
    const known = HOOK_EVENTS.find((e) => e.toLowerCase() === String(u.event).toLowerCase());
    add("hook-event-unknown", { file: u.source, message: `"${u.event}" is not a hook event${known ? ` (the name is ${known})` : ""}`, effect: "Codex ignores the entry in silence: the hooks under it never run, and no warning is printed.", fix: `Use one of the events: ${HOOK_EVENTS.join(", ")}.` });
  }
  for (const h of hooks.hooks) {
    if (h.skippedLayer) continue;
    const where = h.source;
    const label = `the ${h.event} hook${h.matcher ? ` for ${h.matcher}` : ""} (${h.format === "json" ? "hooks.json" : "config.toml"}, group ${h.group + 1}, handler ${h.index + 1})`;
    for (const field of h.unknownFields || []) {
      const hint = FIELD_HINTS[field];
      add("hook-field-unknown", {
        file: where, line: handlerFieldLine(h, field),
        message: `${label} has the field \`${field}\`, which Codex does not read in a hook handler${hint ? `. Did you mean \`${hint}\`?` : ""}`,
        effect: `Codex drops the field in silence: no warning in \`codex exec\` or in the app server (put to Codex 0.163.0). ${/timeout/i.test(field) ? "The timeout stays at its default, 600 seconds (1 second for SessionEnd and Interrupt)." : "The handler runs without it."}`,
        fix: hint ? `Rename it to \`${hint}\`.` : "Delete the field, or check its name: a command handler reads type, command, commandWindows, timeout, async, statusMessage and additionalContextLimit; an mcp_tool handler reads type, server, tool, input, timeout and statusMessage.",
      });
    }
    if (h.type === "command" && h.status !== "invalid") {
      const found = programFound(sys, h.command, world.dir);
      if (!found.found) {
        add("hook-command-missing", { file: where, message: `${label} runs \`${h.command}\`, and \`${found.name}\` is not found`, effect: `The hook fails: Codex prints "hook: ${h.event}" and "hook: ${h.event} Failed" and goes on with the tool call.`, fix: `Install ${found.name}, put its folder in PATH, or write its full path in the command.` });
      }
      if (h.event === "PreToolUse" || h.event === "PermissionRequest") {
        const script = hookScript(sys, h.command, world.dir);
        if (script && scriptAsks(script.text)) add("hook-ask-unsupported", { file: script.path, message: `${label} runs ${script.path}, which answers permissionDecision \"ask\"`, effect: "Documented: Codex parses `ask` and does not support it, and the hook run counts as failed. Put to Codex 0.163.0: the command ran, with no question and no message, as if the hook had said nothing.", fix: "Answer \"allow\" or \"deny\" and leave the asking to approval_policy." });
      }
    }
    if (h.status === "untrusted") {
      add("hook-untrusted", { file: where, message: `${label} is not trusted: there is no record for it in ${userFile}`, effect: "Codex skips it. `codex exec` says nothing; the app server lists it as untrusted, and the documentation says `/hooks` in the terminal UI lists it for review.", fix: `Review and trust it with /hooks in Codex, or add to ${userFile}:\n[hooks.state.${JSON.stringify(h.key)}]\ntrusted_hash = "${h.hash}"` });
    } else if (h.status === "modified") {
      add("hook-modified", { file: where, message: `${label} changed since it was trusted`, effect: "Codex skips it until it is trusted again (the record holds a hash of the definition). `codex exec` says nothing.", fix: `Review it with /hooks, or update trusted_hash in ${userFile} to ${h.hash}.` });
    }
  }
  if (hooks.featureOff && hooks.hooks.length) {
    add("hooks-feature-off", { file: userFile, message: "`features.hooks = false` and hooks are defined: none of them runs", effect: "Codex starts without running hooks, in silence.", fix: "Remove `hooks = false` from [features], or delete the hooks." });
  }

  // ---- AGENTS.md
  const ag = c.agents;
  if (ag.firstShort) {
    const f = ag.firstShort;
    const left = ag.files.filter((x) => x.status === "left-out");
    const missing = f.status === "cut" ? f.cutBytes + left.reduce((n, x) => n + x.bytes, 0) : left.reduce((n, x) => n + x.bytes, 0);
    add("agents-md-over-cap", {
      file: f.path,
      message: f.status === "cut"
        ? `${f.path} is the first file that does not fit: Codex reads ${bytes(f.includedBytes)} of its ${bytes(f.bytes)}${left.length ? ` and leaves out ${left.length} more file${left.length === 1 ? "" : "s"}` : ""} (${bytes(missing)} in all do not reach the model; the cap is ${bytes(ag.cap)})`
        : `${f.path} is the first file Codex leaves out (${bytes(f.bytes)}): the files before it use the whole cap of ${bytes(ag.cap)}`,
      effect: "Codex adds the files in order until project_doc_max_bytes is reached, cuts the file that crosses it at the byte and drops the rest. It prints nothing about it in `codex exec` (put to Codex 0.163.0; the terminal UI was not driven).",
      fix: `Raise \`project_doc_max_bytes\` (it is ${bytes(ag.cap)}), shorten the files, or move guidance into the folders where it applies. The files nearest the working folder come last, so they are the ones that go.`,
    });
  }
  for (const f of ag.files) {
    if (f.status === "empty") add("agents-md-empty", { file: f.path, message: `${f.path} has no text${f.bytes ? " (white space only)" : ""}`, effect: "Codex skips it: it adds nothing to the instructions.", fix: "Delete it, or write the instructions." });
  }
  for (const s of ag.shadowed) {
    if (s.reason === "same-folder") {
      const by = ag.files.find((x) => x.path === s.by);
      const hidden = by && by.status === "empty";
      add("agents-md-shadowed", { severity: hidden ? "warning" : "note", file: s.path, message: `${s.path} is not read: ${s.by} is in the same folder and Codex takes one file per folder${hidden ? ", and that file has no text" : ""}`, effect: hidden ? "Codex takes the first file it finds in the folder (AGENTS.override.md first) even when it has no text, so the folder adds no instructions at all." : "Codex takes one file per folder: AGENTS.override.md, else AGENTS.md, else the names in project_doc_fallback_filenames.", fix: hidden ? `Delete ${s.by} or put the text in it.` : `Delete ${s.by} if it is a leftover, or merge the two.` });
    }
  }
  {
    const checkEnc = (file) => {
      const buf = sys.readFile(file);
      if (!buf || !buf.length) return;
      const utf16 = buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff));
      const nul = buf.includes(0);
      const text = Buffer.from(buf).toString("utf8");
      const invalid = text.includes("�") && Buffer.from(text, "utf8").length !== buf.length;
      const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      if (utf16 || nul || invalid) {
        add("agents-md-encoding", { file, message: `${file} is ${utf16 ? "UTF-16" : nul ? "text with NUL bytes" : "not valid UTF-8"}`, effect: "Codex reads the file as UTF-8 and puts the bytes in the prompt: the model gets replacement characters and NUL characters (put to Codex 0.163.0), and you pay for them in tokens.", fix: win ? "Save it as UTF-8. Windows PowerShell 5.1 writes UTF-16 with `>` and `Out-File`; use `Set-Content -Encoding utf8` or an editor." : "Save it as UTF-8." });
      } else if (bom) {
        add("agents-md-encoding", { severity: "note", file, message: `${file} starts with a byte order mark`, effect: "Codex keeps the mark: U+FEFF is the first character of the file's text in the prompt (put to Codex 0.163.0).", fix: "Save the file as UTF-8 without a byte order mark." });
      }
    };
    if (ag.global) checkEnc(ag.global.path);
    for (const f of ag.files) checkEnc(f.path);
  }

  // ---- rules
  for (const f of c.rules.files) {
    if (f.skipped) continue;
    if (!f.ok && f.error.kind !== "unsupported") {
      add("rules-syntax", { file: f.path, line: f.error.line || null, message: `${f.path}${f.error.line ? `:${f.error.line}` : ""}: ${f.error.message}`, effect: `\`codex exec\` does not start: it exits with code 1 and prints "Error loading rules:", the file and the line. The terminal UI starts and warns "Error parsing rules; custom rules not applied.": it applies none of your rules, in any file, so a forbidden rule stops nothing (put to Codex 0.163.0).${f.bom ? " A byte order mark at the start of the file is enough (Windows PowerShell 5.1 writes one with `Set-Content -Encoding UTF8`)." : ""}`, fix: f.bom ? "Save the file as UTF-8 without a byte order mark." : "Correct the Starlark at that line. Run `codex execpolicy check --rules <file> -- <command>` to test a file." });
    } else if (!f.ok) {
      add("rules-unevaluated", { file: f.path, line: f.error.line || null, message: `${f.path}:${f.error.line || "?"}: this tool cannot run the file completely (${f.error.message})`, effect: "Codex runs the whole Starlark program. This tool reads the common subset (calls, variables, loops, comprehensions, small functions), so it knows nothing of the rules in this file and says nothing about them.", fix: "Nothing to fix. Test the file with `codex execpolicy check --rules <file> -- <command>`." });
    }
  }
  for (const p of c.rules.exampleProblems) {
    add("rules-example-fails", { file: p.file, line: p.line, message: p.kind === "match" ? `the match example "${p.example}" matches no rule` : `the not_match example "${p.example}" matches the rule it is written in`, effect: `\`codex exec\` does not start: it exits with code 1 and prints "Error loading rules:" and ${p.kind === "match" ? "\"expected every example to match at least one rule\"" : "\"expected example to not match rule\""}. The terminal UI starts and warns "Error parsing rules; custom rules not applied.": it applies none of your rules, in any file (put to Codex 0.163.0).`, fix: p.kind === "match" ? "Correct the example, or the pattern." : "Correct the example, or narrow the pattern." });
  }
  for (const s of shadowedRules(c.rules.rules)) {
    add("rules-shadowed", { file: s.rule.file, line: s.rule.line, message: `the allow rule ${patternText(s.rule)} never decides: the ${s.by.decision} rule ${patternText(s.by)} (${s.by.file === s.rule.file ? `line ${s.by.line}` : `${s.by.file}:${s.by.line}`}) matches every command it matches`, effect: "When several rules match, the strictest decision wins (forbidden, then prompt, then allow): `codex execpolicy check` lists both and decides with the stricter.", fix: "Delete the allow rule, or narrow the stricter rule." });
  }
  for (const r of c.rules.rules) {
    if (r.decision !== "allow") continue;
    const bad = expandPattern(r).filter(isBannedPrefix);
    if (!bad.length) continue;
    const words = (p) => `\`${p.join(" ")}\``;
    add("rules-allow-ignored", {
      file: r.file, line: r.line,
      message: `the allow rule ${patternText(r)} is not honoured: Codex ignores an allow rule for ${bad.map(words).join(", ")}`,
      effect: "Codex keeps a table of prefixes it will not trust an allow rule for: the shells, the interpreters with -c, -e or -r, git, env, rm, sudo, `npm run` and a few more (put to Codex 0.163.0, prefix by prefix). The command is handled as if no rule matched, so it asks, or runs inside the sandbox. A prompt or forbidden rule on the same pattern is honoured, and so is a longer pattern.",
      fix: `Make the pattern longer, for example ["${bad[0][0]}", "status"] and not ["${bad[0][0]}"], or ask for the exact command you mean.`,
    });
  }

  // ---- MCP servers
  for (const s of c.mcp) {
    const at = whereSet(world, ["mcp_servers", s.id]);
    for (const p of s.problems) add("mcp-invalid", { file: at.file || userFile, line: at.line, message: `[mcp_servers.${s.id}]: ${p.message}`, effect: `Codex does not start: "Error loading config.toml: ${p.message.split(":")[0]}\\n  in \`mcp_servers.${s.id}\`".`, fix: p.kind === "both" ? "Use `command` for a program Codex starts, or `url` for a server it connects to." : p.kind === "neither" ? "Add a `command` (and `args`) or a `url`." : `Remove \`${p.key}\`, or use \`url\` and not \`command\`.` });
    if (s.transport === "stdio" && s.enabled && s.resolved && !s.resolved.found) {
      add("mcp-command-missing", {
        severity: s.required ? "error" : "warning", file: at.file || userFile, line: at.line,
        message: `[mcp_servers.${s.id}] starts \`${s.command}\`, and no such program is found${s.argsInCommand ? ` (\`command\` is a program name: put the arguments in \`args\`)` : ""}`,
        effect: s.required ? "Codex does not start: \"required MCP servers failed to initialize: " + s.id + (win ? ": program not found" : ": No such file or directory (os error 2)") + "\" (exit code 1)." : "Codex skips the server in silence (nothing is printed in `codex exec`, and the exit code is 0), and the model never sees its tools.",
        fix: s.argsInCommand ? `Set command = "${s.command.trim().split(/\s+/)[0]}" and args = ${JSON.stringify(s.command.trim().split(/\s+/).slice(1))}.` : `Install the program, put its folder in PATH${win ? " (a .cmd or .bat file is found; a .ps1 script is not)" : ""}, or write its full path.`,
      });
    }
  }

  // ---- the model provider
  const pv = c.provider;
  for (const p of pv.list) {
    const at = whereSet(world, ["model_providers", p.id]);
    if (p.reserved) add("provider-reserved-id", { file: at.file || userFile, line: at.line, message: `[model_providers.${p.id}] redefines a built-in provider`, effect: `Codex does not start: "model_providers contains reserved built-in provider IDs: \`${p.id}\`. Built-in providers cannot be overridden. Rename your custom provider (for example, \`openai-custom\`)."`, fix: `Rename the provider (for example \`${p.id}-custom\`) and set model_provider to the new name.` });
    if (p.wireApi !== "responses") add("provider-wire-api", { file: at.file || userFile, line: at.line, message: `[model_providers.${p.id}] has wire_api = ${JSON.stringify(p.wireApi)}`, effect: p.wireApi === "chat" ? "Codex does not start and prints: `wire_api = \"chat\"` is no longer supported. How to fix: set `wire_api = \"responses\"` in your provider config." : `Codex does not start and prints: unknown variant \`${p.wireApi}\`, expected \`responses\``, fix: "Set wire_api = \"responses\" (the only value). A server that speaks only chat completions needs a gateway that answers the Responses API." });
    if (!p.name) add("provider-conflict", { file: at.file || userFile, line: at.line, message: `[model_providers.${p.id}] has no \`name\``, effect: `Codex does not start: "model_providers.${p.id}: provider name must not be empty".`, fix: "Add name = \"...\"." });
    if (p.hasAuth && p.envKey) add("provider-conflict", { file: at.file || userFile, line: at.line, message: `[model_providers.${p.id}] has both \`auth\` and \`env_key\``, effect: `Codex does not start: "model_providers.${p.id}: provider auth cannot be combined with env_key".`, fix: "Keep one of them." });
    if (p.selected && !p.reserved && !p.baseUrl) add("provider-base-url", { file: at.file || userFile, line: at.line, message: `[model_providers.${p.id}] has no base_url`, effect: "Codex connects to https://api.openai.com/ (put to Codex 0.163.0: the connection log names that host), whatever the provider is called.", fix: "Add base_url = \"https://...\" for the service you mean." });
    if (p.selected && p.envKey && !p.envKeySet) add("provider-env-key-unset", { file: at.file || userFile, line: at.line, message: `[model_providers.${p.id}] reads its key from ${p.envKey}, and ${p.envKey} is not set in this environment`, effect: `Codex stops at the first request: "ERROR: Missing environment variable: \`${p.envKey}\`." (exit code 1).`, fix: `Set ${p.envKey} in the environment Codex starts in${win ? " (setx stores it for new terminals; the desktop app and editors need a restart)" : ""}.` });
  }
  if (typeof c.value.model_provider === "string" && !pv.selectedDefined && !BUILT_IN.includes(pv.selected)) {
    const layer = world.layers.find((l) => entryOf(l, ["model_provider"]));
    const e = layer && entryOf(layer, ["model_provider"]);
    add("provider-undefined", { file: layer ? layer.path : userFile, line: e ? e.line : null, message: `model_provider is "${pv.selected}", and no [model_providers.${pv.selected}] is defined`, effect: `Codex does not start: "Error: Model provider \`${pv.selected}\` not found".`, fix: `Define [model_providers.${pv.selected}] in the user's config.toml (a project's config may not: model_provider and model_providers are ignored there), or use a built-in provider (${RESERVED_PROVIDER_IDS.join(", ")}).` });
  }

  // ---- the Windows sandbox
  const ws = c.windows;
  if (ws.applicable) {
    const fullAccess = ws.sandboxMode.wanted === "danger-full-access";
    if (ws.selection === "none" && !fullAccess) {
      add("windows-sandbox", {
        file: userFile,
        message: `No Windows sandbox is selected: windows.sandbox is not set and ${ws.preferUnavailable ? "features.prefer_mxc is true, but MXC is not available here (" + (ws.log && ws.log.mxcAvailable === false ? "Codex's sandbox log says \"MXC availability: false\"" : `this Windows is build ${ws.build}`) + "), which Codex does not make up for with another sandbox" : "features.prefer_mxc is not true"}${ws.sandboxMode.downgraded ? `; ${ws.sandboxMode.asked ? "sandbox_mode" : "the default sandbox_mode"} workspace-write becomes read-only` : ""}`,
        effect: "Codex has no sandbox to run commands in. The prompt tells the model sandbox_mode is read-only; with approval_policy on-request every command that no rule allows asks first (even `echo hi`), with never it is refused (\"blocked by policy\"). Put to Codex 0.163.0 on Windows 11; the sandbox log says \"Windows sandbox selection: disabled\".",
        fix: "Add to config.toml:\n[windows]\nsandbox = \"unelevated\"\nwhich needs no administrator; \"mxc\" (or `[features] prefer_mxc = true`) needs Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278 or newer; \"elevated\" needs a one-time administrator setup.",
      });
    }
    if (ws.selection === "mxc" && ws.mxcBuild === "too-old") add("windows-sandbox", { severity: "error", file: userFile, message: `windows.sandbox is "mxc" and this Windows is build ${ws.build}; MXC needs build 26100.9278 or newer`, effect: "Documented: an explicit \"mxc\" fails when the device lacks the capabilities.", fix: "Use \"unelevated\" or \"elevated\", or update Windows." });
    else if (ws.selection === "mxc" && ws.log && ws.log.mxcAvailable === false) add("windows-sandbox", { file: ws.log.path, message: "windows.sandbox selects mxc, and Codex's sandbox log says \"MXC availability: false\"", effect: "Codex found no MXC on this machine the last time it ran (the line is in the sandbox log).", fix: "Use \"unelevated\" or \"elevated\", or update Windows to build 26100.9278 / 26200.9278 or newer." });
    else if (ws.selection === "mxc" && ws.mxcBuild === "check-update") add("windows-sandbox", { severity: "note", file: userFile, message: `Windows build ${ws.build}: MXC needs the update revision .9278 or newer, which this tool does not read`, effect: "Documented. If `codex -c windows.sandbox=mxc sandbox --include-managed-config --permission-profile :workspace -- cmd.exe /d /c echo MXC_OK` does not print MXC_OK, MXC is not available.", fix: "Run that probe once." });
    if (ws.selection === "elevated") add("windows-sandbox", { severity: "note", file: userFile, message: "windows.sandbox is \"elevated\": it needs a one-time setup by an administrator", effect: "Documented: the setup creates sandbox users and firewall rules. This tool cannot tell whether it was done.", fix: "If commands are refused, run the setup from Codex (an administrator approves it), or use \"unelevated\"." });
  }

  out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts = { error: 0, warning: 0, note: 0 };
  for (const x of out) counts[x.severity]++;
  return { findings: out, counts };
}

const patternText = (r) => `[${r.pattern.map((alts) => (alts.length === 1 ? JSON.stringify(alts[0]) : `[${alts.map((a) => JSON.stringify(a)).join(", ")}]`)).join(", ")}]`;
