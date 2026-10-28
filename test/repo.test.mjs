// The package itself: what it says it is, what it imports, which Node it needs, that nothing in src/ writes a file, starts a program or opens a
// connection, that no file has a carriage return, that the workflows and the community files have what they promise, and that the version
// is the same everywhere.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { ROOT, underTmp } from "./helpers.mjs";
import { VERSION } from "../src/version.mjs";
import { IDS } from "../src/catalog.mjs";

// a checkout on Windows may turn line feeds into CRLF
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const json = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const files = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith(ext)).map((n) => path.join(dir, n));
const posix = (f) => f.split(path.sep).join("/");

const pkg = json("package.json");
const SOURCES = [...files("src", ".mjs"), ...files("bin", ".mjs")];
const TESTS = files("test", ".mjs");

test("package.json: name, version, bin, engines, no dependencies, tests run with node --test, the files that are shipped", () => {
  assert.equal(pkg.name, "codex-config-doctor");
  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.bin, { "codex-config-doctor": "bin/codex-config-doctor.mjs" });
  assert.equal(pkg.engines.node, ">=18");
  for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.scripts.test, "node --test");
  assert.deepEqual(pkg.files, ["bin", "src", "README.md", "LICENSE"]);
  for (const f of pkg.files) assert.ok(exists(f), `${f} is listed and exists`);
  assert.match(pkg.description, /^What Codex CLI will actually do with your configuration/);
  assert.match(pkg.description, /Zero tokens\.$/);
  assert.equal(pkg.repository, "github:nrzz/codex-config-doctor");
  assert.equal(pkg.homepage, "https://nrzz.github.io/claude-code-toolkit/");
  assert.equal(pkg.bugs, "https://github.com/nrzz/codex-config-doctor/issues");
  assert.equal(pkg.author, "Naresh Prabu");
  for (const k of ["codex", "openai-codex", "codex-cli", "config", "toml", "agents-md", "execpolicy", "sandbox", "mcp", "hooks"]) assert.ok(pkg.keywords.includes(k), k);
});

test("no lock file, no vendored node_modules, and no .gitattributes", () => {
  assert.ok(!exists("package-lock.json"));
  assert.ok(!exists("npm-shrinkwrap.json"));
  assert.ok(!exists("yarn.lock"));
  assert.ok(!exists("node_modules") || fs.readdirSync(path.join(ROOT, "node_modules")).length === 0);
  assert.ok(!exists(".gitattributes"));
  assert.match(read(".gitignore"), /^node_modules\/$/m);
});

test("no tracked text file has a carriage return: every file is written with LF (the index is read, a checkout on Windows may differ)", { skip: !exists(".git") && "not a git checkout" }, () => {
  const ls = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer", windowsHide: true });
  assert.equal(ls.status, 0, String(ls.stderr));
  const tracked = ls.stdout.toString("utf8").split("\0").filter(Boolean);
  assert.ok(tracked.length > 20, `${tracked.length} tracked files`);
  const withCr = [];
  for (const f of tracked) {
    if (/\.(png|ico|jpg|gif|woff2?)$/i.test(f)) continue;
    const blob = spawnSync("git", ["show", `:${f}`], { cwd: ROOT, encoding: "buffer", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (blob.status === 0 && blob.stdout.includes(13)) withCr.push(f);
  }
  assert.deepEqual(withCr, [], "files that hold a carriage return in the index");
});

test("every source file is .mjs and imports only the package itself and the few node built-ins it needs, each in the one file that needs it", () => {
  assert.ok(SOURCES.length >= 20);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "src")).filter((n) => !n.endsWith(".mjs")), []);
  const allowed = { "node:fs": ["src/sys.mjs"], "node:os": ["src/sys.mjs"], "node:path": ["src/sys.mjs"], "node:crypto": ["src/hooks.mjs"] };
  for (const f of SOURCES) {
    const text = read(f);
    for (const m of text.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)) {
      const spec = m[1];
      if (spec.startsWith("./") || spec.startsWith("../")) continue;
      assert.ok(allowed[spec] && allowed[spec].includes(posix(f)), `${f} imports ${spec}`);
    }
    assert.doesNotMatch(text, /\brequire\(|\bimport\(/, `${f} has no dynamic loading`);
  }
});

