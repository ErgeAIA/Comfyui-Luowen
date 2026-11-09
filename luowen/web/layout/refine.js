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
 * sink-coverage 终点（纯拓扑，2026-11-09 提案）：在汇点（出度 0，排除 Note）中选祖先覆盖最大者；
 * 并列按「路径长度 ↓ → 起点 top ↑ → id」决胜。祖先用位集精确求并集。
 */
function pickCoverageSink(model, ids, order, prevs, nexts, best) {
  const index = new Map();
  let i = 0;
  for (const id of ids) index.set(id, i++);
  const anc = new Map();
  for (const id of order) {
    let bits = 1n << BigInt(index.get(id));
    for (const p of prevs.get(id)) bits |= anc.get(p) ?? 0n;
    anc.set(id, bits);
  }
  const bitCount = (x) => { let c = 0; while (x) { x &= x - 1n; c++; } return c; };
  let win = null, winCover = -1, winLen = -1, winY = Infinity;
  for (const id of ids) {
    if (nexts.get(id).length) continue;
    const n = model.nodes.get(id);
    if (n && n.kind === 'note') continue;
    const b = best.get(id);
    if (!b) continue;
    const cover = bitCount(anc.get(id));
    const idTie = win == null || String(id).localeCompare(String(win), 'en', { numeric: true }) < 0;
    const better = cover > winCover
      || (cover === winCover && b.len > winLen)
      || (cover === winCover && b.len === winLen && (b.startY < winY || (b.startY === winY && idTie)));
    if (better) { win = id; winCover = cover; winLen = b.len; winY = b.startY; }
  }
  return win;
}

/**
 * 主链识别（用户校准 2026-11-09）：默认取「祖先覆盖最大的汇点」的最长上游链（并列按长度/起点 top），
 * 返回链节点 ids 与锚顶（链上第二个节点的 top）。定位交给 R2 列重排：列内顶端是主链节点的列
 * 锚定到锚顶——既保证主链顶边成一条线，又不会把扇出列（顶端非主链）的堆叠打断。
 * 默认 strategy='sink-coverage'：「祖先覆盖最大的汇点 + 以它结尾的最长路径」（仍是纯拓扑）；'longest' 保留供回退/测试。
 * 链 <3 节点或含环时返回空。
 */
