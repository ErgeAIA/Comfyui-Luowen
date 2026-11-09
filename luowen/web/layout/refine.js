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
export function spineOf(model, positions, subset = null) {
  const empty = { chain: [], ids: new Set(), anchorTop: null };
  const pos = positions;
  const movable = [...model.nodes.values()].filter((n) => pos.has(n.id) && !n.fixed && (!subset || subset.has(n.id)));
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
        // 以对端节点的「中心线」为轴（而非端口 y），扇出/扇入才真正对称
        const otherId = sIn ? e.dst : e.src;
        const on = model.nodes.get(otherId);
        const op = pos.get(otherId) ?? ori.get(otherId);
        if (on && op) { hubSum += op[1] + on.size[1] / 2; hubN++; }
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

/**
 * 主链段水平压实（用户校准 2026-11-09）：沿主链把「1 进 1 出」节点所在列向上一列收紧到 inlineGap，
 * 其余列保持原间距；列整体平移（侧节点随之），列间不相交。让采样算法/CFG 归一化这类过路小节点
 * 水平并排、更紧凑，同时不牺牲多入口列的可读性。
 */
export function compressSpineInline(model, positions, { inlineGap = 50, colGap = 150, spine = null } = {}) {
  const pos = new Map(positions);
  if (!spine || !spine.chain || spine.chain.length < 3) return { positions: pos, compressed: 0 };
  const spineIds = new Set(spine.chain);
  const inDeg = new Map(), outDeg = new Map();
  for (const e of model.edges) { inDeg.set(e.dst, (inDeg.get(e.dst) ?? 0) + 1); outDeg.set(e.src, (outDeg.get(e.src) ?? 0) + 1); }
  const nodes = [...model.nodes.values()].filter((n) => pos.has(n.id)).sort((a, b) => (pos.get(a.id)[0] - pos.get(b.id)[0]) || a.id.localeCompare(b.id));
  if (nodes.length < 2) return { positions: pos, compressed: 0 };
  const cols = [];
  let c0 = [nodes[0]];
  for (let i = 1; i < nodes.length; i++) {
    if (pos.get(nodes[i].id)[0] - pos.get(nodes[i - 1].id)[0] <= colGap) c0.push(nodes[i]);
    else { cols.push(c0); c0 = [nodes[i]]; }
  }
  cols.push(c0);
  const colOf = new Map();
  cols.forEach((c, i) => c.forEach((n) => colOf.set(n.id, i)));
  const minX = cols.map((c) => Math.min(...c.map((n) => pos.get(n.id)[0])));
  const maxX = cols.map((c) => Math.max(...c.map((n) => pos.get(n.id)[0] + n.size[0])));
  const MIN_GAP = 20;
  const shift = new Array(cols.length).fill(0);
  let compressed = 0;
  for (let i = 1; i < cols.length; i++) {
    shift[i] = shift[i - 1]; // 默认：整列随上一列同幅平移（非 1进1出 的间距保持不变）
    const sp = cols[i].find((n) => spineIds.has(n.id));
    if (sp && inDeg.get(sp.id) === 1 && outDeg.get(sp.id) === 1) {
      const si = spine.chain.indexOf(sp.id);
      const pred = si > 0 ? spine.chain[si - 1] : null;
      const pc = pred != null ? colOf.get(pred) : null;
      if (pc != null && pc < i) {
        // 安全阀：本列若有来自更早列的侧边（非主链 pred→sp 边），压缩会挤压该侧线（如 加载CLIP→CLIP文本编码）
        // → 跳过本列压缩（本列随上一列同幅平移，侧线间距保持不变）
        const colIds = new Set(cols[i].map((n) => n.id));
        let hasSideIn = false;
        for (const e of model.edges) {
          if (!colIds.has(e.dst)) continue;
          const sc = colOf.get(e.src);
          if (sc != null && sc < i && !(e.src === pred && e.dst === sp.id)) { hasSideIn = true; break; }
        }
        if (hasSideIn) continue;
        const predN = model.nodes.get(pred);
        const predRight = pos.get(pred)[0] + shift[pc] + predN.size[0];
        const wantShift = predRight + inlineGap - pos.get(sp.id)[0]; // 使 sp 左缘 = pred 右缘 + inlineGap
        if (wantShift < shift[i]) {
          const minAllowed = shift[i - 1] + (maxX[i - 1] + MIN_GAP) - minX[i]; // 列不相交下限
          const applied = Math.max(wantShift, minAllowed);
          if (applied < shift[i]) { shift[i] = applied; compressed++; }
        }
      }
    }
  }
  cols.forEach((c, i) => { if (shift[i]) for (const n of c) { const p = pos.get(n.id); pos.set(n.id, [p[0] + shift[i], p[1]]); } });
  return { positions: pos, compressed };
}

/**
 * 主链独立轨道（用户校准 2026-11-09 阶段 A）：
 * - 主链按水平线紧凑排布（1进1出→inlineGap，多入口→layerGap+自适应），顶边统一；
 * - 末端若是「被前驱扇出、且前驱还扇出别的兄弟」的汇点（如 SaveImage），并入该扇列、不占顶线；
 * - 侧分支按最近主链锚点放置（R=下游、L=上游），逐层外扩、竖直居中；
 * - 列内对齐按流向（L/扇入→右缘、R/扇出→左缘），auto 默认可强制；
 * - 最后一道全对碰撞消解：重叠即把非主链节点下移，保证零重叠。
 */
export function layoutSpineTracks(model, positions, { spine = null, inlineGap = 50, layerGap = 60, sideGap = 60, nodeGap = 40, align = 'auto', only = null } = {}) {
  const pos = new Map(positions);
  if (!spine || !spine.chain || spine.chain.length < 2) return { positions: pos, overlaps: 0 };
  const inDeg = new Map(), outDeg = new Map();
  for (const e of model.edges) { inDeg.set(e.dst, (inDeg.get(e.dst) ?? 0) + 1); outDeg.set(e.src, (outDeg.get(e.src) ?? 0) + 1); }
  const effH = (id) => { const n = model.nodes.get(id); return n ? (n.effH ?? n.size[1]) : 0; };
  const movable = (id) => { const n = model.nodes.get(id); return !!(n && !n.fixed && (!only || only.has(id))); };
  let topLine = spine.chain.filter((id) => pos.has(id));
  if (topLine.length < 2) return { positions: pos, overlaps: 0 };
  // 主链末端汇点：末端 sink 且前驱还扇出别的兄弟 → 不占顶线（并入扇列）
  {
    const last = topLine[topLine.length - 1], pred = topLine[topLine.length - 2];
    if ((outDeg.get(last) ?? 0) === 0 && (outDeg.get(pred) ?? 0) > 1) topLine = topLine.slice(0, -1);
  }
  // 1. 顶线
  const anchorTop = spine.anchorTop != null ? spine.anchorTop : Math.min(...topLine.map((id) => pos.get(id)[1]));
  let cx = Math.min(...topLine.map((id) => pos.get(id)[0]));
  topLine.forEach((id, k) => {
    const n = model.nodes.get(id);
    if (k > 0) {
      const prev = model.nodes.get(topLine[k - 1]);
      const inD = inDeg.get(id) ?? 0;
      const gap = (inD === 1 && (outDeg.get(id) ?? 0) === 1) ? inlineGap : layerGap + Math.max(0, inD - 1) * 20;
      cx = pos.get(topLine[k - 1])[0] + prev.size[0] + gap;
    }
    pos.set(id, [cx, anchorTop]);
  });
  // 2. BFS 侧节点 → 最近主链锚点 + 侧别(L/R) + 深度
  const adj = new Map();
  for (const n of model.nodes.values()) if (pos.has(n.id) && (!only || only.has(n.id))) adj.set(n.id, []);
  for (const e of model.edges) { if (adj.has(e.src) && adj.has(e.dst)) { adj.get(e.src).push({ to: e.dst, down: true }); adj.get(e.dst).push({ to: e.src, down: false }); } }
  const info = new Map(), seen = new Set(topLine), q = topLine.map((id) => ({ id, hub: id, depth: 0 }));
  while (q.length) {
    const cur = q.shift();
    for (const { to, down } of adj.get(cur.id) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      const side = cur.depth === 0 ? (down ? 'R' : 'L') : info.get(cur.id).side;
      info.set(to, { hub: cur.hub, side, depth: cur.depth + 1 });
      q.push({ id: to, hub: cur.hub, depth: cur.depth + 1 });
    }
  }
  // 3. 分组（hub|side|depth），深度升序放置
  const groups = new Map();
  for (const [id, inf] of info) { const key = `${inf.hub}|${inf.side}|${inf.depth}`; if (!groups.has(key)) groups.set(key, { hub: inf.hub, side: inf.side, depth: inf.depth, nodes: [] }); groups.get(key).nodes.push(id); }
  const groupList = [...groups.values()].sort((a, b) => a.depth - b.depth);
  for (const g of groupList) {
    const hubN = model.nodes.get(g.hub), hubPos = pos.get(g.hub);
    if (!hubN || !hubPos) continue;
    const portOf = new Map();
    for (const e of model.edges) if (e.dst === g.hub) portOf.set(e.src, e.dstPort);
    const ids = g.nodes.filter(movable).sort((a, b) => {
      const pa = portOf.get(a), pb = portOf.get(b);
      if (pa != null && pb != null && pa !== pb) return pa - pb; // 扇入：按目标输入口顺序（正面→负面→Latent）
      return (pos.get(a)[1] - pos.get(b)[1]) || a.localeCompare(b);
    });
    if (!ids.length) continue;
    const totalH = ids.reduce((s, id) => s + effH(id), 0) + (ids.length - 1) * nodeGap;
    const centerY = hubPos[1] + hubN.size[1] / 2;
    let y = centerY - totalH / 2;
    const al = align === 'auto' ? (g.side === 'L' ? 'right' : 'left') : align;
    const maxW = Math.max(...ids.map((id) => model.nodes.get(id).size[0]));
    let colLeft, colRight;
    if (g.side === 'R') {
      const parent = groupList.find((p) => p.hub === g.hub && p.side === 'R' && p.depth === g.depth - 1);
      const base = parent ? Math.max(...parent.nodes.filter(movable).map((id) => pos.get(id)[0] + model.nodes.get(id).size[0])) + sideGap : hubPos[0] + hubN.size[0] + sideGap;
      colLeft = base; colRight = base + maxW;
    } else {
      const parent = groupList.find((p) => p.hub === g.hub && p.side === 'L' && p.depth === g.depth - 1);
      const base = parent ? Math.min(...parent.nodes.filter(movable).map((id) => pos.get(id)[0])) - sideGap : hubPos[0] - sideGap;
      colRight = base; colLeft = base - maxW;
    }
    for (const id of ids) {
      const n = model.nodes.get(id);
      let x = colLeft;
      if (al === 'right') x = colRight - n.size[0];
      else if (al === 'center') x = colLeft + (maxW - n.size[0]) / 2;
      pos.set(id, [x, y]);
      y += effH(id) + nodeGap;
    }
  }
  // 4. 碰撞消解（整组下移、保持列内顺序）：顶线固定；侧组与顶线/已放置组重叠 → 整组下移
  const rect = (id) => { const n = model.nodes.get(id), p = pos.get(id); return { x: p[0], y: p[1], w: n.size[0], h: effH(id) }; };
  const xOv = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1;
  const yOv = (a, b) => a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const bboxOf = (gids) => { let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9; for (const id of gids) { const r = rect(id); mnx = Math.min(mnx, r.x); mny = Math.min(mny, r.y); mxx = Math.max(mxx, r.x + r.w); mxy = Math.max(mxy, r.y + r.h); } return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny }; };
  const placed = [];
  for (const n of model.nodes.values()) if (n.fixed && pos.has(n.id) && (!only || only.has(n.id))) placed.push({ ...rect(n.id), id: 'fixed:' + n.id });
  for (const id of topLine) if (pos.has(id)) placed.push({ ...rect(id), id: 'spine:' + id });
  const resolveOrder = groupList.filter((g) => g.nodes.some(movable)).slice().sort((a, b) => {
    const ay = Math.min(...a.nodes.filter(movable).map((id) => pos.get(id)[1]));
    const by = Math.min(...b.nodes.filter(movable).map((id) => pos.get(id)[1]));
    return ay - by;
  });
  for (const g of resolveOrder) {
    const gids = g.nodes.filter(movable);
    if (!gids.length) continue;
    let guard = 0;
    while (guard++ < 300) {
      const box = bboxOf(gids);
      const hit = placed.find((o) => xOv(box, o) && yOv(box, o));
      if (!hit) break;
      const dy = hit.y + hit.h + nodeGap - box.y; // 整组下移到命中对象下方，保持列内顺序
      if (dy <= 1e-6) break;
      for (const id of gids) { const p = pos.get(id); pos.set(id, [p[0], p[1] + dy]); }
    }
    placed.push(bboxOf(gids));
  }
  // 最终重叠统计
  const allIds = [...pos.keys()].filter(movable);
  let finalOv = 0;
  for (let i = 0; i < allIds.length; i++) for (let j = i + 1; j < allIds.length; j++) { const a = rect(allIds[i]), b = rect(allIds[j]); if (xOv(a, b) && yOv(a, b)) finalOv++; }
  return { positions: pos, overlaps: finalOv };
}

