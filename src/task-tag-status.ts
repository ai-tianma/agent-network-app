import type { ReqColumn, Requirement } from './requirements-model';
import { EMPTY_FILTER, NO_PROJECT, type BoardFilter } from './task-board-model';

export const TAG_STATES: readonly ReqColumn[] = ['pool', 'doing', 'done', 'abandoned'];
export interface TagBucket { tag: string | null; pool: number; doing: number; done: number; abandoned: number; total: number }
export interface TagSnapshot { complete: boolean; total: number; buckets: TagBucket[] }
export const statsProject = (project: string | undefined): string | null => project === NO_PROJECT ? 'none' : project || null;
export const inStatsProject = (item: Requirement, project: string | null): boolean => project === null || (project === 'none' ? !item.projectId : item.projectId === project);
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const sortBuckets = (buckets: TagBucket[]) => buckets.sort((a, b) => (b.pool + b.doing) - (a.pool + a.doing) || b.total - a.total || String(a.tag).localeCompare(String(b.tag)));

/** Only a complete current snapshot for this exact scope may be called full. */
export function parseTagSnapshot(raw: unknown, project: string | null): TagSnapshot | null {
  const s = (raw as any)?.tag_status;
  if (!s || s.basis !== 'current' || s.complete !== true || s.includes_archived !== false || s.project_filter !== project || !count(s.total) || !Array.isArray(s.by_tag)) return null;
  const seen = new Set<string | null>();
  const buckets: TagBucket[] = [];
  for (const r of s.by_tag) {
    if (!r || !(r.tag === null || typeof r.tag === 'string' && r.tag.length > 0) || seen.has(r.tag) || !TAG_STATES.every(k => count(r[k])) || !count(r.total) || r.total !== TAG_STATES.reduce((n, k) => n + r[k], 0) || r.total > s.total) return null;
    seen.add(r.tag);
    buckets.push({ tag: r.tag, pool: r.pool, doing: r.doing, done: r.done, abandoned: r.abandoned, total: r.total });
  }
  if (s.total > 0 && !buckets.length) return null;
  return { complete: true, total: s.total, buckets: sortBuckets(buckets) };
}

/** Loaded cards are a partial snapshot; never infer full scope from page size. */
export function loadedTagSnapshot(items: readonly Requirement[], project: string | null): TagSnapshot {
  const buckets = new Map<string | null, TagBucket>();
  const seen = new Set<string>();
  let total = 0;
  for (const item of items) {
    if (seen.has(item.id) || item.archived || !inStatsProject(item, project)) continue;
    seen.add(item.id); total++;
    const tags = [...new Set((item.tags ?? []).filter(t => !!t))];
    for (const tag of tags.length ? tags : [null]) {
      const r = buckets.get(tag) ?? { tag, pool: 0, doing: 0, done: 0, abandoned: 0, total: 0 };
      r[item.column]++; r.total++; buckets.set(tag, r);
    }
  }
  return { complete: false, total, buckets: sortBuckets([...buckets.values()]) };
}

/** A chart click expresses exactly one tag/state in the same project. */
export function tagStatusFilter(tag: string | null, status: ReqColumn, project?: string): BoardFilter {
  return { ...EMPTY_FILTER, project, tag: tag ?? '', untagged: tag === null, statuses: [status], showAbandoned: status === 'abandoned' };
}