export function spineOf(model, positions, subset = null, { strategy = 'sink-coverage' } = {}) {
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
  for (const id of order) {
    let cur = { len: 1, startY: pos.get(id)[1], prev: null };
    for (const p of prevs.get(id)) {
      const b = best.get(p);
      if (!b) continue;
      if (b.len + 1 > cur.len || (b.len + 1 === cur.len && b.startY < cur.startY)) cur = { len: b.len + 1, startY: b.startY, prev: p };
    }
    best.set(id, cur);
  }
  // 终点选择：longest=全图最长（现状）；sink-coverage=覆盖祖先最多的汇点（纯拓扑，排除 Note）
  let bestEnd = strategy === 'sink-coverage' ? pickCoverageSink(model, ids, order, prevs, nexts, best) : null;
  if (!bestEnd || best.get(bestEnd).len < 3) {
    let bestLen = 0, bestStartY = Infinity;
    for (const id of order) {
      const cur = best.get(id);
      if (cur.len > bestLen || (cur.len === bestLen && cur.startY < bestStartY)) { bestLen = cur.len; bestStartY = cur.startY; bestEnd = id; }
    }
  }
  if (!bestEnd || best.get(bestEnd).len < 3) return empty;
  const chain = [];
  for (let id = bestEnd; id != null; id = best.get(id).prev) chain.unshift(id);
  // 首节点是纯源、而第二个节点有多个输入 → 它是兄弟之一，不是主轴起点；主轴从汇合点开始
  while (chain.length >= 4) {
    const a = chain[0], b = chain[1];
    if ((prevs.get(a) ?? []).length === 0 && (prevs.get(b) ?? []).length > 1) chain.shift(); else break;
  }
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
  const effW = (id) => { const n = model.nodes.get(id); return n ? (n.effW ?? n.size[0]) : 0; };
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
  let cy = anchorTop, cyPrev = anchorTop;
  topLine.forEach((id, k) => {
    const n = model.nodes.get(id);
    if (k > 0) {
      const prevId = topLine[k - 1], prev = model.nodes.get(prevId);
      const inD = inDeg.get(id) ?? 0;
      let gap = (inD === 1 && (outDeg.get(id) ?? 0) === 1) ? inlineGap : layerGap + Math.max(0, inD - 1) * 20;
      // 可读性优先：扇入密集 / 扇出 / 需要插深度源的主轴段主动放宽
      if (inD >= 5) gap += 60;
      if ((prev.outPorts?.length || 0) > 1 && inD >= 4) gap += 40;
      let hasD2 = false;
      for (const e of model.edges) if (e.dst === id) for (const e2 of model.edges) if (e2.dst === e.src) { hasD2 = true; break; }
      if (hasD2) gap += 120;
      cx = pos.get(prevId)[0] + prev.size[0] + gap;
      // 主轴以端口连线水平为准（减少弯折），不再强制顶边共线
      const es = model.edges.filter((e) => e.src === prevId && e.dst === id);
      if (es.length) {
        let sum = 0;
        for (const e of es) {
          const outN = prev.outPorts.length || 1, inN = n.inPorts.length || 1;
          const prevOutY = cyPrev + prev.size[1] * ((e.srcPort + 0.5) / outN);
          sum += prevOutY - n.size[1] * ((e.dstPort + 0.5) / inN);
        }
        cy = sum / es.length;
      } else cy = anchorTop;
    }
    pos.set(id, [cx, cy]);
    cyPrev = cy;
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
  const placedGroups = [];
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
    let centerY = hubPos[1] + hubN.size[1] / 2;
    if (g.depth > 1) {
      const parents = new Set();
      for (const id of ids) for (const e of model.edges) if (e.src === id) { const inf = info.get(e.dst); if (inf && inf.hub === g.hub && inf.depth === g.depth - 1) parents.add(e.dst); }
      if (parents.size) centerY = [...parents].reduce((s2, id) => s2 + pos.get(id)[1] + effH(id) / 2, 0) / parents.size;
    }
    const al = align === 'auto' ? (g.side === 'L' ? 'right' : 'left') : align;
    const maxW = Math.max(...ids.map((id) => effW(id)));
    let colLeft, colRight;
    if (g.side === 'R') {
      const parent = groupList.find((p) => p.hub === g.hub && p.side === 'R' && p.depth === g.depth - 1);
      const base = parent ? Math.max(...parent.nodes.filter(movable).map((id) => pos.get(id)[0] + effW(id))) + sideGap : hubPos[0] + effW(g.hub) + sideGap;
      colLeft = base; colRight = base + maxW;
    } else {
      const parent = groupList.find((p) => p.hub === g.hub && p.side === 'L' && p.depth === g.depth - 1);
      const base = parent ? Math.min(...parent.nodes.filter(movable).map((id) => pos.get(id)[0])) - sideGap : hubPos[0] - sideGap;
      colRight = base; colLeft = base - maxW;
      // 深度1 的扇入列右缘对齐主轴前驱右缘（#231/#223 对齐 #220）
      if (g.depth === 1) {
        const hi = topLine.indexOf(g.hub);
        if (hi > 0) { const prevId = topLine[hi - 1]; colRight = Math.min(colRight, pos.get(prevId)[0] + effW(prevId)); colLeft = colRight - maxW; }
      }
    }
    const hOf = (list) => list.reduce((s, id) => s + effH(id), 0) + Math.max(0, list.length - 1) * nodeGap;
    const place = (id, y, k, layout) => {
      const n = model.nodes.get(id);
      const w = layout.widths[k] ?? maxW;
      const off = layout.offsets[k] ?? k * (sideGap + maxW);
      let left, right;
      if (g.side === 'R') { left = colLeft + off; right = left + w; }
      else { right = colRight - off; left = right - w; }
      let x = left;
      if (al === 'right') x = right - effW(id);
      else if (al === 'center') x = left + (w - effW(id)) / 2;
      pos.set(id, [x, y]);
      return y + effH(id) + nodeGap;
    };
    // 直接扇入源：严格按目标输入口排序，以主链源为锚（下口在下）；
    // 单列过高时折列，但每列都贴同一锚线，顺序与高度同时满足。
    // 行式网格：按目标口顺序逐行填（每行 ≤3 列），行内用 6px 递增偏移保持严格 Y 序；
    // 整块贴主链锚线（上方组底边贴锚顶上方、下方组顶边贴锚底下方），既紧凑又不打乱顺序。
    const stackPlace = (list, startY) => {
      if (!list.length) return;
      const layout = { widths: [maxW], offsets: [0] };
      let y = startY;
      for (const id of list) y = place(id, y, 0, layout);
      placedGroups.push({ nodes: list, order: startY, hub: g.hub, side: g.side, depth: g.depth });
    };
    let placed = false;
    if (g.side === 'L' && g.depth === 1 && portOf.size) {
      const topSet = new Set(topLine);
      const spineSrc = [];
      for (const e of model.edges) if (e.dst === g.hub && topSet.has(e.src)) spineSrc.push({ id: e.src, port: e.dstPort });
      if (spineSrc.length) {
        const minPort = Math.min(...spineSrc.map((s) => s.port));
        const maxPort = Math.max(...spineSrc.map((s) => s.port));
        const above = ids.filter((id) => (portOf.get(id) ?? 1e9) < minPort).sort((a, b) => portOf.get(a) - portOf.get(b));
        const below = ids.filter((id) => (portOf.get(id) ?? 1e9) > maxPort).sort((a, b) => portOf.get(a) - portOf.get(b));
        const pinY = (slot) => hubPos[1] + hubN.size[1] * ((slot + 0.5) / Math.max(1, hubN.inPorts.length));
        if (above.length) {
          const anchorSlot = Math.max(...above.map((id) => portOf.get(id) ?? 0));
          stackPlace(above, pinY(anchorSlot) - nodeGap - hOf(above));
          placed = true;
        }
        if (below.length) {
          const anchorSlot = Math.min(...below.map((id) => portOf.get(id) ?? 0));
          stackPlace(below, pinY(anchorSlot) + nodeGap);
          placed = true;
        }
      }
    }
    if (!placed) {
      const layout = { widths: [maxW], offsets: [0] };
      // 无主链锚：兄弟以目标针脚中心线为轴上下对称（前半在上、后半在下），右对齐
      const pinY = (slot) => hubPos[1] + hubN.size[1] * ((slot + 0.5) / Math.max(1, hubN.inPorts.length));
      const slotOf = (id) => portOf.get(id) ?? 0;
      const axis = ids.reduce((s2, id) => s2 + pinY(slotOf(id)), 0) / ids.length;
      const half = Math.ceil(ids.length / 2);
      const up = ids.slice(0, half), down = ids.slice(half);
      const hUp = hOf(up);
      const startY = axis - nodeGap / 2 - hUp;
      let y = startY;
      for (const id of up) y = place(id, y, 0, layout);
      y = axis + nodeGap / 2;
      for (const id of down) y = place(id, y, 0, layout);
      // 深度≥2：记录父节点与锁定侧（最终阶段按父节点最终位置复核）
      let lock = null;
      if (g.depth > 1) {
        const parents = new Set();
        for (const id of ids) for (const e of model.edges) if (e.src === id) { const inf = info.get(e.dst); if (inf && inf.hub === g.hub && inf.depth === g.depth - 1) parents.add(e.dst); }
        if (parents.size) {
          const pTop = Math.min(...[...parents].map((id) => pos.get(id)[1]));
          const pBot = Math.max(...[...parents].map((id) => pos.get(id)[1] + effH(id)));
          if (g.side === 'L') lock = { side: 'above', parents: [...parents] };
        }
      }
      placedGroups.push({ nodes: ids, order: startY, hub: g.hub, side: g.side, depth: g.depth, lock });
    }
  }
  // 4. 碰撞消解（整列就近上下、保持列内顺序）：顶线固定；侧列与顶线/已放置对象重叠 → 取最近的合法位置
  const rect = (id) => { const n = model.nodes.get(id), p = pos.get(id); return { x: p[0], y: p[1], w: effW(id), h: effH(id) }; };
  const xOv = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1;
  const yOv = (a, b) => a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const bboxOf = (gids) => { let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9; for (const id of gids) { const r = rect(id); mnx = Math.min(mnx, r.x); mny = Math.min(mny, r.y); mxx = Math.max(mxx, r.x + r.w); mxy = Math.max(mxy, r.y + r.h); } return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny }; };
  const placed = [];
  for (const n of model.nodes.values()) if (n.fixed && pos.has(n.id) && (!only || only.has(n.id))) placed.push({ ...rect(n.id), id: 'fixed:' + n.id });
  for (const id of topLine) if (pos.has(id)) placed.push({ ...rect(id), id: 'spine:' + id });
  const resolveOrder = placedGroups.slice().sort((a, b) => a.order - b.order);
  for (const g of resolveOrder) {
    const gids = g.nodes;
    if (!gids.length) continue;
    const box = bboxOf(gids);
    // 上下就近：找离原位置最近、且与已放置对象（含间距）不冲突的整列顶部
    const placedX = placed.filter((o) => xOv(box, o));
    if (placedX.length) {
      const gaps = placedX.map((o) => [o.y - nodeGap, o.y + o.h + nodeGap]);
      const fits = (top) => !gaps.some(([a, b]) => top < b - 1e-6 && a < top + box.h - 1e-6);
      if (!fits(box.y)) {
        const cands = [];
        for (const [a, b] of gaps) { cands.push(a - box.h); cands.push(b); }
        const lim = g.limit;
        const okLim = (c) => !lim || (lim.type === 'above' ? c + box.h <= lim.y + 1e-6 : c >= lim.y - 1e-6);
        let best = null;
        for (const c of cands) {
          if (!fits(c) || !okLim(c)) continue;
          const d = Math.abs(c - box.y);
          if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && c > best.c)) best = { c, d };
        }
        if (!best) for (const c of cands) { if (!fits(c)) continue; const d = Math.abs(c - box.y); if (!best || d < best.d - 1e-9) best = { c, d }; }
        if (best) for (const id of gids) { const p = pos.get(id); pos.set(id, [p[0], p[1] + (best.c - box.y)]); }
      }
    }
    placed.push(bboxOf(gids));
  }
  // 深度≥2 上游源：端口对齐父节点；冲突时插空档（x 右移到障碍右侧）
  for (const g of placedGroups) {
    if (!(g.depth > 1 && g.side === 'L' && g.hub)) continue;
    const parents = new Set();
    for (const id of g.nodes) for (const e of model.edges) if (e.src === id) { const inf = info.get(e.dst); if (inf && inf.hub === g.hub && inf.depth === g.depth - 1) parents.add(e.dst); }
    if (!parents.size) continue;
    const deltas = [];
    for (const id of g.nodes) {
      const e = model.edges.find((x) => x.src === id && parents.has(x.dst));
      if (!e) continue;
      const pn = model.nodes.get(e.dst), sn = model.nodes.get(id);
      if (!pn || !sn) continue;
      const py = pos.get(e.dst)[1] + pn.size[1] * ((e.dstPort + 0.5) / Math.max(1, pn.inPorts.length));
      const oy = pos.get(id)[1] + sn.size[1] * ((e.srcPort + 0.5) / Math.max(1, sn.outPorts.length));
      deltas.push(py - oy);
    }
    if (!deltas.length) continue;
    const dy = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const own = new Set(g.nodes);
    const shiftY = (d) => { for (const id of g.nodes) { const p = pos.get(id); pos.set(id, [p[0], p[1] + d]); } };
    const collides = () => {
      const b = bboxOf(g.nodes);
      for (const n of model.nodes.values()) { if (!pos.has(n.id) || own.has(n.id)) continue; const r = rect(n.id); if (xOv(b, r) && yOv(b, r)) return true; }
      return false;
    };
    const baseX = bboxOf(g.nodes).x;
    const shiftX = (d) => { for (const id of g.nodes) { const p = pos.get(id); pos.set(id, [p[0] + d, p[1]]); } };
    shiftY(dy);
    if (collides()) {
      shiftY(-dy);
      const b = bboxOf(g.nodes);
      const yLo = b.y + dy, yHi = b.y + b.h + dy;
      const cands = [baseX];
      for (const n of model.nodes.values()) {
        if (!pos.has(n.id) || own.has(n.id)) continue;
        const r = rect(n.id);
        if (r.y < yHi + nodeGap && yLo < r.y + r.h + nodeGap) cands.push(r.x + r.w + nodeGap);
      }
      cands.sort((a, b2) => a - b2);
      let ok = false;
      for (const cx of cands) {
        if (cx < baseX) continue;
        shiftX(cx - baseX);
        shiftY(dy);
        if (!collides()) { ok = true; break; }
        shiftY(-dy);
        shiftX(baseX - cx);
      }
      if (!ok) { shiftX(baseX - bboxOf(g.nodes).x); }
    }
  }
  // 兄弟单边吸附：输出口与目标入口 |dy| ≤ 40 且不产生重叠 → 采纳
  {
    const spineSet = new Set(spine.chain);
    const cand = [];
    for (const n of model.nodes.values()) {
      if (!pos.has(n.id) || spineSet.has(n.id) || n.fixed || n.kind === 'note') continue;
      const es = model.edges.filter((e) => e.src === n.id);
      if (es.length !== 1) continue;
      const e = es[0]; if (!pos.has(e.dst)) continue;
      const tn = model.nodes.get(e.dst); if (!tn) continue;
      const py = pos.get(e.dst)[1] + tn.size[1] * ((e.dstPort + 0.5) / Math.max(1, tn.inPorts.length));
      const oy = pos.get(n.id)[1] + n.size[1] * ((e.srcPort + 0.5) / Math.max(1, n.outPorts.length));
      const dy = py - oy;
      if (Math.abs(dy) > 1e-6 && Math.abs(dy) <= 40) cand.push({ id: n.id, dy });
    }
    cand.sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy));
    for (const c of cand) {
      const shift = (d) => { const p = pos.get(c.id); pos.set(c.id, [p[0], p[1] + d]); };
      const coll = () => { const r = rect(c.id); for (const n of model.nodes.values()) { if (!pos.has(n.id) || n.id === c.id) continue; const o = rect(n.id); if (xOv(r, o) && yOv(r, o)) return true; } return false; };
      shift(c.dy); if (coll()) shift(-c.dy);
    }
  }
  // 最终重叠统计
  const allIds = [...pos.keys()].filter(movable);
  let finalOv = 0;
  for (let i = 0; i < allIds.length; i++) for (let j = i + 1; j < allIds.length; j++) { const a = rect(allIds[i]), b = rect(allIds[j]); if (xOv(a, b) && yOv(a, b)) finalOv++; }
  return { positions: pos, overlaps: finalOv };
}

