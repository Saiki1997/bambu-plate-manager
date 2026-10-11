import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import {
  AlertTriangle,
  Download,
  ImagePlus,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { deleteImageBlob, getImageBlob, putImageBlob } from "@/lib/image-db";
import { readScreenshot, type OcrProgress } from "@/lib/ocr-client";
import type { Usage } from "@/lib/parse-slicing";
import { downloadWorkbook, exportReport } from "@/lib/export-xlsx";
import { createArchive, downloadBlob, readArchive, restoreArchiveImages } from "@/lib/archive";
import {
  useProjectStore,
  type FilamentRow,
} from "@/lib/project-store";
import { cn, formatAmount, parseAmount } from "@/lib/utils";
import { searchCatalogue, materials, brands, filterCatalogue, CATALOGUE_META, type CatalogueItem } from "@/lib/filament-match";
import { ensureCatalogue } from "@/lib/filament-workbook";
import { desktopApi, type DesktopInfo } from "@/lib/desktop";
import { normalizeHex } from "@/lib/color-distance";
import {
  automaticMatchPatch,
  clearMatchPatch,
  filamentActions,
  isProtectedMatch,
  manualSelectionPatch,
  matchStatusLabel,
  possibleCatalogueMatches,
  suggestColour,
} from "@/lib/manual-match";

type Filter = "all" | "review";

function asset(path: string): string {
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${prefix}${path}`;
}

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

function UsageCell({
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

export function PlateApp() {
  const project = useProjectStore((state) => state.project);
  const past = useProjectStore((state) => state.past);
  const undo = useProjectStore((state) => state.undo);
  const rename = useProjectStore((state) => state.rename);
  const reset = useProjectStore((state) => state.reset);
  const ingest = useProjectStore((state) => state.ingest);
  const patchRow = useProjectStore((state) => state.patchRow);
  const patchPlate = useProjectStore((state) => state.patchPlate);
  const removeRow = useProjectStore((state) => state.removeRow);
  const addRow = useProjectStore((state) => state.addRow);
  const addPlate = useProjectStore((state) => state.addPlate);
  const suggestAll = useProjectStore((state) => state.suggestAll);
  const mergeDuplicates = useProjectStore((state) => state.mergeDuplicates);
  const loadProject = useProjectStore((state) => state.loadProject);

  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [view, setView] = useState<"ledger" | "catalogue">("ledger");
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [picking, setPicking] = useState(false);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [catalogueTick, setCatalogueTick] = useState(0);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = project.images.find((image) => image.id === selectedId) ?? project.images.at(-1) ?? null;

  useEffect(() => {
    let cancel = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const image of project.images) {
        const blob = await getImageBlob(image.id);
        if (cancel) return;
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        created.push(url);
        next[image.id] = url;
      }
      if (!cancel) setUrls(next);
    })();
    return () => {
      cancel = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [project.images]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  useEffect(() => {
    void ensureCatalogue()
      .then(() => {
        setCatalogueTick((value) => value + 1);
        useProjectStore.getState().reviewLocks();
      })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "The filament workbook could not be loaded."));
  }, []);

  useEffect(() => {
    const persist = useProjectStore.persist;
    const review = () => useProjectStore.getState().reviewLocks();
    if (persist.hasHydrated()) review();
    return persist.onFinishHydration(review);
  }, []);

  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    let cancel = false;
    const persist = useProjectStore.persist;
    const hydrate = async () => {
      const info = await api.info();
      if (cancel) return;
      setDesktopInfo(info);
      const saved = await api.loadSession();
      if (cancel) return;
      if (saved.project) {
        useProjectStore.getState().loadProject(saved.project);
        useProjectStore.getState().reviewLocks();
        for (const image of saved.images) {
          const bytes = await api.readImage(image.id);
          if (!bytes) continue;
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          await putImageBlob(image.id, new Blob([copy], { type: image.type || "image/png" }));
        }
        if (saved.missingImages.length > 0) {
          setStatus(`${saved.missingImages.length} screenshot${saved.missingImages.length === 1 ? " is" : "s are"} missing from the portable data folder.`);
        }
      }
    };
    const start = persist.hasHydrated() ? hydrate() : new Promise<void>((resolve) => persist.onFinishHydration(() => void hydrate().then(resolve)));
    void start;
    let timer = 0;
    const unsub = useProjectStore.subscribe((state, previous) => {
      if (state.project === previous.project) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void api.saveSession(state.project);
      }, 250);
    });
    const flush = () => api.flushSession(useProjectStore.getState().project);
    window.addEventListener("beforeunload", flush);
    return () => {
      cancel = true;
      unsub();
      window.clearTimeout(timer);
      window.removeEventListener("beforeunload", flush);
    };
  }, []);

  const wide = project.rows.some((row) => row.wide);
  const visibleRows = useMemo(
    () =>
      project.rows.filter((row) => {
        if (filter === "review" && !row.needsReview) return false;
        if (selected && row.imageId !== selected.id) return false;
        return true;
      }),
    [project.rows, filter, selected],
  );

  const reviewCount = project.rows.filter((row) => row.needsReview).length;
  const filamentCount = project.rows.filter((row) => !row.isTotal).length;

  async function consume(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name));
    if (images.length === 0) {
      setStatus("Choose a PNG or JPEG screenshot.");
      return;
    }
    cancelRef.current = false;
    setBusy(true);
    try {
      for (const file of images) {
        if (cancelRef.current) break;
        setProgress({ done: 0, total: 1, label: file.name });
        const blob = file.slice(0, file.size, file.type || "image/png");
        const hash = await hashBlob(blob);
        const result = await readScreenshot(blob, setProgress, () => cancelRef.current);
        if (cancelRef.current) break;
        const message = ingest({
          name: file.name,
          hash,
          width: result.width,
          height: result.height,
          parsed: result.parsed,
          swatches: result.swatches,
        });
        const stored = useProjectStore.getState().project.images.find((image) => image.hash === hash);
        if (stored && !message.startsWith("That screenshot")) {
          await putImageBlob(stored.id, blob);
          const api = desktopApi();
          if (api) {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            await api.saveImage({ id: stored.id, name: file.name, type: blob.type || "image/png", data: bytes });
          }
          setSelectedId(stored.id);
        }
        setStatus(message);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The screenshot could not be read.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function loadSamples() {
    setStatus(null);
    const files: File[] = [];
    for (const [path, name] of [
      ["/samples/single-plate.png", "single-plate.png"],
      ["/samples/multi-plate.png", "multi-plate.png"],
    ] as const) {
      const response = await fetch(asset(path));
      if (!response.ok) throw new Error("Sample screenshots are unavailable.");
      const blob = await response.blob();
      files.push(new File([blob], name, { type: "image/png" }));
    }
    await consume(files);
  }

  function matchColours() {
    const { matched, skipped, unverified } = suggestAll();
    setStatus(
      `Automatic matching suggested ${matched} colour${matched === 1 ? "" : "s"}. ${skipped} locked or manually confirmed match${skipped === 1 ? "" : "es"} left unchanged. ${unverified} unverified.`,
    );
    setView("ledger");
  }

  const report = useMemo(() => exportReport(project), [project]);
  const activeRow = project.rows.find((row) => row.id === activeRowId && !row.isTotal) ?? null;
  const hasExportIssues = report.unmatched > 0 || report.lowOcr > 0 || report.uncertainMatch > 0 || report.missingColour > 0;

  const catalogueHits = useMemo(
    () => (view === "catalogue" ? searchCatalogue(query, material || null, 48) : []),
    [view, query, material, catalogueTick],
  );

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
      if (files.length === 0 || busy) return;
      event.preventDefault();
      void consume(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  function applyCatalogue(item: CatalogueItem, rowId: string) {
    const row = useProjectStore.getState().project.rows.find((entry) => entry.id === rowId);
    if (!row) return;
    patchRow(rowId, manualSelectionPatch(row, item));
    setStatus(`Manually confirmed ${item.name} (${item.code || "no code"}). The OCR colour was kept.`);
    setView("ledger");
  }

  function commitSampledHex(row: FilamentRow, hex: string | null) {
    if (isProtectedMatch(row)) {
      patchRow(row.id, {
        hex,
        ocrHex: hex,
        hexSource: hex ? "user" : row.hexSource,
        userCorrected: true,
      });
      return;
    }
    const next = suggestColour({
      ...row,
      hex,
      ocrHex: hex,
      hexSource: hex ? "user" : null,
      matchLocked: false,
      matchStatus: null,
      matchSource: null,
      catalogueId: null,
      catalogueBrand: null,
      catalogueCode: null,
      catalogueName: null,
      catalogueMaterial: null,
      catalogueHex: null,
      catalogueMissing: false,
      catalogueChanged: false,
    });
    patchRow(row.id, {
      hex,
      ocrHex: next.ocrHex,
      hexSource: hex ? "user" : null,
      catalogueId: next.catalogueId ?? null,
      catalogueBrand: next.catalogueBrand ?? null,
      catalogueCode: next.catalogueCode,
      catalogueName: next.catalogueName,
      catalogueMaterial: next.catalogueMaterial,
      catalogueHex: next.catalogueHex,
      matchConfidence: next.matchConfidence,
      matchStatus: next.matchStatus,
      matchSource: next.matchSource,
      matchLocked: false,
      catalogueMissing: false,
      catalogueChanged: false,
      needsReview: next.needsReview,
      userCorrected: false,
    });
  }

  function rematchRow(row: FilamentRow) {
    if (isProtectedMatch(row)) {
      setStatus("That manual confirmation stays locked. Clear the selected filament before automatic matching can change it.");
      return;
    }
    const patch = automaticMatchPatch(row);
    if (!patch) {
      setStatus("Automatic matching left this line unchanged.");
      return;
    }
    patchRow(row.id, patch);
    setStatus(
      patch.matchStatus === "suggested"
        ? `Suggested ${patch.catalogueName}. It is not locked.`
        : "No unique database match. This line stays unverified.",
    );
  }

  function sampleAt(event: MouseEvent<HTMLImageElement>) {
    if (!picking || !activeRow) return;
    if (activeRow.matchLocked) {
      setStatus("That line is locked. Clear the match before sampling a new colour.");
      return;
    }
    const image = event.currentTarget;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height || !image.naturalWidth) return;
    const x = ((event.clientX - rect.left) / rect.width) * image.naturalWidth;
    const y = ((event.clientY - rect.top) / rect.height) * image.naturalHeight;
    const canvas = document.createElement("canvas");
    const size = 5;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(image, x - 2, y - 2, size, size, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 200) continue;
      r += data[index];
      g += data[index + 1];
      b += data[index + 2];
      n += 1;
    }
    if (!n) return;
    const hex = `#${[r, g, b].map((channel) => Math.round(channel / n).toString(16).padStart(2, "0")).join("")}`;
    const normalized = normalizeHex(hex);
    if (!normalized) return;
    const next = suggestColour({
      ...activeRow,
      hex: normalized,
      ocrHex: normalized,
      hexSource: "sampled",
      matchLocked: false,
      matchStatus: null,
      matchSource: null,
      catalogueId: null,
      catalogueBrand: null,
      catalogueCode: null,
      catalogueName: null,
      catalogueMaterial: null,
      catalogueHex: null,
      catalogueMissing: false,
      catalogueChanged: false,
    });
    patchRow(activeRow.id, {
      hex: normalized,
      ocrHex: normalized,
      hexSource: "sampled",
      catalogueId: next.catalogueId ?? null,
      catalogueBrand: next.catalogueBrand ?? null,
      catalogueCode: next.catalogueCode,
      catalogueName: next.catalogueName,
      catalogueMaterial: next.catalogueMaterial,
      catalogueHex: next.catalogueHex,
      matchConfidence: next.matchConfidence,
      matchStatus: next.matchStatus,
      matchSource: next.matchSource,
      matchLocked: false,
      catalogueMissing: false,
      catalogueChanged: false,
      needsReview: next.needsReview,
      userCorrected: false,
    });
    setPicking(false);
    setStatus(
      next.matchStatus === "suggested"
        ? `Sampled ${normalized}. Suggested ${next.catalogueName} (${next.catalogueCode}), not locked.`
        : `Sampled ${normalized}. Colour left unverified — choose it from the filament database.`,
    );
  }

  async function saveArchive() {
    const blob = await createArchive(project);
    const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plates";
    downloadBlob(blob, `${safe}.plate.json`);
    setStatus("Project archive downloaded, including screenshots stored in this browser.");
  }

  async function openArchive(file: File) {
    const archive = await readArchive(file);
    const count = await restoreArchiveImages(archive);
    loadProject(archive.project);
    const api = desktopApi();
    if (api) {
      for (const image of archive.project.images) {
        const blob = await getImageBlob(image.id);
        if (!blob) continue;
        await api.saveImage({
          id: image.id,
          name: image.name,
          type: blob.type || "image/png",
          data: new Uint8Array(await blob.arrayBuffer()),
        });
      }
      await api.saveSession(archive.project);
    }
    setSelectedId(archive.project.images.at(-1)?.id ?? null);
    setStatus(`Restored ${archive.project.name} with ${count} screenshot${count === 1 ? "" : "s"}.`);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    if (busy) return;
    void consume([...event.dataTransfer.files]);
  }

  return (
    <div className="min-h-screen bg-bg text-fg" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-wide text-primary">BAMBU STUDIO</p>
            <h1 className="text-lg font-semibold leading-tight">Bambu Plate Manager</h1>
          </div>
          <label className="min-w-0 flex-1">
            <span className="sr-only">Project name</span>
            <input
              value={project.name}
              onChange={(event) => rename(event.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <button
            type="button"
            onClick={matchColours}
            disabled={project.rows.length === 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm disabled:opacity-40"
          >
            Match colours
          </button>
          <button
            type="button"
            onClick={() => setView(view === "catalogue" ? "ledger" : "catalogue")}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm"
          >
            {view === "catalogue" ? "Back to ledger" : "Filament database"}
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={past.length === 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm text-fg disabled:opacity-40"
          >
            <Undo2 className="size-4" />
            Undo
          </button>
          <button
            type="button"
            onClick={() => {
              setAck(false);
              setExportOpen(true);
            }}
            disabled={project.rows.length === 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg disabled:opacity-40"
          >
            <Download className="size-4" />
            Export workbook
          </button>
        </div>
      </header>
      {desktopInfo && (
        <div className={desktopInfo.askedUser ? "border-b border-primary/50 bg-surface" : "border-b border-border"}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
            <p>{desktopInfo.askedUser ? desktopInfo.message : "Saved projects stay in the portable data folder next to this application."}</p>
            <button type="button" onClick={() => void desktopApi()?.openDataDir()} className="min-h-11 text-sm text-primary">
              Open data folder
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-md border border-dashed border-border bg-surface p-3">
            <p className="text-sm font-medium">Screenshots</p>
            <p className="mt-1 text-sm text-muted">Drop a slicing result, paste from the clipboard, or pick PNG, JPEG, or WebP files.</p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg disabled:opacity-40"
              >
                <ImagePlus className="size-4" />
                Add screenshots
              </button>
              <button
                type="button"
                onClick={() => void loadSamples().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Samples failed."))}
                disabled={busy}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm disabled:opacity-40"
              >
                Read the sample screenshots
              </button>
              <button
                type="button"
                onClick={() => void saveArchive().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Archive failed."))}
                disabled={project.images.length === 0 && project.rows.length === 0}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm disabled:opacity-40"
              >
                Save project archive
              </button>
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border px-3 text-sm">
                Restore archive
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void openArchive(file).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Restore failed."));
                  }}
                />
              </label>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = "";
                  void consume(files);
                }}
              />
            </div>
          </div>

          <ul className="space-y-2">
            {project.images.map((image) => (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(image.id)}
                  className={cn(
                    "flex w-full gap-3 rounded-md border p-2 text-left",
                    selected?.id === image.id ? "border-primary bg-surface" : "border-border bg-surface",
                  )}
                >
                  {urls[image.id] ? (
                    <img src={urls[image.id]} alt="" className="h-14 w-14 rounded-md object-cover" />
                  ) : (
                    <span className="h-14 w-14 rounded-md bg-surface-2" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{image.name}</span>
                    <span className="mt-1 block text-xs text-muted">
                      {image.layout === "multi-plate-summary"
                        ? "Multi-plate summary"
                        : image.layout === "single-plate"
                          ? "Single plate"
                          : "Unread table"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Plates</h2>
              <button type="button" onClick={addPlate} className="inline-flex min-h-11 items-center gap-1 text-sm text-primary">
                <Plus className="size-4" />
                Add
              </button>
            </div>
            <ul className="space-y-2">
              {project.plates.map((plate) => (
                <li key={plate.id} className={cn("rounded-md border border-border bg-surface p-2", plate.reviewStatus === "excluded" && "opacity-50")}>
                  <input
                    aria-label={`Name for ${plate.label}`}
                    defaultValue={plate.label}
                    key={`${plate.id}-${plate.label}`}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (next && next !== plate.label) patchPlate(plate.id, { label: next });
                    }}
                    className="w-full bg-transparent text-sm font-medium outline-none"
                  />
                  <p className="mt-1 font-mono text-xs text-muted">
                    {[plate.prepareTime && `prep ${plate.prepareTime}`, plate.printTime && `print ${plate.printTime}`, plate.totalTime && `total ${plate.totalTime}`]
                      .filter(Boolean)
                      .join(" · ") || "No time read"}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        patchPlate(plate.id, {
                          reviewStatus: plate.reviewStatus === "reviewed" ? "pending" : "reviewed",
                          needsReview: false,
                        })
                      }
                      className="min-h-11 rounded-md border border-border px-2 text-xs"
                    >
                      {plate.reviewStatus === "reviewed" ? "Reviewed" : "Mark reviewed"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchPlate(plate.id, {
                          reviewStatus: plate.reviewStatus === "excluded" ? "pending" : "excluded",
                        })
                      }
                      className="min-h-11 rounded-md border border-border px-2 text-xs"
                    >
                      {plate.reviewStatus === "excluded" ? "Include" : "Exclude"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {project.images.length > 0 && (
            confirmClear ? (
              <div className="rounded-md border border-border bg-surface p-2 text-sm">
                <p>Clear this set? Screenshots and reviewed rows in this browser will be removed.</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const ids = project.images.map((image) => image.id);
                      for (const image of project.images) void deleteImageBlob(image.id);
                      const api = desktopApi();
                      if (api) void api.deleteImages(ids);
                      reset();
                      setSelectedId(null);
                      setStatus(null);
                      setConfirmClear(false);
                      setActiveRowId(null);
                    }}
                    className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg"
                  >
                    Clear
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="min-h-11 rounded-md border border-border px-3 text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmClear(true)} className="text-sm text-muted underline-offset-2 hover:underline">
                Clear this set
              </button>
            )
          )}
        </aside>

        <main className="min-w-0 space-y-4">
          {status && <p className="text-sm text-muted">{status}</p>}
          {view === "catalogue" ? (
            <CatalogueBrowser
              query={query}
              material={material}
              hits={catalogueHits}
              activeRow={activeRow}
              onQuery={setQuery}
              onMaterial={setMaterial}
              onUse={(item) => {
                if (!activeRow) {
                  setStatus("Select a filament line in the ledger first.");
                  return;
                }
                applyCatalogue(item, activeRow.id);
              }}
            />
          ) : (
          <>
          <section className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted">
                {project.images.length} image{project.images.length === 1 ? "" : "s"} · {project.plates.length} plate
                {project.plates.length === 1 ? "" : "s"} · {filamentCount} filament line{filamentCount === 1 ? "" : "s"}
                {reviewCount > 0 ? ` · ${reviewCount} to check` : ""}
              </p>
              {selected?.cost && (
                <p className="mt-1 font-mono text-sm">
                  Cost {selected.cost}
                  {selected.filamentChanges !== null ? ` · changes ${selected.filamentChanges}` : ""}
                </p>
              )}
            </div>
            <div className="flex rounded-md border border-border p-1">
              {(["all", "review"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "min-h-11 rounded-md px-3 text-sm",
                    filter === value ? "bg-surface-2 text-fg" : "text-muted",
                  )}
                >
                  {value === "all" ? "All lines" : "Needs review"}
                </button>
              ))}
            </div>
          </section>

          {selected?.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 rounded-md border border-primary/40 bg-surface px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
              {warning}
            </p>
          ))}

          {selected?.layout === "multi-plate-summary" && (
            <p className="text-sm text-muted">
              This screenshot lists every plate’s time, but the filament weights are project totals. They are not split per plate.
            </p>
          )}

          {selected && urls[selected.id] && (
            <div className="overflow-auto rounded-md border border-border bg-surface">
              <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1">
                <p className="text-xs text-muted">
                  {picking ? "Click the swatch in the screenshot. The match is only a suggestion." : "Preview"}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeRow) {
                        setStatus("Select a filament line, then sample its swatch.");
                        return;
                      }
                      setPicking((value) => !value);
                    }}
                    className={cn("min-h-11 rounded-md px-2 text-xs", picking ? "bg-primary text-primary-fg" : "text-muted")}
                  >
                    Sample colour
                  </button>
                  {[1, 1.5, 2].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setZoom(value)}
                      className={cn("min-h-11 rounded-md px-2 text-xs", zoom === value ? "bg-surface-2 text-fg" : "text-muted")}
                    >
                      {value}×
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-96 overflow-auto">
                <div className="relative">
                <img
                  src={urls[selected.id]}
                  alt={selected.name}
                  onClick={sampleAt}
                  className={cn("block max-w-none object-contain", picking && "cursor-crosshair")}
                  style={{ width: `${zoom * 100}%` }}
                />
                <div className="pointer-events-none absolute inset-0">
                  {project.rows
                    .filter((row) => row.imageId === selected.id && row.y0 !== null && row.y1 !== null)
                    .map((row) => (
                      <div
                        key={row.id}
                        className={cn("absolute right-0 left-0 border-y", row.needsReview ? "border-primary/70 bg-primary/10" : "border-fg/20")}
                        style={{
                          top: `${(row.y0! / selected.height) * 100}%`,
                          height: `${(Math.max(row.y1! - row.y0!, 1) / selected.height) * 100}%`,
                        }}
                      />
                    ))}
                </div>
                </div>
              </div>
            </div>
          )}

          {project.images.length === 0 && !busy && (
            <div className="rounded-md border border-border bg-surface px-4 py-8">
              <h2 className="text-base font-medium">Read a slicing result</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
                Import a Bambu Studio plate screenshot. The table keeps only what OCR can read. A colour stays unverified unless one database colour is uniquely high-confidence. Choose the filament yourself when it is not. Manual choices are kept when matching runs again.
              </p>
            </div>
          )}

          {busy && progress && (
            <div className="rounded-md border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{progress.label}</span>
                <button type="button" onClick={() => (cancelRef.current = true)} className="min-h-11 text-sm text-primary">
                  Cancel
                </button>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full origin-left bg-primary"
                  style={{ transform: `scaleX(${progress.total ? progress.done / progress.total : 0})` }}
                />
              </div>
            </div>
          )}

          {project.rows.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <thead className="bg-surface-2 text-left text-xs text-muted">
                  <tr>
                    <th className="px-2 py-2 font-medium">Use</th>
                    <th className="px-2 py-2 font-medium" title="Bambu Studio filament index beside the colour. Not an AMS slot.">
                      Filament ID
                    </th>
                    <th className="px-2 py-2 font-medium">Plate</th>
                    <th className="px-2 py-2 text-right font-medium">Model</th>
                    <th className="px-2 py-2 text-right font-medium">Support</th>
                    {wide && <th className="px-2 py-2 text-right font-medium">Purged</th>}
                    {wide && <th className="px-2 py-2 text-right font-medium">Tower</th>}
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                    <th className="px-2 py-2 font-medium">Colour</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => {
                        if (!row.isTotal) setActiveRowId(row.id);
                      }}
                      className={cn(
                        "border-t border-border",
                        row.needsReview && "bg-primary/5",
                        row.isTotal && "bg-surface",
                        activeRowId === row.id && "outline outline-1 outline-primary",
                      )}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={row.isTotal ? "Total row is not an assignment" : `Include filament ${row.filamentId || "blank"}`}
                          checked={row.include}
                          disabled={row.isTotal}
                          onChange={(event) => patchRow(row.id, { include: event.target.checked })}
                          className="size-4 accent-primary"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          {!row.isTotal && (
                            <span
                              aria-hidden
                              className="size-3.5 shrink-0 rounded-sm border border-border"
                              style={{ background: shownHex(row) ?? "transparent" }}
                            />
                          )}
                          {row.isTotal && <span className="text-xs text-muted">Total</span>}
                          <input
                            aria-label="Filament ID"
                            title="Filament ID from Bambu Studio, not an AMS slot"
                            value={row.filamentId}
                            disabled={row.isTotal}
                            onChange={(event) => patchRow(row.id, { filamentId: event.target.value })}
                            className="w-12 rounded-md border border-transparent bg-transparent px-1 py-1 font-mono text-sm outline-none focus:border-border"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          aria-label="Plate"
                          value={row.plateId ?? ""}
                          onChange={(event) => patchRow(row.id, { plateId: event.target.value || null })}
                          className="max-w-36 rounded-md border border-border bg-surface px-2 py-2 text-sm"
                        >
                          <option value="">Project total</option>
                          {project.plates.map((plate) => (
                            <option key={plate.id} value={plate.id}>
                              {plate.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2"><UsageCell usage={row.model} label="Model" onCommit={(model) => patchRow(row.id, { model })} /></td>
                      <td className="px-2 py-2"><UsageCell usage={row.support} label="Support" onCommit={(support) => patchRow(row.id, { support })} /></td>
                      {wide && (
                        <td className="px-2 py-2">
                          <UsageCell
                            usage={row.purged}
                            label="Purged"
                            onCommit={(purged) => patchRow(row.id, { purged })}
                          />
                        </td>
                      )}
                      {wide && (
                        <td className="px-2 py-2">
                          <UsageCell usage={row.tower} label="Tower" onCommit={(tower) => patchRow(row.id, { tower })} />
                        </td>
                      )}
                      <td className="px-2 py-2"><UsageCell usage={row.total} label="Total" onCommit={(total) => patchRow(row.id, { total })} /></td>
                      <td className="px-2 py-2">
                        <ColourField
                          row={row}
                          onCommit={(hex) => commitSampledHex(row, hex)}
                          onChoose={() => setPickerRowId(row.id)}
                          onClear={() => {
                            patchRow(row.id, clearMatchPatch());
                            setStatus("Selection cleared. This line is unverified. The OCR colour was kept.");
                          }}
                          onRematch={() => rematchRow(row)}
                          onAccept={() =>
                            patchRow(row.id, {
                              matchStatus: "accepted",
                              matchLocked: true,
                              matchSource: "automatic",
                              needsReview: false,
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <button type="button" aria-label="Remove row" onClick={() => removeRow(row.id)} className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {project.images.length > 0 && (
            <div className="flex flex-wrap gap-4">
              <button type="button" onClick={() => addRow(selected?.id ?? null)} className="inline-flex min-h-11 items-center gap-2 text-sm text-primary">
                <Plus className="size-4" />
                Add a line
              </button>
              <button
                type="button"
                onClick={() => {
                  const removed = mergeDuplicates();
                  setStatus(removed ? `Merged ${removed} duplicate colour${removed === 1 ? "" : "s"} on the same plate.` : "No duplicate colours on the same plate.");
                }}
                className="inline-flex min-h-11 items-center text-sm text-muted"
              >
                Merge same colours
              </button>
            </div>
          )}

          {selected?.ocrText && (
            <details className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <summary className="cursor-pointer py-2">Original OCR text</summary>
              <pre className="overflow-x-auto pb-2 font-mono text-xs leading-relaxed text-muted">{selected.ocrText}</pre>
            </details>
          )}
          </>
          )}
        </main>
      </div>
      {exportOpen && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-bg/80 p-4 sm:items-center">
          <div role="dialog" aria-labelledby="export-title" className="w-full max-w-lg rounded-md border border-border bg-surface p-4">
            <h2 id="export-title" className="text-base font-medium">Export workbook</h2>
            <p className="mt-1 text-sm text-muted">
              {report.rows} filament {report.rows === 1 ? "row" : "rows"} across {report.plates} {report.plates === 1 ? "plate" : "plates"}.
              {report.totalGrams === null ? " Total grams unavailable." : ` About ${report.totalGrams.toFixed(2)} g where a weight was read.`}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              <li>{report.unmatched} without a confirmed catalogue match</li>
              <li>{report.lowOcr} with low-confidence or incomplete OCR</li>
              <li>{report.uncertainMatch} unverified colours or unlocked suggestions</li>
              <li>{report.missingColour} missing both a sample and a catalogue colour</li>
            </ul>
            <p className="mt-3 text-sm text-muted">
              The file has Project Summary, Filament Details, Colour Summary, and Plates. Swatches are cell fills. Empty weights stay empty.
            </p>
            {hasExportIssues && (
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} className="mt-1 size-4 accent-primary" />
                I have reviewed the uncertain rows and still want this workbook.
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setExportOpen(false)} className="min-h-11 rounded-md border border-border px-3 text-sm">
                Back
              </button>
              <button
                type="button"
                disabled={hasExportIssues && !ack}
                onClick={() => {
                  setExportOpen(false);
                  void downloadWorkbook(project)
                    .then(() => setStatus("Workbook downloaded."))
                    .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Excel export failed."));
                }}
                className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg disabled:opacity-40"
              >
                Download workbook
              </button>
            </div>
          </div>
        </div>
      )}
      {pickerRowId && (
        <FilamentPicker
          row={project.rows.find((row) => row.id === pickerRowId) ?? null}
          catalogueTick={catalogueTick}
          onCancel={() => setPickerRowId(null)}
          onConfirm={(item) => {
            const row = useProjectStore.getState().project.rows.find((entry) => entry.id === pickerRowId);
            if (!row) {
              setPickerRowId(null);
              return;
            }
            patchRow(row.id, manualSelectionPatch(row, item));
            setPickerRowId(null);
            setStatus(`Manually confirmed ${item.name} (${item.code || "no code"}). The OCR colour was kept.`);
          }}
        />
      )}
    </div>
  );
}

function shownHex(row: FilamentRow): string | null {
  if ((row.matchStatus === "manual" || row.matchStatus === "accepted" || row.matchStatus === "suggested") && row.catalogueHex) {
    return row.catalogueHex;
  }
  return row.hex;
}

function ColourField({
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

function itemKey(item: CatalogueItem, index: number): string {
  return `${item.family}|${item.code}|${item.material}|${item.name}|${item.rawHex ?? ""}|${index}`;
}

function FilamentPicker({
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

function CatalogueBrowser({
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
