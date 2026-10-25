import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ParsedDocument, Usage } from "./parse-slicing.ts";
import { isProtectedMatch, normalizeRow, reviewCataloguePresence, suggestColour } from "./manual-match.ts";

export type SourceImage = {
  id: string;
  name: string;
  width: number;
  height: number;
  hash: string;
  layout: ParsedDocument["layout"];
  cost: string | null;
  filamentChanges: string | null;
  warnings: string[];
  ocrText: string;
  importedAt: string;
};

export type Plate = {
  id: string;
  imageId: string | null;
  label: string;
  prepareTime: string | null;
  printTime: string | null;
  totalTime: string | null;
  reviewStatus: "pending" | "reviewed" | "excluded";
  needsReview: boolean;
  confidence: number;
};

export type FilamentRow = {
  id: string;
  imageId: string;
  plateId: string | null;
  /** Bambu Studio filament index shown beside the colour swatch. Not an AMS slot. */
  filamentId: string;
  include: boolean;
  isTotal: boolean;
  wide: boolean;
  model: Usage;
  support: Usage;
  purged: Usage | null;
  tower: Usage | null;
  total: Usage;
  hex: string | null;
  hexSource: "sampled" | "user" | null;
  catalogueCode: string | null;
  catalogueName: string | null;
  catalogueMaterial: string | null;
  catalogueHex: string | null;
  catalogueId?: string | null;
  catalogueBrand?: string | null;
  /** Sampled or OCR colour, kept even after a manual database selection. */
  ocrHex?: string | null;
  matchConfidence: "high" | "medium" | "low" | null;
  matchLocked: boolean;
  matchStatus: "suggested" | "accepted" | "rejected" | "unverified" | "manual" | null;
  matchSource?: "automatic" | "manual" | null;
  catalogueMissing?: boolean;
  catalogueChanged?: boolean;
  confidence: number;
  needsReview: boolean;
  userCorrected: boolean;
  raw: string;
  y0: number | null;
  y1: number | null;
};

export type Project = {
  id: string;
  name: string;
  updatedAt: string;
  images: SourceImage[];
  plates: Plate[];
  rows: FilamentRow[];
  /** When a workbook was last exported. Compared with updatedAt to tell whether it is stale. */
  exportedAt?: string | null;
};

type State = {
  project: Project;
  past: Project[];
  undo: () => void;
  rename: (name: string) => void;
  reset: () => void;
  ingest: (input: {
    name: string;
    hash: string;
    width: number;
    height: number;
    parsed: ParsedDocument;
    swatches: Array<string | null>;
  }) => string;
  patchRow: (id: string, patch: Partial<FilamentRow>) => void;
  patchPlate: (id: string, patch: Partial<Plate>) => void;
  removeRow: (id: string) => void;
  addRow: (imageId: string | null) => void;
  addPlate: () => void;
  suggestAll: () => { matched: number; skipped: number; unverified: number };
  reviewLocks: () => void;
  mergeDuplicates: () => number;
  loadProject: (project: Project) => void;
  markExported: () => void;
};

function uid(): string {
  return crypto.randomUUID();
}

function emptyUsage(): Usage {
  return { meters: null, grams: null };
}

export function blankProject(): Project {
  return {
    id: uid(),
    name: "Untitled plate set",
    updatedAt: new Date().toISOString(),
    images: [],
    plates: [],
    rows: [],
  };
}

export function normalizeProject(project: Project): Project {
  return { ...project, rows: project.rows.map((row) => normalizeRow(row)) };
}

export function suggestProjectRows(rows: FilamentRow[]): {
  rows: FilamentRow[];
  matched: number;
  skipped: number;
  unverified: number;
} {
  let matched = 0;
  let skipped = 0;
  let unverified = 0;
  const next = rows.map((row) => {
    if (row.isTotal) return row;
    if (isProtectedMatch(row)) {
      skipped += 1;
      return reviewCataloguePresence(row);
    }
    const suggested = suggestColour(row);
    if (suggested !== row && suggested.matchStatus === "suggested") matched += 1;
    if (suggested.matchStatus === "unverified") unverified += 1;
    return suggested;
  });
  return { rows: next, matched, skipped, unverified };
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.round((a + b) * 100) / 100;
}

