export type OpenCodeGeneration = 'v1' | 'v2';

// Generation, not the shared runtime ID, determines this wizard's creation mode.
// Keep V1's legacy payload unchanged: it does not request TUI copresence.
export const OPENCODE_GENERATION_LABELS: Record<OpenCodeGeneration, string> = {
  v1: 'V1（兼容默认 · headless）',
  v2: 'V2（实验性 TUI 共存）',
};
export const OPENCODE_V1_NOTE = 'V1 沿用兼容创建协议，默认以 headless 后台模式运行；此入口不请求 TUI 共存，也不代表 TUI 已启动。';

export const OPENCODE_V2_WARNING = 'V2 是高风险预览：所有本地工具可用，可读写文件、执行命令。仅用于可信任务；不是安全沙箱。当前仅 Linux 链路完成候选验证，其他平台尚未验收。';

export interface OpenCodeCreateOptions {
  runtimeId: string;
  opencodeGeneration?: OpenCodeGeneration;
  opencodeUnsafeTools?: boolean;
  model: string;
}

export function opencodeCreateError(i: OpenCodeCreateOptions): string | null {
  if (i.runtimeId !== 'opencode-cli') return null;
  if (i.opencodeGeneration !== undefined && i.opencodeGeneration !== 'v1' && i.opencodeGeneration !== 'v2') return '请选择明确的 OpenCode 代际。';
  if (i.opencodeGeneration !== 'v2') return null;
  if (i.opencodeUnsafeTools !== true) return '创建 V2 前，请明确同意仅将其用于可信任务，并允许所有本地工具。';
  const parts = i.model.split('/');
  if (i.model.length > 100 || !/^[A-Za-z0-9_.:/-]+$/.test(i.model)
    || parts.length !== 2 || parts.some(p => !p || /^\.+$/.test(p))) {
    return 'V2 模型必须是有效的 provider/model（最多 100 个字符），且需已在目标机器配置可用。';
  }
  return null;
}

export function opencodeCreateFlags(i: OpenCodeCreateOptions): Record<string, unknown> {
  const error = opencodeCreateError(i);
  if (error) throw new Error(error);
  // Never leak stale OpenCode consent to another runtime or V1. Omitting V1
  // preserves old Hub compatibility; V2 uses strict flags, never top-level keys.
  return i.runtimeId === 'opencode-cli' && i.opencodeGeneration === 'v2'
    ? { opencodeGeneration: 'v2', opencodeUnsafeTools: true } : {};
}

export function describeOpenCodeCreateError(e: { error?: string | null; field?: string | null }): string | null {
  const why = e.error ?? '';
  if ((why === 'flag_key_unknown' && ['opencodeGeneration', 'opencodeUnsafeTools'].includes(e.field ?? ''))
    || /flag_key_unknown:(opencodeGeneration|opencodeUnsafeTools)\b/.test(why)) {
    return '目标 Hub 或 daemon 不支持 V2 创建协议。请先升级到已验收的兼容版本；不会自动改为 V1 或放宽授权。';
  }
  return null;
}
