// 络纹 LuoWen — 节点拖动对齐吸附适配器（阶段 3A-2）
//
// 宿主约束（docs/comfyui-dev-conventions.md §2.7）：
//   - 宿主走 Vue 节点拖动（LiteGraph.vueNodesMode=true）。Vue 每帧用 `dragStartPos + screenToCanvas(delta)`
//     绝对重算并写入 node.pos（useNodeDrag.ts:137-192），因此吸附必须**晚于原生 rAF**再写一次。
//   - 本适配器在 window 冒泡阶段监听 pointermove（节点自身的 Vue handler 先执行、先排 rAF），
//     再排自己的 rAF，回调执行顺序即「原生 → 我们」。
//   - 收尾写入在 pointerup 内同步完成（早于 changeTracker 的 window mouseup 快照），一次拖动只产生一条 undo。
//   - 多选（canvas.selectedItems.size > 1）跳过；设置开关关闭时不写位置、不显示提示线。
//   - 提示线是 DOM overlay（pointer-events:none，z-index 高于 Vue 节点卡片层），随 canvas.ds 平移缩放同步。
//   - 只改绘制表达与拖动落点，不写图数据（Link ID / slot / 节点数据不变）。

import { alignSnap, GRID_SIZE } from './alignSnap.js';
import { graphLinks, nodeRects } from '../adapters/graphRead.js';

const OVERLAY_ID = 'luowen-snap-overlay';
const GUIDE_X_CLASS = 'luowen-snap-guide-x';
const GUIDE_Y_CLASS = 'luowen-snap-guide-y';
const GUIDE_COLOR = 'rgba(96, 165, 250, 0.95)';
const OVERLAY_Z = 500; // 高于节点卡片（运行时实测 z 19~34，选中/悬停会抬高），低于选择框 z9999、菜单 z999、提示框 z99999
const MIN_DRAG_GRAPH = 0.5; // 小于该图坐标变化视为「原生还没真正写入位置」

const state = {
  installed: false,
  canvas: null,
  enabled: true,
  snapCells: 2,
  handlers: null,
  rafId: null,
  drag: null,
  guides: null, // {host, el, x, y}
};

// 吸附距离按画布格数计（1 格 = GRID_SIZE 图 px）；解除距离 = 捕获距离 × 1.5
function snapTolerances() {
  const cells = Math.max(1, Math.min(5, Math.round(Number(state.snapCells) || 2)));
  const snapTol = cells * GRID_SIZE;
  return { snapTol, releaseTol: snapTol * 1.5 };
}

function findNode(graph, id) {
  if (!graph) return null;
  let list = graph.nodes;
  if (Array.isArray(graph._nodes)) list = graph._nodes;
  else if (list && !Array.isArray(list) && typeof list === 'object') list = Object.values(list);
  if (!Array.isArray(list)) return null;
  return list.find((n) => n && String(n.id) === String(id)) ?? null;
}

function nodeXY(node) {
  const p = node?.pos;
  return [Number(p?.[0]), Number(p?.[1])];
}

// 被拖动节点用 body 坐标：node.pos 是 body 左上角，node.size 是 body 尺寸。
// （getBounding 的 y 含标题栏，会让锚点整体上移一个标题高度，不能混用。）
function nodeWH(node) {
  return {
    w: Number(node?.size?.[0] ?? 0),
    h: Number(node?.size?.[1] ?? 0),
  };
}

function isMultiSelect(canvas) {
  const sel = canvas?.selectedItems;
  return !!(sel && typeof sel.size === 'number' && sel.size > 1);
}

