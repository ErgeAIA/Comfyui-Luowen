// 自动布局 Phase B（DEC-043）：图模型与约束模型——纯计算层。
// 纪律（plan.md §3 阶段 B）：不触碰 ComfyUI UI 对象、不写图数据；输入为 plain-data 快照，
// 输出为 plain-data 模型；算法（Phase C）只消费本层产物。
//
// 快照形状（由适配器或 fromWorkflowJson 从工作流 JSON 构建）：
//   snapshot = {
//     nodes: [{ id, type, pos:[x,y], size:[w,h], inputs:[{name,type?}], outputs:[{name,type?}],
//              note?:bool, selected?:bool, pinned?:bool }],
//     links: [{ id, fromId, fromSlot, toId, toSlot }],
//     groups: [{ id, title?, bounds:[x,y,w,h] }],          // bounds = [x, y, w, h]
//   }
// 模型形状（LayoutModel）：
//   {
//     nodes: Map<id, { id, type, pos, size, inPorts, outPorts, kind:'node'|'note', fixed, selected }>,
//     edges: [{ id, src, dst, srcPort, dstPort, rerouteChain:[id...], manualIntent }],
//     groups: [{ id, title, bounds, memberIds }],
//     reroutes: Map<id, { id, pos, size }>,                // Reroute/Note 以外的透明路径点（折叠后不参与分层）
//     notes: [id...],
//     components: [[id...]],                               // 无向连通分量（不含 reroute 节点）
//     topoOrder: [id...] | null,                           // Kahn 序；有环为 null
//     dropped: [{ kind:'link'|'node', id, reason }],       // 引用缺失等被剔除项（如实报告，不静默）
//   }

// Reroute / Note 的类型识别（工作流 JSON 的大写类型名与运行时 type 字符串均可能）
export function isRerouteType(type) {
  return /reroute/i.test(String(type));
}
export function isNoteType(type) {
  return /note|markdown/i.test(String(type));
}

function toPorts(list) {
  return (list ?? []).map((p, i) => ({ index: i, name: String(p?.name ?? ''), type: p?.type != null ? String(p.type) : null }));
}

/**
 * 从 plain-data 快照构建 LayoutModel。
 * 严格性：引用缺失的 link/node 剔除并记入 dropped（不静默）；不抛错（样本容错优先）。
 */
export function buildModel(snapshot) {
  const nodes = new Map();
  const reroutes = new Map();
  const notes = [];
  const dropped = [];
  for (const n of snapshot.nodes ?? []) {
    const id = n.id;
    if (id == null || nodes.has(String(id))) { dropped.push({ kind: 'node', id, reason: 'missing-or-duplicate-id' }); continue; }
    const key = String(id);
    const kind = isNoteType(n.type) ? 'note' : 'node';
    const rec = {
      id: key,
      type: String(n.type ?? ''),
      pos: [Number(n.pos?.[0] ?? 0), Number(n.pos?.[1] ?? 0)],
      size: [Number(n.size?.[0] ?? 0), Number(n.size?.[1] ?? 0)],
      effH: Number(n.effH ?? n.size?.[1] ?? 0),
      inPorts: toPorts(n.inputs),
      outPorts: toPorts(n.outputs),
      kind,
      fixed: !!n.pinned,
      selected: !!n.selected,
    };
    nodes.set(key, rec);
    if (kind === 'note') notes.push(key);
    if (isRerouteType(n.type)) reroutes.set(key, { id: key, pos: rec.pos.slice(), size: rec.size.slice() });
  }

  const edges = [];
  for (const l of snapshot.links ?? []) {
    const src = l.fromId != null ? String(l.fromId) : null;
    const dst = l.toId != null ? String(l.toId) : null;
    if (src == null || dst == null) { dropped.push({ kind: 'link', id: l.id ?? null, reason: 'missing-endpoint' }); continue; }
    if (!nodes.has(src) || !nodes.has(dst)) { dropped.push({ kind: 'link', id: l.id ?? null, reason: 'endpoint-not-in-nodes' }); continue; }
    if (src === dst) { dropped.push({ kind: 'link', id: l.id ?? null, reason: 'self-loop' }); continue; }
    edges.push({
      id: l.id != null ? String(l.id) : `e${edges.length}`,
      src, dst,
      srcPort: Number(l.fromSlot ?? 0),
      dstPort: Number(l.toSlot ?? 0),
      rerouteChain: [],
      manualIntent: false,
    });
  }

  const groups = (snapshot.groups ?? []).map((g, i) => ({
    id: g.id != null ? String(g.id) : `g${i}`,
    title: g.title != null ? String(g.title) : '',
    bounds: [Number(g.bounds?.[0] ?? 0), Number(g.bounds?.[1] ?? 0), Number(g.bounds?.[2] ?? 0), Number(g.bounds?.[3] ?? 0)],
    memberIds: [],
  }));
  // 成员关系按几何包含推导（快照未提供显式成员时）：节点中心落在 group bounds 内
  for (const g of groups) {
    for (const n of nodes.values()) {
      if (n.kind === 'note') continue;
      const cx = n.pos[0] + n.size[0] / 2, cy = n.pos[1] + n.size[1] / 2;
      const [gx, gy, gw, gh] = g.bounds;
      if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) g.memberIds.push(n.id);
    }
  }

  const model = { nodes, edges, groups, reroutes, notes, dropped };

  foldRerouteEdges(model);
  model.components = componentsOf(model);
  model.topoOrder = topoOrderOf(model);
  return model;
}

