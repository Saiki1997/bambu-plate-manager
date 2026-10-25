import type { FilamentRow } from "./project-store.ts";
import { normalizeHex } from "./color-distance.ts";
import { catalogueItems, rankColours, type CatalogueItem, type ColourCandidate } from "./filament-match.ts";
import { colourMemory, recallPick } from "./colour-memory.ts";

/** Below this, a parsed line is not confident enough to verify a colour automatically. */
export const OCR_CONFIDENCE_FLOOR = 0.75;

export type MatchStatus = FilamentRow["matchStatus"];
export type MatchSource = NonNullable<FilamentRow["matchSource"]> | null;

export function isProtectedMatch(row: Pick<FilamentRow, "matchLocked" | "matchStatus" | "matchSource">): boolean {
  return Boolean(row.matchLocked || row.matchStatus === "manual" || row.matchSource === "manual");
}

export function matchStatusLabel(status: MatchStatus | undefined): string {
  switch (status) {
    case "manual":
      return "Manually Confirmed";
    case "accepted":
      return "Confirmed";
    case "suggested":
      return "Suggested automatically";
    case "unverified":
      return "Unverified";
    case "rejected":
      return "Cleared";
    default:
      return "";
  }
}

export function matchSourceLabel(source: FilamentRow["matchSource"], status: MatchStatus | undefined): string {
  if (source === "manual" || status === "manual") return "Manual selection";
  if (source === "remembered") return "Remembered from an earlier choice";
  if (source === "automatic" || status === "suggested" || status === "accepted") return "Automatic suggestion";
  return "";
}

export function filamentActions(row: FilamentRow): {
  choose: boolean;
  change: boolean;
  clear: boolean;
  rematch: boolean;
  confirmSuggestion: boolean;
} {
  if (row.isTotal) {
    return { choose: false, change: false, clear: false, rematch: false, confirmSuggestion: false };
  }
  const selected = Boolean(row.catalogueId || row.catalogueCode || row.catalogueName);
  const open = !selected || row.matchStatus === "unverified" || row.matchStatus === "rejected" || row.matchStatus === null;
  return {
    choose: open,
    change: selected && !open,
    clear: selected,
    rematch: true,
    confirmSuggestion: selected && row.matchStatus === "suggested" && !row.matchLocked,
  };
}

function sameColourState(row: FilamentRow, next: FilamentRow): boolean {
  return (
    row.ocrHex === next.ocrHex &&
    row.catalogueId === next.catalogueId &&
    row.catalogueBrand === next.catalogueBrand &&
    row.catalogueCode === next.catalogueCode &&
    row.catalogueName === next.catalogueName &&
    row.catalogueMaterial === next.catalogueMaterial &&
    row.catalogueHex === next.catalogueHex &&
    row.matchConfidence === next.matchConfidence &&
    row.matchStatus === next.matchStatus &&
    row.matchSource === next.matchSource &&
    row.matchLocked === next.matchLocked &&
    row.catalogueMissing === next.catalogueMissing &&
    row.catalogueChanged === next.catalogueChanged &&
    row.needsReview === next.needsReview
  );
}

function blankCatalogue(row: FilamentRow, confidence: FilamentRow["matchConfidence"]): FilamentRow {
  const next: FilamentRow = {
    ...row,
    ocrHex: row.ocrHex ?? row.hex,
    catalogueId: null,
    catalogueBrand: null,
    catalogueCode: null,
    catalogueName: null,
    catalogueMaterial: null,
    catalogueHex: null,
    matchConfidence: confidence,
    matchStatus: "unverified",
    matchSource: null,
    matchLocked: false,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: true,
  };
  return sameColourState(row, next) ? row : next;
}

function itemsForCandidate(candidate: ColourCandidate): CatalogueItem[] {
  return catalogueItems().filter(
    (item) => item.code === candidate.code && item.name === candidate.name && item.material === candidate.material,
  );
}

