import { mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";

const outputDirectory = new URL("../web/public/", import.meta.url);
const checkOnly = process.argv.includes("--check");
const CANVAS_SIZE = 512;
const BACKGROUND = [255, 255, 255];
const FOREGROUND = [0x7d, 0x84, 0x7f];
const L = {
  x: 176,
  y: 78,
  stemWidth: 80,
  stemHeight: 316,
  footWidth: 204,
  footHeight: 80,
};

function scaledGeometry(scale) {
  const center = CANVAS_SIZE / 2;
  const scalePoint = (value) => center + (value - center) * scale;
  return {
    x: scalePoint(L.x),
    y: scalePoint(L.y),
    stemWidth: L.stemWidth * scale,
    stemHeight: L.stemHeight * scale,
    footWidth: L.footWidth * scale,
    footHeight: L.footHeight * scale,
  };
}

function lPath(scale = 1) {
  const geometry = scaledGeometry(scale);
  const right = geometry.x + geometry.footWidth;
  const stemRight = geometry.x + geometry.stemWidth;
  const bottom = geometry.y + geometry.stemHeight;
  const footTop = bottom - geometry.footHeight;
  return `M ${geometry.x} ${geometry.y} H ${stemRight} V ${footTop} H ${right} V ${bottom} H ${geometry.x} Z`;
}

function insideL(x, y, scale = 1) {
  const geometry = scaledGeometry(scale);
  const right = geometry.x + geometry.footWidth;
  const stemRight = geometry.x + geometry.stemWidth;
  const bottom = geometry.y + geometry.stemHeight;
  const footTop = bottom - geometry.footHeight;
  return (
    x >= geometry.x &&
    x <= right &&
    y >= geometry.y &&
    y <= bottom &&
    (x <= stemRight || y >= footTop)
  );
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(payload), 8 + data.length);
  return chunk;
}

// PNG compression differs between supported Node/zlib versions. Validate the
// generated format and compare decoded scanlines instead of compressed bytes.
function pngContent(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("PNG signature");
  let offset = 8;
  let header;
  const data = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG truncation");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("PNG chunk truncation");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error("PNG checksum");
    if (type === "IHDR" && !header && offset === 8 && length === 13) {
      header = body;
    } else if (type === "IDAT" && header) {
      data.push(body);
    } else if (type === "IEND" && header && data.length && length === 0 && end === bytes.length) {
      const compressed = Buffer.concat(data);
      const decoded = inflateSync(compressed, { info: true, maxOutputLength: 512 * (1 + 512 * 3) });
      if (decoded.engine.bytesWritten !== compressed.length) throw new Error("PNG compressed stream has extra data");
      return { header, rows: decoded.buffer };
    } else {
      throw new Error("Unexpected generated PNG structure");
    }
    offset = end;
  }
  throw new Error("PNG end missing");
}

function sameGeneratedPng(actual, expected) {
  try {
    const left = pngContent(actual);
    const right = pngContent(expected);
    return left.header.equals(right.header) && left.rows.equals(right.rows);
  } catch {
    return false;
  }
}

function renderPng(size, scale = 1) {
  const samplesPerAxis = 4;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    let offset = 1;
    for (let x = 0; x < size; x += 1) {
      let coverage = 0;
      for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
        for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
          const sourceX = ((x + (sampleX + 0.5) / samplesPerAxis) / size) * CANVAS_SIZE;
          const sourceY = ((y + (sampleY + 0.5) / samplesPerAxis) / size) * CANVAS_SIZE;
          if (insideL(sourceX, sourceY, scale)) coverage += 1;
        }
      }
      const amount = coverage / (samplesPerAxis * samplesPerAxis);
      for (let channel = 0; channel < 3; channel += 1) {
        row[offset++] = Math.round(
          BACKGROUND[channel] * (1 - amount) + FOREGROUND[channel] * amount,
        );
      }
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function svgMaster() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" role="img" aria-labelledby="title">
  <title id="title">LeileiOS</title>
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#fff"/>
  <path fill="#7d847f" d="${lPath()}"/>
</svg>
`;
}

const expectedOutputs = new Map([
  ["favicon.svg", Buffer.from(svgMaster())],
  ["apple-touch-icon.png", renderPng(180)],
  ["pwa-192.png", renderPng(192)],
  ["pwa-512.png", renderPng(512)],
  ["pwa-maskable-512.png", renderPng(512, 0.76)],
]);

if (checkOnly) {
  const staleArtifacts = [];
  for (const [filename, expected] of expectedOutputs) {
    const actual = await readFile(new URL(filename, outputDirectory)).catch(() => null);
    if (!actual || !(filename.endsWith(".png") ? sameGeneratedPng(actual, expected) : actual.equals(expected))) staleArtifacts.push(filename);
  }

  if (staleArtifacts.length > 0) {
    console.error(`Web icons are stale: ${staleArtifacts.join(", ")}; run pnpm web:icons.`);
    process.exitCode = 1;
  } else {
    console.log("Web icons are fresh.");
  }
} else {
  await mkdir(outputDirectory, { recursive: true });
  for (const [filename, contents] of expectedOutputs) {
    await writeFile(new URL(filename, outputDirectory), contents);
  }
}
