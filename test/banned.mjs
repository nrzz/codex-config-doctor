// The prefixes Codex will not honour an `allow` rule for, read from the Codex binary. Codex 0.163.0 keeps a sorted table of them (the shells
// with -c and -lc, the interpreters with -e, -c and -r, git, env, rm, sudo, `npm run` and so on); a rule whose whole pattern is one of
// them is ignored, and the same table is the list of prefixes the model is told not to suggest. The table is an array of arrays of string
// slices in the read-only data of the executable: this reads the Windows build (PE) and follows the pointers. src/knowledge.mjs holds the
// result as BANNED_PREFIXES; test/e2e-why.test.mjs reads it again on Windows and compares, and puts every prefix to the binary.
// Importing this file starts nothing.
import fs from "node:fs";
import path from "node:path";

/** The prefixes in the table of a Codex executable for Windows (a PE file): [[token, ...], ...] in the order of the table, or null. */
export function bannedFromPe(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt16LE(0) !== 0x5a4d) return null;
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) return null;
  const sections = buf.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const imageBase = Number(buf.readBigUInt64LE(optional + 24));
  const table = optional + buf.readUInt16LE(pe + 20);
  const map = [];
  for (let i = 0; i < sections; i++) {
    const o = table + i * 40;
    map.push({ size: Math.max(buf.readUInt32LE(o + 8), buf.readUInt32LE(o + 16)), rva: buf.readUInt32LE(o + 12), raw: buf.readUInt32LE(o + 20), rawSize: buf.readUInt32LE(o + 16) });
  }
  const toVa = (off) => { for (const s of map) if (off >= s.raw && off < s.raw + s.rawSize) return imageBase + s.rva + (off - s.raw); return null; };
  const toFile = (va) => { const rva = va - imageBase; for (const s of map) if (rva >= s.rva && rva < s.rva + s.size) return s.raw + (rva - s.rva); return null; };
  const text = (va, len) => { const off = toFile(va); return off === null || off + len > buf.length ? null : buf.toString("latin1", off, off + len); };
  // the table holds ["Rscript"]: find a reference (pointer, length) to that string
  const needle = Buffer.from("Rscript");
  let anchor = -1;
  for (let at = buf.indexOf(needle); at >= 0 && anchor < 0; at = buf.indexOf(needle, at + 1)) {
    const va = toVa(at);
    if (va === null) continue;
    const ref = Buffer.alloc(16);
    ref.writeBigUInt64LE(BigInt(va), 0);
    ref.writeBigUInt64LE(7n, 8);
    anchor = buf.indexOf(ref);
  }
  if (anchor < 0) return null;
  const found = [];
  for (let o = anchor - 16 * 400; o < anchor + 16 * 400; o += 8) {
    if (o < 0 || o + 16 > buf.length) continue;
    const p = Number(buf.readBigUInt64LE(o));
    const n = Number(buf.readBigUInt64LE(o + 8));
    if (n < 1 || n > 6 || p < imageBase || p > imageBase + 0x20000000) continue;
    const off = toFile(p);
    if (off === null || off + n * 16 > buf.length) continue;
    const tokens = [];
    for (let k = 0; k < n; k++) {
      const len = Number(buf.readBigUInt64LE(off + k * 16 + 8));
      const s = len >= 1 && len <= 24 ? text(Number(buf.readBigUInt64LE(off + k * 16)), len) : null;
      if (s === null || !/^[ -~]+$/.test(s)) { tokens.length = 0; break; }
      tokens.push(s);
    }
    if (tokens.length === n) found.push({ o, tokens });
  }
  // one array of the table per position, in the order of the table; the table is sorted and runs from ["/bin/bash"] to ["zsh", "-lc"]
  const unique = new Map();
  for (const f of found.sort((a, b) => a.o - b.o)) if (!unique.has(JSON.stringify(f.tokens))) unique.set(JSON.stringify(f.tokens), f.tokens);
  const list = [...unique.values()];
  const from = list.findIndex((t) => t.length === 1 && t[0] === "/bin/bash");
  const to = list.findIndex((t) => t.length === 2 && t[0] === "zsh" && t[1] === "-lc");
  return from >= 0 && to > from ? list.slice(from, to + 1) : null;
}

/** The executable of a Codex installed with npm for Windows, found from the command that starts it (codex.cmd), or null. */
export function findWindowsExe(command) {
  if (!command) return null;
  if (/\.exe$/i.test(command) && fs.existsSync(command)) return command;
  const roots = [];
  let dir = path.dirname(path.resolve(command));
  for (let i = 0; i < 4; i++) { roots.push(dir); dir = path.dirname(dir); }
  const seen = new Set();
  const search = (folder, depth) => {
    if (depth > 10 || seen.has(folder)) return null;
    seen.add(folder);
    let names;
    try { names = fs.readdirSync(folder, { withFileTypes: true }); } catch { return null; }
    for (const e of names) if (e.isFile() && e.name === "codex.exe") return path.join(folder, e.name);
    for (const e of names) if (e.isDirectory() && (e.name === "node_modules" || e.name.startsWith("@openai") || e.name.startsWith("codex") || e.name === "vendor" || e.name === "bin" || e.name.includes("windows"))) { const r = search(path.join(folder, e.name), depth + 1); if (r) return r; }
    return null;
  };
  for (const r of roots) { const hit = search(path.join(r, "node_modules"), 0) || search(r, 0); if (hit) return hit; }
  return null;
}
