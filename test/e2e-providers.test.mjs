// Model providers, put to the real Codex: the reserved ids, wire_api, a provider that is not defined, a key variable that is not set, a
// provider with no name or both auth and env_key, and a provider with no base_url. Every proxy variable of a run names a closed port (see
// test/codex-sandbox.mjs), so even the run that goes to the wrong address leaves nothing behind.
import test from "node:test";
import assert from "node:assert/strict";
import { exec, lintWorld } from "./behave.mjs";
import { skip } from "./codex-sandbox.mjs";

const opts = { skip: skip() };
const provider = (body, top = 'model_provider = "p"\n') => `${top}[model_providers.p]\n${body}`;
const URL_LOCAL = 'base_url = "http://127.0.0.1:1/v1"\n';

test("provider-reserved-id: openai, ollama and lmstudio cannot be redefined", opts, async () => {
  for (const id of ["openai", "ollama", "lmstudio"]) {
    const r = await exec({ label: "e2e-prov-reserved", userTables: `[model_providers.${id}]\nname = "x"\n${URL_LOCAL}` });
    assert.equal(r.code, 1, id);
    assert.match(r.err, new RegExp(`model_providers contains reserved built-in provider IDs: \`${id}\`\\. Built-in providers cannot be overridden\\. Rename your custom provider \\(for example, \`openai-custom\`\\)\\.`), id);
    assert.equal(lintWorld(r.sb).find("provider-reserved-id").length, 1, id);
  }
});

test("provider-wire-api: chat is no longer supported, and no other word is", opts, async () => {
  const chat = await exec({ label: "e2e-prov-wire", rawUser: provider(`name = "p"\n${URL_LOCAL}wire_api = "chat"\n`) });
  assert.equal(chat.code, 1);
  assert.match(chat.err, /`wire_api = "chat"` is no longer supported\.\r?\nHow to fix: set `wire_api = "responses"` in your provider config\./);
  const banana = await exec({ label: "e2e-prov-wire-2", rawUser: provider(`name = "p"\n${URL_LOCAL}wire_api = "banana"\n`) });
  assert.equal(banana.code, 1);
  assert.match(banana.err, /unknown variant `banana`, expected `responses`/);
  for (const r of [chat, banana]) {
    const l = lintWorld(r.sb);
    assert.equal(l.find("provider-wire-api").length, 1);
    assert.equal(l.find("wrong-type").length, 0, "reported once, as the provider finding");
  }
  const ok = await exec({ label: "e2e-prov-wire-3", userTables: "" });
  assert.equal(ok.code, 0, ok.err);
  assert.equal(lintWorld(ok.sb).find("provider-wire-api").length, 0);
});

test("provider-undefined: model_provider names a provider that is not defined", opts, async () => {
  const r = await exec({ label: "e2e-prov-undefined", rawUser: 'model_provider = "nope"\n' });
  assert.equal(r.code, 1);
  assert.match(r.err, /Error: Model provider `nope` not found/);
  const found = lintWorld(r.sb).find("provider-undefined");
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.equal(lintWorld((await exec({ label: "e2e-prov-builtin", rawUser: 'model_provider = "ollama"\n', timeout: 8000 })).sb).find("provider-undefined").length, 0, "a built-in provider is defined");
});

test("provider-env-key-unset: Codex stops at the first request when the key variable is not set", opts, async () => {
  const r = await exec({ label: "e2e-prov-key", env: { FAKE_API_KEY: undefined } });
  assert.equal(r.code, 1);
  assert.match(r.err, /ERROR: Missing environment variable: `FAKE_API_KEY`\./);
  assert.equal(r.requests.length, 0);
  assert.equal(lintWorld(r.sb).find("provider-env-key-unset").length, 1);
  assert.equal(lintWorld(r.sb, { env: { FAKE_API_KEY: "x" } }).find("provider-env-key-unset").length, 0, "no finding when the variable is set where lint runs");
  const ok = await exec({ label: "e2e-prov-key-ok" });
  assert.equal(ok.code, 0, ok.err);
});

test("provider-conflict: a provider with no name, or with auth and env_key", opts, async () => {
  const noName = await exec({ label: "e2e-prov-noname", rawUser: provider(`${URL_LOCAL}env_key = "FAKE_API_KEY"\n`) });
  assert.equal(noName.code, 1);
  assert.match(noName.err, /model_providers\.p: provider name must not be empty/);
  assert.equal(lintWorld(noName.sb).find("provider-conflict").length, 1);
  const both = await exec({ label: "e2e-prov-both", rawUser: provider(`name = "p"\n${URL_LOCAL}env_key = "FAKE_API_KEY"\n[model_providers.p.auth]\ncommand = "x"\n`) });
  assert.equal(both.code, 1);
  assert.match(both.err, /model_providers\.p: provider auth cannot be combined with env_key/);
  assert.equal(lintWorld(both.sb).find("provider-conflict").length, 1);
});

test("provider-base-url: a provider with no base_url connects to api.openai.com, whatever it is called", opts, async () => {
  const hosts = (err) => [...new Set(err.split("\n").filter((l) => /starting new connection/.test(l)).map((l) => /connection: (\S+)/.exec(l)[1]))];
  const none = await exec({ label: "e2e-prov-nourl", rawUser: provider('name = "my-gateway"\nenv_key = "FAKE_API_KEY"\n'), timeout: 12000, env: { RUST_LOG: "reqwest=debug" } });
  assert.ok(hosts(none.err).includes("https://api.openai.com/"), `connections: ${hosts(none.err)}`);
  const local = await exec({ label: "e2e-prov-url", rawUser: provider(`name = "my-gateway"\nbase_url = "http://127.0.0.1:7/v1"\nenv_key = "FAKE_API_KEY"\n`), timeout: 12000, env: { RUST_LOG: "reqwest=debug" } });
  assert.ok(hosts(local.err).includes("http://127.0.0.1:7/"), `connections: ${hosts(local.err)}`);
  assert.ok(!hosts(local.err).includes("https://api.openai.com/"));
  assert.equal(lintWorld(none.sb).find("provider-base-url").length, 1);
  assert.equal(lintWorld(local.sb).find("provider-base-url").length, 0);
});
