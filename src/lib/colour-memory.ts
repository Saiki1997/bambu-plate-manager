import type { FilamentRow } from "./project-store.ts";
import { deltaE00, normalizeHex } from "./color-distance.ts";

/** How far (CIEDE2000) a new swatch may be from a remembered one and still recall it. */
export const RECALL_TOLERANCE = 2;
const LIMIT = 500;

export type RememberedPick = {
  ocrHex: string;
  catalogueId: string | null;
  catalogueBrand: string | null;
  catalogueCode: string | null;
  catalogueName: string;
  catalogueMaterial: string | null;
  catalogueHex: string | null;
  uses: number;
  updatedAt: string;
};

export type ColourMemory = { version: 1; picks: RememberedPick[] };

export function emptyMemory(): ColourMemory {
  return { version: 1, picks: [] };
}

export function parseMemory(value: unknown): ColourMemory {
  const picks = (value as { picks?: unknown } | null)?.picks;
  if (!Array.isArray(picks)) return emptyMemory();
  return {
    version: 1,
    picks: picks.filter(
      (pick): pick is RememberedPick =>
        Boolean(pick) && typeof pick.catalogueName === "string" && normalizeHex(pick.ocrHex) !== null,
    ),
  };
}

let current = emptyMemory();
const listeners = new Set<() => void>();

export function colourMemory(): ColourMemory {
  return current;
}

export function setColourMemory(next: ColourMemory) {
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeColourMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Remember the filament chosen for a row's original swatch colour. Returns the memory unchanged when there is nothing to learn. */
export function rememberPick(memory: ColourMemory, row: FilamentRow, now = new Date().toISOString()): ColourMemory {
  const ocrHex = normalizeHex(row.ocrHex ?? row.hex);
  if (!ocrHex || !row.catalogueName) return memory;
  const previous = memory.picks.find((pick) => pick.ocrHex === ocrHex);
  const pick: RememberedPick = {
    ocrHex,
    catalogueId: row.catalogueId ?? null,
    catalogueBrand: row.catalogueBrand ?? null,
    catalogueCode: row.catalogueCode,
    catalogueName: row.catalogueName,
    catalogueMaterial: row.catalogueMaterial,
    catalogueHex: row.catalogueHex,
    uses: (previous?.uses ?? 0) + 1,
    updatedAt: now,
  };
  const rest = memory.picks.filter((item) => item.ocrHex !== ocrHex);
  return { version: 1, picks: [pick, ...rest].slice(0, LIMIT) };
}

export function forgetPick(memory: ColourMemory, ocrHex: string): ColourMemory {
  const normalized = normalizeHex(ocrHex);
  return { version: 1, picks: memory.picks.filter((pick) => pick.ocrHex !== normalized) };
}

/** The remembered pick closest to this colour, if one is within RECALL_TOLERANCE. */
export function recallPick(memory: ColourMemory, hex: string | null | undefined): RememberedPick | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  let best: RememberedPick | null = null;
  let bestDelta = Infinity;
  for (const pick of memory.picks) {
    const delta = pick.ocrHex === normalized ? 0 : deltaE00(normalized, pick.ocrHex);
    if (delta <= RECALL_TOLERANCE && delta < bestDelta) {
      best = pick;
      bestDelta = delta;
    }
  }
  return best;
}
