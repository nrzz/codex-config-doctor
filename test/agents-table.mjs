// The AGENTS.md worlds the assembly is held to. A scenario: files (paths from the project folder; "home:" paths from the Codex home), the user's
// config.toml, the working folder (cwd, from the project folder) and whether the project folder is a Git repository. test/record-oracles.mjs
// builds each on disk, asks `codex debug prompt-input` for the AGENTS.md message and records its size, its hash and its ends in
// test/fixtures/agents-oracle.json; test/agents.test.mjs holds src/agents.mjs to that record; test/e2e-agents.test.mjs asks Codex again.
const K = 1024;
const rep = (c, n) => ({ repeat: [c, n] });
/** Content of a file: text, or { repeat: [char, count] }, or { bytes: [numbers] }, or { utf16: text }. */
export function bytesOf(c) {
  if (typeof c === "string") return Buffer.from(c, "utf8");
  if (c.repeat) return Buffer.from(c.repeat[0].repeat(c.repeat[1]), "utf8");
  if (c.bytes) return Buffer.from(c.bytes);
  if (c.utf16) return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(c.utf16, "utf16le")]);
  throw new Error("unknown content");
}

export const SCENARIOS = [
  { name: "no file at all", files: {} },
  { name: "a project file", files: { "AGENTS.md": "ROOT\n" } },
  { name: "a global file only", files: { "home:AGENTS.md": "GLOBAL\n" } },
  { name: "a global file and a project file", files: { "home:AGENTS.md": "GLOBAL\n", "AGENTS.md": "ROOT\n" } },
  { name: "the chain root, a, a/b", files: { "home:AGENTS.md": "GLOBAL\n", "AGENTS.md": "ROOT\n", "a/AGENTS.md": "A\n", "a/b/AGENTS.md": "B\n" }, cwd: "a/b" },
  { name: "files without a final newline", files: { "home:AGENTS.md": "GLOBAL", "AGENTS.md": "ROOT", "a/AGENTS.md": "A", "a/b/AGENTS.md": "B" }, cwd: "a/b" },
  { name: "extra newlines", files: { "home:AGENTS.md": "GLOBAL\n\n\n", "AGENTS.md": "ROOT\n\n\n", "a/AGENTS.md": "\n\nA\n", "a/b/AGENTS.md": "B  \n" }, cwd: "a/b" },
  { name: "CRLF files", files: { "home:AGENTS.md": "GLOBAL\r\nline2\r\n", "AGENTS.md": "ROOT\r\nline2\r\n" }, cwd: "a/b" },
  { name: "a folder in the chain without a file", files: { "AGENTS.md": "ROOT\n", "a/b/AGENTS.md": "B\n" }, cwd: "a/b" },
  { name: "override beside AGENTS.md in a project folder", files: { "AGENTS.md": "STANDARD\n", "AGENTS.override.md": "OVERRIDE\n" } },
  { name: "override in the Codex home", files: { "home:AGENTS.md": "G-STANDARD\n", "home:AGENTS.override.md": "G-OVERRIDE\n", "AGENTS.md": "P\n" } },
  { name: "an empty override in a project folder hides AGENTS.md", files: { "AGENTS.md": "STANDARD\n", "AGENTS.override.md": "" } },
  { name: "an override with only spaces hides AGENTS.md", files: { "AGENTS.md": "STANDARD\n", "AGENTS.override.md": "  \n" } },
  { name: "an empty override in the Codex home does not hide AGENTS.md", files: { "home:AGENTS.md": "G-STANDARD\n", "home:AGENTS.override.md": "", "AGENTS.md": "P\n" } },
  { name: "an empty project file", files: { "AGENTS.md": "", "home:AGENTS.md": "G\n" } },
  { name: "a project file with only white space", files: { "AGENTS.md": "   \n\n", "home:AGENTS.md": "G\n" } },
  { name: "a folder named AGENTS.md is passed over", files: { "AGENTS.md/keep": "x", "AGENTS.override.md": "OVR\n" } },
  { name: "fallback name, no AGENTS.md", files: { "TEAM.md": "TEAMDOC\n" }, config: 'project_doc_fallback_filenames = ["TEAM.md"]\n' },
  { name: "fallback names, AGENTS.md first", files: { "AGENTS.md": "A\n", "TEAM.md": "TEAM\n" }, config: 'project_doc_fallback_filenames = ["TEAM.md"]\n' },
  { name: "two fallback names in order", files: { "B.md": "second\n", "A.md": "first\n" }, config: 'project_doc_fallback_filenames = ["A.md", "B.md"]\n' },
  { name: "fallback names with a path", files: { "sub/dir.md": "SUB\n", "ok.md": "OK\n" }, config: 'project_doc_fallback_filenames = ["sub/dir.md", "", "ok.md"]\n' },
  { name: "a fallback name in the Codex home is not read", files: { "home:TEAM.md": "TEAM\n", "AGENTS.md": "P\n" }, config: 'project_doc_fallback_filenames = ["TEAM.md"]\n' },
  { name: "the cap with 20K, 20K and 5K", files: { "AGENTS.md": rep("R", 20 * K), "a/AGENTS.md": rep("A", 20 * K), "a/b/AGENTS.md": rep("B", 5 * K) }, cwd: "a/b" },
  { name: "a global file of 40K does not count", files: { "home:AGENTS.md": rep("G", 40 * K), "AGENTS.md": rep("R", 20 * K), "a/AGENTS.md": rep("A", 20 * K) }, cwd: "a" },
  { name: "one file of exactly the cap", files: { "AGENTS.md": rep("R", 32 * K), "a/AGENTS.md": rep("A", 100) }, cwd: "a" },
  { name: "one file of the cap minus one", files: { "AGENTS.md": rep("R", 32 * K - 1), "a/AGENTS.md": rep("A", 100) }, cwd: "a" },
  { name: "one file of 40K", files: { "AGENTS.md": rep("R", 40 * K), "a/AGENTS.md": rep("A", 100) }, cwd: "a" },
  { name: "cap 0", files: { "home:AGENTS.md": "G\n", "AGENTS.md": "ROOT\n" }, config: "project_doc_max_bytes = 0\n" },
  { name: "cap 3", files: { "home:AGENTS.md": "GLOBAL\n", "AGENTS.md": "ROOT\n" }, config: "project_doc_max_bytes = 3\n" },
  { name: "cap 8 over two files", files: { "AGENTS.md": "ROOT\n", "a/AGENTS.md": "A\n", "a/b/AGENTS.md": "B\n" }, cwd: "a/b", config: "project_doc_max_bytes = 8\n" },
  { name: "cap exactly the size of the first file", files: { "AGENTS.md": "ROOT\n", "a/AGENTS.md": "A\n" }, cwd: "a", config: "project_doc_max_bytes = 5\n" },
  { name: "cap 1 and a first byte that is a newline", files: { "home:AGENTS.md": "G\n", "AGENTS.md": "\nX" }, config: "project_doc_max_bytes = 1\n" },
  { name: "a multibyte letter cut by the cap", files: { "AGENTS.md": "abééé" }, config: "project_doc_max_bytes = 5\n" },
  { name: "a multibyte letter kept by the cap", files: { "AGENTS.md": "abééé" }, config: "project_doc_max_bytes = 4\n" },
  { name: "an emoji cut by the cap", files: { "AGENTS.md": "a\u{1F600}b" }, config: "project_doc_max_bytes = 3\n" },
  { name: "a byte order mark", files: { "AGENTS.md": "﻿ROOT\n" } },
  { name: "an invalid byte", files: { "AGENTS.md": { bytes: [0x52, 0x4f, 0xff, 0x4f, 0x54, 0x0a] } } },
  { name: "UTF-16 with a byte order mark", files: { "AGENTS.md": { utf16: "ROOT\n" } } },
  { name: "no .git above the working folder", files: { "AGENTS.md": "ROOT\n", "a/AGENTS.md": "A\n" }, cwd: "a", git: false },
  { name: "project_root_markers with a marker that is there", files: { "AGENTS.md": "ROOT\n", "a/AGENTS.md": "A\n", ".hg/keep": "x" }, cwd: "a", git: false, config: 'project_root_markers = [".hg"]\n' },
  { name: "project_root_markers empty", files: { "AGENTS.md": "ROOT\n", "a/AGENTS.md": "A\n" }, cwd: "a", config: "project_root_markers = []\n" },
  { name: ".git as a file", files: { ".git": "gitdir: ../elsewhere\n", "AGENTS.md": "ROOT\n", "a/AGENTS.md": "A\n" }, cwd: "a", git: false },
  { name: "unicode text", files: { "AGENTS.md": "Ünïcödé — 日本語 🚀\n" } },
  { name: "a long line", files: { "AGENTS.md": rep("x", 5000) } },
];
