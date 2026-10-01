/**
 * Generates the PWA icons, deterministically, with no image library.
 *
 * Run with `npm run icons`.
 *
 * ## Why a script rather than committed binaries
 *
 * A PWA needs raster icons — 192, 512, and a maskable 512 — and there is no image tool in this
 * project, and adding one (sharp, imagemagick, a canvas polyfill) for four small monochrome files
 * would be a dependency the product never uses. So the icons are *drawn* here, as pixels, and
 * written as PNGs by hand.
 *
 * PNG is not hard to write when the image is what this one is: a flat background, straight edges,
 * and no compression worth doing. The format is a signature, an IHDR, an IDAT holding
 * zlib-deflated scanlines (each prefixed with a filter byte of 0, meaning "no filtering"), and an
 * IEND. `zlib` is a Node built-in, so the deflate is the real one rather than a stored-block
 * fallback.
 *
 * ## Determinism
 *
 * The same input produces byte-identical output, on every machine and every run: the drawing is
 * pure arithmetic over `(x, y)`, the zlib level is fixed, and Node's deflate is deterministic for
 * a fixed input and level. That matters because it means the icons are reviewable — `git diff`
 * shows a change in pixels, not a change in whatever tool produced them.
 *
 * ## The mark
 *
 * Black on white, matching the application's existing identity: `globals.css` uses `#171717` for
 * text and buttons on `#ffffff`, and nothing else. The glyph is an **H** — the initial, drawn from
 * three rectangles — inside a rounded square, because an unstyled square is what a browser shows
 * in a tab and a letter is what a person recognises on a home screen.
 *
 * `maskable` variants keep the H inside the middle 80% of the canvas, because a maskable icon may
 * be cropped to a circle, a squircle, or a rounded square by the platform, and anything outside
 * that safe zone can be cut off.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(projectRoot, "public");

/** The two colours. Named after where they come from, so a theme change has one place to follow. */
const INK = [0x17, 0x17, 0x17, 0xff];
const PAPER = [0xff, 0xff, 0xff, 0xff];

/**
 * Writes one RGBA PNG.
 *
 * Every row is `filter byte + width * 4 bytes`, and the rows are concatenated in order, which is
 * what PNG's "no filter" scanline format is. `deflateSync` at a fixed level keeps the output
 * reproducible.
 */
function writePng(file, size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;

  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // Filter type 0: none.
    offset += 1;

    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);

    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); // Width
  header.writeUInt32BE(size, 4); // Height
  header[8] = 8; // Bit depth
  header[9] = 6; // Colour type 6: RGBA
  header[10] = 0; // Compression: deflate
  header[11] = 0; // Filter: adaptive
  header[12] = 0; // Interlace: none

  const file_bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  fs.writeFileSync(file, file_bytes);

  return file_bytes.length;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;

    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

/** CRC-32, as PNG defines it. */
function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Whether a point is inside a rounded square.
 *
 * Signed distance to a rounded box, so the corners are one continuous curve rather than a step
 * approximation. `half` is the half-width of the box, and `radius` the corner radius.
 */
function insideRoundedSquare(x, y, size, half, radius) {
  const centre = size / 2;
  const dx = Math.abs(x + 0.5 - centre) - (half - radius);
  const dy = Math.abs(y + 0.5 - centre) - (half - radius);

  if (dx <= 0 && dy <= 0) {
    return true;
  }

  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);

  return ox * ox + oy * oy <= radius * radius;
}

/**
 * The mark: a rounded square with an H cut out of it.
 *
 * `inset` shrinks the plate, and `stroke` is the thickness of the H's strokes. Both scale with
 * `size`, so one drawing serves every resolution and the mark is identical in proportion at 192
 * and at 512 — which is what makes the icons a set rather than three separate pictures.
 */
function mark(size, { inset, plate, letter }) {
  const half = (size - inset * 2) / 2;
  const radius = half * 0.22;

  // The H, as three rectangles: two uprights and a crossbar.
  const stemWidth = Math.max(2, Math.round(size * 0.075));
  const barThickness = Math.max(2, Math.round(size * 0.075));
  const centre = size / 2;
  const gap = size * letter.gap;
  const height = size * letter.height;
  const top = centre - height / 2;
  const left = centre - gap / 2 - stemWidth;
  const right = centre + gap / 2;

  function inH(x, y) {
    const px = x + 0.5;
    const py = y + 0.5;

    if (
      px >= left &&
      px <= left + stemWidth &&
      py >= top &&
      py <= top + height
    ) {
      return true;
    }

    if (
      px >= right &&
      px <= right + stemWidth &&
      py >= top &&
      py <= top + height
    ) {
      return true;
    }

    return (
      px >= left &&
      px <= right + stemWidth &&
      py >= centre - barThickness / 2 &&
      py <= centre + barThickness / 2
    );
  }

  return (x, y) => {
    if (!insideRoundedSquare(x, y, size, half, radius)) {
      // Transparent outside the plate, so a maskable icon is not a white square with a white
      // background painted over the platform's own.
      return [0, 0, 0, 0];
    }

    return inH(x, y) ? PAPER : plate;
  };
}

const FILES = [
  {
    name: "icon-192.png",
    size: 192,
    // "any": the standard icon, used by the manifest and by any browser that asks for this size.
    options: { inset: 8, plate: INK, letter: { gap: 0.2, height: 0.42 } },
  },
  {
    name: "icon-512.png",
    size: 512,
    options: { inset: 20, plate: INK, letter: { gap: 0.2, height: 0.42 } },
  },
  {
    name: "icon-maskable-512.png",
    size: 512,
    // The safe zone is the middle 80%: the plate fills the canvas so a circular mask still sees
    // ink, and the H is pulled inward so nothing important is cropped away.
    options: { inset: 0, plate: INK, letter: { gap: 0.26, height: 0.3 } },
  },
  {
    name: "apple-touch-icon.png",
    size: 180,
    options: { inset: 6, plate: INK, letter: { gap: 0.2, height: 0.42 } },
  },
  {
    name: "favicon.png",
    size: 32,
    options: { inset: 1, plate: INK, letter: { gap: 0.24, height: 0.5 } },
  },
];

fs.mkdirSync(outputDirectory, { recursive: true });

for (const file of FILES) {
  const drawing = mark(file.size, file.options);
  const bytes = writePng(
    path.join(outputDirectory, file.name),
    file.size,
    drawing,
  );

  console.log(
    `wrote public/${file.name} (${file.size}x${file.size}, ${bytes} bytes)`,
  );
}
