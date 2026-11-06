// 络纹 LuoWen — renderLink 适配器（阶段 1 核心）
//
// 依据 docs/phase0/drawing-api-notes.md 的实测结论：
//   - wrap 点 = LGraphCanvas.prototype.renderLink（原型级，子图自动覆盖；不碰随 setGraph 重建的 linkRenderer 实例）
//   - 命中测试读渲染产物（hitTesting 用 ctx.isPointInStroke(seg.path) + seg._pos 8×8）：
//     改变可见形状必须覆写 seg.path / seg._pos，命中即自动跟随
//   - link===null 拖拽预览线；id<0 floating；opts.disabled bypass；opts.reroute 共享段（阶段 1 保守回退原生，PRD F-010）
//   - this !== app.canvas = 覆盖层/派生渲染器借用（AlignLayout 连接助手模式，风险 R12）→ 直通
//
// 每帧流程：drawConnections 前置 beginFrame（障碍版本化 + lane 分配，指针按下冻结）
// → renderLink 逐线：缓存命中 → 净空预检（直线捷径）→ A*（CM router，预算兜底）→ 失败降级原生。
// 铁律：只改绘制；异常单线隔离；不写图数据。

import { route } from '../geometry/router.js';
import { emit as emitRounded, measure as measurePts, pointAt } from '../geometry/trace.js';
import { previewPath } from '../geometry/preview.js';
import { obstacleHash, corridorClear } from '../geometry/obstacles.js';
import { allocateLanes, laneHash as computeLaneHash } from '../routing/laneAssign.js';
import { createRouteCache } from '../routing/routeCache.js';
import { graphLinks, nodeRects, linksHash as computeLinksHash } from './graphRead.js';

// 前端 1.55.18 只暴露 window.comfyAPI shim（见 docs/phase0/drawing-api-notes.md §2）
const { app } = window.comfyAPI.app;

const AVOID_CLEARANCE = { low: 8, standard: 16, high: 24 };
const VPAD = 8;
const DEFAULT_STUB = 24;
const DIR_NAME = { 0: 'none', 1: 'up', 2: 'down', 3: 'left', 4: 'right', 5: 'none' };

const state = {
  installed: false,
  proto: null,
  originalRenderLink: null,
  wrappedRenderRef: null,
  originalDrawConnections: null,
  wrappedDrawRef: null,
  settings: { enabled: true, style: 'orthogonal', avoidance: 'standard' },
  frame: { obstacleHashStr: '', version: 0, rects: [], laneHashStr: '', lanes: null, linksHashStr: '' },
  cache: createRouteCache({ max: 4096 }),
  routes: new Map(), // linkId -> 当前绘制的折线（悬停命中 + 调试用）
  hoverLinkId: null,
  hoverBound: false,
  counters: { preview: 0, strictNull: 0, loose: 0, semi: 0, straight: 0, routed: 0 },
  trace: [],
  warned: false,
};

function traceEntry(e) {
  state.trace.push(e);
  if (state.trace.length > 40) state.trace.shift();
}

function warnOnce(...args) {
  if (!state.warned) {
    state.warned = true;
    console.warn('[LuoWen]', ...args);
  }
}

// ---------- 每帧前置（由 drawConnections 链式回调触发） ----------

export function beginFrame(canvas) {
  const graph = canvas?.graph;
  if (!graph) return;
  if (canvas.pointer && canvas.pointer.isDown) return; // 拖拽期冻结：不更新障碍版本/lanes（R10/CM 实践）

  const rects = nodeRects(graph);
  const oh = obstacleHash(rects);
  if (oh !== state.frame.obstacleHashStr) {
    state.frame.obstacleHashStr = oh;
    state.frame.rects = rects;
    state.frame.version += 1;
    state.routes.clear();
  } else {
    state.frame.rects = rects;
  }

  const lh = computeLaneHash(graphLinks(graph), rects) + '|' + computeLinksHash(graph);
  if (lh !== state.frame.laneHashStr) {
    state.frame.laneHashStr = lh;
    state.frame.lanes = allocateLanes(graphLinks(graph), rects);
  }
}

// ---------- 逐线渲染（renderLink wrap 体内） ----------

function sharpPath(path, pts) {
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
}

// 拖拽期预览函数在 geometry/preview.js（纯函数，可单测）

