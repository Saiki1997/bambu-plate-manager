import type { FilamentRow, Project } from "./project-store.ts";
import type { Usage } from "./parse-slicing.ts";
import { normalizeHex } from "./color-distance.ts";
import { rgbOf } from "./utils.ts";
import { desktopApi } from "./desktop.ts";
import { matchSourceLabel, matchStatusLabel } from "./manual-match.ts";
import { emptyPrices, emptyStock, filamentTotals, summarizeTotals, type PriceBook, type StockBook } from "./filament-totals.ts";

export type Costing = { prices: PriceBook; stock: StockBook };

export type ExportReport = {
  plates: number;
  rows: number;
  uniqueColours: number;
  totalGrams: number | null;
  unmatched: number;
  lowOcr: number;
  uncertainMatch: number;
  missingColour: number;
};

const DETAIL_HEADERS = [
  "Project",
  "Plate",
  "Filament ID",
  "Model g",
  "Model m",
  "Support g",
  "Support m",
  "Purged g",
  "Purged m",
  "Tower g",
  "Tower m",
  "Total g",
  "Total m",
  "Usage",
  "Original OCR colour",
  "Original OCR RGB",
  "Selected filament name",
  "Selected material",
  "Selected product code",
  "Selected hexadecimal colour",
  "Swatch",
  "Match confidence",
  "Match status",
  "Notes",
  "Match source",
  "Database id",
  "Brand",
  "Selected colour name",
] as const;

function includedLines(project: Project): FilamentRow[] {
  return project.rows.filter((row) => row.include && !row.isTotal);
}

function plateLabel(project: Project, plateId: string | null): string {
  if (!plateId) return "Project total";
  return project.plates.find((plate) => plate.id === plateId)?.label ?? "";
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) return null;
  return Math.round(known.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

export function exportReport(project: Project): ExportReport {
  const lines = includedLines(project);
  const colours = new Set(lines.map((row) => normalizeHex(row.catalogueHex) || normalizeHex(row.hex)).filter(Boolean));
  return {
    plates: project.plates.filter((plate) => plate.reviewStatus !== "excluded").length,
    rows: lines.length,
    uniqueColours: colours.size,
    totalGrams: sumKnown(lines.map((row) => row.total.grams)),
    unmatched: lines.filter((row) => {
      const identified = Boolean(row.catalogueCode || row.catalogueName || row.catalogueId);
      if (row.matchStatus === "manual" || row.matchStatus === "accepted") return !identified;
      if (row.matchStatus === "suggested") return !identified;
      return true;
    }).length,
    lowOcr: lines.filter((row) => row.needsReview || row.confidence < 0.75).length,
    uncertainMatch: lines.filter((row) => row.matchStatus === "suggested" || row.matchStatus === "unverified").length,
    missingColour: lines.filter((row) => !normalizeHex(row.hex) && !normalizeHex(row.catalogueHex)).length,
  };
}

function argb(hex: string): string {
  return `FF${hex.slice(1).toUpperCase()}`;
}

function contrast(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 150 ? "FF1A1406" : "FFF4F1EA";
}

type Worksheet = import("exceljs").Worksheet;
type Cell = import("exceljs").Cell;

function writeAmount(cell: Cell, value: number | null) {
  if (value === null) {
    cell.value = null;
    return;
  }
  cell.value = value;
  cell.numFmt = "0.00";
}

function writePair(row: import("exceljs").Row, start: number, usage: Usage | null) {
  writeAmount(row.getCell(start), usage?.grams ?? null);
  writeAmount(row.getCell(start + 1), usage?.meters ?? null);
}

function paintSwatch(cell: Cell, hex: string | null) {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    cell.value = null;
    return;
  }
  cell.value = normalized;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(normalized) } };
  cell.font = { color: { argb: contrast(normalized) }, name: "Calibri" };
}

