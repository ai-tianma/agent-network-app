// Regenerates the three Android adaptive icon layers from the brand mark.
//
// This exists because mobile-v0.2.32 shipped the previous cyan hub on Android:
// #50 replaced assets/icon.png and left the derived layers behind, and nothing
// caught it. The first fix regenerated them on a laptop with Pillow and SciPy —
// neither of which this repository depends on, so "how these files were made"
// still lived outside the repo. Anything the build cannot re-run is a claim,
// not a process.
//
// Everything below uses one declared dependency (pngjs) and arithmetic, so CI
// re-runs it in a temporary directory and compares the result pixel for pixel.
//
// Usage: node scripts/generate-android-icons.mjs [--out <dir>] [--manifest <path>]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/** Every number the output depends on, recorded in the manifest alongside it. */
export const PARAMS = {
  canvas: 1024,
  /** Android keeps the central 66% of the canvas visible under every mask. */
  safeZoneFraction: 0.66,
  /**
   * Luminance ramp that separates the pale mark from the blue plate.
   * Scheme 16's plate is already bright (about 80–140), so the old dark-plate
   * cut (32/120) swallowed the whole icon. Below `lumaLow` is plate, above
   * `lumaHigh` is solid mark, between is the edge and keeps its gradient.
   */
  lumaLow: 160,
  lumaHigh: 210,
  /** A pixel this opaque in the ramp counts as mark body for component finding. */
  coreThreshold: 0.45,
  /** Grow the kept component so the glow immediately around it survives. */
  dilateRadius: 10,
  /**
   * Plate sample: pixels essentially untouched by the ramp, and opaque. The
   * background colour is their per-channel median — a rule, not a hand-picked
   * value, so re-running on new artwork produces the matching colour.
   */
  plateMaskCeiling: 0.03,
  plateAlphaFloor: 200,
};

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const readPng = (path) => PNG.sync.read(readFileSync(path));

/** Soft mark mask in [0,1]: the luminance ramp, gated by the source alpha. */
const markMask = (png) => {
  const { width, height, data } = png;
  const mask = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const ramp = clamp01((luma(data[i], data[i + 1], data[i + 2]) - PARAMS.lumaLow) /
      (PARAMS.lumaHigh - PARAMS.lumaLow));
    mask[p] = ramp * (data[i + 3] / 255);
  }
  return mask;
};

/**
 * Largest connected component of the mark body.
 *
 * The plate's rounded outline is as saturated as the mark and reaches further,
 * so a threshold alone keeps it and it then drives both the centring and the
 * scale. It is a separate, much smaller component, so this drops it without
 * any colour guessing.
 */
const largestComponent = (mask, width, height) => {
  const core = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) core[i] = mask[i] > PARAMS.coreThreshold ? 1 : 0;
  const seen = new Uint8Array(core.length);
  const best = { size: 0, pixels: null };
  const stack = new Int32Array(core.length);
  for (let start = 0; start < core.length; start += 1) {
    if (!core[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const pixels = [];
    while (top > 0) {
      const p = stack[--top];
      pixels.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (core[n] && !seen[n]) {
          seen[n] = 1;
          stack[top++] = n;
        }
      }
    }
    if (pixels.length > best.size) {
      best.size = pixels.length;
      best.pixels = pixels;
    }
  }
  return best;
};

/** Chebyshev dilation — square kernel, so it is a pair of 1-D passes. */
const dilate = (keep, width, height, radius) => {
  const pass = new Uint8Array(keep.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let d = -radius; d <= radius && !on; d += 1) {
        const nx = x + d;
        if (nx >= 0 && nx < width && keep[y * width + nx]) on = 1;
      }
      pass[y * width + x] = on;
    }
  }
  const out = new Uint8Array(keep.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let on = 0;
      for (let d = -radius; d <= radius && !on; d += 1) {
        const ny = y + d;
        if (ny >= 0 && ny < height && pass[ny * width + x]) on = 1;
      }
      out[y * width + x] = on;
    }
  }
  return out;
};

