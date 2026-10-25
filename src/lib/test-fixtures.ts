import type { FilamentRow, Project } from "./project-store.ts";

export function fixtureRow(patch: Partial<FilamentRow> = {}): FilamentRow {
  return {
    id: "a",
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

export function fixtureProject(patch: Partial<Project> = {}): Project {
  return {
    id: "p",
    name: "Test",
    updatedAt: "2026-01-01T00:00:00.000Z",
    images: [],
    plates: [],
    rows: [],
    ...patch,
  };
}
