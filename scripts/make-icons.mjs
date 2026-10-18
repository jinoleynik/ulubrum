// Renders the PWA icons (four colored gems on a dark tile) to PNG with no dependencies: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const GEMS = [[-1, -1, [229, 72, 77]], [1, -1, [62, 142, 247]], [-1, 1, [74, 222, 128]], [1, 1, [245, 197, 24]]];
const BG = [13, 18, 25];

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
/** `scale` shrinks the artwork toward the center (maskable icons need a safe zone). */
function png(size, scale) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const u = (size * scale) / 512;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / u, dy = (y - size / 2) / u;
      let px = BG, a = 1;
      for (const [gx, gy, col] of GEMS) {
        const d = Math.hypot(dx - gx * 80, dy - gy * 80);
        const cov = Math.min(1, Math.max(0, (64 - d) * u + 0.5)); // 1px anti-aliased edge
        if (cov > 0) px = px.map((v, i) => Math.round(v * (1 - cov) + col[i] * cov));
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = 255 * a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const out = (name, size, scale = 1) => writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), png(size, scale));
out('icon-192.png', 192);
out('icon-512.png', 512);
out('icon-maskable-512.png', 512, 0.8);
out('apple-touch-icon.png', 180);
