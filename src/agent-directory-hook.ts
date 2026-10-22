// #725: load the authorized directory for the Agents list.
//
// Deliberately separate from the 10 s status poll: the full /api/status
// projection is far heavier than `light=1`. It reuses the app's foreground-only
// poller (usePoll) so it pauses in background, stays single-flight and backs off
// while reads fail — a private setInterval would keep hitting the Hub.
//
// Failure policy (easy to get wrong, so spelled out):
//   - a *transient* failure (one endpoint unavailable / aborted / non-JSON) must
//     NOT overwrite known rows with an empty directory, and must not claim the
//     rows are current — keep them and mark them stale;
//   - a *first* read that never succeeded keeps the block hidden (loaded=false),
//     so nothing claims "no registered nodes";
//   - a scope change (different hub/profile/user) resets everything: rows from
//     another authorization must never be shown under the new one.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubConfig } from './api';
import { buildAgentDirectory, type AgentDirectory, type AgentDirectoryRow } from './agent-directory';
import { fetchAgentDirectory } from './agent-directory-reader';
import { usePoll } from './usePoll';

const REFRESH_MS = 120_000;

export type AgentDirectoryState = {
  rows: AgentDirectoryRow[];
  /** True only after an authorized read produced a usable directory. */
  loaded: boolean;
  /** True when the last attempt failed and `rows` come from an earlier successful read. */
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

  // Invalidate in-flight replies whenever the authorization scope changes or the
  // block is disabled: a late answer from the previous scope must not land here.
  useEffect(() => {
    generation.current++;
    const scope = cfg ? directoryScope(cfg) : null;
    if (!cfg || !enabled) {
      scopeRef.current = null;
      setState(EMPTY);
      return;
    }
    if (scopeRef.current !== null && scopeRef.current !== scope) {
      scopeRef.current = scope;
      setState(EMPTY);
      return;
    }
    scopeRef.current = scope;
  }, [cfg, enabled]);

  const load = useCallback(async () => {
    if (!cfg || !enabled) return;
    const scope = directoryScope(cfg);
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
      const usable = dir.nodesRead === 'ok' && dir.sessionsRead === 'ok';
      setState(prev => usable
        ? { rows: dir.rows, loaded: true, stale: false, nodesRead: dir.nodesRead, sessionsRead: dir.sessionsRead }
        : {
            ...prev,
            // First-ever failure stays unloaded (hidden); later failures keep the
            // last good rows but mark them stale instead of showing "none".
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

  // Foreground-only, single-flight, backoff (usePoll) — same policy as the list.
  usePoll(load, REFRESH_MS, [load]);

  return state;
}
