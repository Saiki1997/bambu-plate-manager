/** Find the filament colour square at the left of a table row in a Bambu Studio screenshot. */

type Rgb = [number, number, number];

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number): Rgb {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function distance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function median(colours: Rgb[]): Rgb {
  const channel = (index: 0 | 1 | 2) => {
    const values = colours.map((colour) => colour[index]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}

function toHex(colour: Rgb): string {
  return `#${colour.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Colours this close count as the same flat fill. */
const FLAT = 14;
/** A fill must differ this much from the row background to be a swatch. */
const APART = 28;

/**
 * Scan the left part of a row for a flat, roughly square block of colour that differs from the
 * background. Text strokes are thin in one direction, so they fail the square test. Returns null
 * when no such block is found, rather than guessing.
 */
export function findSwatch(data: Uint8ClampedArray, width: number, height: number, y0: number, y1: number): string | null {
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(height - 1, Math.ceil(y1));
  if (bottom - top < 4 || width < 16) return null;
  const limit = Math.max(16, Math.floor(width * 0.3));
  const minRun = 5;

  const background = median(
    [0.25, 0.5, 0.75].flatMap((f) => {
      const y = Math.round(top + (bottom - top) * f);
      return Array.from({ length: Math.floor(limit / 3) }, (_, k) => pixel(data, width, k * 3, y));
    }),
  );

  for (let y = top; y <= bottom; y += 1) {
    let start = 0;
    for (let x = 1; x <= limit; x += 1) {
      if (x < limit && distance(pixel(data, width, x, y), pixel(data, width, start, y)) <= FLAT) continue;
      const run = x - start;
      const cx = start + Math.floor(run / 2);
      const fill = pixel(data, width, cx, y);
      if (run >= minRun && distance(fill, background) >= APART) {
        let below = y;
        while (below + 1 < height && distance(pixel(data, width, cx, below + 1), fill) <= FLAT) below += 1;
        const tall = below - y + 1;
        if (tall >= run * 0.6 && tall <= run * 1.6) {
          const insetX = Math.max(1, Math.floor(run / 5));
          const insetY = Math.max(1, Math.floor(tall / 5));
          const colours: Rgb[] = [];
          for (let yy = y + insetY; yy <= below - insetY; yy += 1) {
            for (let xx = start + insetX; xx < x - insetX; xx += 1) colours.push(pixel(data, width, xx, yy));
          }
          if (colours.length > 0) {
            const centre = median(colours);
            const flat = colours.filter((colour) => distance(colour, centre) <= FLAT).length;
            if (flat / colours.length >= 0.8) return toHex(centre);
          }
        }
      }
      start = x;
    }
  }
  return null;
}
