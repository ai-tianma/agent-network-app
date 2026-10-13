import { View } from 'react-native';
import { Text } from './ui-text';
import { t } from './i18n';
import './i18n-tasks';
import { useTranslation } from './i18n-react';
import type { HubTask } from './api';
import { taskExecutionState, type TaskDiagnostic } from './task-execution';
import { colors, spacing } from './theme';



/** Pure receipt view: chat/list reuse their existing poll, only detail reads diagnostic. */
export default function TaskExecutionNotice({ task, diagnostic, detail = false }: {
  task: HubTask; diagnostic?: TaskDiagnostic | null; detail?: boolean;
}) {
  useTranslation();
  const state = taskExecutionState(task, diagnostic);
  const hint = state === 'received' || state === 'submitted' ? 'waitHint'
    : state === 'evidenceAbsent' || state === 'unconfirmed' ? 'evidenceHint'
    : ['missing', 'offline', 'disconnected'].includes(state) ? 'connectionHint' : null;
  return <View testID={`task-execution-${state}`} style={{ gap: spacing.xs }}>
    <Text style={{ color: state === 'failed' ? colors.failed : colors.textMuted, fontSize: detail ? 14 : 11 }}>
      {t(`execution.${state}`)}
    </Text>
    {detail && hint ? <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t(`execution.${hint}`)}</Text> : null}
  </View>;
}