// ---------- 整线悬停（只读渲染状态，不碰图数据） ----------

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolyline(px, py, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    d = Math.min(d, pointSegDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  return d;
}

function onPointerMove(e) {
  const cfg = state.settings;
  if (!state.installed || !cfg.enabled || cfg.style === 'native') return;
  const canvas = app.canvas;
  if (!canvas?.canvas) return;
  const rect = canvas.canvas.getBoundingClientRect();
  // LiteGraph: canvas = (graph + offset) * scale（DragAndScale.convertOffsetToCanvas）
  const gx = (e.clientX - rect.left) / canvas.ds.scale - canvas.ds.offset[0];
  const gy = (e.clientY - rect.top) / canvas.ds.scale - canvas.ds.offset[1];
  const tol = 8 / canvas.ds.scale;
  let best = null;
  let bestD = tol;
  for (const [id, pts] of state.routes) {
    const d = distToPolyline(gx, gy, pts);
    if (d <= bestD) {
      bestD = d;
      best = id;
    }
  }
  if (best !== state.hoverLinkId) {
    state.hoverLinkId = best;
    canvas.setDirty(true, true);
  }
}

function onPointerLeave() {
  if (state.hoverLinkId !== null) {
    state.hoverLinkId = null;
    app.canvas?.setDirty?.(true, true);
  }
}

// 返回 true = 已由络纹绘制；false = 调用方回退原函数
function tryCustomRender(ctx, a, b, link, color, start_dir, end_dir, opts) {
  const cfg = state.settings;
  const o = opts ?? {};
  const bypass = () => {
    if (link?.id != null) state.routes.delete(link.id); // 本帧原生接管：丢弃旧调试快照
    return false;
  };
  if (!cfg.enabled || cfg.style === 'native') return bypass();
  if (!a || !b || !link || link.id == null || link.id < 0) return bypass(); // 拖拽预览 / floating
  if (o.disabled || o.reroute) return bypass(); // bypass；reroute 共享段阶段 1 保守回退（PRD F-010）
  if (this !== app.canvas) return bypass(); // 覆盖层/派生渲染器借用（R12）→ 直通

  const canvas = app.canvas;
  const graph = canvas?.graph;
  if (!graph) return bypass();

  const ax = a.x ?? a[0];
  const ay = a.y ?? a[1];
  const bx = b.x ?? b[0];
  const by = b.y ?? b[1];
  if (![ax, ay, bx, by].every(Number.isFinite)) return bypass();

  const lanes = state.frame.lanes?.get(link.id) ?? { stubOut: DEFAULT_STUB, stubIn: DEFAULT_STUB };
  const clearance = AVOID_CLEARANCE[cfg.avoidance] ?? 16;
  const key = `${link.id}|${ax}|${ay}|${bx}|${by}|${lanes.stubOut}|${lanes.stubIn}|${start_dir}>${end_dir}|${cfg.avoidance}|${cfg.style}`;

  let pts = state.cache.get(key, state.frame.version);
  if (!pts) {
    if (canvas.pointer && canvas.pointer.isDown) {
      // 拖拽期：端点正在移动的线用正交预览（不进缓存），避免整线回退成原生曲线
      state.counters.preview += 1;
      traceEntry({ id: link.id, mode: 'preview', rects: state.frame.rects.length, ver: state.frame.version });
      pts = previewPath(ax, ay, bx, by, DIR_NAME[start_dir] ?? 'right', DIR_NAME[end_dir] ?? 'left', lanes.stubOut, lanes.stubIn);
    } else {
      // 直线捷径仅限共线（水平/竖直）且走廊净空——正交样式禁止斜线（PRD §5.2）
      const colinear = Math.abs(ay - by) < 2 || Math.abs(ax - bx) < 2;
      if (colinear && corridorClear(ax, ay, bx, by, state.frame.rects, [link.origin_id, link.target_id], clearance, VPAD)) {
        state.counters.straight += 1;
        traceEntry({ id: link.id, mode: 'straight', rects: state.frame.rects.length, ver: state.frame.version });
        pts = [
          [ax, ay],
          [bx, by],
        ];
      } else {
        // 障碍包含两端节点自身：中段禁止从自己连接的卡片底下穿过（引脚 stub 仍允许贴边引出）
        const raw = state.frame.rects.map((r) => [r.x, r.y, r.w, r.h]);
        const endpointIdx = [];
        state.frame.rects.forEach((r, i) => {
          if (String(r.id) === String(link.origin_id) || String(r.id) === String(link.target_id)) endpointIdx.push(i);
        });
        const args = {
          start: [ax, ay],
          end: [bx, by],
          startDir: DIR_NAME[start_dir] ?? 'right',
          endDir: DIR_NAME[end_dir] ?? 'left',
          obstacles: raw,
          clearance,
          stubStart: lanes.stubOut,
          stubEnd: lanes.stubIn,
          vPad: VPAD,
          flatTol: 0,
        };
        const strictPts = route({ ...args, strict: true });
        if (strictPts) {
          pts = strictPts;
          state.counters.routed += 1;
          traceEntry({ id: link.id, mode: 'route', ver: state.frame.version, stub: [lanes.stubOut, lanes.stubIn], raw: raw.length, pts });
        } else {
          // semi：端点卡片仍禁行（线不被自己连接的卡片压住），第三方卡片保留 8× 代价
          const semiPts = endpointIdx.length ? route({ ...args, blockRects: endpointIdx }) : null;
          if (semiPts) {
            pts = semiPts;
            state.counters.semi += 1;
            traceEntry({ id: link.id, mode: 'semi', ver: state.frame.version, raw: raw.length, pts });
          } else {
            // loose：连 semi 都无解（引脚深埋在其他卡片里），保持正交，不出现曲线
            state.counters.loose += 1;
            pts = route({ ...args });
            if (pts) {
              traceEntry({ id: link.id, mode: 'loose', ver: state.frame.version, raw: raw.length, pts });
            } else {
              state.counters.strictNull += 1;
              traceEntry({ id: link.id, mode: 'strictNull', rects: state.frame.rects.length, ver: state.frame.version });
              return bypass(); // 连正交都无解 → 原生降级（degraded, alive）
            }
          }
        }
      }
      state.cache.set(key, state.frame.version, pts);
    }
  }

  const width = typeof canvas.connections_width === 'number' ? canvas.connections_width : 2;
  const stroke = typeof color === 'string' && color ? color : '#94a3b8';
  // 整线悬停（本适配器命中折线任意位置）或原生中心点悬停
  const hovered = state.hoverLinkId === link.id || canvas.over_link_center === link;

  const path = new Path2D();
  if (cfg.style === 'smooth') emitRounded(path, pts);
  else sharpPath(path, pts);
  const mid = pointAt(pts, measurePts(pts), 0.5); // {x, y, angle}

  ctx.save();
  ctx.lineWidth = width + (hovered ? 1.5 : 0);
  ctx.strokeStyle = stroke;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  ctx.stroke(path);
  if (hovered) {
    // 高亮：同路径白色柔光叠加（只改绘制，不改数据）
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = width + 3;
    ctx.stroke(path);
  }
  // 中心 marker：与 _pos 对齐（悬停 8×8 / 线上菜单锚点）
  ctx.beginPath();
  ctx.arc(mid.x, mid.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = stroke;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.restore();

  // 命中跟随：覆写渲染产物（不触碰图数据）
  link.path = path;
  link._pos = [mid.x, mid.y];
  // 记录下来供整线悬停与调试 API 使用（只读渲染产物）
  state.routes.set(link.id, pts);
  return true;
}

function wrappedRenderLink(ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, opts) {
  try {
    if (tryCustomRender.call(this, ctx, a, b, link, color, start_dir, end_dir, opts)) return undefined;
  } catch (err) {
    warnOnce('单线自绘失败，本线回退原生：', err);
  }
  return state.originalRenderLink.apply(this, arguments);
}

function wrappedDrawConnections(ctx, graph) {
  try {
    beginFrame(this);
  } catch (err) {
    warnOnce('beginFrame 失败：', err);
  }
  return state.originalDrawConnections.apply(this, arguments);
}

// ---------- 安装 / 卸载 / 设置 ----------

export function install(canvas) {
  if (state.installed) return true;
  const proto = Object.getPrototypeOf(canvas);
  if (!proto || typeof proto.renderLink !== 'function' || typeof proto.drawConnections !== 'function') {
    return false;
  }
  if (proto.renderLink.__luowenWrapped || proto.drawConnections.__luowenWrapped) return false; // 防双包

  state.originalRenderLink = proto.renderLink;
  state.originalDrawConnections = proto.drawConnections;
  state.wrappedRenderRef = wrappedRenderLink;
  state.wrappedDrawRef = wrappedDrawConnections;
  proto.renderLink = wrappedRenderLink;
  proto.drawConnections = wrappedDrawConnections;
  state.proto = proto;
  state.installed = true;

  // 整线悬停：监听画布指针（只读，不拦截任何事件）
  const el = canvas?.canvas;
  if (el && !state.hoverBound) {
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerleave', onPointerLeave);
    state.hoverBound = true;
  }
  return true;
}

export function uninstall() {
  if (!state.installed) return;
  if (state.proto) {
    if (state.proto.renderLink === state.wrappedRenderRef) state.proto.renderLink = state.originalRenderLink;
    if (state.proto.drawConnections === state.wrappedDrawRef) state.proto.drawConnections = state.originalDrawConnections;
  }
  const el = app.canvas?.canvas;
  if (el && state.hoverBound) {
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerleave', onPointerLeave);
    state.hoverBound = false;
  }
  state.proto = null;
  state.originalRenderLink = null;
  state.originalDrawConnections = null;
  state.wrappedRenderRef = null;
  state.wrappedDrawRef = null;
  state.installed = false;
  state.routes.clear();
  state.hoverLinkId = null;
  state.cache.clear();
}

export function getSettings() {
  return { ...state.settings };
}

export function setSettings(partial) {
  Object.assign(state.settings, partial);
  app?.canvas?.setDirty?.(false, true);
}

export function getStats() {
  return {
    rev: 'r2-strict',
    ...state.settings,
    installed: state.installed,
    obstacleVersion: state.frame.version,
    rects: state.frame.rects.length,
    cache: state.cache.stats(),
    hovered: state.hoverLinkId,
    routed: state.routes.size,
    counters: { ...state.counters },
  };
}

// 调试/验收入口：返回当前绘制的折线（只读快照，不暴露内部对象）
export function getDebugRoutes() {
  return [...state.routes].map(([id, pts]) => ({ id, pts: pts.map((p) => [p[0], p[1]]) }));
}

export function getTrace() {
  return [...state.trace];
}
