import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatMoney, summarizeTotals, type FilamentTotal, type PriceBook } from "@/lib/filament-totals";
import { formatAmount } from "@/lib/utils";
import { AmountField } from "./usage-cell";

export function TotalsView({
  totals,
  prices,
  onPrices,
  onStock,
  onDeduct,
}: {
  totals: FilamentTotal[];
  prices: PriceBook;
  onPrices: (next: PriceBook) => void;
  onStock: (key: string, grams: number | null) => void;
  onDeduct: () => void;
}) {
  const summary = summarizeTotals(totals);
  const tracked = totals.some((total) => total.stock !== null && total.grams !== null);
  const [currency, setCurrency] = useState(prices.currency);
  const [confirmDeduct, setConfirmDeduct] = useState(false);
  useEffect(() => setCurrency(prices.currency), [prices.currency]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-medium">Filament totals</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Grams and metres per filament across every included line. Set a price per kg to see the cost, and the grams left on each spool
          to see whether there is enough. Prices and stock are kept in the portable data folder for later projects.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Filament" value={summary.grams === null ? "—" : `${formatAmount(summary.grams)} g`} />
        <Stat
          label="Estimated cost"
          value={formatMoney(summary.cost, prices.currency)}
          note={summary.unpriced ? `${summary.unpriced} filament${summary.unpriced === 1 ? " has" : "s have"} no price` : undefined}
        />
        <Stat
          label="Spool stock"
          value={!tracked ? "Not tracked" : summary.short ? `${summary.short} short` : "Enough"}
          warn={summary.short > 0}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Currency</span>
          <input
            value={currency}
            maxLength={8}
            placeholder="e.g. RM or $"
            onChange={(event) => setCurrency(event.target.value)}
            onBlur={() => currency !== prices.currency && onPrices({ ...prices, currency: currency.trim() })}
            className="min-h-11 w-28 rounded-md border border-border bg-bg px-2 outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Default price per kg</span>
          <span className="min-h-11 w-32 rounded-md border border-border bg-bg px-1 py-1.5">
            <AmountField value={prices.defaultPerKg} label="Default price per kg" onCommit={(value) => onPrices({ ...prices, defaultPerKg: value })} />
          </span>
        </label>
        <p className="max-w-sm text-xs text-muted">Used for any filament without its own price below.</p>
      </div>

      {totals.length === 0 ? (
        <p className="text-sm text-muted">No included filament lines yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Filament</th>
                <th className="px-2 py-2 text-right font-medium">Lines</th>
                <th className="px-2 py-2 text-right font-medium">Grams</th>
                <th className="px-2 py-2 text-right font-medium">Metres</th>
                <th className="px-2 py-2 text-right font-medium">Price / kg</th>
                <th className="px-2 py-2 text-right font-medium">Cost</th>
                <th className="px-2 py-2 text-right font-medium">On spool g</th>
                <th className="px-2 py-2 font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((total) => (
                <tr key={total.key} className="border-t border-border">
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="size-5 shrink-0 rounded-sm border border-border" style={{ background: total.hex ?? "transparent" }} />
                      <span className="min-w-0">
                        <span className="block truncate">{total.name}</span>
                        <span className="block truncate font-mono text-xs text-muted">
                          {[total.material, total.code, total.confirmed ? null : "not confirmed"].filter(Boolean).join(" · ") || total.hex || ""}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{total.lines}</td>
                  <td className="px-2 py-2 text-right font-mono">{total.grams === null ? "—" : formatAmount(total.grams)}</td>
                  <td className="px-2 py-2 text-right font-mono">{total.meters === null ? "—" : formatAmount(total.meters)}</td>
                  <td className="px-2 py-2">
                    {total.key === "unknown" ? (
                      <span className="block text-right text-xs text-muted">default</span>
                    ) : (
                      <AmountField
                        value={prices.perKg[total.key] ?? null}
                        label={`Price per kg for ${total.name}`}
                        placeholder={prices.defaultPerKg === null ? "set" : formatAmount(prices.defaultPerKg)}
                        boxed
                        onCommit={(value) => {
                          const perKg = { ...prices.perKg };
                          if (value === null) delete perKg[total.key];
                          else perKg[total.key] = value;
                          onPrices({ ...prices, perKg });
                        }}
                      />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono">{formatMoney(total.cost, prices.currency)}</td>
                  <td className="px-2 py-2">
                    {total.key === "unknown" ? (
                      <span className="block text-right text-xs text-muted">—</span>
                    ) : (
                      <AmountField value={total.stock} label={`Grams on spool for ${total.name}`} placeholder="—" boxed onCommit={(value) => onStock(total.key, value)} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">
                    {total.shortBy === null ? (
                      <span className="text-muted">—</span>
                    ) : total.shortBy > 0 ? (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <AlertTriangle className="size-3.5" />
                        Short {formatAmount(total.shortBy)} g
                      </span>
                    ) : (
                      <span className="text-muted">Enough</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tracked &&
        (confirmDeduct ? (
          <div className="rounded-md border border-border bg-surface p-3 text-sm">
            <p>Subtract this project's grams from the spool stock? Use this after the print is done. Undo does not reverse it.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onDeduct();
                  setConfirmDeduct(false);
                }}
                className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg"
              >
                Subtract from stock
              </button>
              <button type="button" onClick={() => setConfirmDeduct(false)} className="min-h-11 rounded-md border border-border px-3 text-sm">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDeduct(true)} className="min-h-11 text-sm text-primary">
            Printed it? Subtract these grams from spool stock
          </button>
        ))}
    </section>
  );
}

function Stat({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={warn ? "mt-1 font-mono text-lg text-primary" : "mt-1 font-mono text-lg"}>{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}
