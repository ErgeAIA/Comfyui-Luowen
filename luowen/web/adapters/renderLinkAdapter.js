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
import { DEFAULT_BEVEL_RATIO, chamferPolyline, findSharedPoints } from '../geometry/chamfer.js';
import { previewPath } from '../geometry/preview.js';
import { obstacleHash, corridorClear } from '../geometry/obstacles.js';
import { allocateLanes, laneHash as computeLaneHash, DEFAULT_LANE_PITCH } from '../routing/laneAssign.js';
import { createRouteCache } from '../routing/routeCache.js';
import { planTrunk } from '../routing/trunkPlan.js';
import { enumerateCrossings, segmentsOfRoutes } from '../routing/crossings.js';
import { planCrossCleanup } from '../routing/crossCleanup.js';
import { graphLinks, nodeRects, linksHash as computeLinksHash } from './graphRead.js';

// 前端 1.55.18 只暴露 window.comfyAPI shim（见 docs/phase0/drawing-api-notes.md §2）
const { app } = window.comfyAPI.app;

const AVOID_CLEARANCE = { low: 8, standard: 16, high: 24 };
const VPAD = 8;
const DEFAULT_STUB = 24;
// DEC-011：线宽级共线容差。两引脚偏移 ≤3px 视为共线，端点仍钉死在引脚中心，
// 只允许一段 ≤3px 的极短转折；更大的高差仍走 A* 台阶（对称台阶属美学候选，未实现）
const STRAIGHT_TOL = 3;
const DIR_NAME = { 0: 'none', 1: 'up', 2: 'down', 3: 'left', 4: 'right', 5: 'none' };

// 3B-2 离线交叉清理：布局静止去抖 → 只重解存在 cross 的线路对 → 严格验收后才覆盖绘制。
// 开关默认关闭；关闭时不读取、不写入任何清理状态，路径坐标与 3B-1 之前逐点一致。
const CLEANUP_DEBOUNCE_MS = 400;
const CLEANUP_CROSS_COST = 60;
const CLEANUP_MAX_GROWTH = 0.15;
const CLEANUP_MAX_ROUNDS = 2;

