import type { FilamentRow, Project } from "./project-store.ts";

export type StepId = "import" | "review" | "match" | "export";
export type StepState = "done" | "current" | "todo";

export type WorkflowStep = {
  id: StepId;
  label: string;
  state: StepState;
  /** Short line under the label, such as "3 to check". */
  detail: string;
};

function lines(project: Project): FilamentRow[] {
  return project.rows.filter((row) => row.include && !row.isTotal);
}

/** An OCR reading the user still has to look at. */
export function needsOcrCheck(row: FilamentRow): boolean {
  return !row.isTotal && row.include && row.needsReview && row.matchStatus !== "unverified";
}

/** A colour that is not confirmed by the user or locked. */
export function needsColourChoice(row: FilamentRow): boolean {
  return !row.isTotal && row.include && row.matchStatus !== "manual" && row.matchStatus !== "accepted";
}

export function needsAttention(row: FilamentRow): boolean {
  return needsOcrCheck(row) || needsColourChoice(row);
}

export function attentionCounts(project: Project): { ocr: number; colour: number; total: number } {
  const included = lines(project);
  const ocr = included.filter(needsOcrCheck).length;
  const colour = included.filter(needsColourChoice).length;
  return { ocr, colour, total: included.filter(needsAttention).length };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function workflowSteps(project: Project): WorkflowStep[] {
  const imported = project.images.length > 0;
  const hasLines = lines(project).length > 0;
  const counts = attentionCounts(project);
  const exported = Boolean(project.exportedAt && project.exportedAt >= project.updatedAt);

  const done: Record<StepId, boolean> = {
    import: imported,
    review: imported && hasLines && counts.ocr === 0,
    match: imported && hasLines && counts.colour === 0,
    export: exported,
  };
  const detail: Record<StepId, string> = {
    import: imported ? plural(project.images.length, "screenshot") : "Add a screenshot",
    review: !hasLines ? "Nothing read yet" : counts.ocr ? `${plural(counts.ocr, "reading")} to check` : "Readings checked",
    match: !hasLines ? "Nothing to match" : counts.colour ? `${plural(counts.colour, "colour")} to confirm` : "Colours confirmed",
    export: exported ? "Workbook saved" : project.exportedAt ? "Changed since export" : "Save the workbook",
  };
  const labels: Record<StepId, string> = { import: "Import", review: "Review", match: "Match", export: "Export" };
  const order: StepId[] = ["import", "review", "match", "export"];
  const current = order.find((id) => !done[id]) ?? null;
  return order.map((id) => ({
    id,
    label: labels[id],
    state: done[id] ? "done" : id === current ? "current" : "todo",
    detail: detail[id],
  }));
}

/** The next row needing attention after `afterId`, wrapping round to the start. */
export function nextAttentionRow(rows: FilamentRow[], afterId: string | null): FilamentRow | null {
  const start = afterId ? rows.findIndex((row) => row.id === afterId) : -1;
  for (let offset = 1; offset <= rows.length; offset += 1) {
    const row = rows[(start + offset + rows.length) % rows.length];
    if (needsAttention(row)) return row;
  }
  return null;
}
