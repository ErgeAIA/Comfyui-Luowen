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
import { obstacleHash, toRawRects, corridorClear } from '../geometry/obstacles.js';
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
  warned: false,
};

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

// 返回 true = 已由络纹绘制；false = 调用方回退原函数
function tryCustomRender(ctx, a, b, link, color, start_dir, end_dir, opts) {
  const cfg = state.settings;
  const o = opts ?? {};
  if (!cfg.enabled || cfg.style === 'native') return false;
  if (!a || !b || !link || link.id == null || link.id < 0) return false; // 拖拽预览 / floating
  if (o.disabled || o.reroute) return false; // bypass；reroute 共享段阶段 1 保守回退（PRD F-010）
  if (this !== app.canvas) return false; // 覆盖层/派生渲染器借用（R12）→ 直通

  const canvas = app.canvas;
  const graph = canvas?.graph;
  if (!graph) return false;

  const ax = a.x ?? a[0];
  const ay = a.y ?? a[1];
  const bx = b.x ?? b[0];
  const by = b.y ?? b[1];
  if (![ax, ay, bx, by].every(Number.isFinite)) return false;

  const lanes = state.frame.lanes?.get(link.id) ?? { stubOut: DEFAULT_STUB, stubIn: DEFAULT_STUB };
  const clearance = AVOID_CLEARANCE[cfg.avoidance] ?? 16;
  const key = `${link.id}|${ax}|${ay}|${bx}|${by}|${lanes.stubOut}|${lanes.stubIn}|${start_dir}>${end_dir}|${cfg.avoidance}|${cfg.style}`;

  let pts = state.cache.get(key, state.frame.version);
  if (!pts) {
    if (canvas.pointer && canvas.pointer.isDown) return false; // 冻结期不重算 → 本线原生
    // 直线捷径仅限共线（水平/竖直）且走廊净空——正交样式禁止斜线（PRD §5.2）
    const colinear = Math.abs(ay - by) < 2 || Math.abs(ax - bx) < 2;
    if (colinear && corridorClear(ax, ay, bx, by, state.frame.rects, [link.origin_id, link.target_id], clearance, VPAD)) {
      pts = [
        [ax, ay],
        [bx, by],
      ];
    } else {
      const raw = toRawRects(state.frame.rects, [link.origin_id, link.target_id]);
      pts = route({
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
      });
      if (!pts) return false; // A* 失败/预算超限 → 原生降级（degraded, alive）
    }
    state.cache.set(key, state.frame.version, pts);
  }

  const width = typeof canvas.connections_width === 'number' ? canvas.connections_width : 2;
  const stroke = typeof color === 'string' && color ? color : '#94a3b8';
  const hovered = canvas.over_link_center === link;

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
  return true;
}

export function uninstall() {
  if (!state.installed) return;
  if (state.proto) {
    if (state.proto.renderLink === state.wrappedRenderRef) state.proto.renderLink = state.originalRenderLink;
    if (state.proto.drawConnections === state.wrappedDrawRef) state.proto.drawConnections = state.originalDrawConnections;
  }
  state.proto = null;
  state.originalRenderLink = null;
  state.originalDrawConnections = null;
  state.wrappedRenderRef = null;
  state.wrappedDrawRef = null;
  state.installed = false;
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
    ...state.settings,
    installed: state.installed,
    obstacleVersion: state.frame.version,
    rects: state.frame.rects.length,
    cache: state.cache.stats(),
  };
}
