import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const size = 256;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) {
  const row = y * (size * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < size; x++) {
    const i = row + 1 + x * 4;
    const dx = x - 127.5;
    const dy = y - 127.5;
    const distance = Math.hypot(dx, dy);
    raw[i] = 0x12;
    raw[i + 1] = 0x14;
    raw[i + 2] = 0x17;
    raw[i + 3] = distance < 120 ? 255 : 0;
    if (distance < 72) {
      raw[i] = 0xe2;
      raw[i + 1] = 0xa2;
      raw[i + 2] = 0x1a;
    }
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), 8 + data.length);
  return out;
}

function crc(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
const file = path.join(path.dirname(new URL(import.meta.url).pathname), "icon.png");
fs.writeFileSync(file, png);
