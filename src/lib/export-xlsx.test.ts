import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkbook, exportReport } from "./export-xlsx.ts";
import type { FilamentRow, Project } from "./project-store.ts";

function row(patch: Partial<FilamentRow>): FilamentRow {
  return {
    id: "row-1",
    imageId: "img",
    plateId: "plate-1",
    filamentId: "1",
    include: true,
    isTotal: false,
    wide: true,
    model: { meters: 66.22, grams: 200.7 },
    support: { meters: null, grams: null },
    purged: { meters: null, grams: null },
    tower: { meters: null, grams: null },
    total: { meters: 66.22, grams: 200.7 },
    hex: "#00AE42",
    hexSource: "sampled",
    catalogueCode: "10501",
    catalogueName: "Bambu Green",
    catalogueMaterial: "PLA Basic",
    catalogueHex: "#00AE42",
    matchConfidence: "high",
    matchLocked: true,
    matchStatus: "accepted",
    confidence: 0.9,
    needsReview: false,
    userCorrected: false,
    raw: "",
    y0: null,
    y1: null,
    ...patch,
  };
}

function project(rows: FilamentRow[]): Project {
  return {
    id: "p",
    name: "Sample job",
    updatedAt: "2026-10-11T00:00:00.000Z",
    images: [],
    plates: [
      {
        id: "plate-1",
        imageId: null,
        label: "Plate 1",
        prepareTime: null,
        printTime: "16h5m",
        totalTime: "16h5m",
        reviewStatus: "pending",
        needsReview: false,
        confidence: 0.9,
      },
    ],
    rows,
  };
}

test("export report does not invent a total when grams are missing", () => {
  const report = exportReport(project([row({ total: { meters: 10, grams: null }, catalogueCode: null, matchStatus: null })]));
  assert.equal(report.totalGrams, null);
  assert.equal(report.unmatched, 1);
  assert.equal(report.rows, 1);
});

test("workbook keeps product codes as text and paints a colour swatch", async () => {
  const blob = await buildWorkbook(
    project([
      row({}),
      row({
        id: "row-2",
        filamentId: "2",
        hex: null,
        catalogueCode: null,
        catalogueName: null,
        catalogueMaterial: null,
        catalogueHex: null,
        matchStatus: null,
        matchConfidence: null,
        matchLocked: false,
        total: { meters: null, grams: null },
        model: { meters: null, grams: null },
        needsReview: true,
        confidence: 0.4,
      }),
    ]),
  );
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await blob.arrayBuffer());
  assert.deepEqual(
    book.worksheets.map((sheet) => sheet.name),
    ["Project Summary", "Filament Details", "Colour Summary", "Plates"],
  );

  const details = book.getWorksheet("Filament Details");
  assert.ok(details);
  assert.equal(details.getRow(1).getCell(1).font?.bold, true);
  assert.equal(details.views[0]?.state, "frozen");
  const green = details.getRow(2);
  assert.equal(green.getCell(4).value, 200.7);
  assert.equal(green.getCell(6).value, null);
  assert.equal(green.getCell(19).value, "10501");
  assert.equal(green.getCell(19).numFmt, "@");
  const swatch = green.getCell(21);
  assert.equal(swatch.value, "#00AE42");
  assert.equal(swatch.fill?.type, "pattern");
  if (swatch.fill && swatch.fill.type === "pattern") {
    assert.equal(swatch.fill.fgColor?.argb, "FF00AE42");
  }

  const missing = details.getRow(3);
  assert.equal(missing.getCell(12).value, null);
  assert.equal(missing.getCell(14).value, "unavailable");
  assert.notEqual(missing.getCell(12).value, 0);

  const colours = book.getWorksheet("Colour Summary");
  assert.ok(colours);
  const colourSwatch = colours.getRow(2).getCell(1);
  if (colourSwatch.fill && colourSwatch.fill.type === "pattern") {
    assert.equal(colourSwatch.fill.fgColor?.argb, "FF00AE42");
  }
  assert.equal(colours.getRow(2).getCell(2).value, "Bambu Lab");
});
