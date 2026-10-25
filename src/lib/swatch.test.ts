import assert from "node:assert/strict";
import test from "node:test";
import { findSwatch } from "./swatch.ts";

type Rgb = [number, number, number];

function canvas(width: number, height: number, background: Rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = (x0: number, y0: number, w: number, h: number, colour: Rgb) => {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = colour[0];
        data[i + 1] = colour[1];
        data[i + 2] = colour[2];
        data[i + 3] = 255;
      }
    }
  };
  fill(0, 0, width, height, background);
  return { data, fill };
}

const grey: Rgb = [59, 59, 59];

test("finds a coloured square left of the filament number", () => {
  const { data, fill } = canvas(400, 40, grey);
  fill(30, 8, 16, 16, [200, 40, 30]);
  fill(60, 8, 2, 16, [230, 230, 230]);
  assert.equal(findSwatch(data, 400, 40, 4, 30), "#c8281e");
});

test("finds black and white squares that a saturation test would miss", () => {
  for (const colour of [[10, 10, 10], [245, 245, 245]] as Rgb[]) {
    const { data, fill } = canvas(400, 40, grey);
    fill(12, 6, 18, 18, colour);
    const hex = findSwatch(data, 400, 40, 4, 30);
    assert.equal(hex, `#${colour.map((n) => n.toString(16).padStart(2, "0")).join("")}`);
  }
});

test("thin text strokes alone are not a swatch", () => {
  const { data, fill } = canvas(400, 40, grey);
  for (let x = 20; x < 100; x += 6) fill(x, 8, 2, 16, [230, 230, 230]);
  fill(110, 14, 10, 2, [230, 230, 230]);
  assert.equal(findSwatch(data, 400, 40, 4, 30), null);
});

test("finds a small square in the top line of a two-line row", () => {
  const { data, fill } = canvas(395, 70, [79, 79, 77]);
  fill(11, 5, 8, 8, [193, 46, 31]);
  fill(30, 5, 2, 12, [230, 230, 230]);
  assert.equal(findSwatch(data, 395, 70, 2, 60), "#c12e1f");
});
