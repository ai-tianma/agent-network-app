import { readFileSync } from 'node:fs';
import { colors, setThemeMode } from './theme';

let failed = 0;
const ck = (name: string, ok: boolean) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
};

const rgb = (hex: string): [number, number, number] => {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(i => Number.parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
};
const luminance = (hex: string): number => {
  const channel = (n: number) => {
    const s = n / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const mode of ['dark', 'light'] as const) {
  setThemeMode(mode);
  ck(`${mode} onAccent passes AA on accent`, contrast(colors.onAccent, colors.accent) >= 4.5);
  ck(`${mode} broadcast passes AA on card`, contrast(colors.broadcast, colors.card) >= 4.5);
  ck(`${mode} running passes AA on card`, contrast(colors.running, colors.card) >= 4.5);
  ck(`${mode} failed passes AA on card`, contrast(colors.failed, colors.card) >= 4.5);
}

const expectedTokens: Record<string, string[]> = {
  'AvatarEditSection.tsx': ['msg.ok ? colors.running : colors.failed'],
  'ChatScreen.tsx': ['desktopSendText: { color: colors.onAccent'],
  // 2026-09-29:主按钮的字统一从 elevation.ts 的 buttonTextStyle('primary') 来(它取 colors.onAccent,下面单独钉)。
  'SideThreadDrawer.tsx': ["askButtonText: { ...buttonTextStyle('primary')"],
  'MessagesScreen.tsx': ["type === 'broadcast') return colors.broadcast"],
  'NodeDetailScreen.tsx': [
    "style={[styles.retryBtnText, pendingAction === 'delete_node' && { color: colors.failed }]}",
    "pendingAction === 'delete_node' && { backgroundColor: colors.card, borderColor: colors.failed, borderWidth: 1 }",
  ],
  'CreateNodeWizardScreen.tsx': ["primaryBtnText: { ...buttonTextStyle('primary')"],
  'HostSupervisorPickerScreen.tsx': [
    "primaryBtnText: { ...buttonTextStyle('primary')",
    "retryBtnText: { ...buttonTextStyle('primary')",
  ],
  'elevation.ts': ["color: kind === 'primary' ? colors.onAccent : colors.accent"],
};

for (const [file, needles] of Object.entries(expectedTokens)) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  for (const needle of needles) ck(`${file} consumes semantic token: ${needle}`, source.includes(needle));
}

setThemeMode('dark');
process.exit(failed ? 1 : 0);
