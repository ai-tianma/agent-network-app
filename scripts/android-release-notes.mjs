#!/usr/bin/env node
// Release notes for the Android channel on the mirror (android/<ver>/notes.md, see src/android-update-core.ts).
//
//   node scripts/android-release-notes.mjs <release-desktop-auto-update.yml> <version> > notes.md
//
// The source is the same text the desktop release uses: the `releaseBody` block of
// .github/workflows/release-desktop-auto-update.yml, which tauri-action copies into the GitHub release body
// and latest.json `notes` (the version bump PR adds "What's new in <ver>:" there). The publish workflow reads
// that file AT THE COMMIT THE APK WAS BUILT FROM, so the notes always match the APK.
// The desktop packaging paragraph ("Signed and notarized update for macOS ...") is dropped for Android:
// phone users don't install a macOS/Windows bundle (stripDesktopPackagingHeader).
//
// Exits 1 (and prints nothing on stdout) when the block is missing, still has the __VERSION__ placeholder
// unexpanded in a heading, or has no "What's new in <version>:" section with at least one "- " item:
// the Android page must never go out without this version's notes (owner 2026-09-30 screenshot).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The literal `releaseBody: |-` / `|` block scalar → its text (indentation removed). null when absent. */
export function extractReleaseBody(workflowText) {
  const lines = String(workflowText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^\s*releaseBody:\s*\|[-+]?\s*$/.test(line));
  if (start < 0) return null;
  const keyIndent = lines[start].match(/^\s*/)[0].length;
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.match(/^\s*/)[0].length <= keyIndent) break;
    block.push(line);
  }
  const indents = block.filter((line) => line.trim() !== '').map((line) => line.match(/^\s*/)[0].length);
  if (!indents.length) return null;
  const cut = Math.min(...indents);
  return block.map((line) => line.slice(cut)).join('\n').trim();
}

/** Items (the "- " lines) under "What's new in <version>:" up to the next heading. */
export function versionItems(body, version) {
  const lines = String(body ?? '').split('\n');
  const heading = (line) => /^What's new in\s+v?[0-9][^\s:]*\s*:\s*$/i.test(line.trim());
  const start = lines.findIndex((line) => heading(line) && line.trim().replace(/^What's new in\s+v?/i, '').replace(/\s*:\s*$/, '') === version);
  if (start < 0) return [];
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (heading(line)) break;
    const m = /^\s*[-*]\s+(\S.*)$/.exec(line);
    if (m) items.push(m[1].trim());
  }
  return items;
}

/** The notes.md content for `version`, or an Error describing why there is none. */
export function androidReleaseNotes(workflowText, version) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version ?? ''))) return new Error(`version must be X.Y.Z, got ${version}`);
  const body = extractReleaseBody(workflowText);
  if (!body) return new Error('no releaseBody block in the release workflow');
  if (!versionItems(body, version).length) return new Error(`releaseBody has no "What's new in ${version}:" section with items`);
  return `${stripDesktopPackagingHeader(body)}\n`;
}

/**
 * Android users don't install a macOS/Windows bundle, so the desktop packaging
 * paragraph that opens the shared releaseBody ("Signed and notarized update for
 * macOS ... Windows ... Ubuntu ...") is noise in the phone's update page. Drop
 * only that exact leading paragraph; any other intro text is kept.
 */
export function stripDesktopPackagingHeader(body) {
  const text = String(body ?? '').trim();
  const paragraphs = text.split(/\n\s*\n/);
  if (paragraphs.length > 1 && /^Signed and notarized update for macOS\b/i.test(paragraphs[0].trim())) {
    return paragraphs.slice(1).join('\n\n').trim();
  }
  return text;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file, version] = process.argv.slice(2);
  if (!file || !version) {
    console.error('usage: android-release-notes.mjs <release-desktop-auto-update.yml> <version>');
    process.exit(2);
  }
  const notes = androidReleaseNotes(readFileSync(file, 'utf8'), version);
  if (notes instanceof Error) {
    console.error(`::error::${notes.message}`);
    process.exit(1);
  }
  process.stdout.write(notes);
}
