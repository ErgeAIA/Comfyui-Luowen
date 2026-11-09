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
 * 主链识别（用户校准 2026-11-09）：在可动子图内取最长路径（并列时取起点 top 更小者），
 * 返回链节点 ids 与锚顶（链上第二个节点的 top）。定位交给 R2 列重排：列内顶端是主链节点的列
 * 锚定到锚顶——既保证主链顶边成一条线，又不会把扇出列（顶端非主链）的堆叠打断。
 * 链 <3 节点或含环时返回空。
 */
export function spineOf(model, positions) {
  const empty = { chain: [], ids: new Set(), anchorTop: null };
  const pos = positions;
  const movable = [...model.nodes.values()].filter((n) => pos.has(n.id) && !n.fixed);
  if (movable.length < 3) return empty;
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
  if (order.length !== ids.size) return empty; // 有环
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
  if (!bestEnd || bestLen < 3) return empty;
  const chain = [];
  for (let id = bestEnd; id != null; id = best.get(id).prev) chain.unshift(id);
  return { chain, ids: new Set(chain), anchorTop: pos.get(chain[1])[1] };
}

/**
 * R2 列内重排（用户反馈 ②「VAE 放 K采样器下方」+ ①「同级对齐」）：
 * 1. 按 x 聚类分列（列内节点 x 差 ≤ colThreshold）
 * 2. 列内按「目标口平均 y」排序（喂到下层低端口的节点排在下方）
 * 3. 整列重堆叠（等间距、无重叠）；x 按 align 对齐：
 *    auto（默认）= 逐列按扇入/扇出判定——多对一（收拢）→ 右缘对齐，一对多（发散）→ 左缘对齐，避免线打架；
 *    right / left / center = 全部列强制该对齐。
 * 主链感知：列内顶端是主链节点的列，起始 y 锚定到主链锚顶（否则从列内最小 y 起堆）。
 * 替换旧版 y 交换——高度不等的节点 y 交换会触发重叠，重排才正确。
 */
export function swapReduceCrossings(model, positions, { colGap = 150, nodeGap = 40, align = 'auto', spine = null } = {}) {
  const pos = new Map(positions);
  const ori = new Map(positions); // 排序/目标口用原始位置，避免处理顺序影响
  const movable = [...model.nodes.values()].filter((n) => ori.has(n.id) && !n.fixed).sort((a, b) => (ori.get(a.id)[0] - ori.get(b.id)[0]) || a.id.localeCompare(b.id));
  if (movable.length < 2) return { positions: pos, columns: 0, swaps: 0, aligns: [] };

  // 1. 按 x 聚类分列（原始位置）
  const cols = [];
  let cur = [movable[0]];
  for (let i = 1; i < movable.length; i++) {
    if (ori.get(movable[i].id)[0] - ori.get(movable[i - 1].id)[0] <= colGap) cur.push(movable[i]);
    else { cols.push(cur); cur = [movable[i]]; }
  }
  cols.push(cur);
  const colOf = new Map();
  cols.forEach((c, i) => c.forEach((n) => colOf.set(n.id, i)));

  // 2. 列内按「目标口平均 y」排序（基于原始位置，确定性）
  const targetYOf = (id) => {
    let sum = 0, n = 0;
    for (const e of model.edges) {
      if (e.src !== id) continue;
      const t = portPos(model, ori, e.dst, 'in', e.dstPort);
      if (t) { sum += t[1]; n++; }
    }
    return n ? sum / n : ori.get(id)?.[1] ?? 0;
  };
  // 逐列对齐：auto 按扇入/扇出判定（单源扇出→左，多源扇入→右）
  const alignOf = (ci) => {
    if (align !== 'auto') return align;
    const leftSrc = new Map(), rightTgt = new Map();
    for (const e of model.edges) {
      const si = colOf.get(e.src), di = colOf.get(e.dst);
      if (di === ci && si != null && si < ci) leftSrc.set(e.src, (leftSrc.get(e.src) ?? 0) + 1);
      if (si === ci && di != null && di > ci) rightTgt.set(e.dst, (rightTgt.get(e.dst) ?? 0) + 1);
    }
    let inFromSingle = 0, outToSingle = 0;
    for (const v of leftSrc.values()) inFromSingle = Math.max(inFromSingle, v);
    for (const v of rightTgt.values()) outToSingle = Math.max(outToSingle, v);
    return inFromSingle > outToSingle ? 'left' : 'right';
  };
  const spineIds = spine?.ids ?? null;
  const anchorTop = spine && spine.anchorTop != null ? spine.anchorTop : null;
  const effHOf = (n) => (n.effH ?? n.size[1]);

  let columns = 0, swaps = 0;
  const aligns = [];
  cols.forEach((col, ci) => {
    const al = alignOf(ci);
    if (col.length < 2) {
      const n = col[0];
      if (spineIds?.has(n.id) && anchorTop != null) pos.set(n.id, [ori.get(n.id)[0], anchorTop]);
      return;
    }
    const sorted = col.slice().sort((a, b) => targetYOf(a.id) - targetYOf(b.id) || a.id.localeCompare(b.id));
    const isReordered = col.map((n) => n.id).join(',') !== sorted.map((n) => n.id).join(',');
    const colLeft = Math.min(...col.map((n) => ori.get(n.id)[0]));
    const colRight = Math.max(...col.map((n) => ori.get(n.id)[0] + n.size[0]));
    const totalH = sorted.reduce((s, n) => s + effHOf(n), 0) + (sorted.length - 1) * nodeGap;
    // 起始 y：列内顶端是主链节点 → 锚定主链锚顶；否则（纯扇入/扇出侧列）以连接口 y 为中线上下分布（2 上 2 下）
    let startY;
    let anchored = false;
    if (spineIds?.has(sorted[0].id) && anchorTop != null) { anchored = true; startY = anchorTop; }
    else {
      const ids = new Set(col.map((n) => n.id));
      let hubSum = 0, hubN = 0;
      for (const e of model.edges) {
        const sIn = ids.has(e.src), dIn = ids.has(e.dst);
        if (sIn === dIn) continue;
        const t = sIn ? portPos(model, ori, e.dst, 'in', e.dstPort) : portPos(model, ori, e.src, 'out', e.srcPort);
        if (t) { hubSum += t[1]; hubN++; }
      }
      startY = hubN ? hubSum / hubN - totalH / 2 : Math.min(...col.map((n) => ori.get(n.id)[1]));
    }
    let y = startY;
    for (const n of sorted) {
      let x = colLeft;
      if (al === 'right') x = colRight - n.size[0];
      else if (al === 'center') x = colLeft + (colRight - colLeft - n.size[0]) / 2;
      pos.set(n.id, [x, y]);
      y += effHOf(n) + nodeGap;
    }
    if (isReordered) swaps++;
    columns++;
    aligns.push({ align: al, anchored });
  });
  return { positions: pos, columns, swaps, aligns };
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