// 候选 = 其他节点矩形（nodeRects 同形）+ 相连邻居的引脚行 yTarget。
// 引脚行目标：把被拖动节点 top 对齐到「邻居引脚 y - 被拖动引脚相对 top 的偏移」，使两端引脚 y 相同。
function buildCandidates(canvas, node) {
  const graph = canvas?.graph;
  if (!graph) return [];
  const selfId = String(node.id);
  const neighbors = new Set();
  const links = graphLinks(graph);

  for (const l of links) {
    if (!l || l.id == null) continue;
    if (String(l.origin_id) === selfId && l.target_id != null) neighbors.add(String(l.target_id));
    else if (String(l.target_id) === selfId && l.origin_id != null) neighbors.add(String(l.origin_id));
  }

  // nodeRects 的 y 是标题栏顶部、h 含标题栏；alignSnap 的矩形契约是 body 坐标，
  // 这里统一换算成 body 矩形（折叠节点只剩标题栏，跳过矩形候选，引脚候选仍可用）。
  const titleH = Number(window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30);
  const candidates = nodeRects(graph)
    .filter((r) => String(r.id) !== selfId && !r.collapsed)
    .map((r) => {
      const body = { id: r.id, x: r.x, y: r.y + titleH, w: r.w, h: Math.max(1, r.h - titleH) };
      return neighbors.has(String(r.id)) ? { ...body, adjacent: true } : body;
    });

  const pinSeen = new Set();
  for (const l of links) {
    if (!l || l.id == null || l.origin_slot == null || l.target_slot == null) continue;
    let neighborId;
    let movedPin;
    let neighborPin;
    try {
      if (String(l.origin_id) === selfId) {
        neighborId = l.target_id;
        movedPin = node.getOutputPos(l.origin_slot);
        const nb = findNode(graph, neighborId);
        neighborPin = nb?.getInputPos?.(l.target_slot);
      } else if (String(l.target_id) === selfId) {
        neighborId = l.origin_id;
        movedPin = node.getInputPos(l.target_slot);
        const nb = findNode(graph, neighborId);
        neighborPin = nb?.getOutputPos?.(l.origin_slot);
      } else {
        continue;
      }
    } catch {
      continue;
    }
    if (!Number.isFinite(movedPin?.[1]) || !Number.isFinite(neighborPin?.[1])) continue;

    const [nodeX, nodeY] = nodeXY(node);
    if (!Number.isFinite(nodeX) || !Number.isFinite(nodeY)) continue;
    const yTarget = nodeY + (neighborPin[1] - movedPin[1]);
    const key = `${String(neighborId)}|${Math.round(yTarget * 100) / 100}`;
    if (pinSeen.has(key)) continue;
    pinSeen.add(key);
    candidates.push({ id: neighborId, yTarget, adjacent: true, skipX: true });
  }

  return candidates;
}

// ---------- 提示线 overlay ----------

function hostContainer() {
  return document.getElementById('graph-canvas-container');
}

function ensureGuides() {
  const host = hostContainer();
  if (!host) return null;
  if (state.guides && state.guides.el.isConnected && state.guides.host === host) return state.guides;

  const old = host.querySelector(`#${OVERLAY_ID}`);
  if (old) old.remove();

  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.pointerEvents = 'none';
  el.style.overflow = 'hidden';
  el.style.zIndex = String(OVERLAY_Z);

  const x = document.createElement('div');
  x.className = GUIDE_X_CLASS;
  x.style.position = 'absolute';
  x.style.top = '0';
  x.style.bottom = '0';
  x.style.width = '0';
  x.style.borderLeft = `1px dashed ${GUIDE_COLOR}`;
  x.style.display = 'none';

  const y = document.createElement('div');
  y.className = GUIDE_Y_CLASS;
  y.style.position = 'absolute';
  y.style.left = '0';
  y.style.right = '0';
  y.style.height = '0';
  y.style.borderTop = `1px dashed ${GUIDE_COLOR}`;
  y.style.display = 'none';

  el.appendChild(x);
  el.appendChild(y);
  host.appendChild(el);
  state.guides = { host, el, x, y };
  return state.guides;
}

// 图坐标 → 容器屏幕坐标：screen = (graph + ds.offset) * ds.scale（DragAndScale.ts:145-150）
function updateGuides(result) {
  const guides = ensureGuides();
  const ds = state.canvas?.ds;
  if (!guides || !ds) return;
  const scale = Number(ds.scale) || 1;
  const ox = Number(ds.offset?.[0] ?? 0);
  const oy = Number(ds.offset?.[1] ?? 0);

  if (result?.guides?.x) {
    guides.x.style.left = `${(result.guides.x.at + ox) * scale}px`;
    guides.x.style.display = 'block';
  } else {
    guides.x.style.display = 'none';
  }
  if (result?.guides?.y) {
    guides.y.style.top = `${(result.guides.y.at + oy) * scale}px`;
    guides.y.style.display = 'block';
  } else {
    guides.y.style.display = 'none';
  }
}

function hideGuides() {
  const g = state.guides;
  if (!g) return;
  g.x.style.display = 'none';
  g.y.style.display = 'none';
}

// ---------- 拖动吸附 ----------

function resetDrag() {
  if (state.rafId !== null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  state.drag = null;
  hideGuides();
}

function applySnap() {
  const drag = state.drag;
  if (!drag || !state.enabled) return;
  const node = drag.node;
  const [x, y] = nodeXY(node);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!drag.active) {
    if (Math.hypot(x - drag.startPos.x, y - drag.startPos.y) < MIN_DRAG_GRAPH) return;
    drag.active = true;
    drag.candidates = buildCandidates(state.canvas, node);
  }

  if (isMultiSelect(state.canvas)) {
    drag.multi = true;
    drag.state = null;
    drag.last = null;
    hideGuides();
    return;
  }
  drag.multi = false;

  const size = nodeWH(node);
  const result = alignSnap({
    pos: { x, y },
    size,
    candidates: drag.candidates,
    state: drag.state,
    enabled: state.enabled,
    ...snapTolerances(),
  });
  drag.state = result.state;
  drag.last = { raw: { x, y }, position: result.position };

  if (result.snapped.x || result.snapped.y) {
    node.setPos(result.position.x, result.position.y);
    updateGuides(result);
  } else {
    hideGuides();
  }
}

