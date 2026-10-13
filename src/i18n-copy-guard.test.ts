import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { t as translate } from './i18n';
import './i18n-chat';
import './i18n-daemon';
import './i18n-agent-org';
import './i18n-settings';
import './i18n-tasks';
import './i18n-task-issues';
import './i18n-task-tags';
import './i18n-tag-status';
import './i18n-task-fields';
import './i18n-accounts';
import './i18n-users';
import './i18n-sessions';
import './i18n-password';
import './i18n-changelog';
import './i18n-fatal';
import './node-adoption';
import './node-control-access';
import './i18n-provider';
import './i18n-backend-pending';
import './i18n-hub-scope';
import './i18n-runtime-support';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
// Expand this explicit migration boundary as additional surfaces are translated.
const migrated = ['src/MobileNavRail.tsx', 'src/ServerSidebar.tsx', 'src/ChatScreen.tsx', 'src/ChatInfoPanel.tsx', 'src/ComposerRowParts.tsx', 'src/VoiceInputUI.tsx', 'src/DesktopVoiceBar.tsx', 'src/LanguageSettings.tsx', 'src/SettingsScreen.tsx', 'src/SettingsPhonePages.tsx', 'src/SettingsEditPages.tsx', 'src/UiScaleSettings.tsx', 'src/ShortcutsSettings.tsx', 'src/VoiceSettingsSection.tsx'];
migrated.push(...['TasksScreen', 'RequirementBoard', 'TaskBoardParts', 'TaskCardMenu', 'TaskChecklist', 'TaskCreateDialog', 'TaskDescriptionEditor', 'TaskDescriptionFullscreen', 'TaskSelectMenu', 'TaskFieldPickers', 'TaskWindow', 'TaskDetailPanel', 'TaskDetailScreen', 'TaskDuePicker', 'TaskFilterSidebar', 'TaskProjectManager', 'TaskRelations', 'RequirementPeoplePicker', 'RequirementAssignmentsEditor'].map(name => `src/${name}.tsx`));
migrated.push('src/TaskIssueBindings.tsx');
migrated.push('src/RichDescriptionEditor.tsx');
migrated.push('src/TaskTags.tsx');
migrated.push('src/TaskListFields.tsx', 'src/TaskListTable.tsx', 'src/TaskListCellEditor.tsx');
migrated.push('src/TaskTimeCell.tsx');
migrated.push('src/TaskGantt.tsx', 'src/TaskCalendar.tsx');
migrated.push('src/TaskDashboard.tsx', 'src/ShareCardNative.tsx');
migrated.push('src/TaskTagStatusChart.tsx');
migrated.push('src/AccountSwitcher.tsx', 'src/AccountRowActions.tsx');
migrated.push('src/UserManagementPanel.tsx', 'src/DmChatScreen.tsx');
migrated.push('src/MemberEditor.tsx', 'src/MemberEditorKit.tsx', 'src/TaskAccessSection.tsx', 'src/RemoveSheet.tsx');
migrated.push('src/ChangelogScreen.tsx');
migrated.push('src/FatalBoundary.tsx', 'src/LastCrashChip.tsx');
migrated.push('src/ManageDepartment.tsx');
migrated.push('src/ChangePasswordPanel.tsx', 'src/WeakPasswordBanner.tsx');
migrated.push('src/NodeAdoptionControls.tsx');
migrated.push('src/NodeControlCard.tsx');
migrated.push('src/CodexProviderFields.tsx');
migrated.push('src/OpenCodeProviderNote.tsx');
migrated.push('src/DaemonRuntimeProviders.tsx');
migrated.push('src/DaemonManagementScreen.tsx');
migrated.push('src/DaemonOverviewSection.tsx');
migrated.push('src/DaemonOverviewFixtureScreen.tsx');
migrated.push('src/BackendPendingDemo.tsx');
migrated.push('src/HubPendingScreen.tsx');
migrated.push('src/HubDaemonEntryScreen.tsx');
migrated.push('src/RuntimeSupportScreen.tsx');
migrated.push('src/backend-pending-ui.tsx');
migrated.push('src/HubScopeScreen.tsx');
migrated.push('src/HubScopeFixtureScreen.tsx');
migrated.push('src/AgentOrgScreen.tsx');
function untranslated(file: string, raw: string): string[] {
  const source = raw.replace(/\r\n?/g, '\n');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = source.split('\n');
  const failures: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (/\p{Script=Han}/u.test(node.text)) {
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
        // Only a reasoned adjacent comment can waive a data/protocol literal.
        const allowed = /\/\/ i18n-allow: \S.+/.test(lines[line - 1] || '');
        if (!allowed) failures.push(`${file}:${line + 1} ${node.text.trim().slice(0, 60)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return failures;
}
ck('reject JSX Chinese', untranslated('x.tsx', '<Text>发送</Text>').length === 1);
ck('reject Chinese accessibility copy', untranslated('x.tsx', '<View accessibilityLabel="返回" />').length === 1);
ck('ignore explanatory comments', untranslated('x.tsx', '// 中文说明\nconst x = "key";').length === 0);
ck('reasoned data exception and CRLF', untranslated('x.tsx', '// i18n-allow: protocol marker, not UI\r\nconst x = "附件";').length === 0);
ck('reason-free exception is not accepted', untranslated('x.tsx', '// i18n-allow:\nconst x = "发送";').length === 1);
ck('scope paths are POSIX', migrated.every(file => file === path.posix.normalize(file) && !file.includes('\\')));
for (const file of migrated) {
  const failures = untranslated(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  ck(`${file} contains no untranslated UI literals${failures.length ? '\n' + failures.join('\n') : ''}`, failures.length === 0);
}
// App also contains login/onboarding, intentionally outside this first migration.
// Still scan every navigation definition instead of silently exempting the whole file.
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const navigation = [...app.matchAll(/const (?:DESKTOP_TABS|MOBILE_TABS|MOBILE_RAIL_TABS) = \[([\s\S]*?)\] as const;/g)];
ck('all three App navigation definitions are guarded', navigation.length === 3 && navigation.every(match => untranslated('App.tsx', match[0]).length === 0));
const missing: string[] = [];
for (const file of migrated) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['t', 'tr'].includes(node.expression.text)) {
      const key = node.arguments[0];
      if (key && ts.isStringLiteral(key) && translate(key.text) === key.text) missing.push(`${file}: ${key.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
ck(`all literal translation keys exist${missing.length ? '\n' + missing.join('\n') : ''}`, missing.length === 0);
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
