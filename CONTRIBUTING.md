# Contributing to codex-config-doctor

Thanks for helping. codex-config-doctor is a command line tool that reads a Codex CLI configuration and says what Codex will do with it, part of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit)'s family of tools for coding agents. The bar for a change is the bar the code already meets: it is tested, it works on Windows, macOS and Linux, it changes nothing on the computer it runs on, it starts no program and opens no connection, and it never wastes anyone's tokens. A claim about what Codex does is a claim that was put to the real binary.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/codex-config-doctor/issues?q=is%3Aopen+label%3A%22good+first+issue%22), and the ideas in [ROADMAP.md](ROADMAP.md).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/codex-config-doctor/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/codex-config-doctor/issues/new/choose) with the Codex version (`codex --version`), the system, `node --version`, and the exact command and output. For a verdict that disagrees with Codex, say what Codex really did and attach the relevant part of the configuration.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/codex-config-doctor
cd codex-config-doctor
npm test
```

- `node bin/codex-config-doctor.mjs show --project <a project>` is the tool; `explain <id>` explains a finding.
- `E2E_CODEX=<path to codex> node --test --test-concurrency=1 "test/e2e-*.test.mjs"` also puts the tool's claims to the real Codex (see below). Without `E2E_CODEX` those files skip and `npm test` needs nothing but Node.
- Point `HOME`, `USERPROFILE` and `CODEX_HOME` (and `CLAUDE_CONFIG_DIR`, `COPILOT_HOME`) at a temporary folder whenever you run the tool, the tests or `codex` by hand; the tests do it for themselves. Never test against your real `~/.codex`. With `CODEX_HOME` unset, Codex on Windows ignores `USERPROFILE` and opens the real profile folder.

## Where things are

| Path | What it holds |
| --- | --- |
| `bin/codex-config-doctor.mjs` | the CLI entry |
| `src/cli.mjs` | the options, the help, the exit codes |
| `src/sys.mjs` | the machine as the commands see it (platform, environment, files); the one file that imports `node:fs` |
| `src/toml.mjs` | a TOML reader that agrees with Codex's on which files parse and on the line of an error |
| `src/knowledge.mjs`, `src/schema.mjs` | what Codex 0.163.0 knows (the keys and their types, 175 feature flags, the banned rule prefixes, the ten keys a project may not set) and the check of a file against it |
| `src/layers.mjs` | the layers Codex loads for a project, which are trusted, and the merge with the source of each key |
| `src/agents.mjs` | the AGENTS.md message, byte for byte |
| `src/starlark.mjs`, `src/rules.mjs`, `src/execpolicy.mjs`, `src/shellsplit.mjs` | the rules files (a Starlark subset), what the rules decide for a command, how a script is split into the commands Codex judges |
| `src/hooks.mjs`, `src/mcp.mjs`, `src/providers.mjs`, `src/winsandbox.mjs`, `src/pathsearch.mjs` | hooks and their trust hash, MCP servers, model providers, the Windows sandbox, the search for a program |
| `src/collect.mjs` | collects all of the above once for a project |
| `src/catalog.mjs`, `src/lint.mjs`, `src/explain.mjs` | the findings, the code that says them, the pages of `explain` |
| `src/why.mjs`, `src/cost.mjs`, `src/recorded.mjs` | what happens to a command; what the first request carries (the figures recorded from Codex are in `recorded.mjs`) |
| `src/report.mjs` | the text, markdown and JSON of every command |
| `test/*.test.mjs` | unit tests; the `e2e-*.test.mjs` files run against the real binary |
| `test/ask.mjs`, `test/*-table.mjs`, `test/fixtures/` | the tables of cases, how each is put to Codex, and the recorded answers the unit tests hold the code to |
| `test/record-oracles.mjs` | writes the fixtures and `src/recorded.mjs` again from the Codex in `E2E_CODEX` |
| `test/codex-sandbox.mjs`, `test/app-server.mjs`, `test/behave.mjs`, `test/measure.mjs` | running the binary at zero cost: the fake Responses API, a client for `codex app-server`, a world and its `lint`, the first request |
| `test/fakesys.mjs`, `test/world.mjs`, `test/examples.mjs` | pretend machines (Windows, Linux, macOS) for the unit tests and the README's examples |
| `examples/` | the Codex home and the project that the README's commands run on |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package will not be merged. Only `src/sys.mjs` imports `node:fs`; no source file writes, starts a program or opens a connection, and a test fails otherwise.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24, and on Linux with Node 18, and the real-binary checks on all three systems; a change that only works on one of them is not done. Windows logic is written with `path.win32` only, so that it runs on a pretend Windows machine on every system.
3. **The binary is right.** A finding says what Codex does because the real binary was put to it. When one is wrong, add the case to the table (`test/*-table.mjs`) or to the e2e file, run it with `E2E_CODEX=...`, fix the code, record the answer (`node test/record-oracles.mjs <task>`), and say so in the README's "What was verified, and how". Do not change an expectation to make a test pass without running it against the binary. A line of an `explain` page is marked `verified` only if a test of `test/e2e-*.test.mjs` shows it.
4. **Token cost is a feature.** The tool runs outside Codex and costs nothing. The README's "What it costs in tokens" table says what `lint --markdown` puts in front of a model; if your change adds anything, update it in the same pull request.
5. **The computer is the user's.** The tool reads and changes nothing. If you propose a command that writes, it must back up the file next to it, change only the keys it is there for, leave a file that does not parse alone, offer `--dry-run`, and have a `restore` that puts back the exact bytes.
6. **Never touch real user data in tests.** Use a temporary folder and point `HOME`, `USERPROFILE` and `CODEX_HOME` at it, in the same command. `test/helpers.mjs` points every way the tool finds a Codex home at a throwaway place the moment it loads, and `test/codex-sandbox.mjs` refuses to run `codex` with a home outside the sandbox.
7. **Nothing leaves the machine.** The real-binary checks use a fake Responses API on 127.0.0.1 and set every proxy variable to a closed port. Do not add a check that talks to a real service.
8. **Keep the README honest.** Every number in it is read from a run, and a test (`test/readme.test.mjs`) holds the numbers, the examples and the tables to the code. If your change affects either, update both in the same pull request.

## The real-binary checks

The `test/e2e-*.test.mjs` files start a fake Responses API on 127.0.0.1 and run the real Codex against it, with a throwaway `HOME`, `USERPROFILE` and `CODEX_HOME`. They put to Codex the tables of cases the unit tests use (several hundred commands for `codex execpolicy check`, the TOML cases, the keys, the layers, the AGENTS.md worlds, the hooks), and the findings one by one: a world with the problem is run with `codex exec` and with a thread of the app server, what Codex does is compared with what the finding says, and `lint` is run on the same folder. No model is reached and nothing leaves your machine. The binary is started asynchronously with its standard input ignored (a synchronous start blocks the fake server, and `codex exec` waits for input on an open stdin).

```bash
E2E_CODEX=/path/to/codex node --test --test-concurrency=1 "test/e2e-*.test.mjs"
```

The checks that are about Windows skip on other systems. When a new Codex comes out, run `node test/record-oracles.mjs all` and `node test/record-oracles.mjs recorded`, read the diff of `test/fixtures/` and `src/recorded.mjs`, and update `src/knowledge.mjs` where it moved.

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Name the line of a rules error that ends the file").
- Fill in the pull request template; CI must be green on every job.
- Signed commits are welcome but not required.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `src/version.mjs` and `package.json` (`npm test` fails until the copies agree), add a section to [CHANGELOG.md](CHANGELOG.md), update the numbers of the README (`npm test` fails until they are the runner's), tag `vX.Y.Z` on the commit whose CI is green and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
