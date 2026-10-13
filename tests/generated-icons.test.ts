import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import test from 'node:test';

function crc(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); payload.copy(result, 4);
  result.writeUInt32BE(crc(payload), result.length - 4);
  return result;
}
function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'leileios-icons-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'web/public'), { recursive: true });
  copyFileSync('scripts/generate-web-icons.mjs', join(root, 'scripts/generate-web-icons.mjs'));
  const names = ['favicon.svg', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png'];
  for (const name of names) copyFileSync(join('web/public', name), join(root, 'web/public', name));
  return { root, icon: join(root, 'web/public/apple-touch-icon.png'), check: () => spawnSync(process.execPath, [join(root, 'scripts/generate-web-icons.mjs'), '--check'], { encoding: 'utf8' }) };
}
function reencode(png: Buffer, changePixels = false, trailingData = false): Buffer {
  let offset = 8; let header = Buffer.alloc(0); const compressed: Buffer[] = [];
  while (offset < png.length) {
    const size = png.readUInt32BE(offset); const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') header = body;
    if (type === 'IDAT') compressed.push(body);
    offset += size + 12;
  }
  const scanlines = inflateSync(Buffer.concat(compressed));
  if (changePixels) scanlines[10] ^= 1;
  const data = Buffer.concat([deflateSync(scanlines, { level: 0 }), trailingData ? Buffer.from("extra-zlib-data") : Buffer.alloc(0)]);
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', data.subarray(0, 100)), chunk('IDAT', data.subarray(100)), chunk('IEND', Buffer.alloc(0))]);
}

test('generated icon check accepts identical pixels with different compression and split IDAT', (t) => {
  const f = fixture(t); const original = readFileSync(f.icon); const reencoded = reencode(original);
  assert.notDeepEqual(reencoded, original);
  writeFileSync(f.icon, reencoded);
  const result = f.check(); assert.equal(result.status, 0, result.stderr);
});
test('generated icon check still rejects a changed pixel', (t) => {
  const f = fixture(t); writeFileSync(f.icon, reencode(readFileSync(f.icon), true));
  assert.equal(f.check().status, 1);
});
for (const damage of ['crc', 'truncated', 'trailing'] as const) {
  test(`generated icon check rejects ${damage} corruption without rewriting it`, (t) => {
    const f = fixture(t); let bytes = readFileSync(f.icon);
    if (damage === 'crc') bytes[29] ^= 1;
    if (damage === 'truncated') bytes = bytes.subarray(0, bytes.length - 5);
    if (damage === 'trailing') bytes = Buffer.concat([bytes, Buffer.from('unexpected')]);
    writeFileSync(f.icon, bytes);
    assert.equal(f.check().status, 1); assert.deepEqual(readFileSync(f.icon), bytes);
  });
}
test('generated SVG remains an exact source contract', (t) => {
  const f = fixture(t); writeFileSync(join(f.root, 'web/public/favicon.svg'), '<svg/>');
  assert.equal(f.check().status, 1);
});

test('generated icon check rejects extra data after the compressed image stream', (t) => {
  const f = fixture(t); writeFileSync(f.icon, reencode(readFileSync(f.icon), false, true));
  assert.equal(f.check().status, 1);
});
