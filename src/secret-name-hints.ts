// 金库里的密钥名「只差一点点」时，别让人以为自己在加一个新名字。
//
// 实测(2026-10-21,通信欧2号转达)：金库里同时有 **TMPAT** 和 **TM_PAT** 两个名字 ——
// 只差一个下划线，而两者不是同一个东西。后来那个 TM_PAT 是 2026-10-21 09:00Z 才写进去的
// (GET /api/secrets 的 updated_at)，也就是说：有人以为原来的名字不对，于是又建了一个。
// 之后 Provider 的 secret_key_ref 指向哪个，就决定了它拿到哪把钥匙 —— 没人分得清。
//
// 这里只做「提醒」，不改任何判据：
//   * 名字列表里出现只差大小写/下划线/短横线的一组 ⇒ 明确标出来，让人自己确认；
//   * 正在输入的名字和已有的某个名字「归一化后相同」⇒ 提示那个已有名字，让人确认不是同一个。
//
// 归一化：小写 + 只留字母数字。TM_PAT / TMPAT / tm-pat ⇒ 同一个键。纯函数，无 react-native。

/** 归一化：小写 + 去掉非字母数字。 */
export function normalizeSecretName(name: string): string {
  return (name ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 输入的名字和已有的某个名字「其实是同一个」吗？返回那个已有名字（原文），没有则 null。
 *
 * 只认归一化后完全相同的情况（TM_PAT vs TMPAT）—— 不做模糊猜测，
 * 免得把「DEEPSEEK_KEY」和「DEEPSEEK_API_KEY」也扯到一起。
 */
export function confusableSecretName(input: string, existing: readonly string[]): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const norm = normalizeSecretName(raw);
  if (!norm) return null;
  for (const name of existing ?? []) {
    const other = (name ?? '').trim();
    if (!other || other === raw) continue;
    if (normalizeSecretName(other) === norm) return other;
  }
  return null;
}

/**
 * 名字列表里「只差一点点」的那些组：[["TMPAT","TM_PAT"], ...]。
 * 一组只有一个不算（那就是普通的名字）。
 */
export function confusableSecretGroups(names: readonly string[]): string[][] {
  const byNorm = new Map<string, string[]>();
  for (const raw of names ?? []) {
    const name = (raw ?? '').trim();
    if (!name) continue;
    const norm = normalizeSecretName(name);
    if (!norm) continue;
    const list = byNorm.get(norm) ?? [];
    list.push(name);
    byNorm.set(norm, list);
  }
  return [...byNorm.values()].filter(group => group.length > 1);
}

/** 这一组里，指定的名字是否在「容易认错」的一组里。 */
export function isInConfusableGroup(name: string, groups: readonly string[][]): boolean {
  const raw = (name ?? '').trim();
  return groups.some(group => group.includes(raw));
}
