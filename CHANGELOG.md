# Changelog

All notable changes to codex-config-doctor are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- `why`: `--file <list>` judges many commands at once, one per line of a file, skipping comments and blank lines, with a summary count and an exit code of 1 if any command is refused.

## [1.0.0] - 2026-10-17

- First release. A command line tool that reads a Codex CLI configuration and says what Codex will do with it. It changes nothing, starts no program and opens no connection. Six commands: `show`, `lint`, `why`, `agents`, `cost` and `explain`, each with `--json`; `--project` and `--profile` on the five that read the configuration.
- `show` prints every layer Codex loads for the project in the order it applies them (system, user, profile, and the project's `.codex/config.toml` from the project root down to the working folder), each read, missing, skipped or broken; the merged settings with the layer each came from; the keys a project may not set; the AGENTS.md files against `project_doc_max_bytes`; the rules; the hooks and whether Codex trusts them; the MCP servers; the model provider; and the Windows sandbox.
- `lint` has 44 findings, each with a severity, the file and line, what Codex does about it and the fix; 42 rest on the binary and two on the documentation. `lint --markdown` is the short form to paste into an agent (at most 12 findings, 500 characters a line).
- `why "<command>"` says whether Codex runs a shell command inside the sandbox, outside it through an allow rule, asks first, or refuses it, which rule matched each part, and how a script is split into the commands Codex judges.
- `agents` lists the AGENTS.md files as Codex reads them (included, cut, left out) and `--print` prints the message exactly as Codex builds it. `cost` adds up what the first request of a session carries before your words. `explain <id>` and `explain --list` give the page of a finding, each line marked verified, documented or not verified.
- What Codex does is what the real binary did. Codex 0.163.0 was put to the TOML reader (128 files), the keys of `config.toml` (321 keys, 21 typos, 198 values of the wrong type), the layers (19 worlds), the AGENTS.md message (44 worlds), the rules (327 commands and 63 files for `codex execpolicy check`), the hooks (41 worlds and the trust hash), every banned rule prefix (88), and the first request. The answers are recorded in `test/fixtures/` and the unit tests hold the code to them without Codex; `test/e2e-*.test.mjs` ask Codex again, and CI runs them on Ubuntu, macOS and Windows against the npm release of Codex.
- Found on the way, and written in the pages of `explain` and in what `why` says: `codex exec` with `sandbox_mode = "danger-full-access"` (and with `workspace-write` on Linux and macOS) writes a trusted entry for the working folder into your `config.toml`; a command that no rule decides but that Codex finds dangerous (`rm` with a force option, wherever it is in a script; in PowerShell `Remove-Item -Force`) asks, and is refused with `approval_policy = "never"`, while `git reset` and `git rm` run; `~/.agents/skills` is read on Linux and macOS; `features.prefer_mxc` selects no sandbox where MXC is not available, as on Windows Server 2025; a rules file with an error stops `codex exec` but only warns the terminal UI, which then applies none of your rules; an allow rule for `git`, `rm`, `env`, `sudo`, a shell or an interpreter alone, and for `npm run`, is ignored; an enabled MCP server brings three tools to every request and its own tools are deferred; the lower-case path in Codex's own trust warning is the spelling that works on Windows, and forward slashes are not.
- Zero tokens for the tool. `lint --markdown` puts at most the number of characters the README states in front of a model, and only if you paste it.

[1.0.0]: https://github.com/nrzz/codex-config-doctor/releases/tag/v1.0.0

[Unreleased]: https://github.com/nrzz/codex-config-doctor/compare/v1.0.0...HEAD