const state = {
  installed: false,
  proto: null,
  originalRenderLink: null,
  wrappedRenderRef: null,
  originalDrawConnections: null,
  wrappedDrawRef: null,
  settings: { enabled: true, style: 'orthogonal', avoidance: 'standard', chamfer: true, bevelRatio: DEFAULT_BEVEL_RATIO, trunkCap: null, lanePitch: DEFAULT_LANE_PITCH, crossCleanup: false },
  frame: {
    obstacleHashStr: '',
    version: 0,
    rects: [],
    laneHashStr: '',
    lanes: null,
    linksHashStr: '',
    trunks: new Map(),
    trunkInfo: [],
    trunkShared: new Map(),
    prevRoutes: new Map(), // 上一帧实际绘制折线（大斜切与其他线路的净空检查用）
    baseRoutes: new Map(), // 本帧清理前正交折线（离线交叉清理的输入；只读）
    effectiveRoutes: new Map(), // 本帧清理后、倒角前的折线（调试与交叉计数用）
    cleanupEnvStr: '',
    cleanupEpoch: 0,
  },
  cleanup: {
    sig: '',
    epoch: -1,
    triggerSig: '',
    routes: new Map(), // linkId -> 采纳后的折线（未采纳的线不在表内）
    timer: null,
    pending: null,
    runs: 0,
    lastReason: null,
    last: null,
  },
  cache: createRouteCache({ max: 4096 }),
  routes: new Map(), // linkId -> 当前绘制的折线（悬停命中 + 调试用）
  endpoints: new Map(), // linkId -> 上一帧观察到的端点/方向（阶段 2 主干规划输入）
  endpointsVer: -1,
  trunkCache: new Map(), // 组 key -> {sig, T, merged, paths, ratios}
  trunkPrev: new Map(), // 组 key -> 上一轮合并集合（拓扑滞回）
  hoverLinkId: null,
  hoverBound: false,
  counters: { preview: 0, strictNull: 0, loose: 0, semi: 0, straight: 0, routed: 0, trunkGroups: 0 },
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

// ---------- 路由求解（单线与主干分支共用） ----------

function routeArgs(ax, ay, bx, by, sd, ed, clearance, lanes) {
  // PRD §7.2：stub 随连接距离收缩，短连接不得因固定 stub 折返
  const dist = Math.hypot(bx - ax, by - ay);
  const stubCap = Math.max(8, dist / 3);
  return {
    start: [ax, ay],
    end: [bx, by],
    startDir: DIR_NAME[sd] ?? 'right',
    endDir: DIR_NAME[ed] ?? 'left',
    obstacles: state.frame.rects.map((r) => [r.x, r.y, r.w, r.h]),
    clearance,
    stubStart: Math.min(lanes.stubOut, stubCap),
    stubEnd: Math.min(lanes.stubIn, stubCap),
    vPad: VPAD,
    flatTol: 0,
  };
}

function endpointIndices(originId, targetId) {
  const idx = [];
  state.frame.rects.forEach((r, i) => {
    if (String(r.id) === String(originId) || String(r.id) === String(targetId)) idx.push(i);
  });
  return idx;
}

// strict（全部卡片禁行）→ semi（仅两端卡片禁行）→ loose（正交可穿卡）
function solveRouteTiers(args, endpointIdx) {
  const strictPts = route({ ...args, strict: true });
  if (strictPts) return { pts: strictPts, mode: 'route' };
  const semiPts = endpointIdx.length ? route({ ...args, blockRects: endpointIdx }) : null;
  if (semiPts) return { pts: semiPts, mode: 'semi' };
  const loosePts = route({ ...args });
  if (loosePts) return { pts: loosePts, mode: 'loose' };
  return { pts: null, mode: null };
}

function solveBranchFor(link, ep, fork, clearance) {
  const lanes = state.frame.lanes?.get(link.id) ?? { stubOut: DEFAULT_STUB, stubIn: DEFAULT_STUB };
  // DEC-011：stub 长度只由 laneAssign 决定（输出侧已组内统一为 base），此处不再覆盖
  const args = routeArgs(fork[0], fork[1], ep.bx, ep.by, ep.sd, ep.ed, clearance, lanes);
  const r = solveRouteTiers(args, endpointIndices(link.origin_id, link.target_id));
  return r.pts; // null → 该成员不参与合流（保持独立路径）
}

// ---------- 阶段 2：同源多目标主干预规划 ----------

function planTrunks(graph, canvas) {
  state.frame.trunks = new Map();
  state.frame.trunkShared = new Map();
  state.frame.trunkInfo = [];
  state.frame.trunkDebug = { endpoints: state.endpoints.size, epsVer: state.endpointsVer, version: state.frame.version, groups: 0, candidates: 0 };
  // 端点缓存必须与本帧几何版本一致（上一帧渲染时记录），否则等待下一帧。
  // 版本变更的那一帧只完成了“记录新端点”，本帧不规划；这里主动再要一帧，否则画布静止时
  // 主干永远不会被规划（实测：版本 2 的最后一帧之后没有后续 draw）。
  if (state.endpointsVer !== state.frame.version) {
    if (state.endpoints.size) canvas?.setDirty?.(true, true);
    return;
  }

  const groups = new Map();
  for (const l of graphLinks(graph)) {
    if (!l || l.id == null || l.id < 0) continue;
    const ep = state.endpoints.get(l.id);
    if (!ep) continue;
    const lanes = state.frame.lanes?.get(l.id) ?? { stubOut: DEFAULT_STUB, stubIn: DEFAULT_STUB };
    const key = `${l.id}|${ep.ax}|${ep.ay}|${ep.bx}|${ep.by}|${lanes.stubOut}|${lanes.stubIn}|${ep.sd}>${ep.ed}|${state.settings.avoidance}|${state.settings.style}`;
    if (!state.cache.get(key, state.frame.version)) continue; // 独立路径基准尚未就绪
    state.frame.trunkDebug.candidates += 1;
    const gkey = `${l.origin_id}:${l.origin_slot}`;
    if (!groups.has(gkey)) groups.set(gkey, []);
    groups.get(gkey).push({ l, ep, key });
  }
  state.frame.trunkDebug.groups = groups.size;

  for (const [gkey, members] of groups) {
    if (members.length < 2) continue;
    const routes = new Map();
    for (const m of members) routes.set(m.l.id, state.cache.get(m.key, state.frame.version));
    const epMap = new Map(members.map((m) => [m.l.id, m.ep]));
    const linksById = new Map(members.map((m) => [m.l.id, m.l]));
    const pin = routes.get(members[0].l.id)[0];
    const sig =
      `${state.frame.version}|${state.frame.laneHashStr}|${state.settings.trunkCap ?? ''}|` +
      members.map((m) => `${m.l.id}:${Math.round(m.ep.ax)},${Math.round(m.ep.ay)},${Math.round(m.ep.bx)},${Math.round(m.ep.by)}`).join(';');

    let plan = state.trunkCache.get(gkey);
    if (!plan || plan.sig !== sig) {
      const clearance = AVOID_CLEARANCE[state.settings.avoidance] ?? 16;
      plan = {
        sig,
        ...planTrunk({
          routes,
          pin,
          prevMembers: state.trunkPrev.get(gkey) ?? null,
          // 分支与独立路径共用同一 lane 来源（输出侧 stub 已组内统一，DEC-011）
          solveBranch: (id, fork) => solveBranchFor(linksById.get(id), epMap.get(id), fork, clearance),
          opts: {
            obstacles: state.frame.rects.map((r) => [r.x, r.y, r.w, r.h]),
            stub: DEFAULT_STUB,
            // 仅调试对照用：默认 null = 合法最晚分叉；显式数值时回到旧上限口径
            max: state.settings.trunkCap ?? null,
          },
        }),
      };
      state.trunkCache.set(gkey, plan);
      // 上限必须大于合法组数（每组至少 2 条线，1000 线最多 500 组）：
      // 写死 64 时 200/500 节点图每帧超限全清，导致整图主干逐帧重规划（实测 744 次求解/帧）。
      if (state.trunkCache.size > 4096) state.trunkCache.clear();
      if (plan.merged.size >= 2) {
        state.trunkPrev.set(gkey, plan.merged);
        state.counters.trunkGroups += 1;
      } else {
        state.trunkPrev.delete(gkey);
      }
    }
    if (plan.merged.size >= 2) {
      // 倒角只在合并后的共用树上做：组内共享点（主干 pin→fork、公共走廊、分叉点）
      // 全部保持直角，同组所有成员共用同一 skip 集合（DEC-012 修订）。
      const shared = findSharedPoints([...plan.paths.values()]);
      for (const [id, pts] of plan.paths) {
        state.frame.trunks.set(id, pts);
        state.frame.trunkShared.set(id, shared);
      }
      state.frame.trunkInfo.push({
        group: gkey,
        T: plan.T,
        merged: [...plan.merged],
      });
    }
  }
}

// ---------- 3B-2 离线交叉清理 ----------

function clearCleanupTimer() {
  if (state.cleanup.timer) {
    clearTimeout(state.cleanup.timer);
    state.cleanup.timer = null;
  }
}

// 几何/链路/环境任一变化：清理结果立即作废并取消待执行去抖。
function invalidateCleanup(reason) {
  clearCleanupTimer();
  state.cleanup.pending = null;
  state.cleanup.triggerSig = '';
  state.cleanup.sig = '';
  if (state.cleanup.routes.size) state.cleanup.routes.clear();
  state.frame.cleanupEpoch += 1;
  state.cleanup.lastReason = reason;
}

function cleanupEnvStr() {
  return `${state.settings.style}|${state.settings.avoidance}|${state.settings.lanePitch}`;
}

// 轻量稳定哈希：只在清理触发时计算一次（不在渲染热路径）。
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function groupMapOfState() {
  const groupOf = new Map();
  for (const t of state.frame.trunkInfo ?? []) {
    for (const id of t.merged) groupOf.set(String(id), t.group);
  }
  return groupOf;
}

// 清理输入：本帧基准正交折线 + 端点 + 引脚标识 + 主干组。
function collectCleanupSpecs(graph) {
  const linkById = new Map(graphLinks(graph).filter((l) => l && l.id != null).map((l) => [l.id, l]));
  const groupOf = groupMapOfState();
  const specs = [];
  for (const [id, pts] of state.frame.baseRoutes) {
    const l = linkById.get(id);
    const ep = state.endpoints.get(id);
    if (!l || !ep || !Array.isArray(pts) || pts.length < 2) continue;
    specs.push({
      linkId: id,
      groupId: groupOf.get(String(id)) ?? null,
      points: pts,
      startPin: `${l.origin_id}:${l.origin_slot}:out`,
      endPin: `${l.target_id}:${l.target_slot}:in`,
    });
  }
  return { linkById, groupOf, specs };
}

// 缓存签名包含：障碍版本 + lane/链路指纹 + 路由环境 + 全部基准折线几何哈希。
// 任何一条别的线几何变化都会改变哈希 → 旧清理结果不会被复用。
function cleanupSignatureOf(specs) {
  const geo = specs
    .map((r) => `${r.linkId}:${r.points.map((p) => `${Math.round(p[0] * 100) / 100},${Math.round(p[1] * 100) / 100}`).join(' ')}`)
    .sort()
    .join(';');
  return `${state.frame.version}|${state.frame.laneHashStr}|${cleanupEnvStr()}|${specs.length}|${fnv1a(geo)}`;
}

function sameEnds(pts, ax, ay, bx, by) {
  if (!Array.isArray(pts) || pts.length < 2) return false;
  const a = pts[0];
  const b = pts[pts.length - 1];
  return Math.abs(a[0] - ax) <= 0.51 && Math.abs(a[1] - ay) <= 0.51 && Math.abs(b[0] - bx) <= 0.51 && Math.abs(b[1] - by) <= 0.51;
}

// 手动/即时执行（A/B 对照与幂等测试入口）。基准几何未变且已有结果时直接复用。
export function runCrossCleanup(trigger = 'manual') {
  const canvas = app.canvas;
  if (!state.installed || !canvas?.graph) return getCrossDebug();
  if (!state.settings.crossCleanup || !state.settings.enabled || state.settings.style === 'native') return getCrossDebug();
  clearCleanupTimer();
  state.cleanup.pending = null;

  const { linkById, groupOf, specs } = collectCleanupSpecs(canvas.graph);
  if (specs.length < 2) return getCrossDebug();
  const sig = cleanupSignatureOf(specs);
  if (state.cleanup.sig === sig && state.cleanup.routes.size && state.cleanup.epoch === state.frame.cleanupEpoch) {
    state.cleanup.lastReason = 'cached';
    return getCrossDebug();
  }

  const clearance = AVOID_CLEARANCE[state.settings.avoidance] ?? 16;
  // 主干合并成员共享同一几何，单独重解会拆散共享走廊 → 本轮锁定，但仍参与交叉计数。
  const locked = new Set(groupOf.keys());
  const resolve = (spec, { lineObstacles, crossCost }) => {
    const ep = state.endpoints.get(spec.linkId);
    const l = linkById.get(spec.linkId);
    if (!ep || !l) return null;
    const lanes = state.frame.lanes?.get(spec.linkId) ?? { stubOut: DEFAULT_STUB, stubIn: DEFAULT_STUB };
    const args = {
      ...routeArgs(ep.ax, ep.ay, ep.bx, ep.by, ep.sd, ep.ed, clearance, lanes),
      lineObstacles,
      crossCost,
    };
    const solved = solveRouteTiers(args, endpointIndices(l.origin_id, l.target_id));
    return solved.pts;
  };

  const plan = planCrossCleanup({
    routes: specs,
    resolve,
    maxRounds: CLEANUP_MAX_ROUNDS,
    maxGrowth: CLEANUP_MAX_GROWTH,
    crossCost: CLEANUP_CROSS_COST,
    locked,
  });

  state.cleanup.sig = sig;
  state.cleanup.epoch = state.frame.cleanupEpoch;
  state.cleanup.routes.clear();
  for (const id of plan.changed) {
    const r = plan.routes.find((x) => String(x.linkId) === String(id));
    if (r) state.cleanup.routes.set(r.linkId, r.points.map((p) => [p[0], p[1]]));
  }
  state.cleanup.runs += 1;
  state.cleanup.lastReason = plan.changedAny ? null : (plan.debug.discardedReason ?? 'no-change');
  state.cleanup.last = { at: Date.now(), trigger, sig, ...plan.debug };
  canvas.setDirty?.(true, true);
  return getCrossDebug();
}

// 布局变化后由 beginFrame 调用：400ms 去抖，去抖期间几何一变动立即放弃。
function scheduleCleanup(canvas) {
  const cfg = state.settings;
  if (!state.installed || !cfg.enabled || cfg.style === 'native' || !cfg.crossCleanup) return;
  if (!state.frame.baseRoutes.size) return;
  if (canvas?.pointer?.isDown) return;

  const pending = state.cleanup.pending;
  if (pending && (pending.version !== state.frame.version || pending.lane !== state.frame.laneHashStr || pending.env !== state.frame.cleanupEnvStr)) {
    clearCleanupTimer();
    state.cleanup.pending = null;
    state.cleanup.lastReason = 'geometry-changed';
  }

  const triggerSig = `${state.frame.version}|${state.frame.laneHashStr}|${state.frame.cleanupEnvStr}`;
  if (state.cleanup.triggerSig === triggerSig) return; // 同一几何已调度或已处理
  state.cleanup.triggerSig = triggerSig;

  clearCleanupTimer();
  state.cleanup.pending = {
    version: state.frame.version,
    lane: state.frame.laneHashStr,
    env: state.frame.cleanupEnvStr,
    at: Date.now(),
  };
  state.cleanup.timer = setTimeout(() => {
    state.cleanup.timer = null;
    const p = state.cleanup.pending;
    state.cleanup.pending = null;
    if (!p) return;
    if (!state.settings.crossCleanup || !state.installed || !state.settings.enabled || state.settings.style === 'native') return;
    const c = app.canvas;
    if (c?.pointer?.isDown) {
      state.cleanup.lastReason = 'dragging';
      return;
    }
    if (p.version !== state.frame.version || p.lane !== state.frame.laneHashStr || p.env !== state.frame.cleanupEnvStr) {
      state.cleanup.lastReason = 'geometry-changed';
      return;
    }
    runCrossCleanup('debounce');
  }, CLEANUP_DEBOUNCE_MS);
}

function specsFromPointsMap(pointsMap, linkById, groupOf) {
  const out = [];
  for (const [id, pts] of pointsMap) {
    const l = linkById.get(id);
    if (!l || !pts?.length) continue;
    out.push({
      linkId: id,
      groupId: groupOf.get(String(id)) ?? null,
      points: pts,
      startPin: `${l.origin_id}:${l.origin_slot}:out`,
      endPin: `${l.target_id}:${l.target_slot}:in`,
    });
  }
  return out;
}

function crossingSummaryOf(pointsMap, linkById, groupOf) {
  const r = enumerateCrossings({ segments: segmentsOfRoutes(specsFromPointsMap(pointsMap, linkById, groupOf)) });
  return { pairs: r.pairs, count: r.count, involved: [...r.involved] };
}

// 调试入口：before = 清理前基准几何；after = 当前实际绘制（清理后、倒角前）。
export function getCrossDebug() {
  const graph = app.canvas?.graph;
  const linkById = graph
    ? new Map(graphLinks(graph).filter((l) => l && l.id != null).map((l) => [l.id, l]))
    : new Map();
  const groupOf = groupMapOfState();
  const beforeMap = state.frame.baseRoutes;
  // 线集必须与 before 相同：原生接管/bypass 的线不写 effectiveRoutes，若整表替换会让
  // 交叉统计凭空少一对（调试口径失真）。缺项回退到基准几何。
  const afterMap = new Map(beforeMap);
  for (const [id, pts] of state.frame.effectiveRoutes) {
    if (beforeMap.has(id)) afterMap.set(id, pts);
  }
  return {
    enabled: !!state.settings.crossCleanup,
    installed: state.installed,
    epoch: state.frame.cleanupEpoch,
    appliedEpoch: state.cleanup.epoch,
    pending: !!state.cleanup.timer,
    sig: state.cleanup.sig,
    activeLinks: [...state.cleanup.routes.keys()],
    runs: state.cleanup.runs,
    lastReason: state.cleanup.lastReason,
    before: crossingSummaryOf(beforeMap, linkById, groupOf),
    after: crossingSummaryOf(afterMap, linkById, groupOf),
    last: state.cleanup.last,
  };
}

// ---------- 每帧前置（由 drawConnections 链式回调触发） ----------

export function beginFrame(canvas) {
  const graph = canvas?.graph;
  if (!graph) return;
  if (canvas.pointer && canvas.pointer.isDown) return; // 拖拽期冻结：不更新障碍版本/lanes（R10/CM 实践）

  // 大斜切需要与其他线路保持净空：以上一帧实际绘制折线为参照。
  state.frame.prevRoutes = new Map(state.routes);

  const rects = nodeRects(graph);
  const oh = obstacleHash(rects);
  if (oh !== state.frame.obstacleHashStr) {
    state.frame.obstacleHashStr = oh;
    state.frame.rects = rects;
    state.frame.version += 1;
    state.routes.clear();
    state.frame.prevRoutes.clear(); // 旧版本几何已失效，不用它约束新斜切
    state.frame.baseRoutes.clear(); // 清理基准同步失效
    state.frame.effectiveRoutes.clear();
    invalidateCleanup('obstacle-version');
    state.frame.trunks = new Map(); // 旧版本的主干几何立即失效（避免压到新位置的节点）
    state.frame.trunkShared = new Map();
    state.frame.trunkInfo = [];
  } else {
    state.frame.rects = rects;
  }

  // 路由环境变化（样式/避障/pitch）也必须让旧清理结果失效；缩放不改变这些，不触发。
  const envStr = cleanupEnvStr();
  if (envStr !== state.frame.cleanupEnvStr) {
    state.frame.cleanupEnvStr = envStr;
    invalidateCleanup('settings');
  }

  const lh = computeLaneHash(graphLinks(graph), rects) + '|' + computeLinksHash(graph) + '|p' + state.settings.lanePitch;
  if (lh !== state.frame.laneHashStr) {
    state.frame.laneHashStr = lh;
    state.frame.lanes = allocateLanes(graphLinks(graph), rects, { pitch: state.settings.lanePitch });
    state.frame.baseRoutes.clear();
    state.frame.effectiveRoutes.clear();
    invalidateCleanup('lane-hash');
  }

  // 阶段 2：同源多目标主干（依赖上一帧记录的端点 + 本帧独立路径基准）
  try {
    planTrunks(graph, canvas);
  } catch (err) {
    warnOnce('主干规划失败，本帧全部独立路由：', err);
    state.frame.trunks = new Map();
    state.frame.trunkInfo = [];
  }

  // 阶段 3B-2：布局静止去抖后执行一次离线交叉清理（默认关闭时不进入）
  scheduleCleanup(canvas);
}

// ---------- 逐线渲染（renderLink wrap 体内） ----------

function sharpPath(path, pts) {
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
}

// 拖拽期预览函数在 geometry/preview.js（纯函数，可单测）

// 近共线捷径（DEC-011）：偏移 ≤STRAIGHT_TOL 时直接生成正交近直线，
// 端点严格落在两个引脚上；差 0.5~3px 的一段放在目标侧 stub 处，形成极短竖/横段。
function nearFlatPath(ax, ay, bx, by, lanes) {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  if (dy <= STRAIGHT_TOL && dx >= dy) {
    if (dy < 0.5) return [[ax, ay], [bx, by]];
    const dir = Math.sign(bx - ax) || 1;
    const reach = Math.min(lanes.stubIn, dx / 2);
    const mx = bx - dir * reach;
    return [[ax, ay], [mx, ay], [mx, by], [bx, by]];
  }
  if (dx <= STRAIGHT_TOL && dy >= dx) {
    if (dx < 0.5) return [[ax, ay], [bx, by]];
    const dir = Math.sign(by - ay) || 1;
    const reach = Math.min(lanes.stubIn, dy / 2);
    const my = by - dir * reach;
    return [[ax, ay], [ax, my], [bx, my], [bx, by]];
  }
  return null;
}

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

  // 阶段 2：本帧有该线的主干计划，且端点与规划输入一致 → 用「共享前缀 + 分支」路径
  const prevEp = state.endpoints.get(link.id);
  let pts = null;
  if (
    prevEp &&
    state.frame.trunks.size &&
    Math.abs(prevEp.ax - ax) < 0.5 &&
    Math.abs(prevEp.ay - ay) < 0.5 &&
    Math.abs(prevEp.bx - bx) < 0.5 &&
    Math.abs(prevEp.by - by) < 0.5
  ) {
    pts = state.frame.trunks.get(link.id) ?? null;
  }

  if (!pts) {
    pts = state.cache.get(key, state.frame.version);
    if (!pts) {
      if (canvas.pointer && canvas.pointer.isDown) {
        // 拖拽期：端点正在移动的线用正交预览（不进缓存），避免整线回退成原生曲线
        state.counters.preview += 1;
        traceEntry({ id: link.id, mode: 'preview', rects: state.frame.rects.length, ver: state.frame.version });
        pts = previewPath(ax, ay, bx, by, DIR_NAME[start_dir] ?? 'right', DIR_NAME[end_dir] ?? 'left', lanes.stubOut, lanes.stubIn);
      } else {
        // 近共线捷径：≤STRAIGHT_TOL 视为共线（端点不吸附，仅允许极短转折段），
        // 走廊必须净空——正交样式禁止斜线（PRD §5.2，DEC-011）
        const flat = nearFlatPath(ax, ay, bx, by, lanes);
        if (flat && corridorClear(ax, ay, bx, by, state.frame.rects, [link.origin_id, link.target_id], clearance, VPAD)) {
          state.counters.straight += 1;
          traceEntry({ id: link.id, mode: 'straight', rects: state.frame.rects.length, ver: state.frame.version });
          pts = flat;
        } else {
          // 障碍包含两端节点自身：中段禁止从自己连接的卡片底下穿过（引脚 stub 仍允许贴边引出）
          const args = routeArgs(ax, ay, bx, by, start_dir, end_dir, clearance, lanes);
          const denied = endpointIndices(link.origin_id, link.target_id);
          const solved = solveRouteTiers(args, denied);
          if (!solved.pts) {
            state.counters.strictNull += 1;
            traceEntry({ id: link.id, mode: 'strictNull', rects: state.frame.rects.length, ver: state.frame.version });
            state.endpoints.set(link.id, { ax, ay, bx, by, sd: start_dir, ed: end_dir });
            state.endpointsVer = state.frame.version;
            return bypass(); // 连正交都无解 → 原生降级（degraded, alive）
          }
          pts = solved.pts;
          state.counters[solved.mode === 'semi' ? 'semi' : solved.mode === 'loose' ? 'loose' : 'routed'] += 1;
          traceEntry({ id: link.id, mode: solved.mode, ver: state.frame.version, stub: [lanes.stubOut, lanes.stubIn], raw: state.frame.rects.length, pts });
        }
        state.cache.set(key, state.frame.version, pts);
      }
    }
  }

  // 记录端点供下一帧的主干规划（同版本内复用）
  state.endpoints.set(link.id, { ax, ay, bx, by, sd: start_dir, ed: end_dir });
  state.endpointsVer = state.frame.version;

  // 3B-2：记录清理前基准几何；仅在缓存签名仍有效（epoch 未失效）时用采纳结果覆盖。
  // 端点必须与清理输入一致，避免节点亚像素移动后误用旧几何。
  state.frame.baseRoutes.set(link.id, pts);
  if (state.settings.crossCleanup && state.cleanup.routes.size && state.cleanup.epoch === state.frame.cleanupEpoch) {
    const cleaned = state.cleanup.routes.get(link.id);
    if (cleaned && sameEnds(cleaned, ax, ay, bx, by)) pts = cleaned;
  }
  state.frame.effectiveRoutes.set(link.id, pts);

  const width = typeof canvas.connections_width === 'number' ? canvas.connections_width : 2;
  const stroke = typeof color === 'string' && color ? color : '#94a3b8';
  // 整线悬停（本适配器命中折线任意位置）或原生中心点悬停
  const hovered = state.hoverLinkId === link.id || canvas.over_link_center === link;

  // 绕障外角大斜切：仅正交样式 + 开关开启；与 smooth 圆角互斥（DEC-012 修订）。
  // 只切「为绕开第三方节点」形成的外凸拐角；合并树共享点全直角，端点节点不参与绕障判定，
  // 因此 T 点/分叉点/端口出线/入引脚段保持直角。cutA/cutB 按两腿可用长度独立计算。
  const orthogonal = cfg.style !== 'smooth';
  const drawPts =
    orthogonal && cfg.chamfer
      ? chamferPolyline(pts, {
          ratio: cfg.bevelRatio,
          skip: state.frame.trunkShared.get(link.id) ?? null,
          obstacles: state.frame.rects.map((r) => [r.x, r.y, r.w, r.h]),
          others: [...state.frame.prevRoutes]
            .filter(([id]) => id !== link.id)
            .map(([, p]) => p),
          excludeIndices: endpointIndices(link.origin_id, link.target_id),
        })
      : pts;

  const path = new Path2D();
  if (cfg.style === 'smooth') emitRounded(path, pts);
  else sharpPath(path, drawPts);
  const mid = pointAt(drawPts, measurePts(drawPts), 0.5); // {x, y, angle}

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

  // 命中跟随：覆写渲染产物（不触碰图数据）。
  // 大斜切后按实际折线命中：斜边可悬停/可删除（DEC-012 修订）。
  link.path = path;
  link._pos = [mid.x, mid.y];
  // 记录下来供整线悬停、删除命中与调试 API 使用（只读渲染产物）
  state.routes.set(link.id, drawPts);
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
  const result = state.originalDrawConnections.apply(this, arguments);
  // 整帧绘制完成后再调度：此时 baseRoutes 才是完整的一帧基准几何。
  try {
    scheduleCleanup(this);
  } catch (err) {
    warnOnce('交叉清理调度失败：', err);
  }
  return result;
}

