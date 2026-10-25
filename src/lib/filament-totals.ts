import type { FilamentRow, Project } from "./project-store.ts";
import { normalizeHex } from "./color-distance.ts";

export type PriceBook = {
  currency: string;
  /** Used for any filament without its own price. */
  defaultPerKg: number | null;
  perKg: Record<string, number>;
};

export type StockBook = {
  /** Grams left on the spool, by filament key. */
  grams: Record<string, number>;
};

export type FilamentTotal = {
  key: string;
  name: string;
  material: string | null;
  code: string | null;
  brand: string | null;
  hex: string | null;
  confirmed: boolean;
  lines: number;
  grams: number | null;
  meters: number | null;
  perKg: number | null;
  cost: number | null;
  stock: number | null;
  shortBy: number | null;
};

export type TotalsSummary = {
  grams: number | null;
  cost: number | null;
  /** Filaments with grams but no price, so the cost leaves them out. */
  unpriced: number;
  short: number;
};

export function emptyPrices(): PriceBook {
  return { currency: "", defaultPerKg: null, perKg: {} };
}

export function emptyStock(): StockBook {
  return { grams: {} };
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0,
    ),
  );
}

export function parsePrices(value: unknown): PriceBook {
  const raw = (value ?? {}) as Partial<PriceBook>;
  const fallback = typeof raw.defaultPerKg === "number" && Number.isFinite(raw.defaultPerKg) ? raw.defaultPerKg : null;
  return {
    currency: typeof raw.currency === "string" ? raw.currency.slice(0, 8) : "",
    defaultPerKg: fallback,
    perKg: numberRecord(raw.perKg),
  };
}

export function parseStock(value: unknown): StockBook {
  return { grams: numberRecord((value as Partial<StockBook> | null)?.grams) };
}

/** A key that stays the same for one filament across projects. Null when the line has no colour at all. */
export function filamentKey(row: Pick<FilamentRow, "catalogueId" | "catalogueCode" | "catalogueName" | "catalogueMaterial" | "hex" | "ocrHex">): string | null {
  if (row.catalogueName) {
    return `db:${row.catalogueId ?? ""}|${row.catalogueCode ?? ""}|${row.catalogueName}|${row.catalogueMaterial ?? ""}`;
  }
  const hex = normalizeHex(row.ocrHex ?? row.hex);
  return hex ? `hex:${hex}` : null;
}

function add(a: number | null, b: number | null): number | null {
  if (b === null) return a;
  return Math.round(((a ?? 0) + b) * 100) / 100;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Grams and metres per filament across the included lines, with cost and stock when known. */
export function filamentTotals(project: Project, prices: PriceBook = emptyPrices(), stock: StockBook = emptyStock()): FilamentTotal[] {
  const groups = new Map<string, FilamentTotal>();
  for (const row of project.rows) {
    if (row.isTotal || !row.include) continue;
    const key = filamentKey(row) ?? "unknown";
    const confirmed = row.matchStatus === "manual" || row.matchStatus === "accepted";
    const current =
      groups.get(key) ??
      ({
        key,
        name: row.catalogueName || (key === "unknown" ? "No colour read" : "Unmatched colour"),
        material: row.catalogueMaterial || null,
        code: row.catalogueCode || null,
        brand: row.catalogueBrand || null,
        hex: normalizeHex(row.catalogueHex) ?? normalizeHex(row.ocrHex ?? row.hex),
        confirmed,
        lines: 0,
        grams: null,
        meters: null,
        perKg: null,
        cost: null,
        stock: null,
        shortBy: null,
      } satisfies FilamentTotal);
    current.lines += 1;
    current.confirmed = current.confirmed && confirmed;
    current.grams = add(current.grams, row.total.grams);
    current.meters = add(current.meters, row.total.meters);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((total) => {
      const perKg = total.key === "unknown" ? prices.defaultPerKg : (prices.perKg[total.key] ?? prices.defaultPerKg);
      const cost = perKg !== null && total.grams !== null ? round((total.grams / 1000) * perKg) : null;
      const inStock = stock.grams[total.key] ?? null;
      const shortBy = inStock !== null && total.grams !== null && total.grams > inStock ? round(total.grams - inStock) : inStock !== null ? 0 : null;
      return { ...total, perKg, cost, stock: inStock, shortBy };
    })
    .sort((a, b) => (b.grams ?? -1) - (a.grams ?? -1));
}

export function summarizeTotals(totals: FilamentTotal[]): TotalsSummary {
  let grams: number | null = null;
  let cost: number | null = null;
  let unpriced = 0;
  let short = 0;
  for (const total of totals) {
    grams = add(grams, total.grams);
    cost = add(cost, total.cost);
    if (total.grams !== null && total.cost === null) unpriced += 1;
    if (total.shortBy) short += 1;
  }
  return { grams, cost, unpriced, short };
}

/** Stock after this project prints. Filaments without a stock figure are left out. */
export function deductFromStock(stock: StockBook, totals: FilamentTotal[]): StockBook {
  const grams = { ...stock.grams };
  for (const total of totals) {
    if (grams[total.key] === undefined || total.grams === null) continue;
    grams[total.key] = round(Math.max(0, grams[total.key] - total.grams));
  }
  return { grams };
}

export function formatMoney(value: number | null, currency: string): string {
  if (value === null) return "—";
  return `${currency}${currency && !/[^\w]$/.test(currency) ? " " : ""}${value.toFixed(2)}`;
}
