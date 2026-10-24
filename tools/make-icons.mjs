// สร้างไอคอน PNG (นาฬิกาเรียบๆ บนพื้นเขียว) ด้วย zlib ของ Node ไม่ต้องลงแพ็กเกจเพิ่ม
// รัน: node tools/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const GREEN = [22, 163, 74], WHITE = [255, 255, 255];

const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// ระยะจากจุดถึงเส้นตรง (สำหรับเข็มนาฬิกา)
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// glyph = สัดส่วนของรัศมีวงนาฬิกาเทียบกับความกว้างภาพ (maskable ต้องเล็กลงให้อยู่ใน safe zone)
function render(size, glyph) {
  const buf = Buffer.alloc(size * size * 3), SS = 3, c = size / 2, R = size * glyph, ring = R * 0.12, hw = R * 0.075;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let cov = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + .5) / SS, py = y + (sy + .5) / SS, d = Math.hypot(px - c, py - c);
      const onRing = d <= R && d >= R - ring;
      const hour = segDist(px, py, c, c, c + R * 0.0, c - R * 0.50) <= hw;      // เข็มสั้น ชี้ขึ้น
      const minute = segDist(px, py, c, c, c + R * 0.46, c + R * 0.0) <= hw;     // เข็มยาว ชี้ขวา
      const hub = d <= hw * 1.5;
      if (onRing || hour || minute || hub) cov++;
    }
    const a = cov / (SS * SS), o = (y * size + x) * 3;
    for (let k = 0; k < 3; k++) buf[o + k] = Math.round(GREEN[k] * (1 - a) + WHITE[k] * a);
  }
  return png(size, buf);
}
fs.mkdirSync(OUT, { recursive: true });
const jobs = [['icon-192.png', 192, 0.38], ['icon-512.png', 512, 0.38], ['icon-maskable-512.png', 512, 0.28], ['apple-touch-icon.png', 180, 0.38]];
for (const [name, size, glyph] of jobs) { fs.writeFileSync(path.join(OUT, name), render(size, glyph)); console.log('เขียน', name); }
