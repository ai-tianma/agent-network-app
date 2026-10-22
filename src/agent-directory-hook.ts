// #725: load the authorized directory for the Agents list.
//
// Kept deliberately separate from the 10 s status poll: the full /api/status
// projection is far heavier than `light=1`, so this refreshes slowly and never
// blocks the chat list. A failed read leaves the previous rows alone.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubConfig } from './api';
import { buildAgentDirectory, type AgentDirectory, type AgentDirectoryRow } from './agent-directory';
import { fetchAgentDirectory } from './agent-directory-reader';

const REFRESH_MS = 120_000;

export type AgentDirectoryState = {
  rows: AgentDirectoryRow[];
  /** false until one authorized read finished; the block must not claim "none" before that. */
  loaded: boolean;
  nodesRead: AgentDirectory['nodesRead'] | null;
  sessionsRead: AgentDirectory['sessionsRead'] | null;
};

export function useAgentDirectory(cfg: HubConfig | null, enabled: boolean): AgentDirectoryState {
  const [state, setState] = useState<AgentDirectoryState>({ rows: [], loaded: false, nodesRead: null, sessionsRead: null });
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!cfg || !enabled) return;
    const gen = ++generation.current;
    // The scope key binds account scope + this generation, so a late reply from
    // an older read cannot answer the current question.
    const scopeKey = `agents-directory:${cfg.profileId ?? 'legacy'}:${gen}`;
    try {
      const read = await fetchAgentDirectory(cfg, { scopeKey });
      if (gen !== generation.current) return;
      const dir = buildAgentDirectory(read);
      setState({ rows: dir.rows, loaded: true, nodesRead: dir.nodesRead, sessionsRead: dir.sessionsRead });
    } catch {
      // keep the previous rows; never turn a failure into "nothing registered"
      if (gen === generation.current) setState(prev => ({ ...prev }));
    }
  }, [cfg, enabled]);

  useEffect(() => {
    if (!cfg || !enabled) return;
    let alive = true;
    void load();
    const timer = setInterval(() => { if (alive) void load(); }, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [cfg, enabled, load]);

  return state;
}
