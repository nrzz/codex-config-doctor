# codex-config-doctor

[![test](https://github.com/nrzz/codex-config-doctor/actions/workflows/test.yml/badge.svg)](https://github.com/nrzz/codex-config-doctor/actions/workflows/test.yml) [![e2e](https://github.com/nrzz/codex-config-doctor/actions/workflows/e2e.yml/badge.svg)](https://github.com/nrzz/codex-config-doctor/actions/workflows/e2e.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933.svg) ![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg) [![by the author of the Claude Code toolkit](https://img.shields.io/badge/Claude%20Code-toolkit-d97757.svg)](https://github.com/nrzz/claude-code-toolkit)

Codex CLI has the largest configuration surface of the coding agents, and most of what goes wrong in it goes wrong in silence. On 17 October 2026, openai/codex had 129,639 stars and 23,030 open issues. A key with a typo is accepted unless you start Codex with `--strict-config`. A project's `.codex/` folder, with its config, hooks and rules, is ignored until you trust the project, and `codex exec` prints nothing about it. Ten keys are ignored in a project's `config.toml` with one warning. A rules file with an error stops `codex exec`, and the app server that the terminal UI is built on starts anyway and applies none of your rules. AGENTS.md is cut at 32 KiB without a word ([#13386](https://github.com/openai/codex/issues/13386), 12 reactions: "AGENTS.md is silently truncated and instructions near the end ignored"), an empty `AGENTS.override.md` hides the `AGENTS.md` next to it ([#54755](https://github.com/openai/codex/issues/54755)), a hook with a field Codex does not read keeps its 600 second timeout ([#50303](https://github.com/openai/codex/issues/50303)), a hook you changed is skipped until you trust it again, and an allow rule for `git` or `rm` is ignored. The built-in `codex doctor` reports the install, the login, the runtime, Git, the terminal and the threads, and `/debug-config` prints the layers inside a session. Given eight configurations with one problem each, `codex doctor` 0.163.0 reported four (an unknown key, a TOML error, the legacy profile selector, an MCP server whose program is missing) and called the other four fine (a rules file that does not load, a project folder that is ignored because it is not trusted, a hook with no trust record, an AGENTS.md cut by the cap).

codex-config-doctor reads your Codex configuration and says what Codex will do with it. `show` lists every layer and the merged settings with the source of each key, the AGENTS.md files against their size cap, the rules, the hooks, the MCP servers and the Windows sandbox. `lint` finds what is wrong, each finding with the file and line, what Codex does about it and the fix. `why` says what Codex does with a shell command. What it says about Codex was put to the real `codex` binary through a fake API on 127.0.0.1, and each line of an explanation says whether it is verified, documented (the documentation says so, the binary was not asked) or not verified. The tool is a plain Node program that runs outside Codex: it reads files and the environment, changes nothing, starts no program and opens no connection, so it costs no tokens.

## What you get

- `show`: every layer Codex loads for the project, in the order it applies them (the system `config.toml`, the user's, a profile file, and the project's `.codex/config.toml` from the project root down to the working folder), each read, missing, skipped (a project you have not trusted) or broken (a TOML error, with the line). The merged settings with the layer each key came from, the keys a project's file may not set, and the trust entry for this project. The AGENTS.md files against `project_doc_max_bytes`, the rules files with their rule counts, the hooks and whether Codex trusts them, the MCP servers and whether their programs are found, the model provider, and on Windows the sandbox Codex selects.
- `lint`: 44 findings, each with an id, a severity (error, warning or note), the file and line, what Codex does about it, and the fix. 42 rest on the real binary and two on the documentation. Exit 1 when there is an error or a warning. `lint --markdown` is the short form to paste into an agent: at most 12 findings and 500 characters a line.
- `why "<command>"`: what Codex does with a shell command under your approval policy, sandbox and rules: runs it inside the sandbox, asks first, runs it outside the sandbox through an allow rule, refuses it, or splits a script into the commands it judges one by one. Which rule matched each part, with the prefix and the file and line, or why none did. Exit 1 when Codex would refuse it.
- `agents`: the AGENTS.md files in the order Codex reads them, each included, cut or left out against the cap, and the size of the text. `agents --print` prints the text exactly as Codex sends it.
- `cost`: what the first request of a session carries before your words (the base instructions, the skills, the permissions, AGENTS.md, the environment, the tool definitions), in characters and in tokens. The parts that come from your files are computed and exact; the parts that belong to Codex are the ones recorded from Codex 0.163.0 on each system.
- `explain <finding-id>` and `explain --list`: the page of a finding: what it means, what Codex does (each line marked verified, documented or not verified), and the fix.
- `--json` on every command, for scripts and for other tools. `--project <dir>` and `--profile <name>` on the commands that read the configuration. `CODEX_HOME` is honoured as Codex honours it.

## What it costs in tokens

| Part | Tokens | |
| --- | --- | --- |
| The tool: every command, `--json`, `--markdown` | 0 | It runs outside Codex and sends nothing to a model. If you paste `lint --markdown` into an agent, the paste is at most 6,094 characters plus the length of the project path (12 findings of at most 500 characters, a header and a pointer line): about 1,524 tokens by characters / 4, an estimate. The report of the example project below is 1,580 characters, about 395 tokens. |

## Install

**From a terminal**, with Node 18 or newer. There is nothing to install and no dependency:

```bash
npx -y github:nrzz/codex-config-doctor show --project .
```

```bash
npx -y github:nrzz/codex-config-doctor lint
```

Or from a clone:

```bash
git clone https://github.com/nrzz/codex-config-doctor
node codex-config-doctor/bin/codex-config-doctor.mjs lint --project .
```

## Use

The examples are what the commands print for the Codex home and the project in `examples/` (a Codex home at `/home/runner/.codex`, a project at `/home/runner/shop` with a Git folder, `node`, `git` and `npm` on PATH), on a pretend Linux machine, so that the text is the same on every system; the two examples with a `C:\Users\me\shop>` prompt are a pretend Windows 11 machine (build 26100). A test runs each of them and compares it with this page. The behaviour they describe was put to the real Codex, as "What was verified, and how" says.

```text
Usage: codex-config-doctor <command> [options]

It reads your Codex CLI configuration and changes nothing. Zero tokens: it runs outside Codex.

  show     [--project <dir>] [--profile <name>]
           every layer Codex loads for this project, in the order it applies them, each read,
           missing, skipped (a project you have not trusted) or broken; the merged configuration
           with the layer each key came from; the keys a project may not set; the AGENTS.md files
           against their cap; the rules files; the hooks and whether Codex trusts them; the MCP
           servers and whether their programs are found; the model provider; the Windows sandbox
  lint     [--project <dir>] [--profile <name>] [--markdown]
           what is wrong: each finding has an id, a severity (error, warning, note), the file and
           line, what Codex does about it, and the fix. Exit 1 on an error or a warning.
           --markdown is the short form to paste into an agent (at most 12 findings)
  why      <command> [--project <dir>] [--profile <name>] [--shell bash|powershell]
           what Codex does with this shell command under the approval policy, the sandbox and the
           rules: runs inside the sandbox, asks first, runs outside the sandbox through an allow
           rule, is forbidden, or is split into parts that are judged separately. Exit 1 when
           Codex would refuse it. Quote the command: why "git status && rm -rf build"
  agents   [--project <dir>] [--profile <name>] [--print]
           the AGENTS.md files in order, each included, cut or left out against
           project_doc_max_bytes, and the size of the text; --print prints that text exactly as
           Codex sends it. Exit 1 when a file is cut or left out
  cost     [--project <dir>] [--profile <name>]
           what the first request of a session carries before your words: base instructions,
           skills, permissions, AGENTS.md, tool definitions; yours are computed, Codex's recorded
  explain  [--list] <finding-id>
           what a finding means, what Codex does in that case (each line marked verified,
           documented or not verified), and the fix

Options:
  --json            one JSON document on stdout (every command)
  --project <dir>   the folder Codex starts in (default: the folder you are in)
  --profile <name>  the profile file you start Codex with: $CODEX_HOME/<name>.config.toml
  -h, --help        this text
  -v, --version     the version

Exit codes: 0 ok; 1 findings, or Codex would refuse the command; 2 a usage error.
Environment: CODEX_HOME (Codex's folder, as Codex reads it), USERPROFILE or HOME (the default, ~/.codex),
ProgramData (the system folder on Windows; /etc/codex elsewhere), PATH and PATHEXT.
It reads files and the environment and starts no program. It writes nothing, opens no connection
and sends nothing anywhere.
```

### `show`

Prints what Codex will use. The first lines say where Codex looks (its home, and whether `CODEX_HOME` was set), whether the project is trusted and by which entry, and where the project root is. Then the layers, the one that wins first, then the merged settings and the layer each came from, and a block for each of AGENTS.md, the rules, the hooks, the MCP servers and the provider. Exit 1 if a configuration file is broken or `CODEX_HOME` names a folder that is not there.

```text
$ codex-config-doctor show
codex-config-doctor 1.0.0  what Codex will do with this configuration
project   /home/runner/shop
codex     /home/runner/.codex  (the default, ~/.codex)
trust     trusted, by the entry for this folder (/home/runner/shop)
root      /home/runner/shop  (found by .git)

Layers, the one that wins first
  1  project  /home/runner/shop/.codex/config.toml  read    3 keys, 90 bytes
              ignored here, with a warning: notify
  2  user     /home/runner/.codex/config.toml       read    10 keys, 309 bytes
  3  system   /etc/codex/config.toml                missing
     requirements.toml  /etc/codex/requirements.toml  missing

What Codex uses: 11 settings
  model                                     "gpt-5.4"          project
  approval_policy                           "on-request"       user
  sandbox_mode                              "workspace-write"  user
  project_doc_max_bytes                     1900               user
  aproval_policy                            "never"            user
  features.codex_hooks                      true               user
  features.web_search_request               true               user
  mcp_servers.docs.command                  "docs-mcp"         user
  mcp_servers.docs.args                     ["--stdio"]        user
  projects."/home/runner/shop".trust_level  "trusted"          user
  model_reasoning_effort                    "high"             project

AGENTS.md: 1,458 characters reach the model; the cap is 1,900 bytes
  global   /home/runner/.codex/AGENTS.md  135 bytes (not counted against the cap)
  included  /home/runner/shop/AGENTS.md  1,222 bytes  (1,222 of 1,900)

Rules: 5 rules in 1 file
  5 rules  /home/runner/.codex/rules/default.rules

Hooks: 1
  untrusted  PreToolUse *  node /home/runner/.codex/hooks/guard.mjs  (hooks.json in /home/runner/.codex)

MCP servers: 1
  docs  stdio  docs-mcp  NOT FOUND on PATH

Model provider: openai (built in), model gpt-5.4

Run `codex-config-doctor lint` for what is wrong with it.
```

The example has a project file (`.codex/config.toml`) that sets `model`, `notify` and `model_reasoning_effort`: its `model` wins over the user's, `model_reasoning_effort` is added, and Codex ignores `notify` there. The AGENTS.md block says that 1,458 characters reach the model: the global file, which does not count against the cap, and the project's. The hook in `hooks.json` is `untrusted`: Codex skips it. The MCP server's program is not on PATH.

### `lint`

The findings, worst first within the order of the files. Each says where (file and line), what is wrong, what Codex does about it, and the fix. A finding's id is the argument of `explain`. Exit 1 when there is an error or a warning, and 0 for notes only or nothing.

```text
$ codex-config-doctor lint
codex-config-doctor 1.0.0  lint
project   /home/runner/shop
codex     /home/runner/.codex

WARNING unknown-key   /home/runner/.codex/config.toml:5
  `aproval_policy` is not a key Codex knows. Did you mean `approval_policy`?
  Codex: Codex ignores `aproval_policy`. It prints "warning: Codex is ignoring 1 unrecognized configuration setting. Check for typos or deprecated settings." (in `codex exec`, and the app server that the terminal UI is built on sends it as a warning; with `--json` it is an error item in the event stream). `--strict-config` refuses to start.
  Fix:   Did you mean `approval_policy`, or remove the key.

WARNING ignored-in-project   /home/runner/shop/.codex/config.toml:2
  /home/runner/shop/.codex/config.toml sets `notify`, which a project's config may not set
  Codex: Codex ignores it and prints: "warning: Ignored unsupported project-local config keys in /home/runner/shop/.codex/config.toml: notify. If you want these settings to apply, manually set them in your user-level config.toml." (with `codex exec --json` it is an error item in the event stream).
  Fix:   Move it to /home/runner/.codex/config.toml.

WARNING feature-alias   /home/runner/.codex/config.toml:8
  `features.codex_hooks` is the old name of `features.hooks`
  Codex: Codex honours it and prints: "deprecated: `[features].codex_hooks` is deprecated. Use `[features].hooks` instead."
  Fix:   Rename it to `hooks`.

WARNING hook-untrusted   /home/runner/.codex/hooks.json
  the PreToolUse hook for * (hooks.json, group 1, handler 1) is not trusted: there is no record for it in /home/runner/.codex/config.toml
  Codex: Codex skips it. `codex exec` says nothing; the app server lists it as untrusted, and the documentation says `/hooks` in the terminal UI lists it for review.
  Fix:   Review and trust it with /hooks in Codex, or add to /home/runner/.codex/config.toml:
         [hooks.state."/home/runner/.codex/hooks.json:pre_tool_use:0:0"]
         trusted_hash = "sha256:8f3dbcedc9bf83b0d8db1d418a80614376107f6ebd56e7ec7a59b8cabc1a5f2b"

WARNING rules-allow-ignored   /home/runner/.codex/rules/default.rules:2
  the allow rule ["git"] is not honoured: Codex ignores an allow rule for `git`
  Codex: Codex keeps a table of prefixes it will not trust an allow rule for: the shells, the interpreters with -c, -e or -r, git, env, rm, sudo, `npm run` and a few more (put to Codex 0.163.0, prefix by prefix). The command is handled as if no rule matched, so it asks, or runs inside the sandbox. A prompt or forbidden rule on the same pattern is honoured, and so is a longer pattern.
  Fix:   Make the pattern longer, for example ["git", "status"] and not ["git"], or ask for the exact command you mean.

WARNING mcp-command-missing   /home/runner/.codex/config.toml:11
  [mcp_servers.docs] starts `docs-mcp`, and no such program is found
  Codex: Codex skips the server in silence (nothing is printed in `codex exec`, and the exit code is 0), and the model never sees its tools.
  Fix:   Install the program, put its folder in PATH, or write its full path.

NOTE    feature-deprecated   /home/runner/.codex/config.toml:9
  `features.web_search_request` is deprecated
  Codex: Codex honours it and prints a "deprecated: `[features].web_search_request` is deprecated" notice at start.
  Fix:   Follow the replacement in Codex's notice, or delete the line.

0 errors, 6 warnings, 1 note. `codex-config-doctor explain <id>` says what Codex does, line by line.
```

`lint --markdown` is the same findings in the short form for pasting into an agent. It shows at most 12 findings, 500 characters a line, and says how many more there are. A fix that goes on over several lines (such as the record to add for a hook) is cut to its first line with a pointer to the full report.

```text
$ codex-config-doctor lint --markdown
## codex-config-doctor lint: /home/runner/shop
- WARNING unknown-key (/home/runner/.codex/config.toml:5): `aproval_policy` is not a key Codex knows. Did you mean `approval_policy`? Fix: Did you mean `approval_policy`, or remove the key.
- WARNING ignored-in-project (/home/runner/shop/.codex/config.toml:2): /home/runner/shop/.codex/config.toml sets `notify`, which a project's config may not set Fix: Move it to /home/runner/.codex/config.toml.
- WARNING feature-alias (/home/runner/.codex/config.toml:8): `features.codex_hooks` is the old name of `features.hooks` Fix: Rename it to `hooks`.
- WARNING hook-untrusted (/home/runner/.codex/hooks.json): the PreToolUse hook for * (hooks.json, group 1, handler 1) is not trusted: there is no record for it in /home/runner/.codex/config.toml Fix: Review and trust it with /hooks in Codex, or add to /home/runner/.codex/config.toml (the lines to add: run `codex-config-doctor lint`)
- WARNING rules-allow-ignored (/home/runner/.codex/rules/default.rules:2): the allow rule ["git"] is not honoured: Codex ignores an allow rule for `git` Fix: Make the pattern longer, for example ["git", "status"] and not ["git"], or ask for the exact command you mean.
- WARNING mcp-command-missing (/home/runner/.codex/config.toml:11): [mcp_servers.docs] starts `docs-mcp`, and no such program is found Fix: Install the program, put its folder in PATH, or write its full path.
- NOTE feature-deprecated (/home/runner/.codex/config.toml:9): `features.web_search_request` is deprecated Fix: Follow the replacement in Codex's notice, or delete the line.
```

On Windows, `lint` also says what Codex does when no sandbox is selected, which is the case on a machine where nobody has set `[windows] sandbox`:

```text
C:\Users\me\shop> codex-config-doctor lint
codex-config-doctor 1.0.0  lint
project   C:\Users\me\shop
codex     C:\Users\me\.codex

WARNING windows-sandbox   C:\Users\me\.codex\config.toml
  No Windows sandbox is selected: windows.sandbox is not set and features.prefer_mxc is not true; sandbox_mode workspace-write becomes read-only
  Codex: Codex has no sandbox to run commands in. The prompt tells the model sandbox_mode is read-only; with approval_policy on-request every command that no rule allows asks first (even `echo hi`), with never it is refused ("blocked by policy"). Put to Codex 0.163.0 on Windows 11; the sandbox log says "Windows sandbox selection: disabled".
  Fix:   Add to config.toml:
         [windows]
         sandbox = "unelevated"
         which needs no administrator; "mxc" (or `[features] prefer_mxc = true`) needs Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278 or newer; "elevated" needs a one-time administrator setup.

0 errors, 1 warning, 0 notes. `codex-config-doctor explain <id>` says what Codex does, line by line.
```

### `why`

Takes one shell command in quotes. It applies your approval policy, your sandbox mode and your rules the way Codex does: the script is split on `&&`, `||`, `;` and `|` into separate commands unless it has redirections, substitutions, variables, wildcards or control flow, each part is matched against the rules (the prefix that matched, the file and line, or why no rule did), and the strictest decision wins. When no rule decides a command, Codex looks at the command itself: it asks about `rm` with a force option (`rm -f`, `rm -rf`, `rm --force`, also inside a longer script) and, in PowerShell, about `Remove-Item` with `-Force` and `Start-Process` with a web address, whatever the sandbox, and with `approval_policy = "never"` it refuses them. `git reset` and `git rm` are not on its list. `--shell bash|powershell` chooses how a script is split (the default is PowerShell on Windows and bash elsewhere). Exit 1 when Codex would refuse the command.

```text
$ codex-config-doctor why "git status"
codex-config-doctor 1.0.0  why
command   git status
settings  approval_policy on-request; sandbox_mode workspace-write; shell bash

Codex runs it outside the sandbox, without asking: every part is allowed by a rule.

Judged as 1 command:
  git status
      allow    ["git"]  default.rules:2  (Codex ignores this allow rule)
      allow    ["git", "status"]  default.rules:3

  (verified) The allow rule ["git"] (default.rules:2) is not honoured: Codex ignores an allow rule for git, so this part is handled as if no rule matched.
  (verified) It has an allow rule (["git", "status"] (default.rules:3)), so Codex skips the question and the sandbox (a command in which one part has no rule stays in the sandbox).
```

`git` alone is on the list of prefixes for which Codex ignores an allow rule, so `["git"]` in the example's `default.rules` does nothing, and the command is allowed only because of `["git", "status"]`.

```text
$ codex-config-doctor why "git push origin main"
codex-config-doctor 1.0.0  why
command   git push origin main
settings  approval_policy on-request; sandbox_mode workspace-write; shell bash

Codex runs it inside the workspace-write sandbox, without asking.

Judged as 1 command:
  git push origin main
      allow    ["git"]  default.rules:2  (Codex ignores this allow rule)

  (verified) The allow rule ["git"] (default.rules:2) is not honoured: Codex ignores an allow rule for git, so this part is handled as if no rule matched.
  (documented) The sandbox lets it read files, and write under the project folder, the folders in writable_roots and the temporary folders (TMPDIR and /tmp, unless sandbox_workspace_write.exclude_tmpdir_env_var and exclude_slash_tmp are true); a write elsewhere fails inside the sandbox.
  (documented) If it needs more, the model can ask to run it outside the sandbox, and then you are asked.
```

```text
$ codex-config-doctor why "git status && rm -rf build"
codex-config-doctor 1.0.0  why
command   git status && rm -rf build
settings  approval_policy on-request; sandbox_mode workspace-write; shell bash

Codex refuses to run it: a forbidden rule matches `rm -rf`.

Judged as 2 commands (the script was split):
  git status
      allow    ["git"]  default.rules:2  (Codex ignores this allow rule)
      allow    ["git", "status"]  default.rules:3
  rm -rf build
      forbidden["rm", "-rf"]  default.rules:6  "deleting a tree is never an agent's call"

  (verified) The script is a plain list of 2 commands (git, rm), so Codex judges each one on its own and the strictest answer counts.
  (verified) The allow rule ["git"] (default.rules:2) is not honoured: Codex ignores an allow rule for git, so this part is handled as if no rule matched.
  (verified) The rule ["rm", "-rf"] (default.rules:6) is forbidden ("deleting a tree is never an agent's call"): the model gets "rejected: deleting a tree is never an agent's call" and the command does not start. The approval policy and the sandbox do not change that.
```

```text
$ codex-config-doctor why "npm publish"
codex-config-doctor 1.0.0  why
command   npm publish
settings  approval_policy on-request; sandbox_mode workspace-write; shell bash

Codex asks you first: a prompt rule matches `npm publish`.

Judged as 1 command:
  npm publish
      prompt   ["npm", "publish"]  default.rules:5  "publishing is a decision for a person"

  (verified) The rule ["npm", "publish"] (default.rules:5) asks every time; the question says "requires approval: publishing is a decision for a person", in the full-access sandbox as well.
```

On Windows with no sandbox selected there is nothing to run a command in, so every command that no allow rule covers asks, even `echo hi`:

```text
C:\Users\me\shop> codex-config-doctor why "echo hi"
codex-config-doctor 1.0.0  why
command   echo hi
settings  approval_policy on-request; sandbox_mode read-only; Windows sandbox not selected; shell powershell

Codex asks you first: no Windows sandbox is selected, so there is nothing to run it in.

Judged as 1 command:
  echo hi
      no rule matches

  (verified) Every command that no allow rule covers asks, even `echo hi`. Select a sandbox with `[windows] sandbox = "unelevated"` (see `lint`, windows-sandbox).
  (verified) No rule matches any part of it.
```

### `agents`

The AGENTS.md files in the order Codex reads them. For each: its path, its size, and whether it is included, cut by the cap, or left out. The files go in from the project root down to the working folder, so the files nearest to where you work come last and are the ones that are cut or left out. The global file under `CODEX_HOME` is not counted against `project_doc_max_bytes`. Exit 1 when a file is cut or left out. `--print` writes the text exactly as Codex sends it, to check what the model reads.

```text
$ codex-config-doctor agents
codex-config-doctor 1.0.0  agents
project   /home/runner/shop  (root /home/runner/shop)
cap       project_doc_max_bytes 1,900

  global    /home/runner/.codex/AGENTS.md  135 bytes  included (not counted against the cap)
   1        /home/runner/shop/AGENTS.md  1,222 bytes  included  [1,222 of 1,900]

The text the model gets: 1,458 characters (1,458 bytes), about 365 tokens by characters / 4. `agents --print` prints it.
```

With the working folder in `app/`, the second file does not fit in the 1,900 bytes of the example:

```text
$ codex-config-doctor agents --project /home/runner/shop/app
codex-config-doctor 1.0.0  agents
project   /home/runner/shop/app  (root /home/runner/shop)
cap       project_doc_max_bytes 1,900

  global    /home/runner/.codex/AGENTS.md  135 bytes  included (not counted against the cap)
   1        /home/runner/shop/AGENTS.md  1,222 bytes  included  [1,222 of 1,900]
   2        /home/runner/shop/app/AGENTS.md  1,072 bytes  CUT: 678 of 1,072 bytes read, 394 lost  [1,900 of 1,900]

The text the model gets: 2,142 characters (2,142 bytes), about 536 tokens by characters / 4. `agents --print` prints it.
```

### `cost`

What the first request of a session carries before your words, in characters and in tokens (characters divided by four, an estimate; the real count is the model's). "computed" rows come from your files and are exact: the AGENTS.md message and the skills block were compared with Codex's own, character for character. "recorded" rows are what Codex 0.163.0 sent with the model `gpt-5.5` on each system (Windows, Linux and macOS are recorded separately, because the tool definitions, the permissions text and the environment differ) and move with the Codex version, the model and the feature flags. The last line says how much of it is yours: your AGENTS.md files and your skills are in front of the model on every request of the session.

```text
$ codex-config-doctor cost
codex-config-doctor 1.0.0  cost
project   /home/runner/shop
What the first request of a session carries before your words. Tokens are characters / 4, an estimate.
"computed" comes from your files; "recorded" is what Codex 0.163.0 sent with model gpt-5.5 on Linux (2026-10-17) and moves with the version, the model and the system.

                         characters  tokens  source
  Base instructions      21,299      5,325   recorded: Codex 0.163.0, model gpt-5.5
  Skills                 4,511       1,128   recorded: 4 bundled skills; the how-to text is about 2,600 of the characters
  Permissions            4,039       1,010   recorded: approval on-request, sandbox workspace-write
  AGENTS.md              1,458       365     computed: 1 project file and the global file, 1,458 bytes
  Environment            853         213     recorded: the folder, the shell, the date, the time zone and the sandbox; moves with the length of the folder's path (and by a few characters with the names of the shell and the time zone)
  Tool definitions (13)  11,066      2,767   recorded: exec_command 1,564, write_stdin 784, list_mcp_resources 628, list_mcp_resource_templates 717, read_mcp_resource 526, request_user_input 1,355, apply_patch 846, view_image 526, get_goal 281, create_goal 760, update_goal 2,172, tool_search 804, web_search 89
  MCP servers (1)        -           -       not measured: docs: the three resource tools they bring are counted under tool definitions; a server's own tools are not in the first request (Codex 0.163.0 defers them behind tool_search: 2, 3, 30 and 60 tools gave the same request), so they cost when the model loads them, which this tool does not measure because it starts no server
  Total                  43,226      10,807

Yours (AGENTS.md and your skills): 1,458 characters, about 365 tokens, on every request of the session.
```

An enabled MCP server brings three tools to every request (the resource tools, counted under tool definitions) and adds its id to the description of `tool_search`; its own tools are not in the first request, because Codex defers them, so `cost` cannot say what they cost and says so. It starts no server.

### `explain`

`explain <finding-id>` prints the page of a finding. Each line of "What Codex does" is marked `verified` (the line was put to the real Codex in a test that runs when `E2E_CODEX` names a binary, and the words in quotes are what it printed), `documented` (a documentation page says so and the binary was not asked) or `not verified`. `explain --list` lists the 44 ids with their severity and basis. An unknown id exits 1 and names the nearest ids.

```text
$ codex-config-doctor explain rules-allow-ignored
rules-allow-ignored   An allow rule for a prefix Codex does not honour (a shell, an interpreter, git, env, rm, sudo, npm run ...)  [warning, binary]

An allow rule whose whole pattern is one of the 88 prefixes Codex keeps in a table of its own: a shell alone or with -c or -lc (bash, sh, zsh, fish, dash, ksh, cmd, powershell, pwsh ...), an interpreter alone or with -e, -c or -r (python, node, perl, ruby, php, lua, deno, bun, julia ...), git, env, rm, sudo, osascript, Rscript, and `npm run`, `pnpm run`, `yarn run`, `bun run`, `py -3`.

What Codex does
  - (verified) Codex does not honour the rule: the command is handled as if no rule matched. With no Windows sandbox selected (where every command asks) `git --version` under prefix_rule(pattern=["git"], decision="allow") was refused with approval never, and asked with on-request; a script that needs to write outside the project stayed in the sandbox.
  - (verified) Only the whole pattern counts: ["git", "status"], ["node", "build.mjs"], ["deno", "run"], ["rm", "-rf"], ["npm"], ["npm", "exec"], ["powershell", "-ec"] are honoured, and a prompt or forbidden rule on a banned prefix is honoured. The table is in the binary (the model is told not to suggest these prefixes); test/banned.mjs reads it from the Windows executable and test/e2e-why.test.mjs puts every prefix to the binary.

The fix
  - Make the pattern longer, for example ["git", "status"], or write the exact command you mean.

Documentation
  https://learn.chatgpt.com/docs/agent-configuration/rules.md
```

### The JSON documents

`--json` prints one document. Optional fields are marked `?`. A path in a document is a path of the system the command ran on.

```text
show     { ok, tool, version, command, platform, project,
           codexHome: { dir, source, problem },
           profile: null | { name, path, exists },
           trust: { level, by, entry, key, gitRoot, projectRoot, projectRootMarker },
           layers: [ { index, kind, path, status, applies, bytes, keys, trusted, reason, error, ignoredKeys: [ ] } ],
           requirements: { path, status, keys },
           config: [ { key, value, layer, file } ],
           ignoredInProject: [ { file, keys: [ ], applies } ],
           effective: { approval, sandbox, sandboxAsked, model },
           agents: { cap, total, chars, bytes, root, global: null | { path, bytes },
                     files: [ { path, bytes, status, includedBytes, cutBytes } ], shadowed: [ ] },
           rules: { count, files: [ { path, layer, skipped, ok, count, error } ] },
           hooks: { featureOff, bothFormats: [ ],
                    items: [ { event, matcher, source, format, type, command, server, tool, timeout, key, hash, status, runs } ] },
           mcp: [ { id, transport, command, url, enabled, required, found, path, startupTimeoutSec } ],
           provider: { selected, defined, builtIn, providers: [ { id, baseUrl, wireApi, envKey, envKeySet } ] },
           windows: null | { selection, how, sandboxMode: { asked, wanted, effective, downgraded }, build, mxcBuild,
                             log: null | { path, mxcAvailable, lastSelection, at } } }
lint     { ok, tool, version, command, platform, project, codexHome, profile,
           counts: { error, warning, note },
           findings: [ { id, severity, basis, file, line, column, message, effect, fix } ] }
why      { ok, tool, version, command, shellCommand, platform, project, shell, split, plain, reason,
           parts: [ { tokens: [ ], decision, danger,
                      matched: [ { matchedPrefix: [ ], decision, justification, file, line } ],
                      counted: [ { matchedPrefix: [ ], decision, justification, file, line } ],
                      ignored: [ { matchedPrefix: [ ], decision, justification, file, line } ] } ],
           decision, outcome, headline, lines: [ { source, text } ],
           settings: { approval, sandbox, sandboxAsked, windowsSandbox }, refused }
agents   { ok, tool, version, command, platform, project, cap, total, chars, bytes, root,
           global: null | { path, bytes },
           files: [ { path, bytes, status, includedBytes, cutBytes } ], shadowed: [ ], tokens, text }
cost     { ok, tool, version, command, platform, project,
           rows: [ { id, label, chars, source, detail, items?: [ { name, chars } ] } ],
           total, totalTokens, yours, yoursTokens, recorded: { codex, model, on, system, exact } }
explain  { ok, id?, title?, severity?, basis?, means?, does?: [ { source, text } ], fix?: [ ], docs?: [ ],
           findings?: [ { id, title, severity, basis } ], refused?, ids?: [ ], near?: [ ] }
```

- `status` of a layer is `read`, `missing`, `skipped` (a project that is not trusted) or `broken`. `status` of a hook is `trusted`, `untrusted`, `modified` or `disabled`; `runs` says whether Codex runs it.
- `severity` of a finding is `error`, `warning` or `note`; `basis` is `binary` (put to the real Codex) or `docs` (the documentation says so).
- `outcome` of `why` is `sandboxed`, `unsandboxed`, `outside-sandbox`, `asks`, `refused` or `forbidden`; `decision` is the strictest decision of the rules (`allow`, `prompt`, `forbidden`) or null when none matched, and `danger` of a part is what Codex finds dangerous in it (`rm -f`, `Remove-Item -Force`, ...) when no rule decides it, else null; `source` of a line is `verified` or `documented`.
- `status` of a file in `agents` is `included`, `cut`, `left-out` or `empty`.
- `source` of a row of `cost` is `computed`, `recorded` or `not measured`.
- A usage error with `--json` prints `{ "ok": false, "error": "..." }` and exits 2. `explain` with an unknown id prints `{ ok: false, refused, ids, near }` and exits 1.

## How it works

It reads, on your machine only, the places below. What it says about Codex is what "What was verified, and how" names; where an `explain` line says *documented*, it comes from a documentation page and the binary was not asked.

- **The environment of the process**: `CODEX_HOME`, `USERPROFILE` on Windows and `HOME` elsewhere, `ProgramData` on Windows, `PATH` and `PATHEXT`, and whether the variable that a provider's `env_key` names is set (never its value).
- **The Codex home** (`CODEX_HOME`, else `~/.codex`): `config.toml`, a profile file `<name>.config.toml` when you pass `--profile`, `AGENTS.md` and `AGENTS.override.md`, `hooks.json`, the `rules/` folder, the `skills/` folder, and on Windows the sandbox log under `.sandbox/`. In your home folder, `~/.agents/skills/`.
- **The system folder** (`/etc/codex`, or `ProgramData\OpenAI\Codex` on Windows): `config.toml`, and `requirements.toml`, which `show` lists and does not merge.
- **The project**: the `.codex/` folder of each directory from the project root down to the working folder (`config.toml`, `hooks.json`, `rules/`, `skills/`), the `AGENTS.md` files of those directories, and their `.agents/skills/`. The project root is the nearest folder with a `.git` (or one of the names in `project_root_markers`).
- **The folders on `PATH`** (with `PATHEXT` on Windows), to say whether the program of a hook or of an MCP server is there, and the first lines of a hook script it can read, to look for the word `ask`.

**Layers and trust** (put to Codex 0.163.0):

- From the lowest layer to the highest: the system `config.toml`, the user's `config.toml`, the profile file, then the `.codex/config.toml` of each folder from the project root down to the working folder, the closest winning. Tables merge key by key; arrays and single values are replaced. A `-c key=value` on the command line is above all of them and is not seen by this tool.
- A project layer applies only when the user's `config.toml` has `projects.<path>.trust_level = "trusted"` for the folder itself or, when the folder has no entry, for the Git root. Trusting only a subfolder loads that folder's layer and not the root's; an entry for a parent of the repository does nothing; `"untrusted"` is the same as no entry.
- An untrusted project's `.codex/config.toml` is not opened, so a syntax error in it does not stop Codex, and its hooks and rules are not used. Its skills are still read, and so are its AGENTS.md files.
- Ten keys are ignored in a project's `config.toml` (`openai_base_url`, `chatgpt_base_url`, `apps_mcp_product_sku`, `model_provider`, `model_providers`, `notify`, `profile`, `profiles`, `experimental_realtime_ws_base_url`, `otel`), with one warning at start.
- On Windows the `projects` entry is compared with the folder's path as Windows spells it: backslashes, no trailing separator, no `\\?\` prefix, case ignored. An entry with forward slashes, a trailing backslash or a `\\?\` prefix matches nothing. The warning that Codex prints for an untrusted project names the folder in lower case with backslashes, and an entry written that way trusts it.
- `codex exec` with the sandbox set to `danger-full-access` (in the file, with `--sandbox` or with the bypass flag) writes a trusted entry for the working folder into your `config.toml` after the run, and so does `--sandbox workspace-write` where a sandbox can run (Linux and macOS; on Windows with no sandbox selected workspace-write is read-only and writes nothing).
- A profile is a file: `--profile x` reads `$CODEX_HOME/x.config.toml`, and without the file Codex starts without a profile and says nothing. A top-level `profile = "x"` stops Codex, and `--profile x` with a `[profiles.x]` table in `config.toml` stops it too.

**Keys**: Codex accepts a key it does not know and prints one warning (`--strict-config` refuses to start). A value of the wrong type or outside the allowed words stops Codex with its own message. The tool knows the keys, tables and types of Codex 0.163.0 and its 175 feature flags (42 of them removed, which Codex accepts and ignores; a few deprecated, which Codex honours with a notice). `codex features list` is the list it was written from.

**AGENTS.md**: the global file under the Codex home comes first and does not count against `project_doc_max_bytes` (32768 by default). Then, from the project root down to the working folder, one file per folder: `AGENTS.override.md`, else `AGENTS.md`, else the names in `project_doc_fallback_filenames`. A file with only white space is skipped; an empty `AGENTS.override.md` hides the `AGENTS.md` in its folder. The files are joined with a blank line and Codex stops adding text when the cap is used: the file that crosses it is cut at the byte (a character split in the middle becomes U+FFFD), the files after it are left out, and nothing is printed. UTF-16 or a byte order mark reach the model as they are.

**Rules**: a `.rules` file is a Starlark program whose `prefix_rule(pattern=[...], decision="allow"|"prompt"|"forbidden", ...)` calls are the rules. Only files named `*.rules` directly in a `rules/` folder are read (the Codex home, a trusted project's `.codex/`, the system folder). A pattern is an exact argument prefix, a list in a position means any of its words, the strictest decision of all the rules that match wins, and a `match` or `not_match` example must agree with its own rule. A rules file that does not load stops `codex exec` ("Error loading rules:" and the line); the app server that the terminal UI is built on starts anyway, warns "Error parsing rules; custom rules not applied." and applies none of your rules, in any file. Codex ignores an allow rule whose whole pattern is one of 88 prefixes (the shells alone or with `-c` or `-lc`, the interpreters alone or with `-e`, `-c` or `-r`, `git`, `env`, `rm`, `sudo`, `osascript`, `Rscript`, `npm run`, `pnpm run`, `yarn run`, `bun run`, `py -3` and more): the table is in the binary, and `test/banned.mjs` reads it from the executable. A longer pattern, or a prompt or forbidden rule on a banned prefix, is honoured. A command that no rule decides is looked at by Codex itself: `src/danger.mjs` lists what it asks about, and refuses with `approval_policy = "never"`. For bash and zsh that is `rm` with a force option (`-f`, `--force`, or a group of options with an f such as `-rf`), wherever it is in the script, also after `VAR=1`, `env` or `sudo`; `git reset`, `git rm` and `rm -r` are not on the list. For PowerShell it is `Remove-Item`, `rm`, `ri` and `del` with `-Force`, and `Start-Process` with a web address.

**Hooks**: a hook is in `hooks.json` or in a `[hooks]` table, per layer; a layer with both loads both and warns. Codex runs a hook only after it is trusted: a record `[hooks.state."<file>:<event>:<group>:<handler>"] trusted_hash = "sha256:..."` in the user's `config.toml`, where the hash is the SHA-256 of the hook's canonical JSON (the tool computes it; `lint` prints the key and the hash to add, and `show --json` has them for every hook). A changed hook is skipped until it is trusted again. A handler field that Codex does not read (`timeout_sec`, `status_message`) is dropped in silence. A `PreToolUse` hook that answers `ask` changes nothing; `deny` and `block` stop the command.

**MCP servers**: a server with a `command` is a stdio server and one with a `url` is an HTTP server; both, or neither, stops Codex. A stdio server whose program is not found is skipped in silence unless `required = true`. Any enabled server adds three resource tools to every request, and a server that starts adds its id to the description of `tool_search`; its own tools are not in the first request.

**Model providers**: `openai`, `ollama` and `lmstudio` are built in and cannot be redefined; `wire_api` can only be `responses`; `model_provider` must name a provider that is defined; a provider's `env_key` must be set where Codex starts, or Codex stops at the first request.

**The Windows sandbox**: with no implementation selected (`windows.sandbox` unset and `features.prefer_mxc` not true), `sandbox_mode = "workspace-write"` becomes read-only in the prompt the model gets, and every command that no allow rule covers asks, even `echo hi`; with `approval_policy = "never"` it is refused. `windows.sandbox = "unelevated"` (or `"mxc"` on a Windows that has MXC) selects an implementation and the same commands run inside it. `features.prefer_mxc` picks MXC only where it is available, and where it is not Codex selects nothing and does not fall back to `unelevated`.

**What `cost` computes and what it records**: the AGENTS.md message and the skills block are built from your files by the rules above and were compared with Codex's, character for character. The base instructions, the tool definitions, the permissions text and the environment text are Codex's own: they are recorded in `src/recorded.mjs` from Codex 0.163.0 on Windows, Linux and macOS, and the permissions and environment figures are adjusted to the length of your folder's path. `test/record-oracles.mjs recorded` and the `record` workflow write them again for a newer Codex.

### Privacy

It reads the files and environment variables listed above, on your machine, and nothing else. It writes nothing: no command creates, changes or deletes a file. It starts no program and has no network code; it opens no connection. Nothing is sent to OpenAI or to anyone else, there is no telemetry and no account. `show` prints the value of each setting it lists (the text report cuts a value at 70 characters, `--json` does not), and a `config.toml` can hold a secret in a value, so read the output before you paste it anywhere; for a provider it says whether the `env_key` variable is set, never its value. Paths in a report contain your user name. A test fails if any file under `src/` or `bin/` imports anything but `node:` modules, if any file but `src/sys.mjs` imports `node:fs`, or if any source file can write a file, start a program or open a connection. The tests that run the real `codex` are a separate matter: they run it in throwaway folders, against a fake server on 127.0.0.1, with every proxy variable pointed at a closed port. See also [SECURITY.md](SECURITY.md).

### What `lint` finds

Each row is a finding id (the argument of `explain`), its severity, its basis (`binary`: put to the real Codex; `docs`: the documentation says so) and what it is about.

| Id | Severity | Basis | What |
| --- | --- | --- | --- |
| `codex-home` | error | binary | CODEX_HOME names a folder that is not there |
| `toml-error` | error | binary | A configuration file does not parse |
| `config-encoding` | error | binary | A configuration file is not UTF-8 |
| `unknown-key` | warning | binary | A key Codex does not know |
| `wrong-type` | error | binary | A value of the wrong type, or outside the allowed words |
| `key-removed` | error | binary | A key Codex no longer supports |
| `ignored-in-project` | warning | binary | Keys a project's config.toml may not set |
| `untrusted-project` | warning | binary | A project's .codex folder that Codex ignores because the project is not trusted |
| `trust-key-spelling` | warning | binary | A trusted-project entry spelt in a way that does not match the folder |
| `profile-legacy` | error | binary | The old profile form (profile = ..., [profiles.x]) |
| `profile-missing` | warning | binary | --profile names a file that is not there |
| `approval-deprecated` | warning | binary | An approval_policy that is deprecated or no longer supported |
| `feature-alias` | warning | binary | A feature flag under its old name |
| `feature-unknown` | warning | binary | A feature flag Codex does not know |
| `feature-removed` | warning | binary | A feature flag that was removed and does nothing |
| `feature-deprecated` | note | binary | A feature flag that is deprecated |
| `env-policy-mix` | error | binary | shell_environment_policy mixes filters with exclude or include_only |
| `hooks-both-formats` | warning | binary | A layer with hooks in hooks.json and in config.toml |
| `hooks-json-error` | warning | binary | A hooks.json that does not parse |
| `hook-field-unknown` | warning | binary | A field of a hook handler that Codex does not read (timeout_sec, status_message ...) |
| `hook-event-unknown` | warning | binary | A hooks.json event name that Codex does not know |
| `hook-command-missing` | warning | binary | A hook whose program is not found |
| `hook-untrusted` | warning | binary | A hook that is not trusted and is skipped |
| `hook-modified` | warning | binary | A hook that changed since it was trusted |
| `hook-ask-unsupported` | warning | docs | A hook that answers ask |
| `hooks-feature-off` | note | binary | Hooks are defined and the hooks feature is off |
| `agents-md-over-cap` | warning | binary | AGENTS.md files that do not all fit in project_doc_max_bytes |
| `agents-md-empty` | note | binary | An AGENTS.md with no text |
| `agents-md-shadowed` | warning | binary | An AGENTS.md that another file in its folder hides |
| `agents-md-encoding` | warning | binary | An AGENTS.md that the model reads as garbage |
| `rules-syntax` | error | binary | A .rules file that does not load |
| `rules-example-fails` | error | binary | A match or not_match example that disagrees with its rule |
| `rules-shadowed` | note | binary | An allow rule that a stricter rule always overrides |
| `rules-allow-ignored` | warning | binary | An allow rule for a prefix Codex does not honour (a shell, an interpreter, git, env, rm, sudo, npm run ...) |
| `rules-unevaluated` | note | docs | A .rules file this tool cannot run completely |
| `mcp-command-missing` | warning | binary | An MCP server whose program is not found |
| `mcp-invalid` | error | binary | An MCP server with no usable transport |
| `provider-reserved-id` | error | binary | A model provider named openai, ollama or lmstudio |
| `provider-wire-api` | error | binary | A wire_api other than responses |
| `provider-undefined` | error | binary | model_provider names a provider that is not defined |
| `provider-env-key-unset` | warning | binary | The environment variable of the provider's env_key is not set |
| `provider-base-url` | note | binary | A custom provider with no base_url |
| `provider-conflict` | error | binary | A provider with no name, or with auth and env_key together |
| `windows-sandbox` | warning | binary | The Windows sandbox is not set up, or cannot work here |

## What was verified, and how

Checked on 17 October 2026 on Windows 11 Home (build 10.0.26300, x64) with Node 24.19.0 and Codex CLI 0.163.0, the npm release of that day. CI runs the unit tests on Linux, macOS and Windows with Node 20, 22 and 24 and on Linux with Node 18, and the real-binary checks on Ubuntu 24.04.5, macOS 26.6.2 and Windows Server 2025 (build 10.0.26100) with Codex 0.163.0 installed from npm. On commit 1686302 all 10 jobs of the unit tests (run 39077259593) and all 3 jobs of the real-binary checks (run 39077259606) were green; it is the last commit that changed the code. The badges at the top show the latest runs.

- **299 automated tests** on Windows and **332** on Linux and macOS (`npm test`, Node's own runner, no dependencies, about 10 seconds on this machine). `node --test` also reports each of the 19 helper files under `test/` as a passing test, on every Node version CI runs (18 to 24); those are not counted here (the runner's total was 318 on Windows and 351 on Linux and macOS). Without a Codex binary, on Windows 184 pass and 115 are skipped; on Linux and macOS 184 pass and 148 are skipped. The skipped ones are the real-binary checks below, which are not the same set on Windows (some rows and checks are about Windows only). The tests cover:
  - the readers, held to tables recorded from Codex 0.163.0: the TOML reader (128 files that Codex accepted or rejected, with the line and column of each error), the Starlark subset of the rules files, the checks of `prefix_rule()` and of the examples of a rule;
  - the layers (19 worlds: which folders Codex loads, which it skips, where each key came from, every spelling of a trust entry), the settings (321 keys in seven groups that Codex reads without a warning, 21 typos it lists as ignored, 198 values of the wrong type it refuses), the AGENTS.md message (44 worlds, byte for byte), the hooks (41 worlds: the key, the hash and the status of each hook), and the rules (327 commands under nine rule sets, and 63 rules files, as `codex execpolicy check` answered them);
  - each of the 44 findings, from a pretend machine that a test spoils in one way: said when it should be, with its effect and its fix, and not otherwise; the pages of `explain` (one for every id, every line marked verified, documented or not verified); the table of banned allow-rule prefixes;
  - `why`: the split of a script, the matching of rules, the outcome under every approval policy and sandbox mode; `agents`; `cost` (the rows add up, the folder's path moves the permissions and environment figures as stated, the skills block for every place skills are read from);
  - the reports: the text, the markdown (at most 12 findings, 500 characters a line), the JSON documents; the command line (every usage error and exit code); on a pretend Windows, Linux and macOS machine;
  - the package: its files, the workflows, the community files, the README (its sections, the usage block, the examples, the table of findings, the JSON shapes, the Files table, the numbers it quotes), that nothing under `src/` writes a file, starts a program or opens a connection, and that no tracked file has a carriage return.
- **115 tests that run the real binary** on Windows and **148** on Linux and macOS (`test/e2e-*.test.mjs`, 13 files; they skip when `E2E_CODEX` is not set). Each starts a fake Responses API on 127.0.0.1 and runs `codex exec` or a thread of `codex app-server` (what the terminal UI is built on) against it, with a throwaway `CODEX_HOME`, `HOME` and `USERPROFILE`, the variables of every agent removed from the environment, every proxy variable pointed at a closed port, and stdin ignored; the binary is started with `spawn`, never `spawnSync`. No model is reached and no token is spent. On this machine all 115 ran: 113 passed and 2 were skipped (the check of programs on Linux and macOS, and the check of a `commandWindows` handler off Windows), in 571 seconds. In CI, with Codex 0.163.0 from npm, on commit 1686302: Ubuntu 24.04.5 ran 148 tests, 141 passed and 7 were skipped (the ones about Windows), in 109 seconds; macOS 26.6.2 the same, in 157 seconds; Windows Server 2025 ran 115, 113 passed and 2 were skipped, in 604 seconds. The same findings were compared with what the tool says (`lint` is run on the very folder `codex` was run in). What Codex answered:
  - **Configuration errors.** A `config.toml` or a profile file that does not parse stops Codex with `Error loading config.toml:` and the path, line and column; a trusted project's file does too, and an untrusted project's file is not opened. A UTF-16 file is refused (`invalid utf-8 sequence`); a byte order mark and CRLF are fine. A value of the wrong type stops Codex with its own message (`invalid type: string "yes", expected a boolean`, `unknown variant`, `missing field`); `experimental_thread_store_endpoint` is refused by name. `CODEX_HOME` naming a folder that is not there stops Codex (`CODEX_HOME points to "...", but that path does not exist`).
  - **Silence.** An unknown key is ignored with one warning, and `codex exec --json` prints it as an error item in the event stream and nothing on stderr; `--strict-config` refuses to start. The ten keys in a project's file are ignored with `Ignored unsupported project-local config keys in ...`. `--profile` with no file starts without it, with no message. A feature flag that was removed is accepted without a word; a deprecated one prints a notice.
  - **Trust.** A project's `.codex/` layer, hooks and rules are used only when the project is trusted, by its own entry or its Git root's; the app server warns with the entry to add and `codex exec` says nothing. `codex exec` with `danger-full-access` writes the entry itself, also with `--sandbox workspace-write` on Linux and macOS, where a sandbox can run it (on Windows with no sandbox selected workspace-write is read-only and writes nothing); read-only and the default write nothing, an entry that is already there (even `untrusted`) is left alone, and the next session loads the folder's file. On Windows an entry with forward slashes, a trailing backslash or a `\\?\` prefix does not trust the folder, and the lower-case spelling of Codex's own warning does.
  - **AGENTS.md.** The message Codex builds was compared in 44 worlds with the tool's (size, hash and ends): the cap crossed by the second of three files, a global file that does not count, the cap at 0 and at 3 bytes, a character cut in the middle, a byte order mark, UTF-16, CRLF, override and fallback names, an empty override, a folder named AGENTS.md. `agents --print` is that message.
  - **Rules.** 327 commands under nine rule sets and 63 rules files were put to `codex execpolicy check` and the answers recorded; the tool's matcher agrees with every one. `codex exec` stops on a rules file with a syntax error or a failing example (`Error loading rules:` and the line, which is the line after the last for a bracket that is never closed); the app server starts and warns `Error parsing rules; custom rules not applied.`, and a forbidden rule in another file stopped nothing.
  - **Hooks.** The key and the hash of every hook of 41 worlds were read back from `hooks/list` of the app server: the tool computes the same SHA-256. A hook with no record or with another hash is skipped; `--dangerously-bypass-hook-trust` runs it. A layer with both formats loads both and warns; a `hooks.json` that does not parse loads none of its hooks and warns; an event Codex does not have is ignored in silence; a handler field Codex does not read is dropped in silence (a timeout written `timeout_sec` stays 600 seconds). A `PreToolUse` hook that answers `ask` changed nothing; `deny` and `block` stopped the command with `Command blocked by PreToolUse hook: ...`.
  - **Rules for shell commands.** `why` was compared with what a thread of the app server did to a command that writes outside the project (it was refused, the client was asked, it ran inside the sandbox, or it wrote outside): under every approval policy and sandbox mode, with allow, prompt and forbidden rules, lists of commands, substitutions and a banned prefix. All 88 allow rules for a banned prefix were ignored by the Windows binary and a longer pattern was honoured; on Linux and macOS the same was seen for `env`, `python3`, `rm` and `git` (and for `node`, in the rows above): an allow rule for the bare prefix left the command inside the sandbox, a longer pattern ran it outside.
  - **Commands Codex finds dangerous.** With no rule to decide, `rm` with a force option (`-f`, `--force`, or a group of options with an f such as `-rf`, `-fr`, `-rfv` or `-Rf`, before or after the operands) asks, and with `approval_policy = "never"` is refused with `rm -f style commands are not permitted. Use a safer approach`. On Linux and macOS that holds wherever the `rm` is in a script: after `VAR=1`, `env` or `sudo`, by its path, in a list, a pipe, a subshell, a loop, a substitution, a redirection or the script of `bash -c`. Plain `rm`, `rm -r`, `git reset`, `git rm`, `git clean`, `git push --force`, `xargs rm -rf` and `find -exec rm -rf` run; Ubuntu 24.04 and macOS 26 gave the same answers to all of these. In PowerShell on Windows `Remove-Item`, `rm`, `ri` and `del` with `-Force`, and `Start-Process` with a web address, ask (and are refused with `blocked by policy`), while `rm -rf` and `git reset --hard` run. A command that starts with `bash -lc` is not opened, so the rules for what is inside it do not match.
  - **MCP servers, providers.** A stdio server whose program is missing is skipped in silence (exit 0) and stops Codex with `required = true`; on Windows `tool.cmd` and `tool.bat` are found through PATHEXT and a `.ps1` is not. A `command` and a `url`, or neither, stop Codex. `openai`, `ollama` and `lmstudio` cannot be redefined; `wire_api` other than `responses` stops Codex; a provider with no `base_url` connects to api.openai.com; an `env_key` that is not set stops Codex at the first request.
  - **The first request.** The base instructions are 21,299 characters on all three systems. The tool definitions, the permissions block and the environment block differ by system and are recorded for each; the skills block was reproduced character for character in ten worlds (the places skills are read from, hidden folders, a description longer than 1,024 characters, which Codex cuts to 1,021 and `...`); the AGENTS.md message and the skills block of a world with files agree with the tool's; a server that starts adds its id to `tool_search`, and 2, 3, 30 and 60 tools of a server gave the same request.
  - **The Windows sandbox.** With nothing selected the log says `Windows sandbox selection: disabled`, the prompt says `read-only`, and every command asks (refused with `never`). `unelevated` and `mxc` select an implementation and the commands run inside it. `features.prefer_mxc` picks MXC where the log says `MXC availability: true` and nothing where it says `false` (Windows Server 2025, build 26100: `Windows sandbox selection: disabled`); an explicit `mxc` is selected either way. `elevated` is selected without a word; `bogus` stops Codex.
  - **`codex doctor`.** Run on nine worlds, it reported the unknown key, the TOML error, the legacy profile selector and the missing MCP program, and said nothing of a rules file that does not load, an untrusted project, a hook with no trust record or an AGENTS.md cut by the cap.
- **From GitHub.** `npx -y github:nrzz/codex-config-doctor lint --project <folder>` ran from the published repository (commit 1686302) with a throwaway npm cache, home folder and Codex home. It printed its report, with the two warnings that the folder deserved (a misspelt key, and no Windows sandbox selected), and exited 1, after 10 seconds on Windows 11 with Node 24.19.0, the download from GitHub included.
- **The numbers in the first paragraph** were read on 17 October 2026: openai/codex had 129,639 stars and 23,030 open issues (GitHub's search for open issues, pull requests not counted), and #13386 had 12 reactions.

## Not verified

- **The terminal UI itself.** Its trust prompt, `/hooks`, `/status` and `/debug-config` were not driven. The app server that it is built on was, and where a line says "the terminal UI" it means that server's answer.
- **Linux's sandbox.** On GitHub's Ubuntu 24.04 runner the sandbox cannot start (a command that Codex runs inside it fails with `bwrap: loopback: ...` and exit code 1), so what a command can and cannot write inside the Linux sandbox was not put to the binary there. The checks tell "inside" from "outside" there by whether the command ran. macOS's sandbox and Windows's `unelevated` sandbox did run, and the checks on them tell the two apart by a file that a command writes outside the project. A Linux without `bwrap` on PATH prints a warning at the start of a run; the tool does not check for it.
- **Administrator files.** `requirements.toml` and a managed configuration are listed by `show` and not merged, because writing them needs an administrator. The `elevated` Windows sandbox needs one too, and its setup was not run. Whether MXC is available depends on the build of Windows: it was put to the binary on build 26300 here and on Windows Server 2025 build 26100 in CI.
- **Command-line options of Codex.** A `-c key=value` override, a different `--profile` than the one you pass to this tool, or `--sandbox` on the command line are not seen: the tool reports the files.
- **HTTP MCP servers** (`url`) were not started: a stand-in server that speaks HTTP is a next step in [ROADMAP.md](ROADMAP.md). The tools of an MCP server that starts are not measured by `cost`.
- **The hash of an `mcp_tool` hook handler with an `input` table** is not reproduced (the key and the status are). The handler types `prompt` and `agent` are read and not checked.
- **That `ask` marks a hook run as failed** is the documentation's word; Codex printed nothing about it (`hook-ask-unsupported` is a `docs` finding). The same goes for `rules-unevaluated`, the finding for a rules file that uses Starlark the reader does not run.
- **Other shells and wrappers.** On the macOS runner Codex used `/bin/bash -lc`, so a Mac whose login shell is zsh, and fish or nushell anywhere, were not tried. For the dangerous commands, `sudo` and `env` in front of `rm` were put to the binary; `sudo -u root`, `nohup`, `command`, `time`, the PowerShell aliases `rmdir`, `rd` and `erase`, an abbreviated `-Force` and `Start-Process` through its aliases were not.
- **Another Codex.** The keys, the feature flags, the banned prefixes and the recorded figures are Codex 0.163.0's. A newer Codex may add a key that `lint` reports as unknown; the weekly run of the real-binary checks is there to show it, and `test/record-oracles.mjs` writes the records again.
- **Tokens** are characters divided by four, an estimate, not the count of a tokenizer. The permissions and environment blocks hold names from your machine (the folder, the time zone, the shell, the temporary folder), so they differ from the recorded figures by a few dozen characters; the checks allow 20 for the environment block.
- **What a model does** is not part of any of this: the fake API answers with a scripted command or a fixed text.
- **`mcp-disabled-tools-unknown`**, a finding for a tool name in `disabled_tools` that the server does not have, is not written: it needs the server to list its tools.

## Files

| Path | What it holds |
| --- | --- |
| `bin/codex-config-doctor.mjs` | the command |
| `src/cli.mjs` | the options, the help, the exit codes |
| `src/sys.mjs` | the machine as the commands see it (platform, environment, files); the one file that imports `node:fs` |
| `src/toml.mjs` | a TOML reader that agrees with Codex's on which files parse and on the line of an error |
| `src/knowledge.mjs`, `src/schema.mjs` | what Codex 0.163.0 knows (the keys and their types, 175 feature flags, the ten keys a project may not set, the 88 banned rule prefixes) and the check of a file against it |
| `src/layers.mjs` | the layers Codex loads for a project, which are trusted, and the merge with the source of each key |
| `src/agents.mjs` | the AGENTS.md message, byte for byte |
| `src/starlark.mjs`, `src/rules.mjs`, `src/execpolicy.mjs`, `src/shellsplit.mjs` | the rules files (a Starlark subset), what the rules decide for a command, how a script is split into the commands Codex judges |
| `src/hooks.mjs`, `src/mcp.mjs`, `src/providers.mjs`, `src/winsandbox.mjs`, `src/pathsearch.mjs` | hooks and their trust hash, MCP servers, model providers, the Windows sandbox, the search for a program |
| `src/collect.mjs` | collects all of the above once for a project |
| `src/catalog.mjs`, `src/lint.mjs`, `src/explain.mjs` | the findings, the code that says them, the pages of `explain` |
| `src/why.mjs`, `src/danger.mjs`, `src/cost.mjs`, `src/recorded.mjs` | what happens to a command, and the commands Codex finds dangerous when no rule decides; what the first request carries (the figures recorded from Codex, by system) |
| `src/report.mjs` | the text, markdown and JSON of every command |
| `src/version.mjs` | the version |
| `test/*.test.mjs` | the unit tests; the `e2e-*.test.mjs` files run the real binary and skip without `E2E_CODEX` |
| `test/helpers.mjs`, `test/fakesys.mjs`, `test/world.mjs`, `test/examples.mjs` | throwaway folders and pretend machines (Windows, Linux, macOS) for the tests and the README's examples |
| `test/toml-table.mjs`, `test/schema-table.mjs`, `test/layers-table.mjs`, `test/agents-table.mjs`, `test/hooks-table.mjs`, `test/rules-table.mjs` | the tables of cases |
| `test/ask.mjs`, `test/record-oracles.mjs`, `test/fixtures/` | how each case is put to Codex, the command that records the answers, and the recorded answers the unit tests hold the code to |
| `test/codex-sandbox.mjs`, `test/app-server.mjs`, `test/behave.mjs`, `test/measure.mjs`, `test/mcp-stub.mjs`, `test/record-hook.mjs`, `test/banned.mjs` | running the binary at zero cost: the fake Responses API, a client for `codex app-server`, a world and its `lint`, the first request, a stand-in MCP server, a hook that records its runs, the table of banned prefixes read from the executable |
| `examples/` | the Codex home and the project that the examples above run on |
| `.github/workflows/` | `test.yml` (the suite on three systems), `e2e.yml` (the real-binary checks on three systems), `record.yml` (records the first request on each system) |
| `CONTRIBUTING.md`, `ROADMAP.md`, `CHANGELOG.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md` | the community files |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The next steps are in [ROADMAP.md](ROADMAP.md); the first is a good first issue, [#1](https://github.com/nrzz/codex-config-doctor/issues/1) (`why --file <list>`). A wrong verdict is a bug: open an issue with the Codex version and what Codex really did.

## Also by the same author

The same author's tools for Claude Code are in [claude-code-toolkit](https://github.com/nrzz/claude-code-toolkit), the hub for nineteen tools for Claude Code; the two closest to this one are [claude-settings-doctor](https://github.com/nrzz/claude-settings-doctor) (the merged settings with their source, and a lint against the schema) and [claude-permission-doctor](https://github.com/nrzz/claude-permission-doctor) (why a permission prompt appeared, dead rules, rules from your history).

## License

MIT. See [LICENSE](LICENSE).