function addUsage(a: Usage, b: Usage | null): Usage {
  if (!b) return a;
  return { grams: addNullable(a.grams, b.grams), meters: addNullable(a.meters, b.meters) };
}

export function mergeFilamentRows(rows: FilamentRow[]): { rows: FilamentRow[]; removed: number } {
  const kept: FilamentRow[] = [];
  const indexByKey = new Map<string, number>();
  let removed = 0;
  for (const row of rows) {
    const keyColour = row.catalogueCode || row.hex;
    const key = !row.isTotal && row.include && keyColour ? `${row.plateId ?? ""}|${keyColour}` : "";
    if (!key) {
      kept.push(row);
      continue;
    }
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, kept.length);
      kept.push(row);
      continue;
    }
    const target = kept[existing];
    kept[existing] = {
      ...target,
      model: addUsage(target.model, row.model),
      support: addUsage(target.support, row.support),
      purged: target.purged || row.purged ? addUsage(target.purged ?? { grams: null, meters: null }, row.purged) : null,
      tower: target.tower || row.tower ? addUsage(target.tower ?? { grams: null, meters: null }, row.tower) : null,
      total: addUsage(target.total, row.total),
      needsReview: target.needsReview || row.needsReview,
      wide: target.wide || row.wide,
    };
    removed += 1;
  }
  return { rows: kept, removed };
}

function nextPlateLabel(plates: Plate[]): string {
  const numbers = plates
    .map((plate) => /^Plate (\d+)$/.exec(plate.label)?.[1])
    .filter((value): value is string => !!value)
    .map(Number);
  const n = numbers.length ? Math.max(...numbers) + 1 : 1;
  return `Plate ${n}`;
}

function rowFromParsed(
  parsedRow: ParsedDocument["rows"][number],
  imageId: string,
  plateId: string | null,
  hex: string | null,
): FilamentRow {
  return {
    id: uid(),
    imageId,
    plateId,
    filamentId: parsedRow.filamentId ?? "",
    include: !parsedRow.isTotal,
    isTotal: parsedRow.isTotal,
    wide: parsedRow.wide,
    model: parsedRow.model ?? emptyUsage(),
    support: parsedRow.support ?? emptyUsage(),
    purged: parsedRow.purged,
    tower: parsedRow.tower,
    total: parsedRow.total ?? emptyUsage(),
    hex,
    hexSource: hex ? "sampled" : null,
    ocrHex: hex,
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
    confidence: parsedRow.confidence,
    needsReview: parsedRow.needsReview,
    userCorrected: false,
    raw: parsedRow.raw,
    y0: parsedRow.y0,
    y1: parsedRow.y1,
  };
}

