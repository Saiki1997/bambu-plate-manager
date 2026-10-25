import { Check } from "lucide-react";
import type { StepId, WorkflowStep } from "@/lib/workflow";
import { cn } from "@/lib/utils";

export function StepBar({ steps, onStep }: { steps: WorkflowStep[]; onStep: (id: StepId) => void }) {
  return (
    <nav aria-label="Progress" className="border-b border-border">
      <ol className="mx-auto grid max-w-6xl grid-cols-2 gap-2 px-4 py-2 sm:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onStep(step.id)}
              aria-current={step.state === "current" ? "step" : undefined}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-md border px-2 py-1 text-left",
                step.state === "current" ? "border-primary bg-surface" : "border-transparent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
                  step.state === "done" && "border-primary bg-primary text-primary-fg",
                  step.state === "current" && "border-primary text-primary",
                  step.state === "todo" && "border-border text-muted",
                )}
              >
                {step.state === "done" ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm", step.state === "todo" ? "text-muted" : "text-fg")}>{step.label}</span>
                <span className="block truncate text-xs text-muted">{step.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+O", "Add screenshots"],
  ["Ctrl+V", "Paste a screenshot"],
  ["Ctrl+M", "Match colours"],
  ["N", "Jump to the next line to check"],
  ["Ctrl+Z", "Undo"],
  ["Ctrl+E", "Export workbook"],
  ["?", "Show these shortcuts"],
  ["Esc", "Close a dialog"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-bg/80 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-md border border-border bg-surface p-4"
      >
        <h2 id="shortcuts-title" className="text-base font-medium">Keyboard shortcuts</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="flex items-center justify-between gap-3">
              <dt className="text-muted">{action}</dt>
              <dd>
                <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-border px-3 text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