/**
 * Reroute 链折叠（DEC-033 手动意图保护口径）：Reroute 节点是透明路径点——
 * 进入 Reroute 的边沿「唯一出边」链前向折叠为直连边，标记 manualIntent=true（DEC-033 引申），
 * 被吞掉的链尾边从模型中移除（链信息保留在 rerouteChain）。
 * 保守口径：分叉/汇合的 Reroute、成环链不折叠——原边保留并记 dropped（如实报告）。
 */
export function foldRerouteEdges(model) {
  const rr = model.reroutes;
  if (rr.size === 0) return model;
  const consumed = new Set();
  for (const e of [...model.edges]) {
    if (consumed.has(e.id) || consumed.has(`${e.id}#folded`)) continue;
    if (!rr.has(e.dst)) continue; // 只有「进入 reroute」的边才可能开链
    const chain = [];
    const walked = [];
    let cur = e.dst;
    let ok = false;
    let guard = 0;
    while (guard++ < 64) {
      const outs = model.edges.filter((x) => x.src === cur && !consumed.has(x.id));
      if (outs.length !== 1) { cur = rr.has(cur) ? cur : cur; break; }
      const nxt = outs[0];
      chain.push(nxt.id);
      consumed.add(nxt.id);
      walked.push(cur);
      cur = nxt.dst;
      if (!rr.has(cur)) { ok = true; break; }
    }
    if (ok && cur !== e.src) {
      e.dst = cur;
      e.rerouteChain = chain.slice();
      e.rerouteNodes = walked.slice(); // 链上 Reroute 节点 id（跳过分量时一并固定）
      e.manualIntent = true; // 含链连接 = 手动意图（DEC-033 引申）
    } else {
      // 分叉/汇合/成环：保守不折叠，原边保留并如实报告
      model.dropped.push({ kind: 'reroute-chain', id: e.id, reason: 'cyclic-or-branching-reroute' });
    }
  }
  // 移除被折叠吞掉的链尾边；残留的「从 reroute 出发」的边如实保留（分叉退化态，Phase C 保守处理）
  model.edges = model.edges.filter((e) => !consumed.has(e.id));
  return model;
}

/** 无向连通分量（不含 reroute 节点：它们是透明路径点）。按节点 id 排序保证确定性。 */
export function componentsOf(model) {
  const parent = new Map();
  for (const [id, n] of model.nodes) {
    if (model.reroutes.has(id)) continue;
    parent.set(id, id);
  }
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const e of model.edges) {
    if (model.reroutes.has(e.src) || model.reroutes.has(e.dst)) continue;
    if (!parent.has(e.src) || !parent.has(e.dst)) continue;
    union(e.src, e.dst);
  }
  const groups = new Map();
  for (const [id] of parent) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }
  return [...groups.values()].map((ids) => ids.sort()).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
}

/** Kahn 拓扑序（reroute 节点为透明路径点，不参与）；有环返回 null。确定性：同层按 id 排序。 */
export function topoOrderOf(model) {
  const indeg = new Map();
  for (const [id] of model.nodes) {
    if (model.reroutes.has(id)) continue;
    indeg.set(id, 0);
  }
  for (const e of model.edges) {
    if (model.reroutes.has(e.src) || model.reroutes.has(e.dst)) continue;
    indeg.set(e.dst, (indeg.get(e.dst) ?? 0) + 1);
  }
  const ready = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort();
  const order = [];
  const consumed = new Map(indeg);
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const e of model.edges) {
      if (e.src !== id || model.reroutes.has(e.dst)) continue;
      const d = consumed.get(e.dst) - 1;
      consumed.set(e.dst, d);
      if (d === 0) { ready.push(e.dst); ready.sort(); }
    }
  }
  return order.length === indeg.size ? order : null;
}

/**
 * 从 ComfyUI 工作流 JSON（serialize 格式）构建快照——plain JSON，仍是纯函数（Phase C 样本实验入口）。
 * links 为 [id, fromNode, fromSlot, toNode, toSlot, type] 元组；groups.bounding 为 [x, y, w, h]。
 * Reroute：1.55 既有节点型（type 含 Reroute）也有 extra.reroutes（linkExtensions 挂链）——
 * 节点型按折叠口径处理；extra 型暂只记数（Phase D 运行时模型接入时补齐）。
 */
export function fromWorkflowJson(wf) {
  const nodes = (wf.nodes ?? []).map((n) => ({
    id: n.id,
    type: String(n.type ?? ''),
    pos: [n.pos?.[0] ?? 0, n.pos?.[1] ?? 0],
    size: [n.size?.[0] ?? 0, n.size?.[1] ?? 0],
    inputs: n.inputs ?? [],
    outputs: n.outputs ?? [],
    note: isNoteType(n.type),
    selected: !!n.selected,
    pinned: false,
  }));
  const links = (wf.links ?? []).map((l) => ({ id: l[0], fromId: l[1], fromSlot: l[2], toId: l[3], toSlot: l[4] }));
  const groups = (wf.groups ?? []).map((g, i) => ({ id: g.id ?? `g${i}`, title: g.title ?? '', bounds: g.bounding ?? [0, 0, 0, 0] }));
  const rerouteExtra = (wf.extra?.reroutes ?? []).length;
  const model = buildModel({ nodes, links, groups });
  model.rerouteExtraCount = rerouteExtra;
  return model;
}
