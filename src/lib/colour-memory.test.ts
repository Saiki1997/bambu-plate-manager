import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { catalogueItems, replaceCatalogue } from "./filament-match.ts";
import { parseFilamentWorkbook } from "./filament-workbook.ts";
import { applyManualSelection, suggestColour } from "./manual-match.ts";
import { emptyMemory, forgetPick, parseMemory, recallPick, rememberPick, setColourMemory } from "./colour-memory.ts";
import { fixtureRow } from "./test-fixtures.ts";

const workbookPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../attachments/Bambu_Lab_Filaments_Complete.xlsx");
const parsed = parseFilamentWorkbook(fs.readFileSync(workbookPath));
replaceCatalogue(parsed.items, { incomplete: parsed.incomplete });

/** A swatch far from any one clear match, so automatic matching alone leaves it unverified. */
const odd = "#7A6F5C";

function openRow() {
  return fixtureRow({
    hex: odd,
    ocrHex: odd,
    catalogueCode: null,
    catalogueName: null,
    catalogueMaterial: null,
    catalogueHex: null,
    matchStatus: null,
    matchLocked: false,
    matchConfidence: null,
    confidence: 0.95,
  });
}

test("remembering keys on the original swatch colour and counts repeat choices", () => {
  const item = catalogueItems()[0];
  const chosen = applyManualSelection(openRow(), item);
  const once = rememberPick(emptyMemory(), chosen, "t1");
  const twice = rememberPick(once, chosen, "t2");
  assert.equal(twice.picks.length, 1);
  assert.equal(twice.picks[0].ocrHex, odd);
  assert.equal(twice.picks[0].uses, 2);
  assert.equal(twice.picks[0].catalogueName, item.name);
  assert.equal(rememberPick(once, openRow()), once, "a row without a filament teaches nothing");
});

test("recall accepts a near swatch and rejects a different colour", () => {
  const memory = rememberPick(emptyMemory(), applyManualSelection(openRow(), catalogueItems()[0]));
  assert.ok(recallPick(memory, "#7a6f5d"));
  assert.equal(recallPick(memory, "#2050d0"), null);
  assert.equal(recallPick(forgetPick(memory, odd), odd), null);
});

test("a remembered colour becomes an unlocked suggestion, and a manual choice still wins", () => {
  assert.equal(suggestColour(openRow()).matchStatus, "unverified");
  const item = catalogueItems()[0];
  setColourMemory(rememberPick(emptyMemory(), applyManualSelection(openRow(), item)));
  try {
    const next = suggestColour(openRow());
    assert.equal(next.matchStatus, "suggested");
    assert.equal(next.matchSource, "remembered");
    assert.equal(next.matchLocked, false);
    assert.equal(next.catalogueName, item.name);
    const other = catalogueItems()[1];
    const manual = applyManualSelection(openRow(), other);
    assert.equal(suggestColour(manual), manual);
  } finally {
    setColourMemory(emptyMemory());
  }
});

test("a damaged memory file loads as empty", () => {
  assert.deepEqual(parseMemory(null).picks, []);
  assert.deepEqual(parseMemory({ picks: [{ ocrHex: "nope", catalogueName: "x" }] }).picks, []);
});
