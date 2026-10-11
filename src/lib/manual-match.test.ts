import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { filterCatalogue, replaceCatalogue, type CatalogueItem } from "./filament-match.ts";
import { parseFilamentWorkbook } from "./filament-workbook.ts";
import {
  applyManualSelection,
  automaticMatchPatch,
  clearToUnverified,
  filamentActions,
  matchSourceLabel,
  matchStatusLabel,
  normalizeRow,
  possibleCatalogueMatches,
  reviewCataloguePresence,
  suggestColour,
} from "./manual-match.ts";
import { suggestProjectRows, type FilamentRow } from "./project-store.ts";
import { buildWorkbook } from "./export-xlsx.ts";
import type { Project } from "./project-store.ts";

const workbookPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../attachments/Bambu_Lab_Filaments_Complete.xlsx",
);
const parsed = parseFilamentWorkbook(fs.readFileSync(workbookPath));
replaceCatalogue(parsed.items, { incomplete: parsed.incomplete });

function row(patch: Partial<FilamentRow> = {}): FilamentRow {
  return {
    id: "row-1",
    imageId: "img",
    plateId: "plate-1",
    filamentId: "1",
    include: true,
    isTotal: false,
    wide: false,
    model: { meters: 10, grams: 30 },
    support: { meters: null, grams: null },
    purged: null,
    tower: null,
    total: { meters: 10, grams: 30 },
    hex: "#00AE42",
    hexSource: "sampled",
    ocrHex: "#00AE42",
    catalogueCode: null,
    catalogueName: null,
    catalogueMaterial: null,
    catalogueHex: null,
    catalogueId: null,
    catalogueBrand: null,
    matchConfidence: null,
    matchLocked: false,
    matchStatus: null,
    matchSource: null,
    catalogueMissing: false,
    catalogueChanged: false,
    confidence: 0.95,
    needsReview: false,
    userCorrected: false,
    raw: "ocr line",
    y0: 10,
    y1: 20,
    ...patch,
  };
}

function uniquelySuggested(): CatalogueItem | undefined {
  return parsed.items.find((item) => {
    const hex = item.hexes[0];
    if (!hex) return false;
    const suggested = suggestColour(row({ hex, ocrHex: hex, confidence: 0.95 }));
    return suggested.matchStatus === "suggested" && suggested.catalogueId === item.family && suggested.catalogueCode === item.code;
  });
}

function plaGreen(): CatalogueItem {
  const item = parsed.items.find((entry) => entry.code === "10501" && entry.material === "PLA Basic");
  if (!item) throw new Error("PLA Basic 10501 is missing from the supplied workbook.");
  return item;
}

test("ambiguous, unread, and low-confidence colours stay unverified", () => {
  const ambiguous = suggestColour(row());
  assert.equal(ambiguous.matchStatus, "unverified");
  assert.equal(ambiguous.catalogueCode, null);
  assert.equal(ambiguous.catalogueName, null);
  assert.equal(ambiguous.matchLocked, false);
  assert.equal(ambiguous.ocrHex, "#00AE42");
  assert.equal(filamentActions(ambiguous).choose, true);
  assert.equal(filamentActions(ambiguous).change, false);

  const unread = suggestColour(row({ hex: null, ocrHex: null, hexSource: null }));
  assert.equal(unread.matchStatus, "unverified");
  assert.equal(filamentActions(unread).choose, true);

  const unique = uniquelySuggested();
  assert.ok(unique);
  const low = suggestColour(row({ hex: unique.hexes[0], ocrHex: unique.hexes[0], confidence: 0.4 }));
  assert.equal(low.matchStatus, "unverified");
  assert.equal(low.catalogueCode, null);
});

test("a single high-confidence colour can be suggested and is not marked manually confirmed", () => {
  const unique = uniquelySuggested();
  assert.ok(unique);
  const suggested = suggestColour(row({ hex: unique.hexes[0], ocrHex: unique.hexes[0] }));
  assert.equal(suggested.matchStatus, "suggested");
  assert.equal(suggested.matchSource, "automatic");
  assert.equal(suggested.matchLocked, false);
  assert.equal(suggested.catalogueCode, unique.code);
  assert.equal(suggested.catalogueId, unique.family);
  assert.notEqual(matchStatusLabel(suggested.matchStatus), "Manually Confirmed");
});

