// 自动布局 Phase B：布局质量指标——全部纯函数、确定性、可复现（任务书 §2.5/§6 软指标口径）。
// 位置表示：positions = Map<nodeId, [x, y]>（节点左上角）；端口坐标由节点尺寸按端口序均分推导（MVP 口径）。
// 已知口径限制（如实）：本层指标基于「端口中心直连直线段」；真实 Routing 的折线/圆角不在本层统计，
// bends 采用曼哈顿转角估算口径，Phase D 与真实 Routing polylines 对照校准。

function nodeCenter(n, pos) {
  const p = pos.get(n.id) ?? n.pos;
  return [p[0] + n.size[0] / 2, p[1] + n.size[1] / 2];
}

// 端口中心：输入口自上而下均分节点左缘；输出口自上而下均分节点右缘（MVP；宿主真实插槽 y 由 Phase D 校准）
export function portPos(model, positions, nodeId, kind, index) {
  const n = model.nodes.get(nodeId);
  if (!n) return null;
  const p = positions.get(nodeId) ?? n.pos;
  const list = kind === 'in' ? n.inPorts : n.outPorts;
  const h = n.size[1];
  const y = list.length ? p[1] + (h * (index + 0.5)) / list.length : p[1] + h / 2;
  return [kind === 'in' ? p[0] : p[0] + n.size[0], y];
}

function segIntersect(a1, a2, b1, b2) {
  const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false; // 平行/共线不计（保守）
  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / denom;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / denom;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/** 边交叉对数（端口中心直连线段；共享端点的边对不计）。 */
export function countCrossings(model, positions) {
  const segs = [];
  for (const e of model.edges) {
    const a = portPos(model, positions, e.src, 'out', e.srcPort);
    const b = portPos(model, positions, e.dst, 'in', e.dstPort);
    if (a && b) segs.push({ id: e.id, a1: a, a2: b, src: e.src, dst: e.dst });
  }
  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].src === segs[j].src || segs[i].src === segs[j].dst || segs[i].dst === segs[j].src || segs[i].dst === segs[j].dst) continue;
      if (segIntersect(segs[i].a1, segs[i].a2, segs[j].a1, segs[j].a2)) count++;
    }
  }
  return count;
}

/** 边总长（端口中心直连距离之和）。 */
export function totalEdgeLength(model, positions) {
  let sum = 0;
  for (const e of model.edges) {
    const a = portPos(model, positions, e.src, 'out', e.srcPort);
    const b = portPos(model, positions, e.dst, 'in', e.dstPort);
    if (a && b) sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

/** 反向边：目标口 x < 源口 x（流向左）。返回 { count, totalLength }。 */
export function backwardEdges(model, positions) {
  let count = 0, totalLength = 0;
  for (const e of model.edges) {
    const a = portPos(model, positions, e.src, 'out', e.srcPort);
    const b = portPos(model, positions, e.dst, 'in', e.dstPort);
    if (a && b && b[0] < a[0] - 1e-6) { count++; totalLength += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  }
  return { count, totalLength };
}

/** 曼哈顿转角估算：端口对齐（dx 或 dy ≈0）计 0 弯，否则计 1 弯（L 形路径）。 */
export function estimateBends(model, positions) {
  let bends = 0;
  for (const e of model.edges) {
    const a = portPos(model, positions, e.src, 'out', e.srcPort);
    const b = portPos(model, positions, e.dst, 'in', e.dstPort);
    if (!a || !b) continue;
    if (Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6) bends++;
  }
  return bends;
}

/** 端口对齐率：dx 或 dy ≈0 的边占比（0–1）。 */
export function portAlignment(model, positions) {
  if (!model.edges.length) return 1;
  let aligned = 0;
  for (const e of model.edges) {
    const a = portPos(model, positions, e.src, 'out', e.srcPort);
    const b = portPos(model, positions, e.dst, 'in', e.dstPort);
    if (!a || !b) continue;
    if (Math.abs(a[0] - b[0]) <= 1e-6 || Math.abs(a[1] - b[1]) <= 1e-6) aligned++;
  }
  return aligned / model.edges.length;
}

/** Group 凝聚度：成员中心到 Group 中心距离 ≤ 对角线半径 的成员占比（按几何包含成员）。 */
export function groupCohesion(model, positions) {
  const groups = model.groups.filter((g) => g.memberIds.length >= 2);
  if (!groups.length) return 1;
  let ok = 0, total = 0;
  for (const g of groups) {
    const [gx, gy, gw, gh] = g.bounds;
    const cx = gx + gw / 2, cy = gy + gh / 2;
    const radius = Math.hypot(gw, gh) / 2;
    for (const id of g.memberIds) {
      const n = model.nodes.get(id);
      if (!n) continue;
      const c = nodeCenter(n, positions);
      total++;
      if (Math.hypot(c[0] - cx, c[1] - cy) <= radius) ok++;
    }
  }
  return total ? ok / total : 1;
}

/** 画布占位：节点包围盒 { w, h, area, aspect }。 */
export function canvasFootprint(model, positions) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of model.nodes.values()) {
    const p = positions.get(n.id) ?? n.pos;
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0] + n.size[0]); maxY = Math.max(maxY, p[1] + n.size[1]);
  }
  if (!model.nodes.size) return { w: 0, h: 0, area: 0, aspect: 1 };
  const w = maxX - minX, h = maxY - minY;
  return { w: Math.round(w * 1000) / 1000, h: Math.round(h * 1000) / 1000, area: Math.round(w * h * 1000) / 1000, aspect: h > 0 ? Math.round((w / h) * 1000) / 1000 : 1 };
}

/** 节点重叠对数（包围盒相交）。 */
export function nodeOverlaps(model, positions) {
  const items = [...model.nodes.values()].map((n) => {
    const p = positions.get(n.id) ?? n.pos;
    return { id: n.id, x1: p[0], y1: p[1], x2: p[0] + n.size[0], y2: p[1] + n.size[1] };
  });
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) count++;
    }
  }
  return count;
}

/** 位移统计：A→B 位置差的 { mean, max }（欧氏）。 */
export function displacement(model, posA, posB) {
  let sum = 0, max = 0, n = 0;
  for (const [id, na] of model.nodes) {
    const a = posA.get(id) ?? na.pos;
    const b = posB.get(id);
    if (!b) continue;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    sum += d; max = Math.max(max, d); n++;
  }
  return { mean: n ? Math.round((sum / n) * 1000) / 1000 : 0, max: Math.round(max * 1000) / 1000 };
}

/** 汇总入口：一次算全部软指标（确定性输出，供 A/B 对照表直用）。 */
export function evaluateLayout(model, positions, baseline = null) {
  const out = {
    crossings: countCrossings(model, positions),
    totalEdgeLength: Math.round(totalEdgeLength(model, positions) * 1000) / 1000,
    backwardEdges: backwardEdges(model, positions),
    estimatedBends: estimateBends(model, positions),
    portAlignment: Math.round(portAlignment(model, positions) * 1000) / 1000,
    groupCohesion: Math.round(groupCohesion(model, positions) * 1000) / 1000,
    canvasFootprint: canvasFootprint(model, positions),
    nodeOverlaps: nodeOverlaps(model, positions),
  };
  if (baseline) out.displacement = displacement(model, baseline, positions);
  return out;
}