/**
 * 可动节点的连通分量（连通流）。ids 可选：只在这些 id 内找分量。
 */
export function movableComponents(model, positions, ids = null) {
  const mvIds = (ids ? [...ids] : [...positions.keys()]).filter((id) => { const n = model.nodes.get(id); return n && positions.has(id) && !n.fixed; });
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
  return comps;
}

/**
 * 分量布局：每个分量各算主链、独立走主链轨道。
 * - 默认：分量竖排/横排错开（多工作流全图）。
 * - anchorToOriginal：就地锚定（新布局左上角=该分量原左上角），用于「整理选中所在流」。
 * - movableIds：只布局这些节点（默认所有未固定节点）。
 */
export function layoutComponents(model, positions, { arrangement = 'vertical', anchorToOriginal = false, movableIds = null, spineStrategy = null, ...opts } = {}) {
  const pos = new Map(positions);
  const orig = new Map(positions);
  const comps = movableComponents(model, positions, movableIds);
  const spines = [];
  const allMv = comps.flat();
  const startX = allMv.length ? Math.min(...allMv.map((id) => pos.get(id)[0])) : 0;
  const startY = allMv.length ? Math.min(...allMv.map((id) => pos.get(id)[1])) : 0;
  const horiz = arrangement === 'horizontal';
  let cursor = horiz ? startX : startY;
  let overlaps = 0;
  for (const comp of comps) {
    const set = new Set(comp);
    const sp = spineOf(model, pos, set, spineStrategy ? { strategy: spineStrategy } : undefined);
    spines.push(sp.chain);
    const laid = layoutSpineTracks(model, pos, { ...opts, spine: sp, only: set });
    let mnx = Infinity, mny = Infinity;
    for (const id of comp) { const p = laid.positions.get(id); if (p) { mnx = Math.min(mnx, p[0]); mny = Math.min(mny, p[1]); } }
    if (!Number.isFinite(mnx)) continue;
    if (anchorToOriginal) {
      let ox = Infinity, oy = Infinity;
      for (const id of comp) { const p = orig.get(id); if (p) { ox = Math.min(ox, p[0]); oy = Math.min(oy, p[1]); } }
      if (!Number.isFinite(ox)) { ox = mnx; oy = mny; }
      for (const id of comp) { const p = laid.positions.get(id); if (p) pos.set(id, [ox + (p[0] - mnx), oy + (p[1] - mny)]); }
    } else {
      let maxW = 0, maxH = 0;
      for (const id of comp) { const p = laid.positions.get(id), n = model.nodes.get(id); if (p && n) { maxW = Math.max(maxW, p[0] - mnx + (n.effW ?? n.size[0])); maxH = Math.max(maxH, p[1] - mny + (n.effH ?? n.size[1])); } }
      for (const id of comp) { const p = laid.positions.get(id); if (p) pos.set(id, [(horiz ? cursor : startX) + (p[0] - mnx), (horiz ? startY : cursor) + (p[1] - mny)]); }
      cursor += (horiz ? maxW : maxH) + 120;
    }
    overlaps += laid.overlaps ?? 0;
  }
  return { positions: pos, overlaps, components: comps.length, spines };
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