test("search returns real workbook rows and does not confirm them", () => {
  const before = row();
  const snapshot = JSON.stringify(before);
  const scarlet = filterCatalogue({ query: "Scarlet Red", material: "PLA Matte", brand: "Bambu Lab" });
  assert.equal(scarlet.total, 1);
  assert.equal(scarlet.items[0]?.code, "11200");
  assert.equal(scarlet.items[0]?.name, "Scarlet Red");
  assert.equal(scarlet.items[0]?.brand, "Bambu Lab");
  assert.equal(scarlet.items[0]?.hexes[0], "#DE4343");

  const greens = possibleCatalogueMatches("#00AE42");
  const exact = greens.filter((item) => item.hexes[0] === "#00AE42");
  assert.deepEqual(
    exact.map((item) => item.code).sort(),
    ["10501", "33500", "40500"],
  );
  assert.ok(
    greens.every((item) =>
      parsed.items.some((source) => source.family === item.family && source.code === item.code && source.name === item.name),
    ),
  );
  const byCode = filterCatalogue({ query: "10501" });
  assert.ok(byCode.items.some((item) => item.code === "10501" && item.material === "PLA Basic"));
  assert.equal(JSON.stringify(before), snapshot);
});

test("manual confirmation keeps the OCR colour, locks the database row, and survives reload", () => {
  const item = plaGreen();
  const source = suggestColour(row({ hex: "#112233", ocrHex: "#112233" }));
  const confirmed = applyManualSelection(source, item);
  assert.equal(confirmed.matchStatus, "manual");
  assert.equal(confirmed.matchLocked, true);
  assert.equal(confirmed.matchSource, "manual");
  assert.equal(confirmed.catalogueId, item.family);
  assert.equal(confirmed.catalogueCode, "10501");
  assert.equal(confirmed.catalogueName, "Bambu Green");
  assert.equal(confirmed.catalogueMaterial, "PLA Basic");
  assert.equal(confirmed.catalogueHex, "#00AE42");
  assert.equal(confirmed.hex, "#112233");
  assert.equal(confirmed.ocrHex, "#112233");
  assert.equal(confirmed.total.grams, 30);
  assert.equal(confirmed.filamentId, "1");
  const legacy = normalizeRow({ ...confirmed, filamentId: undefined as unknown as string, slot: "5" });
  assert.equal(legacy.filamentId, "5");
  assert.equal("slot" in legacy, false);
  assert.equal(confirmed.raw, "ocr line");
  assert.equal(filamentActions(confirmed).change, true);
  assert.equal(filamentActions(confirmed).clear, true);
  assert.equal(filamentActions(confirmed).choose, false);
  assert.equal(matchStatusLabel(confirmed.matchStatus), "Manually Confirmed");
  assert.equal(matchSourceLabel(confirmed.matchSource, confirmed.matchStatus), "Manual selection");
  assert.notEqual(matchStatusLabel(confirmed.matchStatus), "Verified Automatically");

  const reloaded = normalizeRow(JSON.parse(JSON.stringify(confirmed)) as FilamentRow);
  assert.equal(reloaded.matchStatus, "manual");
  assert.equal(reloaded.catalogueId, item.family);
  assert.equal(reloaded.ocrHex, "#112233");
  assert.equal(automaticMatchPatch(reloaded), null);
  const rerun = suggestProjectRows([reloaded, row()]);
  assert.equal(rerun.rows[0]?.catalogueCode, "10501");
  assert.equal(rerun.rows[0]?.matchStatus, "manual");
  assert.equal(rerun.rows[0]?.ocrHex, "#112233");
  assert.equal(rerun.skipped, 1);
  assert.equal(rerun.rows[1]?.matchStatus, "unverified");
  assert.equal(rerun.rows[1]?.catalogueCode, null);
});

