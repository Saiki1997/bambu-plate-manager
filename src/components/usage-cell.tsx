import { useEffect, useState } from "react";
import type { Usage } from "@/lib/parse-slicing";
import { formatAmount, parseAmount } from "@/lib/utils";

function AmountField({
  value,
  label,
  onCommit,
}: {
  value: number | null;
  label: string;
  onCommit: (next: number | null) => void;
}) {
  const [text, setText] = useState(formatAmount(value));
  useEffect(() => setText(formatAmount(value)), [value]);
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = parseAmount(text);
        if (next !== value) onCommit(next);
      }}
      className="w-full min-w-16 rounded-md border border-transparent bg-transparent px-1 py-1 text-right font-mono text-sm text-fg outline-none focus:border-border focus:bg-surface"
    />
  );
}

export function UsageCell({
  usage,
  label,
  onCommit,
}: {
  usage: Usage | null;
  label: string;
  onCommit: (next: Usage) => void;
}) {
  if (!usage) return <span className="text-muted">—</span>;
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-end gap-1">
        <AmountField
          value={usage.grams}
          label={`${label} grams`}
          onCommit={(grams) => onCommit({ ...usage, grams })}
        />
        <span className="text-xs text-muted">g</span>
      </div>
      <div className="flex items-baseline justify-end gap-1">
        <AmountField
          value={usage.meters}
          label={`${label} metres`}
          onCommit={(meters) => onCommit({ ...usage, meters })}
        />
        <span className="text-xs text-muted">m</span>
      </div>
    </div>
  );
}
