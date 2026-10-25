import { useEffect, useState } from "react";
import type { ExportReport } from "@/lib/export-xlsx";

export function ExportDialog({
  report,
  onCancel,
  onExport,
  onReview,
}: {
  report: ExportReport;
  onCancel: () => void;
  onExport: () => void;
  onReview: () => void;
}) {
  const [ack, setAck] = useState(false);
  const hasIssues = report.unmatched > 0 || report.lowOcr > 0 || report.uncertainMatch > 0 || report.missingColour > 0;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const issues = [
    [report.unmatched, "without a confirmed catalogue match"],
    [report.lowOcr, "with low-confidence or incomplete OCR"],
    [report.uncertainMatch, "unverified colours or unlocked suggestions"],
    [report.missingColour, "missing both a sample and a catalogue colour"],
  ] as const;

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-bg/80 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="export-title" className="w-full max-w-lg rounded-md border border-border bg-surface p-4">
        <h2 id="export-title" className="text-base font-medium">Export workbook</h2>
        <p className="mt-1 text-sm text-muted">
          {report.rows} filament {report.rows === 1 ? "row" : "rows"} across {report.plates} {report.plates === 1 ? "plate" : "plates"}.
          {report.totalGrams === null ? " Total grams unavailable." : ` About ${report.totalGrams.toFixed(2)} g where a weight was read.`}
        </p>
        {hasIssues ? (
          <ul className="mt-3 space-y-1 text-sm">
            {issues
              .filter(([count]) => count > 0)
              .map(([count, text]) => (
                <li key={text} className="flex gap-2">
                  <span className="w-8 shrink-0 text-right font-mono text-primary">{count}</span>
                  {text}
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm">Every line is read and every colour is confirmed.</p>
        )}
        <p className="mt-3 text-sm text-muted">
          The file has Project Summary, Filament Details, Colour Summary, and Plates. Swatches are cell fills. Empty weights stay empty.
        </p>
        {hasIssues && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} className="mt-1 size-4 accent-primary" />
            I have reviewed the uncertain rows and still want this workbook.
          </label>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {hasIssues && (
            <button type="button" onClick={onReview} className="mr-auto min-h-11 rounded-md border border-primary px-3 text-sm text-primary">
              Review open lines
            </button>
          )}
          <button type="button" onClick={onCancel} className="min-h-11 rounded-md border border-border px-3 text-sm">
            Back
          </button>
          <button
            type="button"
            disabled={hasIssues && !ack}
            onClick={onExport}
            className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg disabled:opacity-40"
          >
            Download workbook
          </button>
        </div>
      </div>
    </div>
  );
}
