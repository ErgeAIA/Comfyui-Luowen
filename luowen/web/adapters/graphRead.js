// 络纹 LuoWen — 图数据只读工具（adapter 层：前端图 → 纯数据）
// 铁律（PRD §9）：只读，绝不写图数据；活动图取 app.canvas.graph（app.graph 已废弃且永远返回根图）。

export function graphNodes(graph) {
  if (!graph) return [];
  if (Array.isArray(graph._nodes)) return graph._nodes;
  if (Array.isArray(graph.nodes)) return graph.nodes;
  if (graph.nodes && typeof graph.nodes === 'object') return Object.values(graph.nodes);
  return [];
}

export function graphLinks(graph) {
  if (!graph) return [];
  const src = graph.links;
  if (!src) return [];
  return src instanceof Map ? Array.from(src.values()) : Object.values(src);
}

// 节点矩形（graph 坐标）：折叠节点取其标题栏包围盒（getBounding 优先，pos/size 兜底）
export function nodeRects(graph) {
  const rects = [];
  for (const n of graphNodes(graph)) {
    if (!n || n.pos == null) continue;
    const collapsed = !!(n.flags && n.flags.collapsed);
    let x = Math.round(n.pos[0]);
    let y = Math.round(n.pos[1]);
    let w;
    let h;
    if (typeof n.getBounding === 'function') {
      try {
        const b = n.getBounding(); // [dx, dy, width, height]（相对 pos）
        x = Math.round(n.pos[0] + (b[0] ?? 0));
        y = Math.round(n.pos[1] + (b[1] ?? 0));
        w = Math.max(1, Math.round(b[2] ?? n.size?.[0] ?? 200));
        h = Math.max(1, Math.round(b[3] ?? n.size?.[1] ?? 100));
      } catch {
        w = Math.max(1, Math.round(n.size?.[0] ?? 200));
        h = Math.max(1, Math.round(n.size?.[1] ?? 100));
      }
    } else {
      w = Math.max(1, Math.round(n.size?.[0] ?? 200));
      h = Math.max(1, Math.round(n.size?.[1] ?? 100));
    }
    rects.push({ id: n.id, x, y, w, h, collapsed });
  }
  return rects;
}

// 连接五元组快照（数据不变性自检用）：[id, origin_id, origin_slot, target_id, target_slot, type]
export function linkTuples(graph) {
  return graphLinks(graph)
    .map((l) => [l?.id, l?.origin_id, l?.origin_slot, l?.target_id, l?.target_slot, String(l?.type)])
    .sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0));
}

export function linksHash(graph) {
  return linkTuples(graph).map((t) => t.join(':')).join(';');
}
