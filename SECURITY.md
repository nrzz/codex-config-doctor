# Security policy

## Supported versions

Security fixes go into the latest release on `main`.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Use GitHub's private reporting: [https://github.com/nrzz/codex-config-doctor/security/advisories/new](https://github.com/nrzz/codex-config-doctor/security/advisories/new), or the contact in the [nrzz security policy](https://github.com/nrzz/.github/blob/main/SECURITY.md). You can expect a first answer within 72 hours, and credit in the release notes if you want it.

## What this tool does, and does not do

It has no telemetry or account and sends nothing to OpenAI or to anyone else. It has no network code at all: it opens no connection, and it starts no program.

**It reads.** The Codex home (`CODEX_HOME`, else `~/.codex`, with `USERPROFILE` on Windows): `config.toml`, a profile file when you name one, `AGENTS.md` and `AGENTS.override.md`, `hooks.json`, the `rules/` folder, the `skills/` folders, and the sandbox log under `.sandbox/`. The system folder (`/etc/codex`, or `ProgramData\OpenAI\Codex` on Windows): `config.toml` and `requirements.toml`. In the project: the `.codex/` folders from the project root down to the working folder (`config.toml`, `hooks.json`, `rules/`, `skills/`), the `AGENTS.md` files of those folders, `.agents/skills/`, and the Git marker that tells where the project root is. The folders on `PATH` (with `PATHEXT` on Windows) to tell whether the program of a hook or an MCP server is there, and the first words of a hook script it can read, to look for the word `ask`. The environment: `CODEX_HOME`, `HOME` or `USERPROFILE`, `ProgramData`, `PATH`, `PATHEXT`, and whether the variable named by a provider's `env_key` is set (never its value).

**It prints** paths, key names and the values of the keys that `show` lists (a value is cut at 70 characters). A `config.toml` can hold a secret in a value: `show` prints the merged settings, so read its output before you paste it anywhere. `lint --json` and `lint --markdown` print messages and fixes, not the file.

**It writes nothing.** No command creates, changes or deletes a file or a folder, and the repository test fails if a source file imports anything that writes or any module that starts a process or opens a connection. A test that runs the real `codex` is a separate matter and is described under "What was verified, and how" in the README: those tests run Codex in throwaway folders, against a fake server on 127.0.0.1, with every proxy variable pointed at a closed port.

The findings are a reading of what Codex did when it was put to the binary (the README says which version); they are not a guard. A wrong verdict is a bug and not a vulnerability: report it as an issue.
