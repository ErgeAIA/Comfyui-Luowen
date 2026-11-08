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
 * R2 同列交换减交叉（用户反馈 ②）：x 相近（同列）且与同一目标相连/交叉的节点对，
 * 尝试交换两者 y（仅当交换后两节点都不与第三者重叠且交叉数严格下降），贪心、轮数 ≤2。
 * 「加载VAE 放到 K采样器下方线就不打架」的同层版本。
 */
export function swapReduceCrossings(model, positions, { rounds = 2, colGap = 30 } = {}) {
  const pos = new Map(positions);
  let crossings = countCross(model, pos);
  let swaps = 0;
  for (let r = 0; r < rounds; r++) {
    const byX = [...model.nodes.values()].filter((n) => pos.has(n.id)).sort((a, b) => (pos.get(a.id)[0] - pos.get(b.id)[0]) || a.id.localeCompare(b.id));
    for (let i = 0; i < byX.length; i++) {
      for (let j = i + 1; j < byX.length; j++) {
        const a = byX[i], b = byX[j];
        const pa = pos.get(a.id), pb = pos.get(b.id);
        if (Math.abs(pa[0] - pb[0]) > colGap) continue; // 不同列不试
        if (Math.abs(pa[1] - pb[1]) < 1) continue;
        // 交换 y
        pos.set(a.id, [pa[0], pb[1]]);
        pos.set(b.id, [pb[0], pa[1]]);
        const after = countCross(model, pos);
        const clash = overlapsAny(model, pos, a.id) || overlapsAny(model, pos, b.id, new Set([a.id]));
        if (after < crossings && !clash) {
          crossings = after;
          swaps++;
        } else {
          pos.set(a.id, pa);
          pos.set(b.id, pb);
        }
      }
    }
  }
  return { positions: pos, crossings, swaps };
}

function countCross(model, pos) {
  const segs = [];
  for (const e of model.edges) {
    const a = portPos(model, pos, e.src, 'out', e.srcPort);
    const b = portPos(model, pos, e.dst, 'in', e.dstPort);
    if (a && b) segs.push({ a1: a, a2: b, src: e.src, dst: e.dst });
    void 0;
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
