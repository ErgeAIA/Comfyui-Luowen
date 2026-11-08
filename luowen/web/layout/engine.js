// 自动布局生产编排（DEC-043 实施轮，PRD docs/specs/auto-layout/prd.md v1.0 批准口径）。
// 职责：现场快照 → 约束 → ELK（vendor 懒加载）→ 障碍规避 → 应用写入（pos+折叠）→ 单条 undo 链。
// 边界（F-015 修订后）：只写 pos 与折叠状态/折叠尺寸（D1，开关默认关）；不触碰连接与图数据；非热路径（用户主动触发）。
import { buildModel, isNoteType } from './graph-model.js';
import { buildConstraints, shiftToFreeBand } from './constraints.js';
import { evaluateLayout } from './metrics.js';

// ---------- vendor 懒加载（首次触发才拉起 1.6MB bundle） ----------
let elkPromise = null;
async function loadElk() {
  if (!elkPromise) {
    // UMD bundle 在浏览器 ESM 下不产生模块导出，而是挂 self.ELK（webpack UMD root=self）；
    // Node require 场景才是 module.exports。两种环境都兼容解析。
    elkPromise = import('../vendor/elk.bundled.js').then((m) => {
      const fromSelf = typeof self !== 'undefined' ? self.ELK : null;
      return fromSelf || m.default || m.ELK || m;
    });
  }
  return elkPromise;
}

// ---------- 现场快照（只读 LGraph；duck-typed 便于单测） ----------
export function snapshotFromGraph(graph) {
  const nodes = (graph._nodes ?? []).map((n) => ({
    id: String(n.id),
    type: String(n.type ?? ''),
    pos: [n.pos?.[0] ?? 0, n.pos?.[1] ?? 0],
    size: [n.size?.[0] ?? 0, n.size?.[1] ?? 0],
    inputs: n.inputs ?? [],
    outputs: n.outputs ?? [],
    pinned: !!n.pinned,
    collapsed: !!n.collapsed,
  }));
  const links = [];
  if (graph.links && typeof graph.links.values === 'function') {
    for (const l of graph.links.values()) {
      links.push({ id: String(l.id), fromId: String(l.origin_id), fromSlot: l.origin_slot ?? 0, toId: String(l.target_id), toSlot: l.target_slot ?? 0 });
    }
  }
  const groups = (graph.groups ?? []).map((g, i) => {
    const b = g._bounding ?? g.bounding ?? [0, 0, 0, 0];
    return { id: String(g.id ?? `g${i}`), title: String(g.title ?? ''), bounds: [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0] };
  });
  return { nodes, links, groups };
}

// ---------- 撤销链（Phase D 实测：Pinia workflow store，前后双采） ----------
function getChangeTracker(app) {
  const pinia = app?.extensionManager?._p;
  if (!pinia?._s) return null;
  for (const st of pinia._s.values()) {
    if (st && st.activeWorkflow !== undefined) return st.activeWorkflow?.changeTracker ?? null;
  }
  return null;
}
function captureState(app) {
  const t = getChangeTracker(app);
  try { t?.captureCanvasState(); } catch { /* 撤销链失败不阻断布局 */ }
  return t;
}

// ---------- ELK 布局（movable 子图 + 端口 FIXED_SIDE） ----------
async function elkLayout(model, movableIds, { nodeSpacing = 60, layerSpacing = 100 } = {}) {
  const ELK = await loadElk();
  const elk = new ELK();
  const mv = new Set(movableIds.map(String));
  const children = [];
  for (const n of model.nodes.values()) {
    if (!mv.has(n.id)) continue;
    children.push({
      id: n.id,
      width: Math.max(1, n.size[0]),
      height: Math.max(1, n.size[1]),
      ports: [
        ...n.inPorts.map((p, i) => ({ id: `${n.id}:in:${p.index}`, width: 1, height: 1, layoutOptions: { 'org.eclipse.elk.port.side': 'WEST' } })),
        ...n.outPorts.map((p, i) => ({ id: `${n.id}:out:${p.index}`, width: 1, height: 1, layoutOptions: { 'org.eclipse.elk.port.side': 'EAST' } })),
      ],
      layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_SIDE' },
    });
  }
  const edges = model.edges
    .filter((e) => mv.has(e.src) && mv.has(e.dst))
    .map((e) => ({ id: e.id, sources: [`${e.src}:out:${e.srcPort}`], targets: [`${e.dst}:in:${e.dstPort}`] }));
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'org.eclipse.elk.direction': 'RIGHT',
      'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'org.eclipse.elk.spacing.nodeNode': String(nodeSpacing),
      'org.eclipse.elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'org.eclipse.elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'org.eclipse.elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
      'org.eclipse.elk.edgeRouting': 'ORTHOGONAL',
    },
    children,
    edges,
  });
  const positions = new Map();
  for (const c of result.children ?? []) positions.set(String(c.id), [c.x, c.y]);
  return positions;
}

// ---------- 应用写入（仅 pos + D1 折叠；不触碰连接数据） ----------
const COLLAPSED_NOTE_HEIGHT = 30; // 折叠后标题条高度（LiteGraph.NODE_TITLE_HEIGHT 口径）

