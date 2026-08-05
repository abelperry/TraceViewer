/**
 * collection 短标签：把 `-Users-yangdayong-Zhipu-code-trace-review` 这样的
 * collection id 压成人能认的短名（如 `trace › review`）。
 *
 * Trace 的会话树与 Reviews 的信息流/详情共用同一套算法，保证同一个项目
 * 在两个视图里显示成同一个名字——否则「这条评审是哪个 trace」又对不上了。
 */

export function collName(id: string): string {
  return id.replace(/^-/, '').replace(/-/g, '/');
}

/** 弱信息路径段：去重时跳过，不作为标签主体。 */
const NOISE_SEG = /^(gen\d+|extracted|uploads?|[0-9a-f-]{8,})$/i;

/**
 * 为一组 collection 计算可辨识的短标签。
 * 标签主体取「最深的有信息段」（跳过 hash/gen0/extracted 等噪声）；
 * 若仍重复，向上找最近的、能区分的有信息祖先段作前缀（用 ›）。
 */
export function buildLabels(ids: string[]): Map<string, string> {
  const meaningful = new Map<string, string[]>();
  for (const id of ids) {
    const segs = collName(id).split('/').filter(Boolean);
    const kept = segs.filter((s) => !NOISE_SEG.test(s));
    meaningful.set(id, kept.length ? kept : segs);
  }

  const labelAt = (id: string, depth: number): string => {
    const p = meaningful.get(id)!;
    const tail = p.slice(Math.max(0, p.length - depth));
    return tail.join(' › ');
  };

  const labels = new Map<string, string>();
  let pending = [...ids];
  let depth = 1;
  while (pending.length > 0 && depth <= 6) {
    const buckets = new Map<string, string[]>();
    for (const id of pending) {
      const t = labelAt(id, depth);
      const arr = buckets.get(t);
      if (arr) arr.push(id);
      else buckets.set(t, [id]);
    }
    const next: string[] = [];
    for (const [tail, group] of buckets) {
      if (group.length === 1) labels.set(group[0]!, tail);
      else {
        const canDeepen = group.some((id) => meaningful.get(id)!.length > depth);
        if (canDeepen) next.push(...group);
        else group.forEach((id) => labels.set(id, tail));
      }
    }
    pending = next;
    depth++;
  }
  for (const id of pending) labels.set(id, collName(id));
  return labels;
}
