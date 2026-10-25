import { parseOcrDocument, type OcrLine, type ParsedDocument } from "@/lib/parse-slicing";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { findSwatch } from "@/lib/swatch";

const FULL = "0123456789.mMgGdhmsPlateTotal :";
const DURATION = "0123456789dhms";

export type OcrProgress = { done: number; total: number; label: string };

function ocrAsset(file: string): string {
  const path = `/ocr/${file}`;
  if (typeof window !== "undefined" && window.location.protocol === "file:") return `.${path}`;
  const prefix =
    typeof window === "undefined"
      ? ""
      : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "");
  return `${prefix}${path}`;
}

function luminance(data: Uint8ClampedArray, index: number): number {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
}

function findBands(data: Uint8ClampedArray, width: number, height: number): Array<[number, number]> {
  const proj = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const row = y * width * 4;
    for (let x = 0; x < width; x += 2) {
      if (luminance(data, row + x * 4) > 145) count++;
    }
    proj[y] = count;
  }
  const min = (width * 0.008) / 2;
  const bands: Array<[number, number]> = [];
  let start = -1;
  for (let y = 0; y < height; y++) {
    if (proj[y] > min) {
      if (start < 0) start = y;
    } else if (start >= 0) {
      if (y - start > 6) bands.push([start, y]);
      start = -1;
    }
  }
  if (start >= 0 && height - start > 6) bands.push([start, height]);
  return bands;
}

function rasterize(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): HTMLCanvasElement {
  const pad = 12;
  const scale = 4;
  const canvas = document.createElement("canvas");
  canvas.width = (w + pad * 2) * scale;
  canvas.height = (h + pad * 2) * scale;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, x, y, w, h, pad * scale, pad * scale, w * scale, h * scale);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    let tone = 255 - luminance(pixels, i);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = tone;
    if (tone < min) min = tone;
    if (tone > max) max = tone;
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < pixels.length; i += 4) {
    const stretched = ((pixels[i] - min) * 255) / span;
    const v = stretched > 155 ? 255 : 0;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function sampleSwatch(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  y0: number,
  y1: number,
): string | null {
  const colors: Array<[number, number, number]> = [];
  const yMid = Math.max(0, Math.min(height - 1, Math.floor((y0 + y1) / 2)));
  for (let y = yMid - 4; y <= yMid + 4; y++) {
    if (y < 0 || y >= height) continue;
    for (let x = 4; x <= 28; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat > 0.45 && max > 70) colors.push([r, g, b]);
    }
  }
  if (colors.length < 8) return null;
  const channel = (index: 0 | 1 | 2) => {
    const values = colors.map((color) => color[index]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(channel(0))}${hex(channel(1))}${hex(channel(2))}`;
}

async function loadCanvas(blob: Blob): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const scale = bitmap.width > 1600 ? 1600 / bitmap.width : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not read the image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { canvas, width, height };
}

export async function readScreenshot(
  blob: Blob,
  onProgress: (progress: OcrProgress) => void,
  shouldCancel: () => boolean,
): Promise<{ parsed: ParsedDocument; width: number; height: number; swatches: Array<string | null> }> {
  const { canvas, width, height } = await loadCanvas(blob);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not read the image.");
  const frame = ctx.getImageData(0, 0, width, height);
  const found = findBands(frame.data, width, height);
  onProgress({ done: 0, total: Math.max(found.length, 1), label: "Loading the reader" });

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: ocrAsset("worker.min.js"),
    corePath: ocrAsset("tesseract-core-simd-lstm.wasm.js"),
    langPath: ocrAsset("tessdata"),
    gzip: false,
    cacheMethod: "none",
    workerBlobURL: window.location.protocol !== "file:",
  });
  const lines: OcrLine[] = [];
  try {
    for (let index = 0; index < found.length; index++) {
      if (shouldCancel()) break;
      const [y0, y1] = found[index];
      onProgress({ done: index, total: found.length, label: `Reading row ${index + 1} of ${found.length}` });
      const band = rasterize(canvas, 0, Math.max(0, y0 - 1), width, y1 - y0 + 2);
      await worker.setParameters({
        tessedit_pageseg_mode: "7" as import("tesseract.js").PSM,
        tessedit_char_whitelist: FULL,
      });
      const full = await worker.recognize(band);
      const text = full.data.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      let duration: string | null = null;
      if (/plate|total|prepare|print|time|peae|tme/i.test(text)) {
        const right = rasterize(
          canvas,
          Math.floor(width * 0.42),
          Math.max(0, y0 - 1),
          Math.ceil(width * 0.58),
          y1 - y0 + 2,
        );
        await worker.setParameters({
          tessedit_pageseg_mode: "7" as import("tesseract.js").PSM,
          tessedit_char_whitelist: DURATION,
        });
        const timed = await worker.recognize(right);
        duration = timed.data.text.replace(/\s+/g, " ").trim() || null;
      }
      lines.push({
        text,
        duration,
        y0,
        y1,
        confidence: full.data.confidence,
      });
    }
  } finally {
    await worker.terminate();
  }

  if (shouldCancel()) {
    return {
      parsed: parseOcrDocument([]),
      width,
      height,
      swatches: [],
    };
  }

  const parsed = parseOcrDocument(lines);
  const swatches = parsed.rows.map((row) =>
    row.isTotal || row.y0 === null || row.y1 === null
      ? null
      : (sampleSwatch(frame.data, width, height, row.y0, row.y1) ?? findSwatch(frame.data, width, height, row.y0, row.y1)),
  );
  onProgress({ done: found.length, total: Math.max(found.length, 1), label: "Done" });
  return { parsed, width, height, swatches };
}