export function ingestParsed(
  project: Project,
  input: {
    name: string;
    hash: string;
    width: number;
    height: number;
    parsed: ParsedDocument;
    swatches: Array<string | null>;
  },
): { project: Project; status: string } {
  if (project.images.some((image) => image.hash === input.hash)) {
    return { project, status: "That screenshot is already in this set." };
  }

  const imageId = uid();
  const warnings = [...input.parsed.warnings];
  const plates = [...project.plates];
  const plateIds: string[] = [];

  if (input.parsed.layout === "single-plate") {
    const incoming = input.parsed.plates[0];
    const match = incoming?.totalTime
      ? plates.find(
          (plate) => plate.totalTime === incoming.totalTime && plate.reviewStatus !== "excluded",
        )
      : undefined;
    if (match) {
      plateIds.push(match.id);
      warnings.push(
        `Total time ${incoming.totalTime} matches ${match.label}. Rows were attached there instead of creating a second plate.`,
      );
    } else {
      const id = uid();
      plateIds.push(id);
      plates.push({
        id,
        imageId,
        label: nextPlateLabel(plates),
        prepareTime: incoming?.prepareTime ?? input.parsed.prepareTime,
        printTime: incoming?.printTime ?? input.parsed.printTime,
        totalTime: incoming?.totalTime ?? input.parsed.projectDuration,
        reviewStatus: "pending",
        needsReview: incoming?.needsReview ?? !input.parsed.projectDuration,
        confidence: incoming?.confidence ?? 0.5,
      });
    }
  } else {
    for (const incoming of input.parsed.plates) {
      const match = plates.find(
        (plate) =>
          plate.label === incoming.label &&
          plate.totalTime &&
          plate.totalTime === incoming.totalTime,
      );
      if (match) {
        plateIds.push(match.id);
        warnings.push(`${incoming.label} is already recorded with the same time, so it was not added twice.`);
        continue;
      }
      const id = uid();
      plateIds.push(id);
      plates.push({
        id,
        imageId,
        label: incoming.label,
        prepareTime: incoming.prepareTime,
        printTime: incoming.printTime,
        totalTime: incoming.totalTime,
        reviewStatus: "pending",
        needsReview: incoming.needsReview,
        confidence: incoming.confidence,
      });
    }
  }

  const singlePlateId = input.parsed.layout === "single-plate" ? plateIds[0] ?? null : null;
  const rows = [
    ...project.rows,
    ...input.parsed.rows.map((row, index) =>
      suggestColour(rowFromParsed(row, imageId, row.isTotal ? null : singlePlateId, input.swatches[index] ?? null)),
    ),
  ];

  const image: SourceImage = {
    id: imageId,
    name: input.name,
    width: input.width,
    height: input.height,
    hash: input.hash,
    layout: input.parsed.layout,
    cost: input.parsed.cost,
    filamentChanges: input.parsed.filamentChanges,
    warnings: [...new Set(warnings)],
    ocrText: input.parsed.ocrText,
    importedAt: new Date().toISOString(),
  };

  const layoutLabel =
    input.parsed.layout === "multi-plate-summary"
      ? `${input.parsed.plates.length} plates in a summary`
      : input.parsed.layout === "single-plate"
        ? "1 plate"
        : "no plate table";

  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      images: [...project.images, image],
      plates,
      rows,
    },
    status: `Read ${input.name}: ${layoutLabel}, ${input.parsed.rows.filter((row) => !row.isTotal).length} filament line${input.parsed.rows.filter((row) => !row.isTotal).length === 1 ? "" : "s"}.`,
  };
}

function commit(project: Project, past: Project[]): { project: Project; past: Project[] } {
  return {
    project: { ...project, updatedAt: new Date().toISOString() },
    past: [...past, project].slice(-25),
  };
}

