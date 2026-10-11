/** Turn OCR lines from a Bambu Studio slicing screenshot into plates and filament rows. */

export type Usage = {
  meters: number | null;
  grams: number | null;
};

export type Measure = {
  amount: number;
  unit: "m" | "g";
  explicitDecimal: boolean;
  strippedNoise: boolean;
};

export type OcrLine = {
  text: string;
  /** Duration read from the right-hand side of a time row, if retried. */
  duration?: string | null;
  y0?: number;
  y1?: number;
  confidence?: number;
};

export type ParsedUsageRow = {
  /** Bambu Studio filament index (the number beside the colour). Not an AMS slot. */
  filamentId: string | null;
  isTotal: boolean;
  model: Usage | null;
  support: Usage | null;
  purged: Usage | null;
  tower: Usage | null;
  total: Usage | null;
  wide: boolean;
  confidence: number;
  needsReview: boolean;
  raw: string;
  y0: number | null;
  y1: number | null;
};

export type ParsedPlate = {
  label: string;
  prepareTime: string | null;
  printTime: string | null;
  totalTime: string | null;
  confidence: number;
  needsReview: boolean;
  raw: string;
  y0: number | null;
  y1: number | null;
};

export type ParsedDocument = {
  layout: "single-plate" | "multi-plate-summary" | "unknown";
  cost: string | null;
  filamentChanges: string | null;
  prepareTime: string | null;
  printTime: string | null;
  projectDuration: string | null;
  plates: ParsedPlate[];
  rows: ParsedUsageRow[];
  warnings: string[];
  ocrText: string;
};

const DURATION_RUN = /(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:\d+s)?/g;

