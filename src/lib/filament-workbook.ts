import * as XLSX from "xlsx";
import { replaceCatalogue, type CatalogueItem } from "./filament-match.ts";
import { desktopApi } from "./desktop.ts";
import { previewPathPrefix } from "./preview-path-prefix.ts";

export type ParsedWorkbook = {
  items: CatalogueItem[];
  incomplete: number;
};

function publicUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined" && window.location.protocol === "file:") return `.${normalized}`;
  const prefix =
    typeof window === "undefined"
      ? ""
      : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
  return `${prefix}${normalized}`;
}

function asBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

export function parseFilamentWorkbook(data: ArrayBuffer | Uint8Array): ParsedWorkbook {
  const workbook = XLSX.read(asBytes(data), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { items: [], incomplete: 0 };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  let incomplete = 0;
  const items: CatalogueItem[] = rows.map((row) => {
    const color = String(row.Color ?? "").trim();
    const coded = /^(.*)\((\d{4,6})\)\s*$/.exec(color);
    const name = (coded?.[1] ?? color).trim();
    const code = coded?.[2] ?? "";
    const rawHex = String(row.RGB ?? "").trim();
    const valid = /^#[0-9A-Fa-f]{6}$/.test(rawHex);
    if (!valid) incomplete += 1;
    const material = String(row.Material ?? "").trim();
    const type = String(row.Type ?? "").trim();
    return {
      code,
      family: String(row.ID ?? ""),
      material: [material, type].filter(Boolean).join(" "),
      kind: type,
      name,
      aliases: [],
      hexes: valid ? [rawHex.toUpperCase()] : [],
      rawHex,
      brand: String(row.Brand ?? "").trim(),
    };
  });
  return { items, incomplete };
}

let loading: Promise<void> | null = null;

export function ensureCatalogue(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const api = desktopApi();
      const bytes = api
        ? await api.readCatalogue()
        : await fetch(publicUrl("/filaments/Bambu_Lab_Filaments_Complete.xlsx")).then((response) => {
            if (!response.ok) throw new Error("The supplied filament workbook could not be loaded.");
            return response.arrayBuffer();
          });
      const parsed = parseFilamentWorkbook(bytes);
      if (parsed.items.length === 0) throw new Error("The supplied filament workbook has no rows.");
      replaceCatalogue(parsed.items, {
        source: "Bambu_Lab_Filaments_Complete.xlsx",
        sourceNote:
          "The supplied workbook is the catalogue. Incomplete colour codes are kept as written and are not guessed.",
        incomplete: parsed.incomplete,
      });
    })().catch((error) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}