/**
 * 多连通分量布局：每个分量各算主链、独立走主链轨道排布，再竖排错开（分量间零重叠）。
 * 修「一个文件多份工作流时只有第一份对」（2026-11-09 用户反馈）。
 */
export function layoutComponents(model, positions, opts = {}) {
  const pos = new Map(positions);
  const mvIds = [...pos.keys()].filter((id) => { const n = model.nodes.get(id); return n && !n.fixed; });
  const mv = new Set(mvIds);
  const adj = new Map();
  for (const id of mvIds) adj.set(id, []);
  for (const e of model.edges) { const s = String(e.src), d = String(e.dst); if (mv.has(s) && mv.has(d)) { adj.get(s).push(d); adj.get(d).push(s); } }
  const seen = new Set(), comps = [];
  for (const id of mvIds) {
    if (seen.has(id)) continue;
    const comp = [], q = [id]; seen.add(id);
    while (q.length) { const c = q.shift(); comp.push(c); for (const nx of adj.get(c) ?? []) if (!seen.has(nx)) { seen.add(nx); q.push(nx); } }
    comps.push(comp);
  }
  let yCursor = mvIds.length ? Math.min(...mvIds.map((id) => pos.get(id)[1])) : 0;
  let overlaps = 0;
  for (const comp of comps) {
    const set = new Set(comp);
    const sp = spineOf(model, pos, set);
    const laid = layoutSpineTracks(model, pos, { ...opts, spine: sp, only: set });
    let mnx = Infinity, mny = Infinity;
    for (const id of comp) { const p = laid.positions.get(id); if (p) { mnx = Math.min(mnx, p[0]); mny = Math.min(mny, p[1]); } }
    if (!Number.isFinite(mnx)) continue;
    let maxY = -Infinity;
    for (const id of comp) {
      const p = laid.positions.get(id), n = model.nodes.get(id);
      if (p && n) { const np = [p[0] - mnx, p[1] - mny + yCursor]; pos.set(id, np); maxY = Math.max(maxY, np[1] + (n.effH ?? n.size[1])); }
    }
    overlaps += laid.overlaps ?? 0;
    yCursor = maxY + 120;
  }
  return { positions: pos, overlaps, components: comps.length };
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
