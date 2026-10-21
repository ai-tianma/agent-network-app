// Generates the GitHub org avatar and the three social-preview images from the
// scheme 16 brand mark.
//
// Why this exists: the GitHub org avatar and the repo social preview can only
// be uploaded by an owner through the web UI, so the artwork has to be ready
// *before* anyone can upload it. Before this script, #1925 had no file to
// upload at all — the owner was asked to upload something that did not exist.
//
// Everything below uses one declared dependency (pngjs) and arithmetic, the
// same rule scripts/generate-android-icons.mjs follows: the build can re-run
// it, so "how these files were made" stays in the repo instead of in someone's
// laptop.
//
// Usage: node scripts/generate-github-social-assets.mjs [--out <dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/** Every number the output depends on. */
export const PARAMS = {
  /** GitHub org avatar: square, shown as a circle. */
  avatar: { size: 500, source: 'assets/icon.png' },
  /** Social preview: GitHub recommends 1280×640; the two smaller ones are fallbacks. */
  previews: [
    { file: 'social-preview-1280x640.png', width: 1280, height: 640 },
    { file: 'social-preview-1200x600.png', width: 1200, height: 600 },
    { file: 'social-preview-640x320.png', width: 640, height: 320 },
  ],
  /** Scheme 16 gradient, light → cyan. */
  gradient: { from: [0x1b, 0x65, 0xdb], to: [0x0e, 0xa5, 0xe9] },
  /** The mark as it reads on a dark plate (assets/mark-dark.png). */
  mark: { source: 'assets/mark-dark.png', heightFraction: 0.46 },
  /** Wordmark: 5×7 bitmap glyphs, "ANET". */
  wordmark: { text: 'ANET', heightFraction: 0.17, gap: 4, color: [0xff, 0xff, 0xff] },
};

const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
};

const readPng = (path) => PNG.sync.read(readFileSync(path));
const writePng = (path, png) => writeFileSync(path, PNG.sync.write(png, { deflateLevel: 9, filterType: -1 }));

/** Bilinear-free nearest sample of an RGBA source into a target box. */
function drawScaled(dst, src, x0, y0, w, h) {
  const { width: sw, height: sh, data: sd } = src;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / w));
      const si = (sy * sw + sx) * 4;
      const a = sd[si + 3] / 255;
      if (a <= 0) continue;
      const di = ((y0 + y) * dst.width + (x0 + x)) * 4;
      for (let c = 0; c < 3; c++) {
        const s = sd[si + c];
        dst.data[di + c] = Math.round(s * a + dst.data[di + c] * (1 - a));
      }
      dst.data[di + 3] = 255;
    }
  }
}

function drawText(dst, text, x0, y0, scale, color) {
  let x = x0;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`no glyph for ${ch}`);
    glyph.forEach((row, gy) => {
      [...row].forEach((cell, gx) => {
        if (cell !== '#') return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = x + gx * scale + dx;
            const py = y0 + gy * scale + dy;
            if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue;
            const di = (py * dst.width + px) * 4;
            dst.data[di] = color[0];
            dst.data[di + 1] = color[1];
            dst.data[di + 2] = color[2];
            dst.data[di + 3] = 255;
          }
        }
      });
    });
    x += 5 * scale + PARAMS.wordmark.gap * scale;
  }
  return x - x0 - PARAMS.wordmark.gap * scale;
}

function gradientCanvas(width, height) {
  const png = new PNG({ width, height });
  const { from, to } = PARAMS.gradient;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Diagonal ramp: the mark sits on the deeper blue, the far corner brightens.
      const t = Math.min(1, Math.max(0, (x / width) * 0.65 + (y / height) * 0.35));
      const di = (y * width + x) * 4;
      png.data[di] = Math.round(from[0] + (to[0] - from[0]) * t);
      png.data[di + 1] = Math.round(from[1] + (to[1] - from[1]) * t);
      png.data[di + 2] = Math.round(from[2] + (to[2] - from[2]) * t);
      png.data[di + 3] = 255;
    }
  }
  return png;
}

export function buildAvatar(icon) {
  const size = PARAMS.avatar.size;
  const out = new PNG({ width: size, height: size });
  drawScaled(out, icon, 0, 0, size, size);
  return out;
}

export function buildPreview(mark, width, height) {
  const out = gradientCanvas(width, height);
  const markH = Math.round(height * PARAMS.mark.heightFraction);
  const markW = Math.round((mark.width / mark.height) * markH);
  const scale = Math.max(4, Math.round((height * PARAMS.wordmark.heightFraction) / 7));
  const textW = PARAMS.wordmark.text.length * (5 * scale + PARAMS.wordmark.gap * scale) - PARAMS.wordmark.gap * scale;
  const gap = Math.round(width * 0.05);

  // One centred group: mark + wordmark. Anything else leaves a lopsided plate.
  const groupW = markW + gap + textW;
  const markX = Math.round((width - groupW) / 2);
  const markY = Math.round((height - markH) / 2);
  drawScaled(out, mark, markX, markY, markW, markH);

  const textX = markX + markW + gap;
  const textY = Math.round((height - 7 * scale) / 2);
  drawText(out, PARAMS.wordmark.text, textX, textY, scale, PARAMS.wordmark.color);
  if (textX + textW > width) throw new Error('wordmark does not fit');
  return out;
}

function main() {
  const outArg = process.argv.indexOf('--out');
  const outDir = outArg >= 0 ? resolve(process.argv[outArg + 1]) : join(REPO, 'assets');
  mkdirSync(outDir, { recursive: true });
  const icon = readPng(join(REPO, PARAMS.avatar.source));
  const mark = readPng(join(REPO, PARAMS.mark.source));
  writePng(join(outDir, 'github-avatar-500.png'), buildAvatar(icon));
  for (const p of PARAMS.previews) {
    writePng(join(outDir, p.file), buildPreview(mark, p.width, p.height));
  }
  console.log(`github social assets written to ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
