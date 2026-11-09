// 自动布局精修后处理（Phase C+ 用户实测反馈 2026-11-08：①同级对齐 ②可避免交叉 ③线拉直）。
// 全部纯函数、确定性；调用方（engine）负责重叠守卫与写入。
// 原则（用户原话）：不过度设计——三个保守变换，每个都有守卫与上限。

import { componentsOf } from './graph-model.js';

function portPos(model, positions, nodeId, kind, index) {
  const n = model.nodes.get(nodeId);
  if (!n) return null;
  const p = positions.get(nodeId) ?? n.pos;
  const list = kind === 'in' ? n.inPorts : n.outPorts;
  const h = n.size[1];
  const y = list.length ? p[1] + (h * (index + 0.5)) / list.length : p[1] + h / 2;
  return [kind === 'in' ? p[0] : p[0] + n.size[0], y];
}

function overlapsAny(model, positions, id, exclude = new Set()) {
  const a = positions.get(id);
  const na = model.nodes.get(id);
  if (!a || !na) return true;
  for (const [id2, p2] of positions) {
    if (id2 === id || exclude.has(id2)) continue;
    const nb = model.nodes.get(id2);
    if (!nb) continue;
    if (a[0] < p2[0] + nb.size[0] && p2[0] < a[0] + na.size[0] && a[1] < p2[1] + nb.size[1] && p2[1] < a[1] + na.size[1]) return true;
  }
  return false;
}

/**
 * R1 端口对齐直化（用户反馈 ③）：按拓扑序扫描每条边（长边优先），
 * 若把源节点平移 dy=目标口y−源口y 后该边变水平、且 |dy| ≤ 源节点高度的一半、
 * 且平移不与任何节点产生重叠 → 采纳（每节点至多采纳一次，首个 qualifying 边生效）。
 * 主链（长边）优先被拉直——与用户手动调整的结果同构。
 */
export function straightenEdges(model, positions, { maxTolRatio = 0.5 } = {}) {
  const moved = new Map();
  const pos = new Map(positions);
  const edgesByLen = model.edges
    .map((e) => {
      const a = portPos(model, pos, e.src, 'out', e.srcPort);
      const b = portPos(model, pos, e.dst, 'in', e.dstPort);
      return e && a && b ? { e, len: Math.hypot(b[0] - a[0], b[1] - a[1]) } : null;
    })
    .filter(Boolean)
    .sort((x, y) => y.len - x.len);
  for (const { e } of edgesByLen) {
    if (moved.has(e.src)) continue;
    const src = model.nodes.get(e.src);
    if (!src || src.fixed) continue;
    const a = portPos(model, pos, e.src, 'out', e.srcPort);
    const b = portPos(model, pos, e.dst, 'in', e.dstPort);
    if (!a || !b || !pos.get(e.src) || !pos.get(e.dst)) continue;
    const dy = b[1] - a[1];
    const tol = src.size[1] * maxTolRatio;
    if (Math.abs(dy) < 1e-6 || Math.abs(dy) > tol) continue;
    const old = pos.get(e.src);
    const cand = new Map([[e.src, [old[0], old[1] + dy]]]);
    // 重叠守卫：候选位置不与任何其他节点重叠
    let clash = false;
    for (const [id2, p2] of pos) {
      if (id2 === e.src) continue;
      const nb = model.nodes.get(id2);
      if (!nb) continue;
      const na = model.nodes.get(e.src);
      if (cand.get(e.src)[0] < p2[0] + nb.size[0] && p2[0] < cand.get(e.src)[0] + na.size[0] && cand.get(e.src)[1] < p2[1] + nb.size[1] && p2[1] < cand.get(e.src)[1] + na.size[1]) { clash = true; break; }
    }
    if (clash) continue;
    pos.set(e.src, cand.get(e.src));
    moved.set(e.src, dy);
  }
  return { positions: pos, movedCount: moved.size, moved };
}

