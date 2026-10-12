export const TASK_LIST_PAGE_SIZE = 50;
export function taskListPage(total: number, requested: number) {
  const pages = Math.max(1, Math.ceil(total / TASK_LIST_PAGE_SIZE));
  const page = Math.min(Math.max(0, requested), pages - 1);
  const start = page * TASK_LIST_PAGE_SIZE;
  return { page, pages, start, end: Math.min(total, start + TASK_LIST_PAGE_SIZE), total };
}
