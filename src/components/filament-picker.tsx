import { useEffect, useMemo, useRef, useState } from "react";
import type { FilamentRow } from "@/lib/project-store";
import { normalizeHex } from "@/lib/color-distance";
import { brands, filterCatalogue, materials, CATALOGUE_META, type CatalogueItem } from "@/lib/filament-match";
import { possibleCatalogueMatches } from "@/lib/manual-match";
import { cn } from "@/lib/utils";

function itemKey(item: CatalogueItem, index: number): string {
  return `${item.family}|${item.code}|${item.material}|${item.name}|${item.rawHex ?? ""}|${index}`;
}

export function FilamentPicker({
  row,
  catalogueTick,
  onCancel,
  onConfirm,
}: {
  row: FilamentRow | null;
  catalogueTick: number;
  onCancel: () => void;
  onConfirm: (item: CatalogueItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState("");
  const [brand, setBrand] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const possibles = useMemo(() => (row ? possibleCatalogueMatches(row.ocrHex ?? row.hex) : []), [row, catalogueTick]);
  const filtered = useMemo(
    () => filterCatalogue({ query, material: material || null, brand: brand || null, limit: 80 }),
    [query, material, brand, catalogueTick],
  );
  const pending = useMemo(() => {
    if (!pendingKey) return null;
    return [...possibles, ...filtered.items].find((item, index) => itemKey(item, index) === pendingKey) ?? null;
  }, [pendingKey, possibles, filtered.items]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (!row) return null;
  const ocr = normalizeHex(row.ocrHex ?? row.hex);
  const brandNames = brands();

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-bg/80 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="filament-picker-title" className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-md border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h2 id="filament-picker-title" className="text-base font-medium">Choose from Filament Database</h2>
          <p className="mt-1 text-sm text-muted">
            {CATALOGUE_META.count} records from the supplied workbook. Nothing is assigned until you confirm.
            {ocr ? ` Original OCR colour ${ocr}.` : " No OCR colour was read."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, colour, material, code, or hex"
            aria-label="Search filament database"
            className="min-h-11 min-w-48 flex-1 rounded-md border border-border bg-bg px-3 text-sm outline-none focus:border-primary"
          />
          <select
            aria-label="Filter by material type"
            value={material}
            onChange={(event) => setMaterial(event.target.value)}
            className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm"
          >
            <option value="">All materials</option>
            {materials().map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {brandNames.length > 0 && (
            <select
              aria-label="Filter by brand"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              className="min-h-11 rounded-md border border-border bg-bg px-3 text-sm"
            >
              <option value="">All brands</option>
              {brandNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
          {possibles.length > 0 && (
            <section>
              <h3 className="text-sm font-medium">Possible matches</h3>
              <p className="mt-1 text-xs text-muted">Separate database rows. The closest colour is not selected for you.</p>
              <ul className="mt-2 space-y-2">
                {possibles.map((item, index) => (
                  <FilamentChoice
                    key={itemKey(item, index)}
                    item={item}
                    pressed={pendingKey === itemKey(item, index)}
                    onSelect={() => setPendingKey(itemKey(item, index))}
                  />
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="text-sm font-medium">Database</h3>
            <p className="mt-1 text-xs text-muted">
              Showing {filtered.items.length} of {filtered.total} from the supplied workbook.
            </p>
            {filtered.items.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No filaments in the supplied database match that search.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {filtered.items.map((item, index) => (
                  <FilamentChoice
                    key={itemKey(item, index + possibles.length)}
                    item={item}
                    pressed={pendingKey === itemKey(item, index + possibles.length)}
                    onSelect={() => setPendingKey(itemKey(item, index + possibles.length))}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="border-t border-border px-4 py-3">
          {pending ? (
            <div className="mb-3 flex items-center gap-3">
              <span className="size-10 shrink-0 rounded-md border border-border" style={{ background: pending.hexes[0] ?? "transparent" }} />
              {ocr && (
                <span className="size-10 shrink-0 rounded-md border border-border" style={{ background: ocr }} title={`OCR ${ocr}`} />
              )}
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{pending.brand || "Unknown brand"} · {pending.name}</p>
                <p className="truncate text-xs text-muted">
                  {pending.material || "No material"} · {pending.code || "no code"} · {pending.hexes[0] ?? pending.rawHex ?? "no colour"} · id {pending.family || "none"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mb-3 text-sm text-muted">Select a record to preview it. Cancel leaves this filament line unchanged.</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="min-h-11 rounded-md border border-border px-3 text-sm">
              Cancel
            </button>
            <button
              type="button"
              disabled={!pending}
              onClick={() => pending && onConfirm(pending)}
              className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg disabled:opacity-40"
            >
              Confirm selection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilamentChoice({
  item,
  pressed,
  onSelect,
}: {
  item: CatalogueItem;
  pressed: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={pressed}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-md border p-2 text-left",
          pressed ? "border-primary bg-bg" : "border-border bg-bg",
        )}
      >
        <span className="size-8 shrink-0 rounded-md border border-border" style={{ background: item.hexes[0] ?? "transparent" }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {item.brand || "Unknown brand"} · {item.name}
          </span>
          <span className="block truncate font-mono text-xs text-muted">
            {item.material || "No material"} · {item.kind || "no type"} · {item.code || "no code"} · {item.hexes[0] ?? item.rawHex ?? "no colour"} · id {item.family || "none"}
          </span>
        </span>
      </button>
    </li>
  );
}
