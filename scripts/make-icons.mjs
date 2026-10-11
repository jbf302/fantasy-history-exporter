// Generates assets/icon{16,32,48,128}.png with no dependencies:
// a purple rounded square with a white "download into tray" glyph.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = [91, 33, 182];
const FG = [255, 255, 255];

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))
  ]);
}

// Shapes in a unit square [0,1]^2.
function inRoundedSquare(u, v, r = 0.22) {
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  return dx * dx + dy * dy <= r * r;
}
function inGlyph(u, v) {
  if (u >= 0.44 && u <= 0.56 && v >= 0.2 && v <= 0.52) return true; // arrow shaft
  if (v >= 0.46 && v <= 0.64 && Math.abs(u - 0.5) <= (0.64 - v) * 1.1 + 0.0) return true; // arrow head
  if (v >= 0.7 && v <= 0.78 && u >= 0.22 && u <= 0.78) return true; // tray bottom
  if (u >= 0.22 && u <= 0.3 && v >= 0.58 && v <= 0.78) return true; // tray left
  if (u >= 0.7 && u <= 0.78 && v >= 0.58 && v <= 0.78) return true; // tray right
  return false;
}

function render(size) {
  const ss = 4;
  return png(size, (x, y) => {
    let cover = 0, glyph = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = (x + (sx + 0.5) / ss) / size, v = (y + (sy + 0.5) / ss) / size;
      if (inRoundedSquare(u, v)) { cover++; if (inGlyph(u, v)) glyph++; }
    }
    const n = ss * ss;
    if (!cover) return [0, 0, 0, 0];
    const t = glyph / cover;
    return [0, 1, 2].map((i) => Math.round(BG[i] * (1 - t) + FG[i] * t)).concat([Math.round((cover / n) * 255)]);
  });
}

mkdirSync("assets", { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`assets/icon${size}.png`, render(size));
console.log("wrote assets/icon{16,32,48,128}.png");