/** Pull the longest valid Bambu duration out of a noisy OCR string. */
export function parseDuration(input: string | null | undefined): string | null {
  if (!input) return null;
  const compact = input.toLowerCase().replace(/\s+/g, "");
  let best: string | null = null;
  for (const match of compact.matchAll(DURATION_RUN)) {
    const run = match[0];
    const idx = match.index ?? 0;
    if (!run || !/[dhms]/.test(run)) continue;
    if (idx > 0 && /[a-z]/.test(compact[idx - 1] ?? "")) continue;
    const parts = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(run);
    if (!parts || (!parts[1] && !parts[2] && !parts[3] && !parts[4])) continue;
    if (parts[2] && Number(parts[2]) > 99) continue;
    if (parts[3] && Number(parts[3]) > 59) continue;
    if (parts[4] && Number(parts[4]) > 59) continue;
    if (!best || run.length > best.length) best = run;
  }
  return best;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function measureFromToken(rawToken: string, hint: "m" | "g" | null): Measure | null {
  const token = rawToken.trim().replace(/,/g, ".");
  if (!token) return null;

  let strippedNoise = false;
  let unit: "m" | "g" | null = null;
  let numeric = token;

  const withUnit = token.match(/^(\d+\.\d+|\d+)\s*([mMgGaA])$/);
  if (withUnit) {
    numeric = withUnit[1];
    unit = withUnit[2].toLowerCase() === "m" ? "m" : "g";
  }

  if (unit === null) unit = hint;
  if (unit === null) return null;

  if (numeric.includes(".")) {
    let [whole, frac] = numeric.split(".");
    while (frac.length > 2 && frac.endsWith("9")) {
      frac = frac.slice(0, -1);
      strippedNoise = true;
    }
    if (frac.length > 2) {
      frac = frac.slice(0, 2);
      strippedNoise = true;
    }
    const amount = round2(Number(`${whole}.${frac}`));
    if (!Number.isFinite(amount)) return null;
    return { amount, unit, explicitDecimal: true, strippedNoise };
  }

  if (!/^\d+$/.test(numeric)) return null;

  // A trailing 9 with no unit glyph is usually a misread "g".
  if (unit === "g" && numeric.length >= 4 && numeric.endsWith("9") && !withUnit) {
    numeric = numeric.slice(0, -1);
    strippedNoise = true;
  }

  if (numeric.length < 3) return null;

  const amount = round2(Number(numeric) / 100);
  if (!Number.isFinite(amount)) return null;
  return { amount, unit, explicitDecimal: false, strippedNoise };
}

function lineHint(line: string): "m" | "g" | null {
  const meters = (line.match(/\d\s*m\b/gi) ?? []).length;
  const grams = (line.match(/\d\s*[gGaA]\b/gi) ?? []).length;
  if (meters > grams) return "m";
  if (grams > meters) return "g";
  return null;
}

export function measuresOnLine(line: string, hint: "m" | "g" | null): Measure[] {
  const hinted = hint ?? lineHint(line);
  const out: Measure[] = [];
  for (const match of line.matchAll(/\d+\.\d+|\d+/g)) {
    const idx = match.index ?? 0;
    const after = line.slice(idx + match[0].length, idx + match[0].length + 3);
    const unitChar = /^\s*([mMgGaA])/.exec(after);
    const parsed = measureFromToken(match[0] + (unitChar ? unitChar[1] : ""), hinted);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** The leading index on a usage line is the filament id beside the colour, not an AMS slot. */
function peelIdentity(line: string): {
  filamentId: string | null;
  isTotal: boolean;
  rest: string;
} {
  let s = line.trim().replace(/^[|•·.\s]+/, "");
  if (/^total\b/i.test(s) && !/cost|time/i.test(s)) {
    return {
      filamentId: null,
      isTotal: true,
      rest: s.replace(/^total\b/i, "").trim(),
    };
  }
  const indexed = s.match(/^[mM]?\s*(\d{1,2})(?![.\d])(?!\s*[mMgGaA])\s+(.+)$/);
  if (indexed) {
    const n = Number(indexed[1]);
    if (n >= 1 && n <= 32) {
      return { filamentId: String(n), isTotal: false, rest: indexed[2] };
    }
  }
  return { filamentId: null, isTotal: false, rest: s };
}

function zipUsage(
  meters: Measure[],
  grams: Measure[],
): { slots: Array<Usage | null>; suspect: boolean } {
  const count = Math.max(meters.length, grams.length);
  const slots: Array<Usage | null> = [];
  let suspect = meters.length !== grams.length;
  for (let i = 0; i < count; i++) {
    const m = meters[i];
    const g = grams[i];
    if (!m && !g) {
      slots.push(null);
      continue;
    }
    if ((m && m.unit !== "m") || (g && g.unit !== "g")) suspect = true;
    slots.push({
      meters: m && m.unit === "m" ? m.amount : null,
      grams: g && g.unit === "g" ? g.amount : null,
    });
  }
  return { slots, suspect };
}

function assignColumns(values: Array<Usage | null>, wide: boolean): Pick<
  ParsedUsageRow,
  "model" | "support" | "purged" | "tower" | "total"
> {
  if (wide) {
    return {
      model: values[0] ?? null,
      support: values[1] ?? null,
      purged: values[2] ?? null,
      tower: values[3] ?? null,
      total: values[4] ?? null,
    };
  }
  if (values.length >= 3) {
    return {
      model: values[0] ?? null,
      support: values[1] ?? null,
      purged: null,
      tower: null,
      total: values[values.length - 1] ?? null,
    };
  }
  return {
    model: values[0] ?? null,
    support: null,
    purged: null,
    tower: null,
    total: values[1] ?? null,
  };
}

function rowConfidence(meters: Measure[], grams: Measure[], suspect: boolean, ocrConf?: number): number {
  const all = [...meters, ...grams];
  if (all.length === 0) return 0.2;
  const avg =
    all.reduce((sum, item) => {
      let score = item.explicitDecimal ? 0.94 : 0.86;
      if (item.strippedNoise) score = 0.82;
      return sum + score;
    }, 0) / all.length;
  let score = avg;
  if (suspect) score -= 0.12;
  if (ocrConf !== undefined && ocrConf < 50) score -= 0.15;
  return Math.max(0.15, Math.min(0.98, score));
}

function isTimeHeader(text: string): boolean {
  return /time\s*est|tme\s*st/i.test(text);
}

function isJunk(text: string): boolean {
  return /travel|retract|unretract|wipe|seams|options|display|color scheme/i.test(text);
}

function costFrom(text: string): string | null {
  if (!/cost|eost|gost/i.test(text)) return null;
  const explicit = text.match(/(\d+\.\d{2})/);
  if (explicit) return explicit[1];
  const digits = text.match(/(\d{3,})/);
  if (!digits) return null;
  const n = Number(digits[1]) / 100;
  return n.toFixed(2);
}

function changesFrom(text: string): string | null {
  const m = text.match(/change\s*times?\s*:?\s*(\d+)/i);
  return m ? m[1] : null;
}

function buildRow(
  meterLine: OcrLine,
  gramLine: OcrLine | null,
): ParsedUsageRow | null {
  const id = peelIdentity(meterLine.text);
  const meterMeasures = measuresOnLine(id.rest, "m").filter((item) => item.unit === "m");
  const gramMeasures = gramLine
    ? measuresOnLine(gramLine.text, "g").filter((item) => item.unit === "g")
    : [];
  if (meterMeasures.length < 2 && gramMeasures.length < 2) return null;
  const { slots, suspect } = zipUsage(meterMeasures, gramMeasures);
  const wide = Math.max(meterMeasures.length, gramMeasures.length) >= 5;
  const cols = assignColumns(slots, wide);
  const missingId = !id.filamentId && !id.isTotal;
  const countMismatch = gramLine ? meterMeasures.length !== gramMeasures.length : true;
  const confidence = rowConfidence(
    meterMeasures,
    gramMeasures,
    suspect || countMismatch,
    meterLine.confidence,
  );
  const ratioOff = [cols.model, cols.support, cols.purged, cols.tower, cols.total].some(usageRatioOff);
  return {
    filamentId: id.filamentId,
    isTotal: id.isTotal,
    ...cols,
    wide,
    confidence: ratioOff ? Math.min(confidence, 0.55) : confidence,
    needsReview: missingId || countMismatch || confidence < 0.72 || ratioOff,
    raw: [meterLine.text, gramLine?.text].filter(Boolean).join(" / "),
    y0: meterLine.y0 ?? null,
    y1: gramLine?.y1 ?? meterLine.y1 ?? null,
  };
}

function usageRatioOff(usage: Usage | null): boolean {
  if (!usage || usage.meters === null || usage.grams === null || usage.meters <= 0) return false;
  const ratio = usage.grams / usage.meters;
  // 1.75 mm PLA is about 3 g per metre. Far outside that, a digit was likely dropped.
  return ratio < 2 || ratio > 5;
}

function sumGrams(rows: ParsedUsageRow[]): number | null {
  const parts = rows
    .filter((row) => !row.isTotal)
    .map((row) => row.total?.grams)
    .filter((n): n is number => n !== null && n !== undefined);
  if (parts.length === 0) return null;
  return round2(parts.reduce((a, b) => a + b, 0));
}

export function parseOcrDocument(lines: OcrLine[]): ParsedDocument {
  const warnings: string[] = [];
  const cleaned = lines
    .map((line) => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() }))
    .filter((line) => line.text.length > 0 && !isJunk(line.text));

  let cost: string | null = null;
  let filamentChanges: string | null = null;
  let prepareTime: string | null = null;
  let printTime: string | null = null;
  let projectDuration: string | null = null;
  let inTime = false;
  const table: OcrLine[] = [];
  const time: OcrLine[] = [];

  for (const line of cleaned) {
    const foundCost = costFrom(line.text);
    if (foundCost && cost === null) cost = foundCost;
    const changes = changesFrom(line.text);
    if (changes !== null) filamentChanges = changes;

    if (isTimeHeader(line.text)) {
      inTime = true;
      continue;
    }
    const timeLabel =
      /^plate\s*\d+/i.test(line.text) ||
      /prep|peae|prae|print|^total\b|total\s*t/i.test(line.text);
    const entersTime =
      timeLabel &&
      (parseDuration(line.duration) !== null || parseDuration(line.text) !== null) &&
      measuresOnLine(line.text, null).length < 2;
    if (entersTime) inTime = true;
    if (inTime) time.push(line);
    else if (!/cost|eost|change\s*times/i.test(line.text)) table.push(line);
  }

  const measureLines = table.filter((line) => {
    const id = peelIdentity(line.text);
    const hinted = lineHint(id.rest) ?? lineHint(line.text);
    return measuresOnLine(id.isTotal || id.filamentId ? id.rest : line.text, hinted).length >= 2;
  });

  const rows: ParsedUsageRow[] = [];
  for (let i = 0; i < measureLines.length; ) {
    const current = measureLines[i];
    const next = measureLines[i + 1];
    const currentHint = lineHint(peelIdentity(current.text).rest) ?? lineHint(current.text);
    const nextHint = next ? lineHint(next.text) : null;
    const pair =
      next &&
      (currentHint === "m" || currentHint === null) &&
      (nextHint === "g" || nextHint === null) &&
      !peelIdentity(next.text).isTotal &&
      !peelIdentity(next.text).filamentId;
    if (pair && next) {
      const row = buildRow(current, next);
      if (row) rows.push(row);
      i += 2;
    } else {
      const row = buildRow(current, null);
      if (row) rows.push(row);
      i += 1;
    }
  }

  const plates: ParsedPlate[] = [];
  for (const line of time) {
    const plateMatch = line.text.match(/plate\s*(\d+)/i);
    const besidePlate = plateMatch ? line.text.replace(/plate\s*\d+/i, " ") : line.text;
    const duration = parseDuration(line.duration) ?? parseDuration(besidePlate);
    if (plateMatch) {
      const needsReview = !duration;
      plates.push({
        label: `Plate ${Number(plateMatch[1])}`,
        prepareTime: null,
        printTime: null,
        totalTime: duration,
        confidence: duration ? 0.9 : 0.4,
        needsReview,
        raw: line.text,
        y0: line.y0 ?? null,
        y1: line.y1 ?? null,
      });
      if (needsReview) warnings.push(`${`Plate ${Number(plateMatch[1])}`} is missing a readable print time.`);
      continue;
    }
    if (/prep|peae|prae/i.test(line.text) && duration) prepareTime = duration;
    else if (/print|model/i.test(line.text) && duration) printTime = duration;
    else if (/^total\b/i.test(line.text) && duration) projectDuration = duration;
    else if (/total\s*time/i.test(line.text) && duration) {
      if (plates.length === 0) printTime = printTime ?? null;
      prepareTime = prepareTime;
      if (!projectDuration) projectDuration = duration;
    }
  }

  // Single-plate screenshots put prepare / print / total above the options list.
  if (plates.length === 0 && (prepareTime || printTime || projectDuration || rows.some((row) => !row.isTotal))) {
    plates.push({
      label: "Plate",
      prepareTime,
      printTime,
      totalTime: projectDuration,
      confidence: projectDuration ? 0.88 : 0.55,
      needsReview: !projectDuration,
      raw: [prepareTime, printTime, projectDuration].filter(Boolean).join(" · "),
      y0: null,
      y1: null,
    });
  }

  const layout: ParsedDocument["layout"] =
    plates.filter((plate) => /^Plate \d+$/.test(plate.label)).length >= 2
      ? "multi-plate-summary"
      : rows.some((row) => !row.isTotal) || prepareTime || printTime
        ? "single-plate"
        : "unknown";

  if (layout === "unknown") {
    warnings.push("No plate table was readable. Add rows manually or try a tighter crop.");
  }

  const totalRow = rows.find((row) => row.isTotal);
  const summed = sumGrams(rows);
  if (totalRow?.total?.grams != null && summed != null) {
    const delta = Math.abs(totalRow.total.grams - summed);
    if (delta > 1) {
      warnings.push(
        `Filament totals add up to ${summed.toFixed(2)} g, but the total row reads ${totalRow.total.grams.toFixed(2)} g.`,
      );
    }
  }

  if (rows.some((row) => row.needsReview) || plates.some((plate) => plate.needsReview)) {
    warnings.push("Some cells need a look — highlighted rows are the uncertain ones.");
  }

  return {
    layout,
    cost,
    filamentChanges,
    prepareTime,
    printTime,
    projectDuration,
    plates,
    rows,
    warnings: [...new Set(warnings)],
    ocrText: cleaned.map((line) => line.text).join("\n"),
  };
}
