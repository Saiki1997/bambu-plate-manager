import assert from "node:assert/strict";
import test from "node:test";
import { deductFromStock, filamentKey, filamentTotals, formatMoney, parsePrices, summarizeTotals } from "./filament-totals.ts";
import { fixtureProject, fixtureRow } from "./test-fixtures.ts";

const green = fixtureRow({ id: "a", catalogueId: "1", total: { grams: 200, meters: 60 } });
const greenAgain = fixtureRow({ id: "b", catalogueId: "1", plateId: "p2", total: { grams: 50, meters: null } });
const sample = fixtureRow({
  id: "c",
  catalogueName: null,
  catalogueCode: null,
  catalogueHex: null,
  catalogueMaterial: null,
  matchStatus: "unverified",
  hex: "#123456",
  total: { grams: 100, meters: 30 },
});
const project = fixtureProject({
  rows: [green, greenAgain, sample, fixtureRow({ id: "t", isTotal: true, include: false }), fixtureRow({ id: "x", include: false, catalogueId: "1" })],
});

test("lines of the same filament add up across plates; excluded and total rows are left out", () => {
  const totals = filamentTotals(project);
  assert.equal(totals.length, 2);
  assert.equal(totals[0].name, "Bambu Green");
  assert.equal(totals[0].lines, 2);
  assert.equal(totals[0].grams, 250);
  assert.equal(totals[0].meters, 60);
  assert.equal(totals[0].confirmed, true);
  assert.equal(totals[1].name, "Unmatched colour");
  assert.equal(totals[1].confirmed, false);
});

test("cost uses a filament's own price, then the default; stock shows any shortfall", () => {
  const key = filamentKey(green)!;
  const totals = filamentTotals(
    project,
    { currency: "$", defaultPerKg: 20, perKg: { [key]: 30 } },
    { grams: { [key]: 200 } },
  );
  assert.equal(totals[0].perKg, 30);
  assert.equal(totals[0].cost, 7.5);
  assert.equal(totals[0].shortBy, 50);
  assert.equal(totals[1].cost, 2);
  assert.equal(totals[1].shortBy, null);
  assert.deepEqual(summarizeTotals(totals), { grams: 350, cost: 9.5, unpriced: 0, short: 1 });
});

test("without prices the cost is unknown, not zero", () => {
  const summary = summarizeTotals(filamentTotals(project));
  assert.equal(summary.cost, null);
  assert.equal(summary.unpriced, 2);
});

test("deducting a print never takes stock below zero and skips untracked filaments", () => {
  const key = filamentKey(green)!;
  const next = deductFromStock({ grams: { [key]: 300 } }, filamentTotals(project));
  assert.deepEqual(next.grams, { [key]: 50 });
  assert.deepEqual(deductFromStock({ grams: { [key]: 100 } }, filamentTotals(project)).grams, { [key]: 0 });
});

test("a damaged price file loads safely", () => {
  assert.deepEqual(parsePrices({ currency: 5, defaultPerKg: "x", perKg: { a: -1, b: 25 } }), { currency: "", defaultPerKg: null, perKg: { b: 25 } });
  assert.equal(formatMoney(1.5, "$"), "$1.50");
  assert.equal(formatMoney(1.5, "RM"), "RM 1.50");
  assert.equal(formatMoney(null, "$"), "—");
});