/**
 * Area-average resample. Deterministic and the right filter for downscaling:
 * every source pixel contributes to exactly the destination pixels it covers.
 */
const resample = (src, srcW, srcH, dstW, dstH) => {
  const out = new Float32Array(dstW * dstH * 4);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let dy = 0; dy < dstH; dy += 1) {
    const y0 = dy * sy;
    const y1 = (dy + 1) * sy;
    for (let dx = 0; dx < dstW; dx += 1) {
      const x0 = dx * sx;
      const x1 = (dx + 1) * sx;
      let r = 0, g = 0, b = 0, a = 0, w = 0;
      for (let y = Math.floor(y0); y < Math.min(Math.ceil(y1), srcH); y += 1) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.min(Math.ceil(x1), srcW); x += 1) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const i = (y * srcW + x) * 4;
          // Weight colour by alpha so transparent pixels cannot wash the edges.
          const av = src[i + 3] * weight;
          r += src[i] * av;
          g += src[i + 1] * av;
          b += src[i + 2] * av;
          a += av;
          w += weight;
        }
      }
      const o = (dy * dstW + dx) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = w > 0 ? a / w : 0;
    }
  }
  return out;
};

const median = (values) => {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.floor(sorted.length / 2)];
};

const toPng = (rgba, size) => {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < rgba.length; i += 1) {
    png.data[i] = Math.max(0, Math.min(255, Math.round(rgba[i])));
  }
  // Adaptive filtering: a flat background compresses to kilobytes instead of a
  // megabyte, and the choice is a pure function of the pixels, so output stays
  // reproducible.
  return PNG.sync.write(png, { deflateLevel: 9, filterType: -1 });
};

