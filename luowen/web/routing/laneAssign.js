// 络纹 LuoWen — 同侧多线 lane 阶梯分配（阶段 1 简化版；CM registry laneStub 思想的确定性重写）
//
// 规则（纯图真相、无迭代）：
//   - 分组：同 origin 节点+slot（输出侧）/ 同 target 节点+slot（输入侧）
//   - 组内按"对端节点 y"分上行/下行/平走；上行最顶者贴引脚最近（rank 0），下行最底者贴引脚最近
//   - stub = base(24) + rank * pitch(5)；分配到的 stub 端点交给 A* 作为 lane（CM：side forms a ribbon by slot order）
//
// 输出 Map<linkId, {stubOut, stubIn}>；纯函数，每帧重算成本低（链路数线性）。

const DEFAULT_BASE = 24;
const DEFAULT_PITCH = 5;

function nodeIndex(graphNodes) {
  const idx = new Map();
  for (const n of graphNodes) if (n && n.id != null) idx.set(n.id, n);
  return idx;
}

export function allocateLanes(links, nodes, { base = DEFAULT_BASE, pitch = DEFAULT_PITCH } = {}) {
  const byId = nodeIndex(nodes);
  const groups = new Map();
  const result = new Map();

  for (const l of links) {
    if (!l || l.id == null) continue;
    result.set(l.id, { stubOut: base, stubIn: base });
    const ok = (k, v) => {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(v);
    };
    ok(`o:${l.origin_id}:${l.origin_slot}`, l);
    ok(`i:${l.target_id}:${l.target_slot}`, l);
  }

  for (const [key, ls] of groups) {
    const side = key[0] === 'o' ? 'stubOut' : 'stubIn';
    const nodeY = (n) => (n?.pos ? n.pos[1] : (n?.y ?? 0)); // 兼容节点对象与矩形 {id,x,y,w,h}
    const withDy = ls.map((l) => {
      const selfId = side === 'stubOut' ? l.origin_id : l.target_id;
      const otherId = side === 'stubOut' ? l.target_id : l.origin_id;
      const selfY = nodeY(byId.get(selfId));
      const otherY = nodeY(byId.get(otherId));
      return { l, dy: otherY - selfY, otherY };
    });
    // 上行（目标更高）：越顶越贴引脚；下行：越底越贴引脚；平走排最后（确定性按 linkId）
    const ups = withDy.filter((e) => e.dy < -1).sort((a, b) => a.otherY - b.otherY || a.l.id - b.l.id);
    const downs = withDy.filter((e) => e.dy > 1).sort((a, b) => b.otherY - a.otherY || a.l.id - b.l.id);
    const flats = withDy.filter((e) => Math.abs(e.dy) <= 1).sort((a, b) => a.l.id - b.l.id);
    ups.forEach((e, i) => {
      result.get(e.l.id)[side] = base + i * pitch;
    });
    downs.forEach((e, i) => {
      result.get(e.l.id)[side] = base + i * pitch;
    });
    flats.forEach((e, i) => {
      result.get(e.l.id)[side] = base + (ups.length + downs.length + i) * pitch;
    });
  }
  return result;
}

// lane 分配的输入指纹：链路拓扑 + 节点 y（分类依据）；变了才重算
export function laneHash(links, nodes) {
  const nodeY = (n) => (n?.pos ? n.pos[1] : (n?.y ?? 0));
  const ys = nodes.map((n) => `${n.id}:${Math.round(nodeY(n))};`).sort();
  const ls = links
    .filter((l) => l && l.id != null)
    .map((l) => `${l.id}:${l.origin_id}:${l.origin_slot}:${l.target_id}:${l.target_slot};`)
    .sort();
  return `${ys.join('')}|${ls.join('')}`;
}
