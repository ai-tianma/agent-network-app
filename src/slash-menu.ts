/**
 * Chat composer slash menu (#1050 slice 1).
 *
 * A leading `/` opens a candidate list above the input. Selecting a row only
 * fills the draft; it never sends. `/btw` stays the only routed command.
 * A leading backslash (`\/...`) is an ordinary message, same as btw-command.ts.
 */
import type { SkillSummary } from "./node-skills";

export type SlashGroup = "command" | "skill";

export type SlashCandidate = {
  id: string;
  group: SlashGroup;
  label: string;
  description: string;
  /** Text written into the draft. No trailing send. */
  insert: string;
};

export const ANET_SLASH_COMMANDS: SlashCandidate[] = [
  {
    id: "cmd:btw",
    group: "command",
    label: "/btw",
    description: "旁路提问，不进入主对话",
    insert: "/btw ",
  },
];

const LEADING_SPACE = /^(\s*)/;

export function slashQuery(input: string): string | null {
  const prefix = input.match(LEADING_SPACE)?.[0] ?? "";
  const rest = input.slice(prefix.length);
  if (rest.startsWith("\\/")) return null;
  if (!rest.startsWith("/")) return null;
  const token = rest.slice(1);
  if (/\s/.test(token)) return null;
  return token;
}

export function slashMenuOpen(input: string): boolean {
  return slashQuery(input) !== null;
}

function matches(query: string, label: string, description: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q) || description.toLowerCase().includes(q);
}

export function slashCandidates(input: string, skills: SkillSummary[]): SlashCandidate[] {
  const query = slashQuery(input);
  if (query === null) return [];
  const commands = ANET_SLASH_COMMANDS.filter(item => matches(query, item.label, item.description));
  const skillRows: SlashCandidate[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    const label = `/${skill.name}`;
    const description = skill.description || skill.name;
    if (!matches(query, label, description)) continue;
    skillRows.push({
      id: `skill:${skill.name}`,
      group: "skill",
      label,
      description,
      insert: `/${skill.name} `,
    });
  }
  return [...commands, ...skillRows];
}

export function slashGroupLabel(group: SlashGroup): string {
  return group === "command" ? "ANet 命令" : "节点技能";
}

export function moveSlashIndex(index: number, count: number, key: "up" | "down"): number {
  if (count <= 0) return 0;
  if (key === "down") return (index + 1) % count;
  return (index - 1 + count) % count;
}
