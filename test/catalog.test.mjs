// The findings, their pages and the code that says them, held to each other: every id has a page, a basis that matches its lines, a place
// in the code that emits it and a test that makes it appear.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CATALOG, IDS, SEVERITIES } from "../src/catalog.mjs";
import { PAGES, listPages, nearIds, pageFor } from "../src/explain.mjs";
import { explainDoc, explainListText, explainText } from "../src/report.mjs";
import { ROOT } from "./helpers.mjs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("the catalog: ids in kebab-case, a severity, a basis and a title for each", () => {
  assert.ok(IDS.length >= 40);
  assert.deepEqual(IDS, Object.keys(CATALOG));
  assert.equal(new Set(IDS).size, IDS.length);
  for (const id of IDS) {
    assert.match(id, /^[a-z]+(-[a-z]+)*$/, id);
    assert.ok(SEVERITIES.includes(CATALOG[id].severity), id);
    assert.ok(["binary", "docs"].includes(CATALOG[id].basis), id);
    assert.ok(CATALOG[id].title.length > 10 && CATALOG[id].title.length < 120, id);
  }
});

test("every finding has a page, and a page has every part", () => {
  assert.deepEqual(Object.keys(PAGES).sort(), [...IDS].sort());
  for (const id of IDS) {
    const page = pageFor(id);
    assert.equal(page.id, id);
    assert.equal(page.severity, CATALOG[id].severity);
    assert.equal(page.basis, CATALOG[id].basis);
    assert.ok(page.means.length > 30, id);
    assert.ok(page.does.length >= 1, id);
    for (const [source, text] of page.does) {
      assert.ok(["verified", "documented", "not verified"].includes(source), `${id}: ${source}`);
      assert.ok(text.length > 20, id);
    }
    assert.ok(page.fix.length >= 1 && page.fix.every((f) => f.length > 5), id);
    assert.ok(page.docs.every((d) => /^https:\/\/learn\.chatgpt\.com\/docs\//.test(d)), id);
  }
});

test("a finding that rests on the binary has a line that was put to it; one that rests on the documentation says so in its lines", () => {
  for (const id of IDS) {
    const sources = pageFor(id).does.map(([s]) => s);
    if (CATALOG[id].basis === "binary") assert.ok(sources.includes("verified"), `${id} is on the binary and has no verified line`);
    else assert.ok(sources.includes("documented"), `${id} is on the documentation and has no documented line`);
  }
});

test("the code emits exactly the findings of the catalog", () => {
  const code = [read("src/lint.mjs"), read("src/schema.mjs")].join("\n");
  const emitted = new Set([...code.matchAll(/\b(?:add|make|problems\.push)\(\s*\{?\s*(?:id: )?"([a-z]+(?:-[a-z]+)+)"/g)].map((m) => m[1]));
  for (const m of code.matchAll(/id: "([a-z]+(?:-[a-z]+)+)"/g)) emitted.add(m[1]);
  for (const id of IDS) assert.ok(emitted.has(id) || new RegExp(`"${id}"`).test(code), `${id} is in the catalog and nothing emits it`);
  for (const id of emitted) if (/^(hook|agents|rules|provider|mcp|profile|feature|trust|untrusted|unknown|wrong|key|config|toml|codex|approval|env|windows|ignored|hooks)-/.test(id) || id === "toml-error") assert.ok(IDS.includes(id), `${id} is emitted and not in the catalog`);
});

test("every finding is made to appear by a test of test/lint.test.mjs", () => {
  const tests = read("test/lint.test.mjs");
  for (const id of IDS) assert.ok(tests.includes(`"${id}"`), `no test of lint.test.mjs names ${id}`);
});

test("explain: the text has the id, the severity and basis, what Codex does line by line, the fix and the documentation", () => {
  const page = pageFor("wrong-type");
  const text = explainText(page);
  assert.match(text, /^wrong-type {3}A value of the wrong type, or outside the allowed words {2}\[error, binary\]\n/);
  assert.match(text, /\nWhat Codex does\n {2}- \(verified\) /);
  assert.match(text, /\nThe fix\n {2}- /);
  assert.match(text, /\nDocumentation\n {2}https:\/\//);
  const doc = explainDoc(page);
  assert.deepEqual(Object.keys(doc), ["ok", "id", "title", "severity", "basis", "means", "does", "fix", "docs"]);
  assert.ok(doc.does.every((d) => d.source && d.text));
  assert.equal(listPages().length, IDS.length);
  assert.equal(explainListText(listPages()).trimEnd().split("\n").length, IDS.length);
});

test("an id that is not one gets the nearest ones", () => {
  assert.equal(pageFor("nosuch"), null);
  assert.deepEqual(nearIds("wrong-typo"), ["wrong-type"]);
  assert.equal(nearIds("hook").length, 4);
  assert.ok(nearIds("hook").every((id) => id.includes("hook")));
  assert.deepEqual(nearIds("zzzzzzzzzzzz"), []);
  assert.ok(ROOT);
});
