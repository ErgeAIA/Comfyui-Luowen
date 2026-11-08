// 自动布局 Phase B：约束模型——把「什么能动、什么不能动、障碍是什么」从布局算法中分离（任务书 §5 阶段 B）。
// 纯函数；PRD F-015 语义在此收口：
//   - 局部布局（selectedIds 给定）：未选节点一律 fixed，并作为障碍物与边界约束；
//   - pinned 节点恒 fixed；
//   - 含 Reroute 链的连接（model.edges[].manualIntent，DEC-033 引申）进入 notes：
//     MVP 对其两端节点施加相对固定（同一相对位形平移），不参与重分层。

/** 约束视图：{ fixedIds:Set, movableIds:[id], obstacles:[{id,x,y,w,h}], direction, spacing, notes:[...] } */
export function buildConstraints(model, { fixedIds = [], selectedIds = null, direction = 'LR', spacing = { x: 60, y: 30 }, lockedGroupIds = [] } = {}) {
  const fixed = new Set();
  const notes = [];
  for (const id of fixedIds) {
    const k = String(id);
    if (model.nodes.has(k)) fixed.add(k);
  }
  for (const n of model.nodes.values()) if (n.fixed) fixed.add(n.id);

  // 局部布局：未选 = fixed + 障碍
  const local = Array.isArray(selectedIds) && selectedIds.length > 0;
  const movableIds = [];
  if (local) {
    const sel = new Set(selectedIds.map(String));
    for (const n of model.nodes.values()) {
      if (sel.has(n.id) && !fixed.has(n.id)) movableIds.push(n.id);
      else if (!fixed.has(n.id)) fixed.add(n.id);
    }
  } else {
    for (const n of model.nodes.values()) if (!fixed.has(n.id)) movableIds.push(n.id);
  }

  // 障碍矩形 = fixed 节点包围盒（含 pinned 与未选）
  const obstacles = [...fixed].map((id) => {
    const n = model.nodes.get(id);
    return { id, x: n.pos[0], y: n.pos[1], w: n.size[0], h: n.size[1] };
  });

  // 锁定 Group：成员并入 fixed（默认不做——用户语义结构不动，plan.md §4⑤）
  for (const gid of lockedGroupIds) {
    const g = model.groups.find((x) => x.id === String(gid));
    if (!g) continue;
    for (const id of g.memberIds) fixed.add(id);
    notes.push({ kind: 'group-locked', id: g.id, members: g.memberIds.length });
  }

  // Reroute 手动意图（DEC-033 引申）：含链连接的端点对进入 MVP 相对固定清单
  const manualIntentEdges = model.edges.filter((e) => e.manualIntent);
  if (manualIntentEdges.length) {
    notes.push({ kind: 'reroute-manual-intent', edges: manualIntentEdges.map((e) => e.id), policy: 'pair-relative-fixed (MVP)' });
  }

  return { fixedIds: fixed, movableIds, obstacles, direction, spacing, local, notes };
}
