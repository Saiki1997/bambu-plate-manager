import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { confidenceFromDelta, deltaE00, normalizeHex } from "./color-distance.ts";
import { catalogueItems, rankColours, searchCatalogue } from "./filament-match.ts";
import { parseFilamentWorkbook } from "./filament-workbook.ts";
import { replaceCatalogue } from "./filament-match.ts";

const workbookPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../attachments/Bambu_Lab_Filaments_Complete.xlsx",
);
const parsed = parseFilamentWorkbook(fs.readFileSync(workbookPath));
replaceCatalogue(parsed.items, { incomplete: parsed.incomplete });

test("the supplied workbook is the catalogue and incomplete colours are not invented", () => {
  assert.equal(parsed.items.length, 333);
  assert.equal(catalogueItems().length, 333);
  const yellow = catalogueItems().find((item) => item.code === "40400");
  assert.equal(yellow?.rawHex, "#FFF20");
  assert.deepEqual(yellow?.hexes, []);
  assert.equal(normalizeHex(yellow?.rawHex), null);
});

test("hex normalisation keeps product codes out of colour values", () => {
  assert.equal(normalizeHex("#ff6a13ff"), "#FF6A13");
  assert.equal(normalizeHex("00ae42"), "#00AE42");
  assert.equal(normalizeHex("10501"), null);
  assert.equal(normalizeHex(""), null);
});

test("identical colours have zero CIEDE2000 distance", () => {
  assert.ok(deltaE00("#00AE42", "#00AE42") < 0.01);
  assert.ok(deltaE00("#000000", "#FFFFFF") > 40);
});

test("Bambu Green matches the supplied workbook by sampled hex", () => {
  const [best] = rankColours({ hex: "#00AE42", limit: 3 });
  assert.equal(best?.name, "Bambu Green");
  assert.equal(best?.confidence, "high");
  assert.ok(best?.deltaE !== null && best.deltaE < 0.05);
});

test("exact product code selects that spreadsheet row", () => {
  const [best] = rankColours({ code: "10501", hex: "#00AE42" });
  assert.equal(best?.code, "10501");
  assert.match(best?.material ?? "", /PLA/);
});

test("exact product code outranks a nearby colour", () => {
  const [best] = rankColours({ code: "10200", hex: "#00AE42" });
  assert.equal(best?.code, "10200");
  assert.equal(best?.reason, "Exact product code");
});

test("catalogue search finds matte scarlet", () => {
  const hits = searchCatalogue("scarlet", "PLA Matte", 5);
  assert.ok(hits.some((item) => item.name === "Scarlet Red"));
});

test("confidence bands", () => {
  assert.equal(confidenceFromDelta(1.2), "high");
  assert.equal(confidenceFromDelta(6), "medium");
  assert.equal(confidenceFromDelta(20), "low");
});
