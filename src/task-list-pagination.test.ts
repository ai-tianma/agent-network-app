import { taskListPage } from './task-list-pagination';
import { selectClick } from './task-select-model';
let count = 0;
function check(name: string, pass: boolean) { if (!pass) throw new Error(name); count++; }
check('empty has a legal first page', JSON.stringify(taskListPage(0, 9)) === JSON.stringify({ page: 0, pages: 1, start: 0, end: 0, total: 0 }));
check('495 results mount 50 on first page', taskListPage(495, 0).end === 50 && taskListPage(495, 0).pages === 10);
check('last page only has the remaining45', taskListPage(495, 9).start === 450 && taskListPage(495, 9).end === 495);
check('shrink clamps the requested page', taskListPage(51, 9).page === 1 && taskListPage(51, 9).end === 51);
check('negative page clamps to zero', taskListPage(495, -1).start === 0);
check('exact multiple adds no empty page', taskListPage(100, 2).page === 1 && taskListPage(100, 2).pages === 2);
const ids = Array.from({ length: 495 }, (_, i) => `r${i}`), visible = ids.slice(50, 100);
const selected = selectClick({ ids: ['r50'], anchor: 'r50' }, 'r99', { toggle: false, range: true }, visible);
check('range selection never includes unmounted rows', selected.ids.length === 50 && selected.ids.every(id => visible.includes(id)));
console.log(`task list pagination: ${count}/${count} checks passed`);