function paintHeader(sheet: Worksheet, columns: number) {
  const header = sheet.getRow(1);
  header.font = { bold: true, name: "Calibri", color: { argb: "FF1A1406" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2A21A" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 22;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(sheet.rowCount, 1), column: columns },
  };
}

function noteFor(row: FilamentRow): string {
  const notes: string[] = [];
  if (row.catalogueMissing) notes.push("Saved filament record is missing from the current database");
  if (row.catalogueChanged) notes.push("Saved filament record differs from the current database");
  if (row.needsReview && row.matchStatus !== "unverified") notes.push("OCR needs review");
  if (row.matchStatus === "unverified") notes.push("Colour unverified");
  if (row.matchStatus === "manual") notes.push("Manually confirmed");
  else if (row.matchStatus === "accepted") notes.push("Match locked by user");
  else if (!row.catalogueCode && !row.catalogueName) notes.push("Catalogue match not confirmed");
  if (row.userCorrected && row.matchStatus !== "manual") notes.push("Edited by user");
  if (row.total.grams === null && row.total.meters === null) notes.push("Usage unavailable");
  return notes.join("; ");
}

export async function buildWorkbook(project: Project, costing: Costing = { prices: emptyPrices(), stock: emptyStock() }): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Bambu Plate Manager";
  book.created = new Date();
  const report = exportReport(project);
  const lines = includedLines(project);
  const totals = filamentTotals(project, costing.prices, costing.stock);
  const totalsSummary = summarizeTotals(totals);
  const currency = costing.prices.currency;

  const summary = book.addWorksheet("Project Summary");
  const facts: Array<[string, string | number | null]> = [
    ["Project", project.name],
    ["Exported", new Date().toISOString()],
    ["Plates", report.plates],
    ["Filament entries", report.rows],
    ["Unique colours", report.uniqueColours],
    ["Estimated filament, grams", report.totalGrams],
    ["Unmatched entries", report.unmatched],
    ["Lines needing OCR review", report.lowOcr],
    ["Uncertain colour matches", report.uncertainMatch],
    ["Missing colour", report.missingColour],
    [currency ? `Estimated filament cost, ${currency}` : "Estimated filament cost", totalsSummary.cost],
    ["Filaments without a price", totalsSummary.unpriced],
    ["Filaments short on the spool", totalsSummary.short],
  ];
  summary.getCell("A1").value = "Bambu Plate Manager";
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF1A1406" } };
  summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2A21A" } };
  summary.mergeCells("A1:B1");
  facts.forEach((fact, index) => {
    const row = summary.getRow(index + 3);
    row.getCell(1).value = fact[0];
    row.getCell(1).font = { bold: true };
    if (typeof fact[1] === "number") {
      row.getCell(2).value = fact[1];
      if (fact[0].includes("grams") || fact[0].includes("cost")) row.getCell(2).numFmt = "0.00";
    } else if (fact[1] === null) {
      row.getCell(2).value = "unavailable";
    } else {
      row.getCell(2).value = fact[1];
    }
  });
  const noteRow = facts.length + 5;
  summary.getCell(`A${noteRow}`).value =
    "Empty cells were not visible in the screenshot. Weights are OCR readings, not calculated estimates. The colour swatch uses the selected database colour when one was confirmed, otherwise the sampled screenshot colour. The original OCR colour is kept in its own column. Manually confirmed rows are not labelled as automatic matches. Product codes are not hexadecimal values.";
  summary.getCell(`A${noteRow}`).alignment = { wrapText: true };
  summary.mergeCells(`A${noteRow}:B${noteRow}`);
  summary.getRow(noteRow).height = 48;
  summary.getColumn(1).width = 32;
  summary.getColumn(2).width = 42;

  const details = book.addWorksheet("Filament Details");
  details.addRow([...DETAIL_HEADERS]);
  for (const row of lines) {
    const excelRow = details.addRow([
      project.name,
      plateLabel(project, row.plateId),
      row.filamentId || null,
    ]);
    writePair(excelRow, 4, row.model);
    writePair(excelRow, 6, row.support);
    writePair(excelRow, 8, row.purged);
    writePair(excelRow, 10, row.tower);
    writePair(excelRow, 12, row.total);
    const usageMissing = row.total.grams === null && row.total.meters === null;
    excelRow.getCell(14).value = usageMissing ? "unavailable" : null;
    const ocr = normalizeHex(row.ocrHex) ?? normalizeHex(row.hex);
    excelRow.getCell(15).value = ocr;
    excelRow.getCell(16).value = ocr ? rgbOf(ocr) : null;
    excelRow.getCell(17).value = row.catalogueName || null;
    excelRow.getCell(18).value = row.catalogueMaterial || null;
    const code = excelRow.getCell(19);
    code.value = row.catalogueCode || null;
    code.numFmt = "@";
    excelRow.getCell(20).value = normalizeHex(row.catalogueHex);
    paintSwatch(excelRow.getCell(21), row.catalogueHex || row.hex);
    excelRow.getCell(22).value = row.matchConfidence;
    excelRow.getCell(23).value = matchStatusLabel(row.matchStatus) || null;
    excelRow.getCell(24).value = noteFor(row) || null;
    excelRow.getCell(25).value = matchSourceLabel(row.matchSource, row.matchStatus) || null;
    const databaseId = excelRow.getCell(26);
    databaseId.value = row.catalogueId || null;
    databaseId.numFmt = "@";
    excelRow.getCell(27).value = row.catalogueBrand || null;
    excelRow.getCell(28).value = row.catalogueName || null;
  }
  details.columns = DETAIL_HEADERS.map((header) => ({
    width: header === "Notes" || header.includes("name") || header.includes("colour") ? 36 : Math.max(12, header.length + 2),
  }));
  paintHeader(details, DETAIL_HEADERS.length);

  const colourSheet = book.addWorksheet("Colour Summary");
  colourSheet.addRow(["Swatch", "Brand", "Colour", "Material", "HEX", "Product code", "Count", "Total grams", "Total metres"]);
  const groups = new Map<
    string,
    { name: string; material: string; hex: string; code: string; brand: string; count: number; grams: Array<number | null>; meters: Array<number | null> }
  >();
  for (const row of lines) {
    const hex = normalizeHex(row.catalogueHex) || normalizeHex(row.hex);
    if (!hex) continue;
    const key = `${row.catalogueCode ?? ""}|${hex}`;
    const current = groups.get(key) ?? {
      name: row.catalogueName || "Unmatched sample",
      material: row.catalogueMaterial || "",
      hex,
      code: row.catalogueCode || "",
      brand: row.catalogueBrand || (row.catalogueCode ? "Bambu Lab" : ""),
      count: 0,
      grams: [],
      meters: [],
    };
    current.count += 1;
    current.grams.push(row.total.grams);
    current.meters.push(row.total.meters);
    groups.set(key, current);
  }
  for (const item of groups.values()) {
    const excelRow = colourSheet.addRow([
      item.hex,
      item.brand || null,
      item.name,
      item.material || null,
      item.hex,
      item.code || null,
      item.count,
    ]);
    excelRow.getCell(6).numFmt = "@";
    paintSwatch(excelRow.getCell(1), item.hex);
    const grams = sumKnown(item.grams);
    const meters = sumKnown(item.meters);
    if (grams === null) excelRow.getCell(8).value = "unavailable";
    else writeAmount(excelRow.getCell(8), grams);
    if (meters === null) excelRow.getCell(9).value = "unavailable";
    else writeAmount(excelRow.getCell(9), meters);
  }
  colourSheet.columns = [14, 16, 28, 18, 14, 16, 12, 16, 16].map((width) => ({ width }));
  paintHeader(colourSheet, 9);

  const totalsSheet = book.addWorksheet("Filament Totals");
  totalsSheet.addRow([
    "Swatch",
    "Brand",
    "Filament",
    "Material",
    "Product code",
    "Confirmed",
    "Lines",
    "Total grams",
    "Total metres",
    currency ? `Price per kg, ${currency}` : "Price per kg",
    currency ? `Cost, ${currency}` : "Cost",
    "On spool, grams",
    "Short by, grams",
  ]);
  for (const total of totals) {
    const excelRow = totalsSheet.addRow([
      total.hex,
      total.brand,
      total.name,
      total.material,
      total.code,
      total.confirmed ? "yes" : "no",
      total.lines,
    ]);
    paintSwatch(excelRow.getCell(1), total.hex);
    excelRow.getCell(5).numFmt = "@";
    writeAmount(excelRow.getCell(8), total.grams);
    writeAmount(excelRow.getCell(9), total.meters);
    writeAmount(excelRow.getCell(10), total.perKg);
    writeAmount(excelRow.getCell(11), total.cost);
    writeAmount(excelRow.getCell(12), total.stock);
    writeAmount(excelRow.getCell(13), total.shortBy);
  }
  totalsSheet.columns = [14, 14, 28, 18, 14, 11, 8, 13, 13, 14, 12, 15, 15].map((width) => ({ width }));
  paintHeader(totalsSheet, 13);

  const plates = book.addWorksheet("Plates");
  plates.addRow(["Plate", "Prepare", "Print", "Total", "Status"]);
  for (const plate of project.plates) {
    plates.addRow([
      plate.label,
      plate.prepareTime,
      plate.printTime,
      plate.totalTime,
      plate.reviewStatus === "excluded" ? "excluded" : plate.reviewStatus,
    ]);
  }
  plates.columns = [18, 16, 16, 16, 14].map((width) => ({ width }));
  paintHeader(plates, 5);

  const bytes = await book.xlsx.writeBuffer();
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function downloadWorkbook(project: Project, costing?: Costing) {
  const blob = await buildWorkbook(project, costing);
  const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plates";
  const filename = `${safe}.xlsx`;
  const api = desktopApi();
  if (api) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await api.saveExport(filename, bytes);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