test("nothing in src/ or bin/ writes a file, starts a program, opens a connection or runs code that was not written here", () => {
  const writes = /\b(?:writeFile|appendFile|copyFile|rename|unlink|rmdir|rm|mkdir|mkdtemp|truncate|symlink|link|chmod|utimes|createWriteStream)(?:Sync)?\s*\(|\bfs\.promises\b/;
  const startsProcess = /node:child_process|(?<![.\w])(spawn|spawnSync|execSync|execFile|execFileSync|fork|exec)\s*\(/;
  const opensConnection = /node:(http|https|http2|net|tls|dns|dgram)\b|(?<![.\w])(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/;
  const runsCode = /node:(worker_threads|cluster|vm)\b|\bprocess\.binding\b|\beval\s*\(|new Function\s*\(/;
  for (const f of SOURCES) {
    const text = read(f);
    assert.doesNotMatch(text, writes, `${f} must not write`);
    assert.doesNotMatch(text, startsProcess, `${f} must not start a program`);
    assert.doesNotMatch(text, opensConnection, `${f} must not open a connection`);
    assert.doesNotMatch(text, runsCode, f);
  }
  const sys = read("src/sys.mjs");
  assert.doesNotMatch(sys, /writeFile|appendFile|mkdir|rmSync|unlink/, "sys.mjs reads");
  assert.match(sys, /readFileSync/);
  // the one place that reads the machine is the one place that imports the file system, and the tests read through the same interface
  assert.equal(SOURCES.filter((f) => /node:fs/.test(read(f))).map(posix).join(","), "src/sys.mjs");
});

test("only APIs that exist in Node 18 are used", () => {
  const newer = [
    [/\.toSorted\(|\.toReversed\(|\.toSpliced\(|\.with\(\d/, "Array copy-methods (Node 20)"],
    [/\bObject\.groupBy\b|\bMap\.groupBy\b/, "groupBy (Node 21)"],
    [/\bArray\.fromAsync\b/, "Array.fromAsync (Node 22)"],
    [/\bPromise\.withResolvers\b/, "Promise.withResolvers (Node 22)"],
    [/import\.meta\.(dirname|filename)\b/, "import.meta.dirname/filename (Node 20.11)"],
    [/\bfs\.(glob|globSync)\b/, "fs.glob (Node 22)"],
    [/\.(isWellFormed|toWellFormed)\(/, "String well-formed methods (Node 20)"],
    [/\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, "Set methods (Node 22)"],
    [/process\.getBuiltinModule|process\.loadEnvFile|util\.styleText|\bstyleText\b/, "newer process/util APIs"],
    [/\bimport\s[^;]*\swith\s*\{/, "import attributes"],
    [/\bfs\.cpSync\b/, "fs.cpSync is experimental before Node 22"],
  ];
  for (const f of [...SOURCES, ...TESTS.filter((x) => !x.endsWith("repo.test.mjs"))]) {
    const text = read(f);
    for (const [re, what] of newer) assert.doesNotMatch(text, re, `${f}: ${what}`);
  }
});

test("the licence, the conduct file, the changelog and the version agree", () => {
  assert.match(read("LICENSE"), /^MIT License/);
  assert.match(read("LICENSE"), /Copyright \(c\) 2026 Naresh Prabu/);
  assert.ok(exists("CODE_OF_CONDUCT.md"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^## \\[${VERSION.replace(/\./g, "\\.")}\\] - 2026-10-28$`, "m"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^\\[${VERSION.replace(/\./g, "\\.")}\\]: https://github\\.com/nrzz/codex-config-doctor/releases/tag/v${VERSION.replace(/\./g, "\\.")}$`, "m"));
  for (const f of ["SECURITY.md", "SUPPORT.md", "ROADMAP.md", "CONTRIBUTING.md"]) assert.ok(exists(f), f);
  assert.match(read("SECURITY.md"), /security\/advisories\/new/);
  const roadmap = read("ROADMAP.md");
  assert.ok((roadmap.match(/^- /gm) || []).length >= 3 && (roadmap.match(/^- /gm) || []).length <= 5, "three to five next steps");
  assert.match(roadmap, /good first issue: \[#4\]\(https:\/\/github\.com\/nrzz\/codex-config-doctor\/issues\/4\)/, "the roadmap names the good first issue");
  assert.match(read("CONTRIBUTING.md"), /## Where things are/);
  assert.match(read("CHANGELOG.md"), new RegExp(`${IDS.length} findings`), "the changelog counts the findings");
});

test("the issue forms and the pull request template are there", () => {
  for (const f of ["bug_report.yml", "feature_request.yml", "config.yml"]) assert.ok(exists(`.github/ISSUE_TEMPLATE/${f}`), f);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /blank_issues_enabled: false/);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /nrzz\/codex-config-doctor\/discussions/);
  assert.ok(exists(".github/PULL_REQUEST_TEMPLATE.md"));
  assert.match(read(".github/dependabot.yml"), /package-ecosystem: github-actions/);
  for (const f of ["bug_report.yml", "feature_request.yml"]) assert.match(read(`.github/ISSUE_TEMPLATE/${f}`), /codex-config-doctor/);
});

test("the CI workflows: the suite on three systems and four Node versions, and the real-binary checks on all three systems, with no action version pinned here", () => {
  const ci = read(".github/workflows/test.yml");
  assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(ci, /node: \[20, 22, 24\]/);
  assert.match(ci, /node: 18/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /uses: actions\/checkout@/);
  assert.match(ci, /uses: actions\/setup-node@/);
  assert.match(ci, /timeout-minutes: \d+/);
  const e2e = read(".github/workflows/e2e.yml");
  for (const part of ["name: e2e", "ubuntu-latest, macos-latest, windows-latest", "npm install -g @openai/codex@${{ inputs.codex_version || 'latest' }}", "continue-on-error: true", "E2E_CODEX: codex", "schedule:", "workflow_dispatch", "codex_version:", "--test-concurrency=1", "test/e2e-*.test.mjs"]) assert.ok(e2e.includes(part), part);
  assert.match(e2e, /timeout-minutes: \d+/);
  // the install may fail without failing the job; the real-binary checks may not
  const steps = e2e.split(/\n {6}- /);
  const install = steps.find((s) => s.includes("npm install -g"));
  const binary = steps.find((s) => s.includes("test/e2e-*.test.mjs"));
  assert.match(install, /continue-on-error: true/);
  assert.doesNotMatch(binary, /continue-on-error/);
  const e2eFiles = TESTS.filter((f) => /^test[\\/]e2e-.*\.test\.mjs$/.test(f));
  assert.ok(e2eFiles.length >= 12, `${e2eFiles.length} e2e files`);
});

test("every real-binary check skips when E2E_CODEX is not set, so `npm test` needs nothing but Node", () => {
  for (const f of TESTS.filter((x) => /e2e-.*\.test\.mjs$/.test(x))) {
    const text = read(f);
    assert.match(text, /\bskip(UnlessWindows)?\(\)/, `${f} skips without a binary`);
    assert.doesNotMatch(text, /process\.env\.E2E_CODEX/, `${f} reads the variable through test/codex-sandbox.mjs`);
  }
  assert.equal(TESTS.filter((x) => /process\.env\.E2E_CODEX/.test(read(x))).map(posix).join(","), "test/codex-sandbox.mjs");
});

test("no test asks the machine for its home folder: every test builds its own world in a temporary folder", () => {
  for (const f of TESTS) {
    if (f.endsWith("repo.test.mjs")) continue;
    assert.doesNotMatch(read(f), /os\.homedir\(\)/, `${f} reaches for the real home folder`);
  }
});

test("the process the tests run in has its home, Codex home and the other agents' folders pointed at a throwaway place", () => {
  for (const v of ["HOME", "USERPROFILE", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "COPILOT_HOME"]) assert.ok(process.env[v] && underTmp(process.env[v]), `${v} is ${process.env[v]}`);
  assert.equal(process.env.USERPROFILE, process.env.HOME);
  for (const k of Object.keys(process.env)) assert.doesNotMatch(k, /^(OPENAI_|ANTHROPIC_|CLAUDE_CODE_)/i, `${k} is not passed to the tests`);
});

test("the run of the real binary refuses a Codex home outside its sandbox (the guard that protects ~/.codex)", async () => {
  const { baseEnv, sandbox } = await import("./codex-sandbox.mjs");
  const sb = sandbox("repo-guard");
  assert.throws(() => baseEnv(sb, { CODEX_HOME: path.join(ROOT, "nope") }), /must name a folder inside the sandbox/);
  assert.throws(() => baseEnv(sb, { CODEX_HOME: undefined }), /must name a folder inside the sandbox/);
  assert.throws(() => baseEnv(sb, { USERPROFILE: "" }), /must name a folder inside the sandbox/);
  assert.doesNotThrow(() => baseEnv(sb, { CODEX_HOME: path.join(sb.root, "elsewhere") }));
  const env = baseEnv(sb);
  assert.equal(env.NO_PROXY, "127.0.0.1,localhost");
  for (const v of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"]) assert.equal(env[v], "http://127.0.0.1:9", `${v} names a closed port`);
});

test("every finding id of the catalog is in the README's table, and the README names no other", () => {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("### What `lint` finds"));
  const listed = [...section.matchAll(/^\| `([a-z]+(?:-[a-z]+)+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), [...IDS].sort());
});