export function suggestColour(row: FilamentRow): FilamentRow {
  if (row.isTotal || isProtectedMatch(row)) return row;
  if (catalogueItems().length === 0) return row;
  if (!row.hex) return blankCatalogue(row, null);
  // A remembered choice comes from the swatch pixels, not the OCR text, so it is offered even on a
  // line whose text is uncertain. It stays an unlocked suggestion and keeps the line's review flag.
  const remembered = rememberedSuggestion(row);
  if (remembered) return sameColourState(row, remembered) ? row : remembered;
  if (row.confidence < OCR_CONFIDENCE_FLOOR && !row.userCorrected) return blankCatalogue(row, null);

  const ranked = rankColours({ hex: row.hex, limit: 60 });
  const highs = ranked.filter((candidate) => candidate.confidence === "high");
  if (highs.length !== 1) return blankCatalogue(row, null);
  const matches = itemsForCandidate(highs[0]);
  if (matches.length !== 1) return blankCatalogue(row, null);
  const item = matches[0];
  const next: FilamentRow = {
    ...row,
    ocrHex: row.ocrHex ?? row.hex,
    catalogueId: item.family || null,
    catalogueBrand: item.brand ?? null,
    catalogueCode: item.code || null,
    catalogueName: item.name,
    catalogueMaterial: item.material,
    catalogueHex: item.hexes[0] ?? null,
    matchConfidence: "high",
    matchStatus: "suggested",
    matchSource: "automatic",
    matchLocked: false,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: row.needsReview,
  };
  return sameColourState(row, next) ? row : next;
}

/** A suggestion from a filament the user chose before for this swatch colour, if it is still in the database. */
function rememberedSuggestion(row: FilamentRow): FilamentRow | null {
  const pick = recallPick(colourMemory(), row.ocrHex ?? row.hex);
  if (!pick) return null;
  const lookup = lookupSavedCatalogue(pick);
  if (lookup.status !== "found") return null;
  const item = lookup.item;
  return {
    ...row,
    ocrHex: row.ocrHex ?? row.hex,
    catalogueId: item.family || null,
    catalogueBrand: item.brand ?? null,
    catalogueCode: item.code || null,
    catalogueName: item.name,
    catalogueMaterial: item.material,
    catalogueHex: item.hexes[0] ?? null,
    matchConfidence: "high",
    matchStatus: "suggested",
    matchSource: "remembered",
    matchLocked: false,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: row.needsReview,
  };
}

