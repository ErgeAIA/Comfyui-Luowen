// 络纹 LuoWen — 测试固定样本构造器（纯数据，与浏览器无关）
// PRD §14.2 固定样本集的最小种子：后续按场景扩充（多目标、走廊、Reroute、密集节点等）。

export function node(id, x, y, w = 200, h = 100, collapsed = false) {
  return { id, pos: [x, y], size: [w, h], flags: { collapsed } };
}

export function link(id, originId, originSlot, targetId, targetSlot, type = 'IMAGE') {
  return { id, origin_id: originId, origin_slot: originSlot, target_id: targetId, target_slot: targetSlot, type };
}

export function graph(nodes, links) {
  return { _nodes: nodes, links };
}

// 场景：单输出扇出到 上/平/下 三个目标（分道阶梯样本）
export function fanOut() {
  return {
    nodes: [node(1, 0, 100), node(2, 400, 40), node(3, 400, 100), node(4, 400, 300)],
    links: [link(10, 1, 0, 2, 0), link(11, 1, 0, 3, 0), link(12, 1, 0, 4, 0)],
  };
}

// 场景：单个障碍挡在直线走廊中间（避障样本）
export function blockedCorridor() {
  return {
    nodes: [node(1, 0, 100), node(2, 400, 100), node(99, 150, 40, 100, 120)],
    links: [link(10, 1, 0, 2, 0)],
  };
}