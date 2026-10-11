import assert from "node:assert/strict";
import test from "node:test";
import { mergeFilamentRows, type FilamentRow } from "./project-store.ts";

function row(patch: Partial<FilamentRow>): FilamentRow {
  return {
    id: patch.id ?? "a",
    imageId: "img",
    plateId: "plate",
    filamentId: "1",
    include: true,
    isTotal: false,
    wide: false,
    model: { meters: 1, grams: 3 },
    support: { meters: null, grams: null },
    purged: null,
    tower: null,
    total: { meters: 1, grams: 3 },
    hex: "#00AE42",
    hexSource: "sampled",
    catalogueCode: "10501",
    catalogueName: "Bambu Green",
    catalogueMaterial: "PLA Basic",
    catalogueHex: "#00AE42",
    matchConfidence: "high",
    matchLocked: true,
    matchStatus: "accepted",
    confidence: 1,
    needsReview: false,
    userCorrected: false,
    raw: "",
    y0: null,
    y1: null,
    ...patch,
  };
}

test("merge sums the same locked colour on one plate and keeps a missing side empty", () => {
  const merged = mergeFilamentRows([
    row({ id: "a", total: { meters: 1, grams: null }, model: { meters: 1, grams: null } }),
    row({ id: "b", filamentId: "2", total: { meters: 2, grams: 4 }, model: { meters: 2, grams: 4 } }),
    row({ id: "c", catalogueCode: "10200", hex: "#FFFFFF", catalogueHex: "#FFFFFF" }),
  ]);
  assert.equal(merged.removed, 1);
  assert.equal(merged.rows.length, 2);
  assert.equal(merged.rows[0]?.total.meters, 3);
  assert.equal(merged.rows[0]?.total.grams, 4);
  assert.equal(merged.rows[0]?.matchLocked, true);
});

test("merge does not combine different plates or project totals", () => {
  const merged = mergeFilamentRows([
    row({ id: "a", plateId: "one" }),
    row({ id: "b", plateId: "two" }),
    row({ id: "c", isTotal: true, include: false, plateId: null }),
  ]);
  assert.equal(merged.removed, 0);
  assert.equal(merged.rows.length, 3);
});
