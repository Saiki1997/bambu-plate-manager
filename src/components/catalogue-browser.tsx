import type { FilamentRow } from "@/lib/project-store";
import { materials, CATALOGUE_META, type CatalogueItem } from "@/lib/filament-match";

export function CatalogueBrowser({
  query,
  material,
  hits,
  activeRow,
  onQuery,
  onMaterial,
  onUse,
}: {
  query: string;
  material: string;
  hits: CatalogueItem[];
  activeRow: FilamentRow | null;
  onQuery: (value: string) => void;
  onMaterial: (value: string) => void;
  onUse: (item: CatalogueItem) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-medium">Bambu Lab filament colours</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {CATALOGUE_META.count} colours from the supplied Bambu Lab workbook. Product codes such as 10501 are not hexadecimal colours.
          {CATALOGUE_META.incomplete > 0
            ? ` ${CATALOGUE_META.incomplete} colour codes in that workbook are incomplete and are left unchanged.`
            : ""}
          {activeRow ? " Choosing a colour manually confirms it and keeps the OCR colour." : " Select a ledger line before choosing a colour."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search name or code"
          aria-label="Search filament catalogue"
          className="min-h-11 min-w-48 flex-1 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
        />
        <select
          aria-label="Filter by material"
          value={material}
          onChange={(event) => onMaterial(event.target.value)}
          className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">All materials</option>
          {materials().map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {hits.map((item, index) => (
          <li key={`${item.family}-${item.code}-${item.material}-${index}`} className="flex items-center gap-3 rounded-md border border-border bg-surface p-2">
            <span className="size-8 shrink-0 rounded-md border border-border" style={{ background: item.hexes[0] ?? "transparent" }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{item.name}</span>
              <span className="block truncate font-mono text-xs text-muted">
                {item.material} · {item.code || "no code"} · {item.hexes[0] ?? item.rawHex ?? "no colour"}
              </span>
            </span>
            <button type="button" onClick={() => onUse(item)} className="min-h-11 shrink-0 rounded-md border border-border px-2 text-xs">
              Use
            </button>
          </li>
        ))}
      </ul>
      {hits.length === 0 && <p className="text-sm text-muted">No catalogue colours match that search.</p>}
    </section>
  );
}
