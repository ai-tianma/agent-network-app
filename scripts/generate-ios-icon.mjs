// app#180 — the iOS home-screen icon showed a white frame: assets/icon.png is RGBA with ~6% fully
// transparent margin on every side, and iOS flattens transparency to white before applying its own
// squircle mask. iOS wants an opaque 1024x1024 with the artwork bleeding to the edge; the corners
// are cut by the OS. This derives that file from the brand mark, deterministically:
//   1. bounding box of the opaque content (alpha >= contentAlpha);
//   2. crop the centred square of side bbox/zoom — the mark's own rounded corners (~24% radius)
//      then fall outside Apple's ~22.4% mask, so no fill ever shows through;
//   3. flatten what little alpha is left (the corner slivers) onto `fill`, the mark's plate colour;
//   4. box-resample to canvas and write RGB (no alpha channel at all).
// Only pngjs and arithmetic, so the result is the same on every CI runner; src/ios-icon-assets.test.ts
// re-runs this and compares pixels with the committed file.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

export const PARAMS = {
  canvas: 1024,
  /** alpha at or above this counts as content when finding the bounding box */
  contentAlpha: 200,
  /** crop side = content side / zoom; 1.065 puts a 24%-radius corner outside Apple's 22.4% mask */
  zoom: 1.065,
  /** plate colour the remaining translucent slivers are flattened onto (scheme 16's darkest plate tone, #1550B8) */
  fill: [21, 80, 184],
};

const readPng = (path) => PNG.sync.read(readFileSync(path));

const contentBox = (png) => {
  const { width, height, data } = png;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= PARAMS.contentAlpha) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
};

/** Box (area-average) resample of an RGB float buffer. */
const resampleRgb = (src, srcW, srcH, dstW, dstH) => {
  const out = new Float64Array(dstW * dstH * 3);
  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = (dy * srcH) / dstH, sy1 = ((dy + 1) * srcH) / dstH;
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = (dx * srcW) / dstW, sx1 = ((dx + 1) * srcW) / dstW;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const w = wy * (Math.min(sx + 1, sx1) - Math.max(sx, sx0));
          const i = (sy * srcW + sx) * 3;
          r += src[i] * w; g += src[i + 1] * w; b += src[i + 2] * w; wsum += w;
        }
      }
      const o = (dy * dstW + dx) * 3;
      out[o] = r / wsum; out[o + 1] = g / wsum; out[o + 2] = b / wsum;
    }
  }
  return out;
};

export const generate = (sourcePath) => {
  const src = readPng(sourcePath);
  const box = contentBox(src);
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const inner = Math.round(side / PARAMS.zoom);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const L = Math.round(cx - inner / 2), T = Math.round(cy - inner / 2);
  // crop + flatten onto fill (straight alpha over an opaque plate)
  const rgb = new Float64Array(inner * inner * 3);
  const [fr, fg, fb] = PARAMS.fill;
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const sx = L + x, sy = T + y;
      let r = fr, g = fg, b = fb;
      if (sx >= 0 && sy >= 0 && sx < src.width && sy < src.height) {
        const i = (sy * src.width + sx) * 4;
        const a = src.data[i + 3] / 255;
        r = src.data[i] * a + fr * (1 - a);
        g = src.data[i + 1] * a + fg * (1 - a);
        b = src.data[i + 2] * a + fb * (1 - a);
      }
      const o = (y * inner + x) * 3;
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    }
  }
  const out = resampleRgb(rgb, inner, inner, PARAMS.canvas, PARAMS.canvas);
  const png = new PNG({ width: PARAMS.canvas, height: PARAMS.canvas, colorType: 2 });
  for (let i = 0, o = 0; i < out.length; i += 3, o += 4) {
    png.data[o] = Math.round(out[i]); png.data[o + 1] = Math.round(out[i + 1]); png.data[o + 2] = Math.round(out[i + 2]); png.data[o + 3] = 255;
  }
  return { png: PNG.sync.write(png, { colorType: 2 }), box, inner };
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sha256Text = (path) => sha256(Buffer.from(readFileSync(path, 'utf8').replace(/\r\n?/g, '\n'), 'utf8'));

const main = () => {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(REPO, 'assets');
  const writeManifest = args.includes('--write-manifest');
  mkdirSync(outDir, { recursive: true });
  const sourcePath = join(REPO, 'assets', 'icon.png');
  const { png, box, inner } = generate(sourcePath);
  writeFileSync(join(outDir, 'icon-ios.png'), png);
  if (writeManifest) {
    const manifest = {
      _why: 'app#180 — iOS flattens the transparent margin of assets/icon.png to white and shows a frame around the mark. This ties the opaque full-bleed iOS icon to the brand mark it is cut from; src/ios-icon-assets.test.ts re-runs the generator recorded here and compares pixels, so a brand change that skips regeneration fails at commit time.',
      generator: 'scripts/generate-ios-icon.mjs',
      generator_sha256: sha256Text(join(REPO, 'scripts', 'generate-ios-icon.mjs')),
      params: PARAMS,
      crop_rule: 'centred square of side max(bbox w,h)/zoom over the alpha>=contentAlpha bounding box; residual alpha flattened onto fill; box-resampled to canvas; written RGB without alpha',
      content_box: box,
      crop_side: inner,
      source: 'assets/icon.png',
      source_sha256: sha256(readFileSync(sourcePath)),
      derived: { 'assets/icon-ios.png': sha256(png) },
    };
    writeFileSync(join(REPO, 'assets', 'ios-icon-derivation.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(`icon-ios.png ${PARAMS.canvas}x${PARAMS.canvas} RGB from bbox ${JSON.stringify(box)} crop ${inner}px → ${outDir}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
