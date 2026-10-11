import { confidenceFromDelta, deltaE00, normalizeHex } from "./color-distance.ts";

export type CatalogueItem = {
  code: string;
  family: string;
  material: string;
  kind: string;
  name: string;
  aliases: string[];
  hexes: string[];
  rawHex?: string;
  brand?: string;
};

export type MatchConfidence = "high" | "medium" | "low";

export type ColourCandidate = {
  code: string;
  name: string;
  material: string;
  hex: string;
  deltaE: number | null;
  textScore: number;
  confidence: MatchConfidence;
  reason: string;
  priority: number;
};

let items: CatalogueItem[] = [];

export const CATALOGUE_META = {
  source: "Bambu_Lab_Filaments_Complete.xlsx",
  sourceNote: "The supplied workbook is loaded at startup. Incomplete colour codes are not guessed.",
  updated: "",
  count: 0,
  incomplete: 0,
};

export function replaceCatalogue(
  next: CatalogueItem[],
  meta?: Partial<Pick<typeof CATALOGUE_META, "source" | "sourceNote" | "updated" | "incomplete">>,
) {
  items = next;
  if (meta?.source) CATALOGUE_META.source = meta.source;
  if (meta?.sourceNote) CATALOGUE_META.sourceNote = meta.sourceNote;
  if (meta?.updated !== undefined) CATALOGUE_META.updated = meta.updated;
  CATALOGUE_META.incomplete = meta?.incomplete ?? next.filter((item) => item.hexes.length === 0).length;
  CATALOGUE_META.count = next.length;
}

export function catalogueItems(): CatalogueItem[] {
  return items;
}

export function materials(): string[] {
  return [...new Set(items.map((item) => item.material))].sort();
}

export function brands(): string[] {
  return [...new Set(items.map((item) => item.brand).filter((brand): brand is string => Boolean(brand)))].sort();
}

export function filterCatalogue(input: {
  query?: string | null;
  material?: string | null;
  brand?: string | null;
  limit?: number;
}): { items: CatalogueItem[]; total: number } {
  const query = (input.query ?? "").trim().toLowerCase();
  const hex = normalizeHex(input.query);
  const filtered = items.filter((item) => {
    if (input.material && item.material !== input.material) return false;
    if (input.brand && item.brand !== input.brand) return false;
    if (!query) return true;
    if (hex && item.hexes.some((value) => value.toUpperCase() === hex)) return true;
    const hay = [item.name, item.material, item.kind, item.code, item.brand, item.family, item.rawHex, ...item.hexes]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(query) || (hex ? hay.includes(hex.slice(1).toLowerCase()) : false);
  });
  const sorted = filtered
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.material.localeCompare(b.material) || a.code.localeCompare(b.code));
  const limit = input.limit ?? 80;
  return { items: sorted.slice(0, limit), total: sorted.length };
}

function tokenScore(query: string, item: CatalogueItem): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const names = [item.name, item.material, item.code, ...item.aliases].map((part) => part.toLowerCase());
  if (names.some((part) => part === q)) return 1;
  if (names.some((part) => part.includes(q) || q.includes(part))) return 0.72;
  const qTokens = q.split(/[^a-z0-9]+/).filter(Boolean);
  if (qTokens.length === 0) return 0;
  const hay = names.join(" ");
  const hits = qTokens.filter((token) => hay.includes(token)).length;
  return hits / qTokens.length * 0.6;
}

export function searchCatalogue(query: string, material: string | null, limit = 40): CatalogueItem[] {
  const q = query.trim().toLowerCase();
  return items
    .filter((item) => !material || item.material === material)
    .map((item) => ({ item, score: q ? tokenScore(q, item) : 1 }))
    .filter((row) => !q || row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((row) => row.item);
}

export function rankColours(input: {
  hex?: string | null;
  name?: string | null;
  code?: string | null;
  material?: string | null;
  limit?: number;
}): ColourCandidate[] {
  const hex = normalizeHex(input.hex);
  const code = input.code?.trim();
  const limit = input.limit ?? 5;
  const scored: ColourCandidate[] = [];

  for (const item of items) {
    if (input.material && item.material !== input.material && !code) {
      // still allow exact code across materials
    }
    const exactCode = Boolean(code && item.code === code);
    const text = tokenScore([input.name, input.material].filter(Boolean).join(" "), item);
    let bestDelta: number | null = null;
    let bestHex = item.hexes[0] ?? "";
    if (hex) {
      for (const candidate of item.hexes) {
        const delta = deltaE00(hex, candidate);
        if (bestDelta === null || delta < bestDelta) {
          bestDelta = delta;
          bestHex = candidate;
        }
      }
    }
    if (!exactCode && text < 0.2 && (bestDelta === null || bestDelta > 18)) continue;
    let confidence: MatchConfidence = "low";
    let reason = "Approximate colour";
    let priority = 3;
    if (exactCode) {
      confidence = "high";
      reason = "Exact product code";
      priority = 0;
    } else if (text >= 0.99) {
      confidence = "high";
      reason = "Exact colour name";
      priority = 1;
    } else if (bestDelta !== null && bestDelta <= 3) {
      confidence = "high";
      reason = "Very close sampled colour";
      priority = 2;
    } else if (text >= 0.7 || (bestDelta !== null && bestDelta <= 10)) {
      confidence = "medium";
      reason = bestDelta !== null && bestDelta <= 10 ? "Nearby catalogue colour" : "Similar name";
      priority = 4;
    } else if (bestDelta !== null) {
      confidence = confidenceFromDelta(bestDelta);
      reason = "Colour distance only";
      priority = 5;
    }
    scored.push({
      code: item.code,
      name: item.name,
      material: item.material,
      hex: bestHex,
      deltaE: bestDelta === null ? null : Math.round(bestDelta * 100) / 100,
      textScore: Math.round(text * 100) / 100,
      confidence,
      reason,
      priority,
    });
  }

  scored.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const da = a.deltaE ?? 99;
    const db = b.deltaE ?? 99;
    if (da !== db) return da - db;
    return b.textScore - a.textScore;
  });
  return scored.slice(0, limit);
}