test("clearing a confirmation returns to unverified without deleting the OCR colour", () => {
  const confirmed = applyManualSelection(row({ hex: "#112233", ocrHex: "#112233" }), plaGreen());
  const cleared = clearToUnverified(confirmed);
  assert.equal(cleared.matchStatus, "unverified");
  assert.equal(cleared.catalogueCode, null);
  assert.equal(cleared.catalogueName, null);
  assert.equal(cleared.matchLocked, false);
  assert.equal(cleared.hex, "#112233");
  assert.equal(cleared.ocrHex, "#112233");
  assert.equal(cleared.total.grams, 30);
  assert.equal(cleared.plateId, "plate-1");
  assert.equal(filamentActions(cleared).choose, true);
});

test("a missing or changed database row keeps the saved selection and asks for review", () => {
  const confirmed = applyManualSelection(row(), plaGreen());
  const missing = reviewCataloguePresence({ ...confirmed, catalogueId: "missing-id-999999" });
  assert.equal(missing.catalogueMissing, true);
  assert.equal(missing.needsReview, true);
  assert.equal(missing.catalogueName, "Bambu Green");
  assert.equal(missing.catalogueCode, "10501");
  assert.equal(missing.catalogueHex, "#00AE42");
  assert.equal(missing.matchStatus, "manual");
  const rerun = suggestProjectRows([missing]);
  assert.equal(rerun.rows[0]?.catalogueName, "Bambu Green");
  assert.equal(rerun.rows[0]?.catalogueMissing, true);
  assert.equal(rerun.rows[0]?.matchStatus, "manual");

  const changed = reviewCataloguePresence({ ...confirmed, catalogueName: "Old Name", catalogueHex: "#112233" });
  assert.equal(changed.catalogueChanged, true);
  assert.equal(changed.catalogueName, "Old Name");
  assert.equal(changed.catalogueHex, "#112233");
  assert.equal(changed.matchStatus, "manual");
  assert.equal(changed.catalogueMissing, false);
});

test("workbook export labels a manual selection and keeps the OCR colour separate", async () => {
  const confirmed = applyManualSelection(row({ hex: "#112233", ocrHex: "#112233" }), plaGreen());
  const project: Project = {
    id: "p",
    name: "Manual job",
    updatedAt: "2026-10-11T00:00:00.000Z",
    images: [],
    plates: [
      {
        id: "plate-1",
        imageId: null,
        label: "Plate 1",
        prepareTime: null,
        printTime: null,
        totalTime: null,
        reviewStatus: "pending",
        needsReview: false,
        confidence: 1,
      },
    ],
    rows: [confirmed],
  };
  const blob = await buildWorkbook(project);
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await blob.arrayBuffer());
  const details = book.getWorksheet("Filament Details");
  assert.ok(details);
  assert.equal(details.getRow(1).getCell(15).value, "Original OCR colour");
  assert.equal(details.getRow(1).getCell(17).value, "Selected filament name");
  assert.equal(details.getRow(1).getCell(23).value, "Match status");
  assert.equal(details.getRow(1).getCell(25).value, "Match source");
  assert.equal(details.getRow(1).getCell(28).value, "Selected colour name");
  const line = details.getRow(2);
  assert.equal(line.getCell(15).value, "#112233");
  assert.equal(line.getCell(17).value, "Bambu Green");
  assert.equal(line.getCell(18).value, "PLA Basic");
  assert.equal(line.getCell(19).value, "10501");
  assert.equal(line.getCell(19).numFmt, "@");
  assert.equal(line.getCell(20).value, "#00AE42");
  assert.equal(line.getCell(21).value, "#00AE42");
  assert.equal(line.getCell(23).value, "Manually Confirmed");
  assert.notEqual(line.getCell(23).value, "Verified Automatically");
  assert.equal(line.getCell(25).value, "Manual selection");
  assert.equal(line.getCell(26).value, plaGreen().family);
  assert.equal(line.getCell(26).numFmt, "@");
  assert.equal(line.getCell(27).value, "Bambu Lab");
  assert.equal(line.getCell(28).value, "Bambu Green");
  assert.equal(line.getCell(4).value, 30);
});
