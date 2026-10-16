/**
 * Composer @ picker. Selecting a row fills `@alias ` into the draft.
 * It does not send. A leading backslash (`\@`) is ordinary text.
 */
export type MentionAgent = {
  alias: string;
  label?: string | null;
  online?: boolean;
};

export type MentionCandidate = {
  alias: string;
  label: string;
  online: boolean;
  insert: string;
};

const LEADING_SPACE = /^(\s*)/;

/** The @ token being typed, or null when the menu should stay closed. */
export function mentionQuery(input: string): string | null {
  const prefix = input.match(LEADING_SPACE)?.[0] ?? "";
  const rest = input.slice(prefix.length);
  if (rest.startsWith("\\@")) return null;
  if (!rest.startsWith("@")) return null;
  const token = rest.slice(1);
  if (/\s/.test(token)) return null;
  return token;
}

export function mentionMenuOpen(input: string): boolean {
  return mentionQuery(input) !== null;
}

export function mentionCandidates(input: string, agents: MentionAgent[]): MentionCandidate[] {
  const query = mentionQuery(input);
  if (query === null) return [];
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const rows: MentionCandidate[] = [];
  for (const agent of agents) {
    const alias = agent.alias.trim();
    if (!alias || seen.has(alias)) continue;
    const label = (agent.label || alias).trim();
    if (q && !alias.toLowerCase().includes(q) && !label.toLowerCase().includes(q)) continue;
    seen.add(alias);
    rows.push({
      alias,
      label,
      online: agent.online === true,
      insert: `@${alias} `,
    });
  }
  rows.sort((a, b) => Number(b.online) - Number(a.online) || a.alias.localeCompare(b.alias, "zh"));
  return rows;
}