function onPointerDown(event) {
  if (!state.enabled || event.button !== 0 || event.altKey) return;
  const target = event.target;
  const el = target?.closest?.('.lg-node[data-node-id]');
  if (!el) return;
  const canvas = state.canvas;
  const graph = canvas?.graph;
  if (!graph || canvas.readOnly) return;
  const node = findNode(graph, el.getAttribute('data-node-id'));
  if (!node || (node.flags && node.flags.pinned)) return;
  const [x, y] = nodeXY(node);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  resetDrag();
  state.drag = {
    node,
    startPos: { x, y },
    candidates: null,
    state: null,
    last: null,
    active: false,
    multi: false,
  };
}

function onPointerMove() {
  if (!state.enabled || !state.drag) return;
  if (state.rafId !== null) return; // 每帧一次；排在原生 rAF 之后执行
  state.rafId = requestAnimationFrame(() => {
    state.rafId = null;
    applySnap();
  });
}

function onPointerUp() {
  const drag = state.drag;
  if (state.rafId !== null) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  state.drag = null;
  // 提示线在拖动结束立即消失，之后不做任何绘制
  hideGuides();
  if (!drag || !state.enabled || !drag.active || drag.multi) return;

  const node = drag.node;
  const [x, y] = nodeXY(node);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  // 若 node.pos 仍是上一帧我们写入的吸附结果，则用其 raw 重新求解，避免重复叠加偏移。
  let raw = { x, y };
  if (
    drag.last &&
    Math.abs(x - drag.last.position.x) < 0.05 &&
    Math.abs(y - drag.last.position.y) < 0.05
  ) {
    raw = drag.last.raw;
  }

  const size = nodeWH(node);
  const result = alignSnap({
    pos: raw,
    size,
    candidates: drag.candidates ?? buildCandidates(state.canvas, node),
    state: drag.state,
    enabled: state.enabled,
    ...snapTolerances(),
  });
  if (result.snapped.x || result.snapped.y) {
    node.setPos(result.position.x, result.position.y);
  }
}

function onPointerCancel() {
  resetDrag();
}

function onContextMenu() {
  if (state.drag) resetDrag();
}

// ---------- 安装 / 卸载 / 调试 ----------

export function installSnap(canvas) {
  if (state.installed) {
    if (canvas) state.canvas = canvas;
    return true;
  }
  const ig = window.LiteGraph;
  if (!canvas || !ig || ig.vueNodesMode !== true) return false;

  state.canvas = canvas;
  state.handlers = {
    pointerdown: onPointerDown,
    pointermove: onPointerMove,
    pointerup: onPointerUp,
    pointercancel: onPointerCancel,
    contextmenu: onContextMenu,
  };
  for (const [type, fn] of Object.entries(state.handlers)) {
    window.addEventListener(type, fn); // 冒泡阶段：晚于节点自身的 Vue handler
  }
  state.installed = true;
  return true;
}

export function uninstallSnap() {
  if (state.installed && state.handlers) {
    for (const [type, fn] of Object.entries(state.handlers)) {
      window.removeEventListener(type, fn);
    }
  }
  resetDrag();
  if (state.guides?.el) state.guides.el.remove();
  state.guides = null;
  state.handlers = null;
  state.canvas = null;
  state.installed = false;
}

export function setSnapEnabled(enabled) {
  state.enabled = !!enabled;
  if (!state.enabled) resetDrag();
  return state.enabled;
}

// 吸附距离（画布格数，1–5）；设置项 onChange 调用
export function setSnapTolerance(cells) {
  state.snapCells = Math.max(1, Math.min(5, Math.round(Number(cells) || 2)));
  return state.snapCells;
}

export function getSnapDebug() {
  const drag = state.drag;
  return {
    installed: state.installed,
    enabled: state.enabled,
    snapCells: state.snapCells,
    ...snapTolerances(),
    active: !!drag?.active,
    nodeId: drag ? String(drag.node?.id) : null,
    multi: !!drag?.multi,
    state: drag?.state ?? null,
    last: drag?.last ?? null,
    guides: state.guides
      ? {
          attached: state.guides.el.isConnected,
          x: state.guides.x.style.display === 'block',
          y: state.guides.y.style.display === 'block',
        }
      : null,
  };
}
