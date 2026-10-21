// Agent 组织架构页的纯数据:部门树来自 Hub departments,Agent 挂在负责人(人)所在的部门上。
// Hub 支持显式给 Agent 设部门(department_id)时优先于负责人部门;未设置才按负责人推断。
// 调整写入 Hub,内存里的 moves 只用于乐观更新与失败回滚。不 import react-native。
import type { Department, OrgData } from './org-model';
import { subtreeIds } from './org-model';

/** departmentId: Hub 显式设置的部门;undefined = 没设置,沿用负责人部门(旧形状)。 */
export type OrgAgent = { nodeId: string; alias: string; departmentId?: string | null };
export type OrgOwner = {
  userId: string;
  username: string;
  displayName: string;
  /** 通讯录里的部门;不在部门树里时界面按未归属算。 */
  departmentId: string | null;
  agents: OrgAgent[];
};
export type AgentOrgData = {
  departments: Department[];
  owners: OrgOwner[];
  unowned: OrgAgent[];
  /** GET /api/requirements/people/directory 有响应。 */
  directory: boolean;
  /** GET /api/networks/:id/departments 有响应。false 时部门是从通讯录摊平的。 */
  departmentsApi: boolean;
  /**
   * Hub 支持「显式给 Agent 设部门」(nodes.department_id)。
   *
   * #1976(admin 2026-10-21:「Agent 组织架构和人类组织架构是两个独立的」):
   * true ⇒ Agent 放哪个部门**只由显式设置**决定,没有显式归属就是「未归属」,
   * **不再**从「负责人在哪个部门」推断 —— 人类的部门树不该决定 Agent 的位置。
   * false ⇒ 老 Hub 没有显式归属这回事,保留旧的推断口径(此时树本身也是从通讯录摊平的)。
   */
  agentDepartmentSupported: boolean;
};

export type DemoMove = { nodeId: string; departmentId: string | null };

export type PlacedAgent = {
  nodeId: string;
  alias: string;
  ownerUserId: string | null;
  ownerName: string | null;
  sourceDepartmentId: string | null;
  departmentId: string | null;
  demo: boolean;
};

export function ownerLabel(owner: Pick<OrgOwner, 'displayName' | 'username'>): string {
  const display = owner.displayName.trim();
  return display || owner.username;
}

const known = (data: AgentOrgData, id: string | null): id is string => !!id && data.departments.some(d => d.id === id);

function sourceDepartment(data: AgentOrgData, departmentId: string | null): string | null {
  return known(data, departmentId) ? departmentId : null;
}

/** 负责人名下的 Agent 优先于「没有负责人」名单;同一节点只留第一次。
 *  部门优先级:Hub 显式 department_id > 负责人部门 > 未归属;moves 是内存里的乐观覆盖。 */
export function placeAgents(data: AgentOrgData, moves: readonly DemoMove[]): PlacedAgent[] {
  const byNode = new Map<string, PlacedAgent>();
  const add = (agent: OrgAgent, owner: OrgOwner | null) => {
    const nodeId = agent.nodeId.trim();
    if (!nodeId || byNode.has(nodeId)) return;
    const explicit = agent.departmentId !== undefined ? sourceDepartment(data, agent.departmentId) : null;
    // #1976 —— 两种口径:
    //   * Hub 支持显式归属:只认显式的;没有显式归属 ⇒ 未归属。**不从负责人部门推断。**
    //   * 老 Hub(不支持):没有显式归属这回事 ⇒ 退回「按负责人部门推断」的老口径。
    const source = agent.departmentId !== undefined
      ? explicit
      : (data.agentDepartmentSupported
        ? null
        : (owner ? sourceDepartment(data, owner.departmentId) : null));
    byNode.set(nodeId, {
      nodeId,
      alias: agent.alias.trim() || nodeId,
      ownerUserId: owner?.userId ?? null,
      ownerName: owner ? ownerLabel(owner) : null,
      sourceDepartmentId: source,
      departmentId: source,
      demo: false,
    });
  };
  for (const owner of data.owners) for (const agent of owner.agents) add(agent, owner);
  for (const agent of data.unowned) add(agent, null);
  for (const move of moves) {
    const row = byNode.get(move.nodeId);
    if (!row) continue;
    const next = sourceDepartment(data, move.departmentId);
    row.departmentId = next;
    row.demo = next !== row.sourceDepartmentId;
  }
  return [...byNode.values()].sort((a, b) => a.alias.localeCompare(b.alias, 'zh') || a.nodeId.localeCompare(b.nodeId));
}

export function agentsDirectlyIn(placed: readonly PlacedAgent[], dept: string | null): PlacedAgent[] {
  return placed.filter(a => a.departmentId === dept);
}

/** 树上的数字:该部门含下级。未归属(null)只算直接挂在外面的。 */
export function agentCount(placed: readonly PlacedAgent[], data: AgentOrgData, dept: string | null): number {
  if (dept === null) return placed.filter(a => a.departmentId === null).length;
  const ids = subtreeIds(orgTree(data), dept);
  return placed.filter(a => a.departmentId !== null && ids.has(a.departmentId)).length;
}

export function orgTree(data: Pick<AgentOrgData, 'departments'>): OrgData {
  return { departments: data.departments, members: [] };
}