/**
 * R4 主链顶边对齐（用户校准 2026-11-09）：在可动子图内取最长路径（并列时取起点 top 更小者），
 * 把链上节点顶边对齐到「链上第二个节点」的 top，其余节点上下平移。
 * 仅 y 方向平移：同列重叠由随后的 R2 列重排消解，跨列因水平分层不会重叠。
 * 单链 <3 节点或含环时保守跳过。
 */
export function spineTopAlign(model, positions) {
  const pos = new Map(positions);
  const movable = [...model.nodes.values()].filter((n) => pos.has(n.id) && !n.fixed);
  if (movable.length < 3) return { positions: pos, movedCount: 0, chain: [] };
  const ids = new Set(movable.map((n) => n.id));
  const prevs = new Map(), nexts = new Map();
  for (const id of ids) { prevs.set(id, []); nexts.set(id, []); }
  for (const e of model.edges) {
    if (!ids.has(e.src) || !ids.has(e.dst)) continue;
    prevs.get(e.dst).push(e.src);
    nexts.get(e.src).push(e.dst);
  }
  // Kahn 拓扑序；有环则保守跳过（Reroute 分量已在上游 fixed）
  const indeg = new Map([...ids].map((id) => [id, prevs.get(id).length]));
  const order = [];
  const q = [...ids].filter((id) => indeg.get(id) === 0).sort();
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const nx of nexts.get(id)) { indeg.set(nx, indeg.get(nx) - 1); if (indeg.get(nx) === 0) q.push(nx); }
  }
  if (order.length !== ids.size) return { positions: pos, movedCount: 0, chain: [] };
  // 最长路径 DP：len=节点数；并列取起点 top 更小者
  const best = new Map();
  let bestEnd = null, bestLen = 0, bestStartY = Infinity;
  for (const id of order) {
    let cur = { len: 1, startY: pos.get(id)[1], prev: null };
    for (const p of prevs.get(id)) {
      const b = best.get(p);
      if (!b) continue;
      if (b.len + 1 > cur.len || (b.len + 1 === cur.len && b.startY < cur.startY)) cur = { len: b.len + 1, startY: b.startY, prev: p };
    }
    best.set(id, cur);
    if (cur.len > bestLen || (cur.len === bestLen && cur.startY < bestStartY)) { bestLen = cur.len; bestStartY = cur.startY; bestEnd = id; }
  }
  if (!bestEnd || bestLen < 3) return { positions: pos, movedCount: 0, chain: [] };
  const chain = [];
  for (let id = bestEnd; id != null; id = best.get(id).prev) chain.unshift(id);
  const anchorTop = pos.get(chain[1])[1];
  let movedCount = 0;
  for (const id of chain) {
    if (id === chain[1]) continue;
    const old = pos.get(id);
    if (Math.abs(anchorTop - old[1]) < 1e-6) continue;
    pos.set(id, [old[0], anchorTop]);
    movedCount++;
  }
  return { positions: pos, movedCount, chain };
}

/**
 * R2 列内重排（用户反馈 ②「VAE 放 K采样器下方」+ ①「同级对齐」）：
 * 1. 按 x 聚类分列（列内节点 x 差 ≤ colThreshold）
 * 2. 列内按「目标口平均 y」排序（喂到下层低端口的节点排在下方）
 * 3. 整列重堆叠（等间距、无重叠；x 按 align 对齐：right 右缘 / left 左缘 / center 居中，默认右对齐）
 * 替换旧版 y 交换——高度不等的节点 y 交换会触发重叠，重排才正确。
 */
