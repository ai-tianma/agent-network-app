import { expect, test, mock } from 'bun:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
mock.module('react-native', () => ({ View: host('View') }));
mock.module('./src/ui-text', () => ({ Text: host('Text') }));
mock.module('./src/i18n-react', () => ({ useTranslation: () => {} }));
mock.module('./src/theme', () => ({ colors: {}, spacing: { xs: 4 } }));
const { default: Notice } = await import('./src/TaskExecutionNotice');
const { setLanguagePreference } = await import('./src/i18n');
setLanguagePreference('zh');

test('visible receipt changes from Hub delivery to submitted, consumed, then terminal', async () => {
  let tree: any;
  const base = { status: 'running', started_at: '2026-10-13 12:00:00' };
  await act(async () => { tree = create(<Notice task={base} detail />); });
  const state = (name: string) => expect(tree.root.findAll((n: any) => n.type === 'View' && n.props.testID === `task-execution-${name}`)).toHaveLength(1);
  state('received');
  expect(JSON.stringify(tree.toJSON())).toContain('当前没有精确排队名次');
  await act(async () => { tree.update(<Notice task={{ ...base, runtime_submitted_at: 'now' }} />); });
  state('submitted');
  await act(async () => { tree.update(<Notice task={{ ...base, consumed_at: 'now' }} />); });
  state('consumed');
  await act(async () => { tree.update(<Notice task={{ ...base, consumed_at: 'now', status: 'failed' }} />); });
  state('failed');
  await act(async () => tree.unmount());
});

test('legacy unknown and target disconnection are distinct rendered outcomes', async () => {
  let tree: any;
  await act(async () => { tree = create(<Notice task={{ status: 'running' }} detail />); });
  expect(JSON.stringify(tree.toJSON())).toContain('开始状态未确认');
  await act(async () => { tree.update(<Notice task={{ status: 'running' }} detail diagnostic={{ schema_version: 1, code: 'target_no_live_sse', evidence: { task_status: 'running', runtime_consumed: false, runtime_submitted: false, target_ever_reported_runtime_evidence: false, target_session_status: 'idle', live_sse_connections: 0 } }} />); });
  expect(JSON.stringify(tree.toJSON())).toContain('Hub 未检测到目标接收连接');
  expect(JSON.stringify(tree.toJSON())).not.toContain('开始状态未确认');
  await act(async () => tree.unmount());
});