export function possibleCatalogueMatches(hex: string | null | undefined): CatalogueItem[] {
  const normalized = normalizeHex(hex);
  if (!normalized || catalogueItems().length === 0) return [];
  const ranked = rankColours({ hex: normalized, limit: 60 }).filter(
    (candidate) => candidate.confidence === "high" || candidate.confidence === "medium",
  );
  const seen = new Set<string>();
  const matches: CatalogueItem[] = [];
  for (const candidate of ranked) {
    for (const item of itemsForCandidate(candidate)) {
      const key = `${item.family}|${item.code}|${item.material}|${item.name}|${item.rawHex ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(item);
    }
  }
  return matches;
}

export function applyManualSelection(row: FilamentRow, item: CatalogueItem): FilamentRow {
  return {
    ...row,
    ocrHex: row.ocrHex ?? row.hex,
    catalogueId: item.family || null,
    catalogueBrand: item.brand ?? null,
    catalogueCode: item.code || null,
    catalogueName: item.name,
    catalogueMaterial: item.material,
    catalogueHex: item.hexes[0] ?? null,
    matchConfidence: "high",
    matchStatus: "manual",
    matchSource: "manual",
    matchLocked: true,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: false,
    userCorrected: true,
  };
}

export function manualSelectionPatch(row: FilamentRow, item: CatalogueItem): Partial<FilamentRow> {
  const next = applyManualSelection(row, item);
  return {
    ocrHex: next.ocrHex,
    catalogueId: next.catalogueId,
    catalogueBrand: next.catalogueBrand,
    catalogueCode: next.catalogueCode,
    catalogueName: next.catalogueName,
    catalogueMaterial: next.catalogueMaterial,
    catalogueHex: next.catalogueHex,
    matchConfidence: next.matchConfidence,
    matchStatus: next.matchStatus,
    matchSource: next.matchSource,
    matchLocked: next.matchLocked,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: false,
    userCorrected: true,
  };
}

export function clearToUnverified(row: FilamentRow): FilamentRow {
  return {
    ...row,
    catalogueId: null,
    catalogueBrand: null,
    catalogueCode: null,
    catalogueName: null,
    catalogueMaterial: null,
    catalogueHex: null,
    matchConfidence: null,
    matchStatus: "unverified",
    matchSource: null,
    matchLocked: false,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: true,
  };
}

export function clearMatchPatch(): Partial<FilamentRow> {
  return {
    catalogueId: null,
    catalogueBrand: null,
    catalogueCode: null,
    catalogueName: null,
    catalogueMaterial: null,
    catalogueHex: null,
    matchConfidence: null,
    matchStatus: "unverified",
    matchSource: null,
    matchLocked: false,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: true,
    userCorrected: true,
  };
}

export function automaticMatchPatch(row: FilamentRow): Partial<FilamentRow> | null {
  if (isProtectedMatch(row)) return null;
  const next = suggestColour(row);
  if (next === row) return null;
  return {
    ocrHex: next.ocrHex,
    catalogueId: next.catalogueId ?? null,
    catalogueBrand: next.catalogueBrand ?? null,
    catalogueCode: next.catalogueCode,
    catalogueName: next.catalogueName,
    catalogueMaterial: next.catalogueMaterial,
    catalogueHex: next.catalogueHex,
    matchConfidence: next.matchConfidence,
    matchStatus: next.matchStatus,
    matchSource: next.matchSource,
    matchLocked: false,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: next.needsReview,
    userCorrected: false,
  };
}

export type CatalogueLookup =
  | { status: "found"; item: CatalogueItem }
  | { status: "missing" }
  | { status: "ambiguous" }
  | { status: "unidentified" };

export function lookupSavedCatalogue(row: Pick<FilamentRow, "catalogueId" | "catalogueCode" | "catalogueName" | "catalogueMaterial">): CatalogueLookup {
  const items = catalogueItems();
  if (items.length === 0) return { status: "unidentified" };
  if (!row.catalogueId && !row.catalogueCode && !row.catalogueName) return { status: "unidentified" };

  let pool = items;
  if (row.catalogueId) {
    pool = items.filter((item) => item.family === row.catalogueId);
    if (pool.length === 0) return { status: "missing" };
    if (pool.length === 1) return { status: "found", item: pool[0] };
  }

  const narrowed = pool.filter(
    (item) =>
      (!row.catalogueCode || item.code === row.catalogueCode) &&
      (!row.catalogueName || item.name === row.catalogueName) &&
      (!row.catalogueMaterial || item.material === row.catalogueMaterial),
  );
  if (narrowed.length === 1) return { status: "found", item: narrowed[0] };
  if (narrowed.length > 1) return { status: "ambiguous" };
  if (row.catalogueId) return { status: "missing" };
  return { status: "missing" };
}

function snapshotDiffers(row: FilamentRow, item: CatalogueItem): boolean {
  const savedHex = normalizeHex(row.catalogueHex);
  const liveHex = normalizeHex(item.hexes[0] ?? null);
  if (savedHex !== liveHex) return true;
  if ((row.catalogueName ?? "") !== item.name) return true;
  if ((row.catalogueMaterial ?? "") !== item.material) return true;
  if ((row.catalogueCode ?? "") !== (item.code || "")) return true;
  if (row.catalogueBrand && item.brand && row.catalogueBrand !== item.brand) return true;
  return false;
}

export function reviewCataloguePresence(row: FilamentRow): FilamentRow {
  if (row.isTotal) return row;
  if (!row.catalogueId && !row.catalogueCode && !row.catalogueName) return row;
  const lookup = lookupSavedCatalogue(row);
  if (lookup.status === "unidentified" || lookup.status === "ambiguous") return row;
  if (lookup.status === "missing") {
    if (row.catalogueMissing && row.needsReview && !row.catalogueChanged) return row;
    return { ...row, catalogueMissing: true, catalogueChanged: false, needsReview: true };
  }
  if (snapshotDiffers(row, lookup.item)) {
    if (row.catalogueChanged && row.needsReview && !row.catalogueMissing) return row;
    return { ...row, catalogueChanged: true, catalogueMissing: false, needsReview: true };
  }
  if (!row.catalogueMissing && !row.catalogueChanged) return row;
  const settled = row.matchStatus === "manual" || row.matchStatus === "accepted";
  return {
    ...row,
    catalogueMissing: false,
    catalogueChanged: false,
    needsReview: settled ? false : row.needsReview,
  };
}

export function normalizeRow(row: FilamentRow & { slot?: string }): FilamentRow {
  const matchStatus = row.matchStatus ?? null;
  const matchSource =
    row.matchSource ??
    (matchStatus === "manual" ? "manual" : matchStatus === "suggested" || matchStatus === "accepted" ? "automatic" : null);
  const { slot: legacySlot, ...rest } = row;
  return {
    ...rest,
    filamentId: row.filamentId ?? legacySlot ?? "",
    catalogueId: row.catalogueId ?? null,
    catalogueBrand: row.catalogueBrand ?? null,
    ocrHex: row.ocrHex ?? row.hex,
    matchSource,
    matchStatus,
    catalogueMissing: row.catalogueMissing ?? false,
    catalogueChanged: row.catalogueChanged ?? false,
  };
}
