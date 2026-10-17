// Puts the tables of cases to the real Codex and records what it answered, in test/fixtures/*.json (and, for `recorded`, in src/recorded.mjs).
// The unit tests hold the code to these records without Codex; the e2e tests ask Codex again and compare. Run it by hand when the tables
// change or a new Codex comes out:
//   E2E_CODEX=<path to codex> node test/record-oracles.mjs toml | rules | schema | schema groups | agents | hooks | layers | recorded | all
// `node --test` also runs every file under test/: with no argument this one does nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const what = process.argv[2];
if (!what || !/record-oracles\.mjs$/.test(process.argv[1] || "")) process.exit(0);

const { codexInfo } = await import("./codex-sandbox.mjs");
const ask = await import("./ask.mjs");
const info = codexInfo();
if (!info.ok) { console.error(info.reason); process.exit(2); }
const FIX = path.join(here, "fixtures");
fs.mkdirSync(FIX, { recursive: true });
const write = (name, data) => { fs.writeFileSync(path.join(FIX, name), `${JSON.stringify(data, null, 1)}\n`); console.log(`wrote test/fixtures/${name}`); };
const dot = (ok) => process.stdout.write(ok === false ? "x" : ".");

const tasks = {
  toml: async () => write("toml-oracle.json", await ask.recordToml(dot)),
  rules: async () => write("rules-oracle.json", await ask.recordRules(dot)),
  schema: async () => {
    if (process.argv[3] === "groups") {
      // asks again only the groups and keeps the rest of the record (the long part is the wrong-type samples)
      const old = JSON.parse(fs.readFileSync(path.join(FIX, "schema-oracle.json"), "utf8"));
      const fresh = await ask.recordSchema(dot, { only: "groups" });
      write("schema-oracle.json", { ...old, codex: fresh.codex, recorded: fresh.recorded, groups: fresh.groups });
    } else write("schema-oracle.json", await ask.recordSchema(dot));
  },
  agents: async () => write("agents-oracle.json", await ask.recordAgents(dot)),
  hooks: async () => write("hooks-oracle.json", await ask.recordHooks(dot)),
  layers: async () => write("layers-oracle.json", await ask.recordLayers(dot)),
  recorded: async () => {
    const { recordFirstRequest, recordedSource } = await import("./measure.mjs");
    const measured = await recordFirstRequest();
    // the figures of the other systems are kept: this one replaces its own
    const { BY_SYSTEM } = await import("../src/recorded.mjs");
    fs.writeFileSync(path.join(here, "..", "src", "recorded.mjs"), recordedSource(measured, BY_SYSTEM));
    console.log(`wrote src/recorded.mjs (the figures of ${process.platform})`);
  },
};
const list = what === "all" ? Object.keys(tasks) : [what];
for (const t of list) {
  if (!tasks[t]) { console.error(`unknown task ${t}; the tasks are ${Object.keys(tasks).join(", ")}, all`); process.exit(2); }
  await tasks[t]();
  console.log();
}