export const useProjectStore = create<State>()(
  persist(
    (set, get) => ({
      project: blankProject(),
      past: [],
      undo: () => {
        const { past } = get();
        const previous = past.at(-1);
        if (!previous) return;
        set({ project: previous, past: past.slice(0, -1) });
      },
      rename: (name) => set((state) => ({ project: { ...state.project, name } })),
      reset: () => set({ project: blankProject(), past: [] }),
      ingest: (input) => {
        const { project, past } = get();
        const result = ingestParsed(project, input);
        if (result.project !== project) set(commit(result.project, past));
        return result.status;
      },
      patchRow: (id, patch) => {
        const { project, past } = get();
        set(
          commit(
            {
              ...project,
              rows: project.rows.map((row) => {
                if (row.id !== id) return row;
                const edited = patch.userCorrected !== false;
                return {
                  ...row,
                  ...patch,
                  userCorrected: edited ? true : row.userCorrected,
                  needsReview: patch.needsReview !== undefined ? patch.needsReview : edited ? false : row.needsReview,
                  confidence: edited && patch.confidence === undefined ? 1 : (patch.confidence ?? row.confidence),
                };
              }),
            },
            past,
          ),
        );
      },
      patchPlate: (id, patch) => {
        const { project, past } = get();
        set(
          commit(
            {
              ...project,
              plates: project.plates.map((plate) => (plate.id === id ? { ...plate, ...patch } : plate)),
            },
            past,
          ),
        );
      },
      removeRow: (id) => {
        const { project, past } = get();
        set(commit({ ...project, rows: project.rows.filter((row) => row.id !== id) }, past));
      },
      addRow: (imageId) => {
        const { project, past } = get();
        const image = imageId ?? project.images.at(-1)?.id ?? null;
        if (!image) return;
        const plateId = project.plates.find((plate) => plate.reviewStatus !== "excluded")?.id ?? null;
        const row: FilamentRow = {
          id: uid(),
          imageId: image,
          plateId,
          filamentId: "",
          include: true,
          isTotal: false,
          wide: project.rows.some((item) => item.wide),
          model: emptyUsage(),
          support: emptyUsage(),
          purged: emptyUsage(),
          tower: emptyUsage(),
          total: emptyUsage(),
          hex: null,
          hexSource: null,
          ocrHex: null,
          catalogueCode: null,
          catalogueName: null,
          catalogueMaterial: null,
          catalogueHex: null,
          catalogueId: null,
          catalogueBrand: null,
          matchConfidence: null,
          matchLocked: false,
          matchStatus: "unverified",
          matchSource: null,
          catalogueMissing: false,
          catalogueChanged: false,
          confidence: 1,
          needsReview: true,
          userCorrected: true,
          raw: "",
          y0: null,
          y1: null,
        };
        set(commit({ ...project, rows: [...project.rows, row] }, past));
      },
      addPlate: () => {
        const { project, past } = get();
        const plate: Plate = {
          id: uid(),
          imageId: project.images.at(-1)?.id ?? null,
          label: nextPlateLabel(project.plates),
          prepareTime: null,
          printTime: null,
          totalTime: null,
          reviewStatus: "pending",
          needsReview: true,
          confidence: 1,
        };
        set(commit({ ...project, plates: [...project.plates, plate] }, past));
      },
      suggestAll: () => {
        const { project, past } = get();
        const result = suggestProjectRows(project.rows);
        const changed = result.rows.some((row, index) => row !== project.rows[index]);
        if (changed) set(commit({ ...project, rows: result.rows }, past));
        return { matched: result.matched, skipped: result.skipped, unverified: result.unverified };
      },
      reviewLocks: () => {
        const project = get().project;
        let changed = false;
        const rows = project.rows.map((row) => {
          if (row.isTotal || (!row.catalogueId && !row.catalogueCode && !row.catalogueName)) return row;
          const next = reviewCataloguePresence(row);
          if (next !== row) changed = true;
          return next;
        });
        if (changed) set({ project: { ...project, rows, updatedAt: new Date().toISOString() } });
      },
      mergeDuplicates: () => {
        const { project, past } = get();
        const merged = mergeFilamentRows(project.rows);
        if (merged.removed === 0) return 0;
        set(commit({ ...project, rows: merged.rows }, past));
        return merged.removed;
      },
      loadProject: (next) => {
        const now = new Date().toISOString();
        const fresh = Boolean(next.exportedAt && next.exportedAt >= next.updatedAt);
        set({ project: { ...normalizeProject(next), updatedAt: now, exportedAt: fresh ? now : (next.exportedAt ?? null) }, past: [] });
      },
      markExported: () => {
        const project = get().project;
        set({ project: { ...project, exportedAt: new Date().toISOString() } });
      },
    }),
    {
      name: "plate-ledger",
      partialize: (state) => ({ project: state.project }),
      merge: (persisted, current) => {
        const saved = persisted as { project?: Project } | undefined;
        if (!saved?.project) return current;
        return { ...current, project: normalizeProject(saved.project) };
      },
    },
  ),
);
