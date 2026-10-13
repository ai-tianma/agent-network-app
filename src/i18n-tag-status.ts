import { registerTranslations } from './i18n';
registerTranslations({
  'tagStats.title': ['按标签的任务状态', 'Task status by tag'],
  'tagStats.full': ['当前未归档 · {n} 个可见任务', 'Current unarchived · {n} visible tasks'],
  'tagStats.partial': ['已加载的部分数据 · {n} 个任务', 'Partial loaded data · {n} tasks'],
  'tagStats.partialBadge': ['部分数据 · {n}', 'Partial · {n} loaded'],
  'tagStats.note': ['按待处理数量排序 · 多标签分别计数，标签合计≠去重总量', 'Sorted by open tasks · Multi-tag tasks count in each tag; tag totals are not unique task totals'],
  'tagStats.untagged': ['无标签（未设置）', 'Untagged (no label)'],
  'tagStats.pool': ['需求池', 'Pool'],
  'tagStats.doing': ['进行中', 'In progress'],
  'tagStats.done': ['完成', 'Done'],
  'tagStats.abandoned': ['废弃', 'Abandoned'],
  'tagStats.empty': ['当前范围没有未归档任务。', 'No unarchived tasks in this scope.'],
  'tagStats.expand': ['展开全部 {n} 个标签', 'Show all {n} tags'],
  'tagStats.collapse': ['收起为前 10 个', 'Show top 10'],
  'tagStats.allProjects': ['全部项目', 'All projects'],
  'tagStats.open': ['查看 {tag} · {status} · {n} 个任务', 'View {tag} · {status} · {n} tasks'],
});