export const generate = (sourcePath) => {
  const src = readPng(sourcePath);
  const { width, height, data } = src;
  const mask = markMask(src);

  const component = largestComponent(mask, width, height);
  if (!component.pixels) throw new Error('no mark component found in the source icon');
  const keep = new Uint8Array(mask.length);
  for (const p of component.pixels) keep[p] = 1;
  const kept = dilate(keep, width, height, PARAMS.dilateRadius);

  const marked = new Float32Array(width * height * 4);
  for (let p = 0; p < mask.length; p += 1) {
    const i = p * 4;
    const alpha = kept[p] ? mask[p] : 0;
    marked[i] = data[i];
    marked[i + 1] = data[i + 1];
    marked[i + 2] = data[i + 2];
    marked[i + 3] = alpha * 255;
  }

  // Fit so the outermost visible pixel lands on the safe circle.
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let p = 0; p < mask.length; p += 1) {
    if (marked[p * 4 + 3] <= 127) continue;
    const x = p % width;
    const y = (p - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let maxR = 0;
  for (let p = 0; p < mask.length; p += 1) {
    if (marked[p * 4 + 3] <= 127) continue;
    const x = p % width;
    const y = (p - x) / width;
    const r = Math.hypot(x - cx, y - cy);
    if (r > maxR) maxR = r;
  }
  const safeR = (PARAMS.canvas * PARAMS.safeZoneFraction) / 2;
  const scale = safeR / maxR;
  const side = Math.round(width * scale);
  const scaled = resample(marked, width, height, side, Math.round(height * scale));

  const canvas = PARAMS.canvas;
  const fg = new Float32Array(canvas * canvas * 4);
  const offX = Math.round(canvas / 2 - cx * scale);
  const offY = Math.round(canvas / 2 - cy * scale);
  const scaledH = Math.round(height * scale);
  for (let y = 0; y < scaledH; y += 1) {
    const ty = y + offY;
    if (ty < 0 || ty >= canvas) continue;
    for (let x = 0; x < side; x += 1) {
      const tx = x + offX;
      if (tx < 0 || tx >= canvas) continue;
      const s = (y * side + x) * 4;
      const t = (ty * canvas + tx) * 4;
      fg[t] = scaled[s];
      fg[t + 1] = scaled[s + 1];
      fg[t + 2] = scaled[s + 2];
      fg[t + 3] = scaled[s + 3];
    }
  }

  // Background: median of the plate pixels — a rule that re-derives itself.
  const plateR = [], plateG = [], plateB = [];
  for (let p = 0; p < mask.length; p += 1) {
    const i = p * 4;
    if (mask[p] < PARAMS.plateMaskCeiling && data[i + 3] >= PARAMS.plateAlphaFloor) {
      plateR.push(data[i]);
      plateG.push(data[i + 1]);
      plateB.push(data[i + 2]);
    }
  }
  const bg = [median(plateR), median(plateG), median(plateB)].map((v) => Math.round(v));
  const bgRgba = new Float32Array(canvas * canvas * 4);
  for (let i = 0; i < bgRgba.length; i += 4) {
    bgRgba[i] = bg[0];
    bgRgba[i + 1] = bg[1];
    bgRgba[i + 2] = bg[2];
    bgRgba[i + 3] = 255;
  }

  // Monochrome: the foreground's own coverage as a white silhouette.
  const mono = new Float32Array(canvas * canvas * 4);
  for (let i = 0; i < mono.length; i += 4) {
    mono[i] = mono[i + 1] = mono[i + 2] = 255;
    mono[i + 3] = clamp01((fg[i + 3] / 255 - 0.22) / 0.5) * 255;
  }

  return {
    foreground: toPng(fg, canvas),
    background: toPng(bgRgba, canvas),
    monochrome: toPng(mono, canvas),
    backgroundColor: `#${bg.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
    componentSize: component.size,
  };
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Digest of a text file with newlines normalised.
 *
 * A Windows checkout converts line endings on text files, so hashing raw bytes
 * makes this script's digest depend on which platform cloned the repository —
 * the guard then fails on Windows CI while nothing is actually wrong. Binary
 * assets are unaffected and keep their byte digests.
 */
const sha256Text = (path) =>
  sha256(Buffer.from(readFileSync(path, 'utf8').replace(/\r\n?/g, '\n'), 'utf8'));

const main = () => {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(REPO, 'assets');
  const manifestIndex = args.indexOf('--manifest');
  const manifestPath = manifestIndex >= 0 ? resolve(args[manifestIndex + 1]) : null;

  const sourcePath = join(REPO, 'assets', 'icon.png');
  const result = generate(sourcePath);
  mkdirSync(outDir, { recursive: true });
  const files = {
    'android-icon-foreground.png': result.foreground,
    'android-icon-background.png': result.background,
    'android-icon-monochrome.png': result.monochrome,
  };
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(outDir, name), buf);

  if (manifestPath) {
    const manifest = {
      _why:
        'Ties the Android adaptive layers to the brand mark they are cut from. #50 replaced ' +
        'assets/icon.png and left these behind, and no gate noticed. src/icon-assets.test.ts ' +
        're-runs the generator recorded here and compares pixels, so a brand change that skips ' +
        'regeneration fails at commit time instead of shipping.',
      generator: 'scripts/generate-android-icons.mjs',
      generator_sha256: sha256Text(join(HERE, 'generate-android-icons.mjs')),
      params: PARAMS,
      background_color_rule:
        'per-channel median of source pixels with mark-mask < plateMaskCeiling and alpha >= plateAlphaFloor',
      source: 'assets/icon.png',
      source_sha256: sha256(readFileSync(sourcePath)),
      background_color: result.backgroundColor,
      derived: Object.fromEntries(
        Object.entries(files).map(([name, buf]) => [`assets/${name}`, sha256(buf)]),
      ),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(
    `mark component ${result.componentSize} px, background ${result.backgroundColor}, wrote ${Object.keys(files).length} layers to ${outDir}`,
  );
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
