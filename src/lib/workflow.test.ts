import assert from "node:assert/strict";
import test from "node:test";
import { attentionCounts, nextAttentionRow, workflowSteps } from "./workflow.ts";
import { fixtureProject, fixtureRow } from "./test-fixtures.ts";
import type { SourceImage } from "./project-store.ts";

const image = { id: "img", name: "a.png" } as SourceImage;

test("an empty project starts at import", () => {
  const steps = workflowSteps(fixtureProject());
  assert.deepEqual(
    steps.map((step) => step.state),
    ["current", "todo", "todo", "todo"],
  );
});

test("open OCR readings and unconfirmed colours keep review and match current", () => {
  const project = fixtureProject({
    images: [image],
    rows: [
      fixtureRow({ id: "a", needsReview: true, matchStatus: "suggested", matchLocked: false }),
      fixtureRow({ id: "b" }),
      fixtureRow({ id: "c", matchStatus: "unverified", needsReview: true, matchLocked: false }),
    ],
  });
  const counts = attentionCounts(project);
  assert.equal(counts.ocr, 1, "an unverified colour is a colour task, not an OCR task");
  assert.equal(counts.colour, 2);
  assert.equal(counts.total, 2);
  const steps = workflowSteps(project);
  assert.equal(steps[0].state, "done");
  assert.equal(steps[1].state, "current");
  assert.equal(steps[1].detail, "1 reading to check");
  assert.equal(steps[2].detail, "2 colours to confirm");
});

test("excluded lines and total rows do not need attention", () => {
  const project = fixtureProject({
    images: [image],
    rows: [
      fixtureRow({ id: "a", include: false, matchStatus: "unverified" }),
      fixtureRow({ id: "t", isTotal: true, include: false, matchStatus: null }),
      fixtureRow({ id: "b", matchStatus: "manual" }),
    ],
  });
  assert.equal(attentionCounts(project).total, 0);
  assert.deepEqual(
    workflowSteps(project).map((step) => step.state),
    ["done", "done", "done", "current"],
  );
});

test("export is done only while the workbook is newer than the last edit", () => {
  const base = { images: [image], rows: [fixtureRow()] };
  const fresh = workflowSteps(fixtureProject({ ...base, exportedAt: "2026-01-02T00:00:00.000Z" }));
  assert.equal(fresh[3].state, "done");
  const stale = workflowSteps(fixtureProject({ ...base, updatedAt: "2026-01-03T00:00:00.000Z", exportedAt: "2026-01-02T00:00:00.000Z" }));
  assert.equal(stale[3].state, "current");
  assert.equal(stale[3].detail, "Changed since export");
});

test("next row wraps round and skips settled lines", () => {
  const rows = [
    fixtureRow({ id: "a", matchStatus: "unverified" }),
    fixtureRow({ id: "b" }),
    fixtureRow({ id: "c", needsReview: true }),
  ];
  assert.equal(nextAttentionRow(rows, null)?.id, "a");
  assert.equal(nextAttentionRow(rows, "a")?.id, "c");
  assert.equal(nextAttentionRow(rows, "c")?.id, "a");
  assert.equal(nextAttentionRow([fixtureRow()], null), null);
  assert.equal(nextAttentionRow([], null), null);
});
