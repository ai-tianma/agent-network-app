// Cold start showed ~0.5 s of a white rounded card with a grey grid and three
// concentric circles (Vincent, Android). That picture is not ours: it is
// `splashscreen_logo.png` from the bare template inside `expo/template.tgz`.
// `expo prebuild` copies the template, and only the expo-splash-screen config
// plugin replaces that drawable and the `Theme.App.SplashScreen` that stretches
// it over the whole window. The app never installed expo-splash-screen and had
// no splash config, so every Android build shipped the template placeholder.
// iOS got the template storyboard pointing at an image set that did not exist
// (a blank system-colour screen); the desktop page had no background at all and
// painted white until React's first frame.
//
// So this pins the three launch surfaces to the brand and the theme:
//   1. the splash plugin is installed and configured, light and dark;
//   2. every image the launch surfaces reference is a brand asset, is not one of
//      the template placeholder digests, and actually carries colour (the
//      placeholder is pure grey on white, so a greyscale image is refused even
//      if a future template changes its bytes);
//   3. the splash and web boot backgrounds are the app's own ground colours.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (rel: string): string =>
  fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO, rel.replace(/^\.\//, '')));
const sha256 = (rel: string): string =>
  createHash('sha256').update(fs.readFileSync(path.join(REPO, rel.replace(/^\.\//, '')))).digest('hex');

let p = 0;
let t = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  t++;
  if (ok) {
    p++;
    console.log(`PASS: ${name}`);
  } else {
    failures.push(name);
    console.error(`FAIL: ${name}`);
  }
};

// splashscreen_logo.png at mdpi..xxxhdpi from expo/template.tgz (SDK 56), the
// exact files Vincent's build carried.
const TEMPLATE_PLACEHOLDER_SHA256 = new Set([
  'f84b9b17a4a1c7d7dd840cd272c07a6c3fd66d5a9826b64bb53facb6f176bc24',
  '721c895579cb08ec4c9a0fe7dadafe9a97c33ef758d3578ad5e8b540de59f974',
  'e1c5250e339add5ed7849cb0859d052edb9781abb91db049e68ae3a4059247d7',
  '23d97ccb41a821ee345b2c5bb0c9bdab730a751a9227925acbf0af021dc38a9b',
  'be9fac5c4cda48c41dce592288c486524bba3e4ca7fa00c0a04a46928154b5bf',
]);

type SplashConfig = {
  image?: string;
  backgroundColor?: string;
  imageWidth?: number;
  dark?: { image?: string; backgroundColor?: string };
};

const pkg = JSON.parse(readText('package.json')) as { dependencies?: Record<string, string> };
const expo = (JSON.parse(readText('app.json')) as { expo: any }).expo;
const plugins: unknown[] = expo.plugins ?? [];
const splashEntry = plugins.find(
  (entry) => entry === 'expo-splash-screen' || (Array.isArray(entry) && entry[0] === 'expo-splash-screen'),
);
const splash: SplashConfig = Array.isArray(splashEntry) ? (splashEntry[1] as SplashConfig) ?? {} : {};
const derivation = JSON.parse(readText('assets/icon-derivation.json')) as {
  source: string;
  derived: Record<string, string>;
};
const brandAssets = new Set([
  derivation.source,
  ...Object.keys(derivation.derived),
  'assets/splash-icon.png',
  'assets/mark-light.png',
  'assets/mark-dark.png',
]);

// Ground colours of the two palettes in src/theme.ts.
const theme = readText('src/theme.ts');
const groundOf = (name: string): string | undefined =>
  theme.match(new RegExp(`const ${name}\\b[^=]*=\\s*\\{[^}]*?\\bbg:\\s*'(#[0-9a-fA-F]{6})'`))?.[1]?.toLowerCase();
const darkBg = groundOf('DARK');
const lightBg = groundOf('LIGHT');
check('src/theme.ts still declares DARK.bg and LIGHT.bg', !!darkBg && !!lightBg);

/** Share of visible pixels that are clearly coloured (not grey/white/black). */
const chromaticShare = (rel: string): number => {
  const png = PNG.sync.read(fs.readFileSync(path.join(REPO, rel.replace(/^\.\//, ''))));
  let visible = 0;
  let coloured = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 128) continue;
    visible++;
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 40) coloured++;
  }
  return visible ? coloured / visible : 0;
};

// 1. Plugin installed and configured.
check('expo-splash-screen is a dependency (without it prebuild keeps the template placeholder)',
  !!pkg.dependencies?.['expo-splash-screen']);
check('app.json configures the expo-splash-screen plugin', Array.isArray(splashEntry));
check('splash has an image', typeof splash.image === 'string');
check('splash has a backgroundColor', typeof splash.backgroundColor === 'string');
check('splash has a dark variant with its own image and backgroundColor',
  typeof splash.dark?.image === 'string' && typeof splash.dark?.backgroundColor === 'string');
check('no top-level expo.splash competing with the plugin config', expo.splash === undefined);

// 3. Backgrounds are the app's own ground colours.
check(`splash backgroundColor is LIGHT.bg (${lightBg})`, splash.backgroundColor?.toLowerCase() === lightBg);
check(`splash dark backgroundColor is DARK.bg (${darkBg})`, splash.dark?.backgroundColor?.toLowerCase() === darkBg);

// 2. Every launch-surface image is a real brand asset.
const adaptive = expo.android?.adaptiveIcon ?? {};
const referenced: Array<[string, string | undefined]> = [
  ['splash image', splash.image],
  ['splash dark image', splash.dark?.image],
  ['app icon', expo.icon],
  ['iOS icon', expo.ios?.icon],
  ['adaptive foreground', adaptive.foregroundImage],
  ['adaptive background', adaptive.backgroundImage],
];
for (const [label, ref] of referenced) {
  const rel = ref?.replace(/^\.\//, '');
  const present = !!rel && exists(rel);
  check(`${label} (${ref ?? 'unset'}) exists`, present);
  if (!present) continue;
  check(`${label} is not a template placeholder`, !TEMPLATE_PLACEHOLDER_SHA256.has(sha256(rel!)));
  if (label !== 'adaptive background' && label !== 'iOS icon') {
    check(`${label} is a brand asset (icon.png or derived from it)`, brandAssets.has(rel!));
  }
}
// The background layer is a flat plate by design; the marks must carry colour.
for (const [label, ref] of [['splash image', splash.image], ['splash dark image', splash.dark?.image],
  ['adaptive foreground', adaptive.foregroundImage]] as const) {
  if (!ref || !exists(ref)) continue;
  const share = chromaticShare(ref);
  check(`${label} carries colour (${(share * 100).toFixed(1)}% chromatic pixels, placeholder ≈0%)`, share > 0.2);
}
// The placeholder itself must fail the colour criterion, or the criterion proves nothing.
{
  const grey = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < grey.data.length; i += 4) grey.data.set([220, 220, 224, 255], i);
  const tmp = path.join(REPO, 'node_modules', '.splash-assets-probe.png');
  let share = 1;
  try {
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, PNG.sync.write(grey));
    share = chromaticShare(path.relative(REPO, tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  check('a grey-on-white image scores as colourless (positive control)', share === 0);
}

// Desktop / web: the page must paint the ground colour before the bundle runs.
const html = exists('public/index.html') ? readText('public/index.html') : '';
check('public/index.html overrides the Expo template (which has no background)', html.length > 0);
check('web boot background: dark ground by default', html.includes(`background: ${darkBg};`));
check('web boot background: light ground for a light system scheme',
  new RegExp(`prefers-color-scheme:\\s*light[\\s\\S]*?background:\\s*${lightBg}`, 'i').test(html));
check('web boot background honours the saved theme (theme_mode_v1)', html.includes("'theme_mode_v1'"));
check('theme_mode_v1 is still the desktop theme key',
  readText('src/desktop-theme-storage.ts').includes("const THEME_KEY = 'theme_mode_v1';"));
const tauri = JSON.parse(readText('src-tauri/tauri.conf.json')) as { app: { windows: Array<{ backgroundColor?: string }> } };
check('Tauri windows open on the dark ground, not white',
  tauri.app.windows.every((w) => w.backgroundColor?.toLowerCase() === darkBg));

console.log(`\nsplash assets: ${p}/${t} passed`);
if (failures.length) process.exit(1);