function applyPositions(graph, positions, { collapseNotes, noteIds }) {
  let moved = 0;
  for (const n of graph._nodes ?? []) {
    const id = String(n.id);
    const p = positions.get(id);
    if (!p) continue;
    if (n.pos[0] !== p[0] || n.pos[1] !== p[1]) moved++;
    n.pos[0] = p[0];
    n.pos[1] = p[1];
    if (collapseNotes && noteIds.has(id) && isNoteType(n.type)) {
      try { n.collapse?.(true); } catch { /* 个别类型不支持折叠时保持展开 */ }
      if (n.size[1] > COLLAPSED_NOTE_HEIGHT) n.size[1] = COLLAPSED_NOTE_HEIGHT;
    }
  }
  return moved;
}

// ---------- Group bounds 随成员重算（MVP：成员新包围盒 + 边距 20） ----------
function recomputeGroupBounds(graph, memberIdsByGroupId, groupIdsInOrder) {
  const grps = graph.groups ?? [];
  grps.forEach((grp, i) => {
    const ids = memberIdsByGroupId.get(groupIdsInOrder[i]);
    if (!ids || !ids.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graph._nodes ?? []) {
      if (!ids.includes(String(n.id))) continue;
      minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1]);
      maxX = Math.max(maxX, n.pos[0] + n.size[0]); maxY = Math.max(maxY, n.pos[1] + n.size[1]);
    }
    if (!Number.isFinite(minX)) return;
    const bw = Math.max(maxX - minX + 40, 100);
    const bh = Math.max(maxY - minY + 40, 60);
    // 正规写入口（1.55.18 LGraphGroup）：setBounds + commitBounds（同步 layoutStore 与 mutation views）
    if (typeof grp.setBounds === 'function') {
      grp.setBounds(minX - 20, minY - 20, bw, bh);
      grp.commitBounds?.();
    } else if (Array.isArray(grp._bounding)) {
      grp._bounding.splice(0, 4, minX - 20, minY - 20, bw, bh);
    }
    grp.setDirtyCanvas?.(true, true);
  });
}

// ---------- 主入口 ----------
/**
 * 执行自动布局。
 * @param {object} app ComfyUI app 实例（由 index.js 注入，本模块不直接引用 window 全局）
 * @param {object} opts { scope:'full'|'selected', collapseNotes:boolean }
 * @returns { report } { moved, noteIdsCollapsed, groups, metrics, ms }
 */
export async function runAutoLayout(app, { scope = 'full', collapseNotes = false } = {}) {
  const graph = app.canvas.graph;
  if (!graph) throw new Error('no graph');
  const t0 = performance.now();

  const snapshot = snapshotFromGraph(graph);
  const model = buildModel(snapshot);
  const selectedIds = scope === 'selected'
    ? [...(app.canvas.selectedItems ?? [])].map((n) => String(n?.id ?? n)).filter((id) => model.nodes.has(id))
    : null;
  if (scope === 'selected' && (!selectedIds || !selectedIds.length)) {
    return { moved: 0, skipped: 'no-selection' };
  }
  const constraints = buildConstraints(model, { selectedIds });
  // R3（用户反馈 2026-11-09）：含 Reroute 的分量整体跳过重排——手动意图保护（清除转接点超出整理范畴）
  const { rerouteComponentIds } = await import('./refine.js');
  const skipIds = rerouteComponentIds(model);
  if (skipIds.size) {
    constraints.movableIds = constraints.movableIds.filter((id) => !skipIds.has(id));
    for (const n of model.nodes.values()) {
      if (skipIds.has(n.id) && !constraints.fixedIds.has(n.id)) {
        constraints.fixedIds.add(n.id);
        constraints.obstacles.push({ id: n.id, x: n.pos[0], y: n.pos[1], w: n.size[0], h: n.size[1] });
      }
    }
  }
  if (!constraints.movableIds.length) return { moved: 0, skipped: 'nothing-movable' };

  let positions = await elkLayout(model, constraints.movableIds);
  // R1/R2 精修后处理（用户反馈：③拉直 ①对齐 ②同列减交叉；重叠守卫内建）
  const { straightenEdges, swapReduceCrossings } = await import('./refine.js');
  const st = straightenEdges(model, positions);
  positions = st.positions;
  const sw = swapReduceCrossings(model, positions, { colGap: 150 });
  positions = sw.positions;
  // 障碍规避：有 fixed/未选（局部）时，把新布局整体平移到 fixed 包围盒右侧空白带（硬约束：不重叠）
  shiftToFreeBand(positions, constraints.obstacles, { margin: 60 });

  // Group 成员表（快照时按几何包含推导，随模型保留）
  const memberIdsByGroupId = new Map(model.groups.filter((g) => g.memberIds.length).map((g) => [g.id, g.memberIds]));

  // 撤销链：布局前 capture → 写入 → 布局后 capture（activeState 模型，Phase D 实测口径）
  captureState(app);
  const noteIds = new Set(model.notes);
  const moved = applyPositions(graph, positions, { collapseNotes, noteIds });
  recomputeGroupBounds(graph, memberIdsByGroupId, model.groups.map((g) => g.id));
  captureState(app);

  app.canvas.setDirty(true, true);
  const positionsFinal = new Map([...model.nodes.values()].map((n) => [n.id, positions.get(n.id) ?? n.pos]));
  return {
    moved,
    skippedRerouteComponents: skipIds.size ? [...skipIds] : [],
    straightened: st.movedCount,
    swaps: sw.swaps,
    noteIdsCollapsed: collapseNotes ? [...noteIds] : [],
    groups: memberIdsByGroupId.size,
    metrics: evaluateLayout(model, positionsFinal, new Map([...model.nodes.values()].map((n) => [n.id, n.pos]))),
    ms: Math.round((performance.now() - t0) * 100) / 100,
  };
}
