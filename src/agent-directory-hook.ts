// #725: load the authorized directory for the Agents list.
//
// Kept deliberately separate from the 10 s status poll: the full /api/status
// projection is far heavier than `light=1`, so this refreshes slowly and never
// blocks the chat list.
//
// Failure policy (this is the part that is easy to get wrong):
//   - a *transient* failure (one endpoint unavailable / aborted / non-JSON) must
//     NOT overwrite known rows with an empty directory, and must not claim the
//     rows are current — it marks them stale and keeps them;
//   - a *first* read that never succeeded keeps the block hidden (loaded=false),
//     so nothing claims "no registered nodes";
//   - a scope change (different profile/account/hub) resets everything, because
//     rows from another authorization must never be reused.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubConfig } from './api';
import { buildAgentDirectory, type AgentDirectory, type AgentDirectoryRow } from './agent-directory';
import { fetchAgentDirectory } from './agent-directory-reader';

const REFRESH_MS = 120_000;

export type AgentDirectoryState = {
  rows: AgentDirectoryRow[];
  /** True only after an authorized read produced a usable directory. */
  loaded: boolean;
  /** True when the last attempt failed and `rows` are from an earlier successful read. */
  stale: boolean;
  nodesRead: AgentDirectory['nodesRead'] | null;
  sessionsRead: AgentDirectory['sessionsRead'] | null;
};

const EMPTY: AgentDirectoryState = { rows: [], loaded: false, stale: false, nodesRead: null, sessionsRead: null };

/** Authorization scope identity. Changing any of these invalidates cached rows. */
export function directoryScope(cfg: HubConfig): string {
  return [cfg.serverUrl, cfg.profileId ?? 'legacy', cfg.username ?? ''].join('\u0000');
}

export function useAgentDirectory(cfg: HubConfig | null, enabled: boolean): AgentDirectoryState {
  const [state, setState] = useState<AgentDirectoryState>(EMPTY);
  const generation = useRef(0);
  const scopeRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!cfg || !enabled) return;
    const scope = directoryScope(cfg);
    // Authorization scope changed: drop rows from the previous authorization
    // instead of showing them under the new one.
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      setState(EMPTY);
    }
    const gen = ++generation.current;
    const scopeKey = `agents-directory:${scope}:${gen}`;
    try {
      const read = await fetchAgentDirectory(cfg, { scopeKey });
      if (gen !== generation.current) return;
      const dir = buildAgentDirectory(read);
      // A read is only usable when both endpoints answered. Otherwise keep what we
      // had (marked stale) and never present an empty directory as the truth.
      const usable = dir.nodesRead === 'ok' && dir.sessionsRead === 'ok';
      setState(prev => usable
        ? { rows: dir.rows, loaded: true, stale: false, nodesRead: dir.nodesRead, sessionsRead: dir.sessionsRead }
        : {
            ...prev,
            // First-ever failure: stay unloaded (hidden), do not claim "none".
            loaded: prev.loaded,
            stale: prev.loaded,
            nodesRead: dir.nodesRead,
            sessionsRead: dir.sessionsRead,
          });
    } catch {
      if (gen !== generation.current) return;
      setState(prev => ({ ...prev, stale: prev.loaded }));
    }
  }, [cfg, enabled]);

  useEffect(() => {
    if (!cfg || !enabled) return;
    let alive = true;
    void load();
    const timer = setInterval(() => { if (alive) void load(); }, REFRESH_MS);
    return () => {
      alive = false;
      // Invalidate in-flight replies so a late answer cannot land on a later scope.
      generation.current++;
      clearInterval(timer);
    };
  }, [cfg, enabled, load]);

  return state;
}