export function swapReduceCrossings(model, positions, { colGap = 150, nodeGap = 40, align = 'right' } = {}) {
  const pos = new Map(positions);
  const movable = [...model.nodes.values()].filter((n) => pos.has(n.id) && !n.fixed).sort((a, b) => (pos.get(a.id)[0] - pos.get(b.id)[0]) || a.id.localeCompare(b.id));
  if (movable.length < 2) return { positions: pos, columns: 0, swaps: 0 };

  // 1. 按 x 聚类分列
  const cols = [];
  let cur = [movable[0]];
  for (let i = 1; i < movable.length; i++) {
    if (pos.get(movable[i].id)[0] - pos.get(movable[i - 1].id)[0] <= colGap) cur.push(movable[i]);
    else { cols.push(cur); cur = [movable[i]]; }
  }
  cols.push(cur);

  // 2. 列内按「目标口平均 y」排序 + 3. 重堆叠
  const targetYOf = (id) => {
    let sum = 0, n = 0;
    for (const e of model.edges) {
      if (e.src !== id) continue;
      const t = portPos(model, pos, e.dst, 'in', e.dstPort);
      if (t) { sum += t[1]; n++; }
    }
    return n ? sum / n : pos.get(id)?.[1] ?? 0;
  };
  let columns = 0, swaps = 0;
  for (const col of cols) {
    if (col.length < 2) continue;
    const sorted = col.slice().sort((a, b) => targetYOf(a.id) - targetYOf(b.id) || a.id.localeCompare(b.id));
    const origOrder = col.map((n) => n.id).join(',');
    const newOrder = sorted.map((n) => n.id).join(',');
    const isReordered = origOrder !== newOrder;
    const colLeft = Math.min(...col.map((n) => pos.get(n.id)[0]));
    const colRight = Math.max(...col.map((n) => pos.get(n.id)[0] + n.size[0]));
    let y = Math.min(...col.map((n) => pos.get(n.id)[1]));
    for (const n of sorted) {
      let x = colLeft;
      if (align === 'right') x = colRight - n.size[0];
      else if (align === 'center') x = colLeft + (colRight - colLeft - n.size[0]) / 2;
      pos.set(n.id, [x, y]);
      y += n.size[1] + nodeGap;
    }
    if (isReordered) swaps++;
    columns++;
  }
  return { positions: pos, columns, swaps };
}

function countCross(model, pos) {
  const segs = [];
  for (const e of model.edges) {
    const a = portPos(model, pos, e.src, 'out', e.srcPort);
    const b = portPos(model, pos, e.dst, 'in', e.dstPort);
    if (a && b) segs.push({ a1: a, a2: b, src: e.src, dst: e.dst });
  }
  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].src === segs[j].src || segs[i].src === segs[j].dst || segs[i].dst === segs[j].src || segs[i].dst === segs[j].dst) continue;
      const d1x = segs[i].a2[0] - segs[i].a1[0], d1y = segs[i].a2[1] - segs[i].a1[1];
      const d2x = segs[j].a2[0] - segs[j].a1[0], d2y = segs[j].a2[1] - segs[j].a1[1];
      const denom = d1x * d2y - d1y * d2x;
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((segs[j].a1[0] - segs[i].a1[0]) * d2y - (segs[j].a1[1] - segs[i].a1[1]) * d2x) / denom;
      const u = ((segs[j].a1[0] - segs[i].a1[0]) * d1y - (segs[j].a1[1] - segs[i].a1[1]) * d1x) / denom;
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) count++;
    }
  }
  return count;
}

/**
 * R3 Reroute 分量跳过（用户反馈：UP 主用转接点手动整理，重排会破坏手动意图；
 * 「清除转接点超出整理范畴」——用户判断采纳）。含 Reroute 节点或手动意图边（折叠链）
 * 的连通分量整体跳过重排（原位保持，作为障碍），返回其节点 id 列表供 engine 并入 fixed。
 */
export function rerouteComponentIds(model) {
  const skip = new Set();
  if (!model.reroutes.size && !model.edges.some((e) => e.manualIntent)) return skip;
  // 链上 Reroute 节点随分量一并固定（折叠后它们没有边，不在 components 里）
  for (const e of model.edges) {
    if (e.manualIntent) for (const nid of e.rerouteNodes ?? []) skip.add(nid);
  }
  for (const comp of model.components) {
    const hit = comp.some((id) => model.reroutes.has(id)) || model.edges.some((e) => e.manualIntent && (comp.includes(e.src) || comp.includes(e.dst)));
    if (hit) for (const id of comp) skip.add(id);
  }
  return skip;
}
