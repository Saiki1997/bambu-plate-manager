import { useEffect, useState } from "react";
import type { FilamentRow } from "@/lib/project-store";
import { normalizeHex } from "@/lib/color-distance";
import { filamentActions, matchStatusLabel } from "@/lib/manual-match";

export function shownHex(row: FilamentRow): string | null {
  if ((row.matchStatus === "manual" || row.matchStatus === "accepted" || row.matchStatus === "suggested") && row.catalogueHex) {
    return row.catalogueHex;
  }
  return row.hex;
}

export function ColourField({
  row,
  onCommit,
  onAccept,
  onClear,
  onChoose,
  onRematch,
}: {
  row: FilamentRow;
  onCommit: (hex: string | null) => void;
  onAccept: () => void;
  onClear: () => void;
  onChoose: () => void;
  onRematch: () => void;
}) {
  const [text, setText] = useState(row.hex ?? "");
  useEffect(() => setText(row.hex ?? ""), [row.hex]);
  const actions = filamentActions(row);
  const swatch = shownHex(row);
  const status = matchStatusLabel(row.matchStatus);
  const ocr = normalizeHex(row.ocrHex ?? row.hex);
  const selectedHex = normalizeHex(row.catalogueHex);
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="size-5 shrink-0 rounded-sm border border-border" style={{ background: swatch ?? "transparent" }} />
        <span className="font-mono text-xs">{swatch ?? "Unverified"}</span>
        {status && <span className="text-xs text-muted">{status}</span>}
      </div>
      {row.catalogueName && (
        <p className="mt-1 text-xs text-muted">
          {row.catalogueName}
          {row.catalogueMaterial ? ` · ${row.catalogueMaterial}` : ""}
          {row.catalogueCode ? ` · ${row.catalogueCode}` : ""}
          {row.catalogueBrand ? ` · ${row.catalogueBrand}` : ""}
        </p>
      )}
      {ocr && selectedHex && ocr !== selectedHex && <p className="font-mono text-xs text-muted">OCR {ocr}</p>}
      {row.catalogueMissing && (
        <p className="text-xs text-primary">This saved record is not in the current database. The selection was kept.</p>
      )}
      {row.catalogueChanged && (
        <p className="text-xs text-primary">This database record changed. The saved selection was kept.</p>
      )}
      <label className="mt-1 flex items-center gap-2 text-xs text-muted">
        OCR
        <input
          aria-label="Original OCR hex"
          value={text}
          placeholder="Unverified"
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            const next = text.trim();
            if (!next) onCommit(null);
            else if (/^#[0-9a-fA-F]{6}$/.test(next)) onCommit(next.toLowerCase());
            else setText(row.hex ?? "");
          }}
          className="w-24 bg-transparent font-mono text-xs text-fg outline-none"
        />
      </label>
      {!row.isTotal && (
        <div className="mt-1 flex flex-wrap gap-1">
          {actions.choose && (
            <button type="button" onClick={onChoose} className="min-h-11 rounded-md border border-primary px-2 text-xs text-primary">
              Choose from Filament Database
            </button>
          )}
          {actions.change && (
            <button type="button" onClick={onChoose} className="min-h-11 rounded-md border border-border px-2 text-xs">
              Change selected filament
            </button>
          )}
          {actions.confirmSuggestion && (
            <button type="button" onClick={onAccept} className="min-h-11 rounded-md border border-border px-2 text-xs text-primary">
              Lock suggestion
            </button>
          )}
          {actions.clear && (
            <button type="button" onClick={onClear} className="min-h-11 rounded-md border border-border px-2 text-xs text-muted">
              Clear
            </button>
          )}
          {actions.rematch && (
            <button type="button" onClick={onRematch} className="min-h-11 rounded-md border border-border px-2 text-xs text-muted">
              Re-run automatic matching
            </button>
          )}
        </div>
      )}
    </div>
  );
}