// ---------- 安装 / 卸载 / 设置 ----------

export function install(canvas) {
  if (!canvas) return false; // 注册期设置回调可能先于 canvas 就绪
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
  clearCleanupTimer();
  state.cleanup.pending = null;
  state.cleanup.sig = '';
  state.cleanup.triggerSig = '';
  state.cleanup.routes.clear();
  state.frame.baseRoutes.clear();
  state.frame.effectiveRoutes.clear();
  state.routes.clear();
  state.endpoints.clear();
  state.endpointsVer = -1;
  state.trunkCache.clear();
  state.trunkPrev.clear();
  state.frame.trunks = new Map();
  state.frame.trunkShared = new Map();
  state.frame.trunkInfo = [];
  state.hoverLinkId = null;
  state.cache.clear();
}

export function getSettings() {
  return { ...state.settings };
}

export function setSettings(partial) {
  const prev = { ...state.settings };
  Object.assign(state.settings, partial);
  const dirty = ['enabled', 'style', 'avoidance', 'lanePitch', 'crossCleanup']
    .some((k) => k in partial && partial[k] !== prev[k]);
  if (dirty) invalidateCleanup('settings');
  app?.canvas?.setDirty?.(false, true);
}

export function getStats() {
  return {
    rev: 'r7-input-lanes',
    ...state.settings,
    installed: state.installed,
    obstacleVersion: state.frame.version,
    rects: state.frame.rects.length,
    cache: state.cache.stats(),
    hovered: state.hoverLinkId,
    routed: state.routes.size,
    counters: { ...state.counters },
    trunks: state.frame.trunkInfo.map((t) => ({ group: t.group, fork: t.T, merged: t.merged })),
    trunkDebug: state.frame.trunkDebug ?? null,
    cleanup: {
      sig: state.cleanup.sig,
      activeLinks: [...state.cleanup.routes.keys()],
      pending: !!state.cleanup.timer,
      runs: state.cleanup.runs,
      lastReason: state.cleanup.lastReason,
    },
  };
}

// 调试/验收入口：返回当前绘制的折线（只读快照，不暴露内部对象）
export function getDebugRoutes() {
  return [...state.routes].map(([id, pts]) => ({ id, pts: pts.map((p) => [p[0], p[1]]) }));
}

export function getTrace() {
  return [...state.trace];
}
