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
import { emitBezier, measure as measurePts, pointAt, DEFAULT_RADIUS as DEFAULT_CORNER_RADIUS } from '../geometry/trace.js';
import { resolveLinkColor, shouldAnimate, dashOffset, setTheme as setLinkColorTheme, themeInfo } from '../colors/linkColors.js';
import { DEFAULT_BEVEL_RATIO, chamferPolyline, createChamferIndex, polylineBox, findSharedPoints } from '../geometry/chamfer.js';
import { previewPath } from '../geometry/preview.js';
import { obstacleHash, corridorClear } from '../geometry/obstacles.js';
import { allocateLanes, laneHash as computeLaneHash, DEFAULT_LANE_PITCH } from '../routing/laneAssign.js';
import { createRouteCache } from '../routing/routeCache.js';
import { planTrunk, classifyHover } from '../routing/trunkPlan.js';
import { enumerateCrossings, segmentsOfRoutes } from '../routing/crossings.js';
import { planCrossCleanup } from '../routing/crossCleanup.js';
import { graphLinks, graphNodes, nodeRects, linksHash as computeLinksHash } from './graphRead.js';

// 前端 1.55.18 只暴露 window.comfyAPI shim（见 docs/phase0/drawing-api-notes.md §2）
const { app } = window.comfyAPI.app;

const AVOID_CLEARANCE = { low: 8, standard: 16, high: 24 };
const VPAD = 8;
const DEFAULT_STUB = 24;
// DEC-011：线宽级共线容差。两引脚偏移 ≤3px 视为共线，端点仍钉死在引脚中心，
// 只允许一段 ≤3px 的极短转折；更大的高差仍走 A* 台阶（对称台阶属美学候选，未实现）
const STRAIGHT_TOL = 3;
// 圆角半径是「上限意图」：实际半径 = min(设定值, 相邻段各三分之一)，夹取在 trace.js。
export const CORNER_RADIUS_MAX = 24;
const DIR_NAME = { 0: 'none', 1: 'up', 2: 'down', 3: 'left', 4: 'right', 5: 'none' };

// 3B-2 离线交叉清理：布局静止去抖 → 只重解存在 cross 的线路对 → 严格验收后才覆盖绘制。
// 开关默认关闭；关闭时不读取、不写入任何清理状态，路径坐标与 3B-1 之前逐点一致。
const CLEANUP_DEBOUNCE_MS = 400;
const CLEANUP_CROSS_COST = 60;
const CLEANUP_MAX_GROWTH = 0.15;
const CLEANUP_MAX_ROUNDS = 2;

// 阶段 2B：同目标等距带（DEC-028）
// 默认兄弟线间距；上限由「同组接入点之间的最小 y 间距」钳制（面板项待设置会话合并）。
const DEFAULT_BROTHER_SPACING = 8;
// 整带外移上限（× 间距），撞到即停住并打降级标记。
const BAND_MAX_SHIFT_STEPS = 4;

const state = {
  installed: false,
  proto: null,
  originalRenderLink: null,
  wrappedRenderRef: null,
  originalDrawConnections: null,
  wrappedDrawRef: null,
  windowPointerDown: false,
  settings: { enabled: true, style: 'orthogonal', avoidance: 'standard', chamfer: true, bevelRatio: DEFAULT_BEVEL_RATIO, cornerRadius: DEFAULT_CORNER_RADIUS, trunkCap: null, lanePitch: DEFAULT_LANE_PITCH, brotherSpacing: DEFAULT_BROTHER_SPACING, crossCleanup: false, colorTheme: 'off', flowAnim: false, animMode: 'all', flowStyle: 'dash', flowDash: 7, flowGap: 13, flowSpeed: 48, disableAnimOnRun: true },
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
    chamferIdx: null, // 斜切预筛索引（每帧一次，见 chamferIndexForFrame）
    chamferIdxFor: null, // 索引对应的 prevRoutes 快照（身份比较；拖拽冻结期直接复用）
    chamferIdxVer: -1, // 索引对应的障碍版本
    baseRoutes: new Map(), // 本帧清理前正交折线（离线交叉清理的输入；只读）
    effectiveRoutes: new Map(), // 本帧清理后、倒角前的折线（调试与交叉计数用）
    cleanupEnvStr: '',
    cleanupEpoch: 0,
    plannedEndpoints: null, // 本帧主干规划所用端点（predictEndpoints 的同帧预测值）
    bands: new Map(), // 本帧等距带成员几何（linkId -> pts，优先于独立解）
    bandInfo: [], // 等距带诊断（目标/成员/基准/间距/外移步数）
    bandDegraded: [], // 撞上限或偏移非法的降级记录
    orderCtx: new Map(), // 同目标同方向编队上下文（linkId -> {target,spacing,x,shift,pts}）
    orderDegraded: [], // 帧末校验/阶梯失败的显式降级记录（不许静默）
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
  lastGoodRoutes: new Map(), // 上一帧已绘制且通过求解的折线（等距带撞上限时的回退源）
  endpoints: new Map(), // linkId -> 上一帧观察到的端点/方向（阶段 2 主干规划输入）
  pinOffsets: new Map(), // linkId -> {a,b} 端点相对 origin/target 节点 pos 的偏移（Vue 引脚布局）
  endpointsVer: -1,
  trunkCache: new Map(), // 组 key -> {sig, T, merged, paths, ratios}
  trunkPrev: new Map(), // 组 key -> 上一轮合并集合（拓扑滞回）
  hover: null, // { linkId, part: 'trunk'|'branch', memberIds, groupPts } | null
  menuHook: { original: null, wrapped: null },
  hoverBound: false,
  counters: { preview: 0, strictNull: 0, loose: 0, semi: 0, straight: 0, routed: 0, trunkGroups: 0 },
  trace: [],
  warned: false,
  // 性能采样（默认关闭；LuoWen.perfStart() 开启，热路径只多一次布尔判断）
  perf: { on: false, maxFrames: 600, lastTs: 0, sample: null, frames: [], cacheStart: null },
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

// 性能插桩：关闭时返回 0 / 空操作，热路径只多一次布尔判断。
function perfBegin() {
  return state.perf.on ? performance.now() : 0;
}

function perfAdd(key, t0) {
  if (!t0) return;
  const d = performance.now() - t0;
  const s = state.perf.sample;
  if (s) s[key] = (s[key] ?? 0) + d;
}

function perfCount(key, n = 1) {
  if (!state.perf.on) return;
  const s = state.perf.sample;
  if (s) s[key] = (s[key] ?? 0) + n;
}

// A* 调用计时：strict/semi/loose 每层 route() 都单独计入 astar 桶。
function timedRoute(args) {
  const t = perfBegin();
  const pts = route(args);
  perfAdd('astar', t);
  perfCount('astarCalls');
  return pts;
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

// 斜切预筛索引：每帧构建一次（O(节点数 + 连线数)），逐线按折线包围盒取近邻障碍/他线，
// 替代「每条线都重建 obstacles 数组 + 全量 filter/map 其他线路 + 逐采样点全量扫描」。
// prevRoutes 在 beginFrame 整体换新，拖拽冻结期不换 → 用身份比较跨帧复用。
function chamferIndexForFrame() {
  const f = state.frame;
  if (f.chamferIdx && f.chamferIdxFor === f.prevRoutes && f.chamferIdxVer === f.version) return f.chamferIdx;
  const obstacles = f.rects.map((r) => ({ id: r.id, rect: [r.x, r.y, r.w, r.h] }));
  const paths = [];
  for (const [id, pts] of f.prevRoutes) paths.push({ id, pts });
  f.chamferIdx = createChamferIndex({ obstacles, paths });
  f.chamferIdxFor = f.prevRoutes;
  f.chamferIdxVer = f.version;
  return f.chamferIdx;
}

// strict（全部卡片禁行）→ semi（仅两端卡片禁行）→ loose（正交可穿卡）
function solveRouteTiers(args, endpointIdx) {
  perfCount('solveCalls');
  const strictPts = timedRoute({ ...args, strict: true });
  if (strictPts) return { pts: strictPts, mode: 'route' };
  const semiPts = endpointIdx.length ? timedRoute({ ...args, blockRects: endpointIdx }) : null;
  if (semiPts) return { pts: semiPts, mode: 'semi' };
  const loosePts = timedRoute({ ...args });
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

// 端点相对节点 pos 的偏移：Vue nodes 的引脚位置由 DOM 布局测量得来，节点移动时偏移不变。
// 记录后即可在下一帧用「节点 pos + 偏移」同帧重建端点，不必再等上一帧渲染完成。
function recordEndpoint(link, ep, graph) {
  state.endpoints.set(link.id, ep);
  state.endpointsVer = state.frame.version;
  const byId = nodesById(graph);
  const on = byId.get(String(link.origin_id));
  const tn = byId.get(String(link.target_id));
  if (
    on && tn &&
    Number.isFinite(on.pos?.[0]) && Number.isFinite(on.pos?.[1]) &&
    Number.isFinite(tn.pos?.[0]) && Number.isFinite(tn.pos?.[1])
  ) {
    state.pinOffsets.set(link.id, {
      a: [ep.ax - on.pos[0], ep.ay - on.pos[1]],
      b: [ep.bx - tn.pos[0], ep.by - tn.pos[1]],
    });
  } else {
    state.pinOffsets.delete(link.id); // 布局不可用 → 下一帧退回上一帧端点
  }
}

function nodesById(graph) {
  // 不跨帧缓存：装载早期图可能尚无节点，按 graph 对象缓存会永久留下空表，
  // 导致引脚偏移记录全部失效（预测退回上一帧端点 → 端点移动时两态翻转）。
  const m = new Map();
  for (const n of graphNodes(graph)) if (n && n.id != null) m.set(String(n.id), n);
  return m;
}

// 本帧端点预测：有偏移记录时用节点 pos 重建；否则沿用上一帧实际端点（靠 0.5px 容差回退）。
function predictEndpoints(graph) {
  const out = new Map();
  const byId = nodesById(graph);
  for (const l of graphLinks(graph)) {
    if (!l || l.id == null || l.id < 0) continue;
    const prev = state.endpoints.get(l.id);
    if (!prev) continue;
    const off = state.pinOffsets.get(l.id);
    const on = byId.get(String(l.origin_id));
    const tn = byId.get(String(l.target_id));
    if (
      off && on && tn &&
      Number.isFinite(on.pos?.[0]) && Number.isFinite(on.pos?.[1]) &&
      Number.isFinite(tn.pos?.[0]) && Number.isFinite(tn.pos?.[1])
    ) {
      out.set(l.id, {
        ax: on.pos[0] + off.a[0], ay: on.pos[1] + off.a[1],
        bx: tn.pos[0] + off.b[0], by: tn.pos[1] + off.b[1],
        sd: prev.sd, ed: prev.ed, predicted: true,
      });
    } else {
      out.set(l.id, prev);
    }
  }
  return out;
}

// lane 分配用的真实引脚口径：目标入引脚 x = 线路实际端点 bx（与 router 的 eStub 同基准），
// y 跨度 = 该线两端引脚的实际 y。把 +10 偏移与整节点 y 跨度替换掉（BUG-003）。
function endpointsToPins(eps) {
  const out = new Map();
  if (!eps) return out;
  for (const [id, ep] of eps) {
    if (!Number.isFinite(ep?.bx) || !Number.isFinite(ep?.ay) || !Number.isFinite(ep?.by)) continue;
    out.set(id, { x: ep.bx, y0: Math.min(ep.ay, ep.by), y1: Math.max(ep.ay, ep.by) });
  }
  return out;
}

function pinsHash(pins) {
  let s = '';
  for (const [id, p] of pins) s += `${id}:${Math.round(p.x)},${Math.round(p.y0)},${Math.round(p.y1)};`;
  return '|q' + s;
}

// 独立基准路径（主干规划与逐线渲染共用同一求解口径；不写计数器/轨迹）
function solveBaseline(link, ep, lanes, clearance) {
  const flat = nearFlatPath(ep.ax, ep.ay, ep.bx, ep.by, lanes);
  if (flat && corridorClear(ep.ax, ep.ay, ep.bx, ep.by, state.frame.rects, [link.origin_id, link.target_id], clearance, VPAD)) {
    return { pts: flat, mode: 'straight' };
  }
  // 障碍包含两端节点自身：中段禁止从自己连接的卡片底下穿过（引脚 stub 仍允许贴边引出）
  const args = routeArgs(ep.ax, ep.ay, ep.bx, ep.by, ep.sd, ep.ed, clearance, lanes);
  const solved = solveRouteTiers(args, endpointIndices(link.origin_id, link.target_id));
  return { pts: solved.pts, mode: solved.mode };
}

// 手动意图保护（PRD §8.4 / F-010 / AT-018）：前端 1.55.18 的 Reroute 挂在单条 Link 上，
// link.parentId 非空即该链含用户手动放置的锚点（LLink.getReroutes 从该 id 起链）。
// 含 Reroute 链的连接不参与跨目标主干合并与同目标成带；独立线段仍走单线管线。
function carriesReroute(link) {
  return link?.parentId != null;
}

function planTrunks(graph, canvas, epMap) {
  // 整计划 memo（DEC-035 帧内复用）：拓扑(linksHash) + 端点版本 + lane 指纹 + 相关设置全部未变时，
  // 静态帧直接复用上一帧的组计划（499 次 key 拼接 + 372 组 sig/Map 构造 → O(1)）。
  const memoKey =
    `${state.frame.linksHashStr}|${state.endpointsVer}|${state.frame.laneHashStr}|` +
    `${state.settings.avoidance}|${state.settings.style}|${state.settings.trunkCap ?? ''}|${state.settings.enabled ? 1 : 0}`;
  if (state.trunkPlanMemo && state.trunkPlanMemo.key === memoKey) {
    const m = state.trunkPlanMemo;
    state.frame.trunks = m.trunks;
    state.frame.trunkShared = m.trunkShared;
    state.frame.trunkInfo = m.trunkInfo;
    state.frame.trunkDebug = m.trunkDebug;
    return;
  }
  state.frame.trunks = new Map();
  state.frame.trunkShared = new Map();
  state.frame.trunkInfo = [];
  state.frame.trunkDebug = { endpoints: epMap?.size ?? 0, epsVer: state.endpointsVer, version: state.frame.version, groups: 0, candidates: 0 };
  if (!state.settings.enabled || state.settings.style === 'native') { state.trunkPlanMemo = { key: memoKey, trunks: state.frame.trunks, trunkShared: state.frame.trunkShared, trunkInfo: state.frame.trunkInfo, trunkDebug: state.frame.trunkDebug }; return; } // 不绘制时不求解
  // 端点改用「本帧预测」（节点 pos + 上一帧引脚偏移），不再等上一帧记录完再自请求一帧：
  // 否则版本变更帧 trunks 为空走独立路径、下一帧恢复主干，竖线位置逐帧翻转（两态翻转）。
  // 尚无任何端点记录（刚安装/新图首帧）仍要一帧来采样引脚偏移。
  if (!epMap || !epMap.size) {
    if (state.endpoints.size) canvas?.setDirty?.(true, true);
    return;
  }

  const clearance = AVOID_CLEARANCE[state.settings.avoidance] ?? 16;
  const groups = new Map();
  for (const l of graphLinks(graph)) {
    if (!l || l.id == null || l.id < 0) continue;
    const ep = epMap.get(l.id);
    if (!ep) continue;
    if (carriesReroute(l)) continue; // 手动 Reroute 链不进主干组，也不共用主干前缀
    const lanes = state.frame.lanes?.get(l.id) ?? { stubOut: DEFAULT_STUB, stubIn: DEFAULT_STUB };
    const key = `${l.id}|${ep.ax}|${ep.ay}|${ep.bx}|${ep.by}|${lanes.stubOut}|${lanes.stubIn}|${ep.sd}>${ep.ed}|${state.settings.avoidance}|${state.settings.style}`;
    if (!state.cache.get(key, state.frame.version)) {
      // 版本变更帧缓存全失效：同帧求解基准路径并写入缓存（逐线渲染随后直接命中）
      const solved = solveBaseline(l, ep, lanes, clearance);
      if (!solved.pts) continue; // 无正交基准 → 该线不参与合流
      state.cache.set(key, state.frame.version, solved.pts);
    }
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
    const memberEps = new Map(members.map((m) => [m.l.id, m.ep]));
    const linksById = new Map(members.map((m) => [m.l.id, m.l]));
    const pin = routes.get(members[0].l.id)[0];
    const sig =
      `${state.frame.version}|${state.frame.laneHashStr}|${state.settings.trunkCap ?? ''}|` +
      members.map((m) => `${m.l.id}:${Math.round(m.ep.ax)},${Math.round(m.ep.ay)},${Math.round(m.ep.bx)},${Math.round(m.ep.by)}`).join(';');

    let plan = state.trunkCache.get(gkey);
    if (!plan || plan.sig !== sig) {
      plan = {
        sig,
        ...planTrunk({
          routes,
          pin,
          prevMembers: state.trunkPrev.get(gkey) ?? null,
          // 分支与独立路径共用同一 lane 来源（输出侧 stub 已组内统一，DEC-011）
          solveBranch: (id, fork) => solveBranchFor(linksById.get(id), memberEps.get(id), fork, clearance),
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
  state.trunkPlanMemo = {
    key: memoKey,
    trunks: state.frame.trunks,
    trunkShared: state.frame.trunkShared,
    trunkInfo: state.frame.trunkInfo,
    trunkDebug: state.frame.trunkDebug,
  };

}

// ---------- 阶段 2B：同目标等距带（DEC-028） ----------

// 目标侧走廊：进入目标引脚前的那条竖段（最后一个内部竖段）。
// 编号阶梯只约束这一段；源侧 stub 竖段不参与排序。
function approachOf(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  let found = null;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (Math.abs(x1 - x0) < 0.01 && Math.abs(y1 - y0) > 0.01) {
      found = { x: x1, y0, y1, dy: Math.sign(y1 - y0), index: i - 1 };
    }
  }
  return found;
}

// 受限重解（几何受限版）：只平移目标侧竖段的 x，长度与端点 y 不变。
// 相邻水平段随之伸缩，正交性与引脚锚定由调用方的 entryEndsClean / bandClear 校验。
// 竖段若是首/末段（没有两端水平段可伸缩）或会越过目标引脚 → 返回 null，交给降级路径。
function shiftCorridor(pts, ep, ap, dx) {
  if (!Array.isArray(pts) || pts.length < 2 || !ap || !Number.isFinite(dx)) return null;
  const out = pts.map((p) => [p[0], p[1]]);
  if (Math.abs(dx) < 0.01) return out;
  if (ap.index < 1 || ap.index > pts.length - 3) return null;
  const side = Math.sign(ep.bx - ap.x) || 1;
  if (Math.sign(ep.bx - (ap.x + dx)) !== side) return null; // 不许越过目标引脚
  out[ap.index][0] += dx;
  out[ap.index + 1][0] += dx;
  return out;
}

// 偏移后的折线合法性：段必须正交、不得进入第三方节点的 hard 箱（±4）。
// skipIds = 该线自身 origin/target（端口出/入段允许贴边）。
function bandClear(pts, rects, skipIds, pad = 4) {
  if (!Array.isArray(pts) || pts.length < 2) return false;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const horiz = Math.abs(ay - by) < 0.01;
    const vert = Math.abs(ax - bx) < 0.01;
    if (!horiz && !vert) return false; // 不做任意斜线
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / 4));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      for (const r of rects) {
        if (skipIds.has(String(r.id))) continue;
        if (px > r.x - pad && px < r.x + r.w + pad && py > r.y - pad && py < r.y + r.h + pad) return false;
      }
    }
  }
  return true;
}

// 入口水平段必须回到各线自己的引脚 y（误差 <0.5px）；竖向段间距才是等距带的作用域。
function entryEndsClean(pts, ep) {
  if (!pts || pts.length < 2) return false;
  const [x0, y0] = pts[0];
  const [xn, yn] = pts[pts.length - 1];
  const [xp, yp] = pts[pts.length - 2];
  return (
    Math.abs(y0 - ep.ay) < 0.5 && Math.abs(x0 - ep.ax) < 0.5 &&
    Math.abs(yn - ep.by) < 0.5 && Math.abs(xn - ep.bx) < 0.5 &&
    Math.abs(yp - ep.by) < 0.5 // 末段水平进入引脚
  );
}

function laneKeyOf(l, ep, lanes) {
  return `${l.id}|${ep.ax}|${ep.ay}|${ep.bx}|${ep.by}|${lanes.stubOut}|${lanes.stubIn}|${ep.sd}>${ep.ed}|${state.settings.avoidance}|${state.settings.style}`;
}

// 两条正交折线是否真的相交（复用 crossings.js 的判定口径：内点垂直交叉或共线重叠）。
// 只用于同组兄弟线的帧末校验；端点接触不计。
function pathsCross(a, b) {
  if (!Array.isArray(a) || a.length < 2 || !Array.isArray(b) || b.length < 2) return false;
  const segs = [];
  for (let k = 1; k < a.length; k++) segs.push({ linkId: 'A', a: a[k - 1], b: a[k] });
  for (let k = 1; k < b.length; k++) segs.push({ linkId: 'B', a: b[k - 1], b: b[k] });
  return enumerateCrossings({ segments: segs }).events.some((e) => e.counted);
}

function round2(v) {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function planBands(graph) {
  state.frame.bands = new Map();
  state.frame.bandInfo = [];
  state.frame.bandDegraded = [];
  state.frame.orderCtx = new Map();
  state.frame.orderDegraded = [];
  if (!state.settings.enabled || state.settings.style === 'native') return;
  const epMap = state.frame.plannedEndpoints;
  if (!epMap || !epMap.size || !state.frame.lanes) return;
  const rawSpacing = Number(state.settings.brotherSpacing);
  const wantSpacing = Number.isFinite(rawSpacing) && rawSpacing > 0 ? rawSpacing : DEFAULT_BROTHER_SPACING;
  const byId = nodesById(graph);
  const rects = state.frame.rects;
  const clearance = AVOID_CLEARANCE[state.settings.avoidance] ?? 16;

  // 1) 同目标 + 同一接近方向分组。准入只看这两项，不再要求「原走廊已 ≤2×pitch」：
  //    那个条件正是等距带要产生的结果，且障碍版本一变两条线的缓存同时失效，
  //    准入在需要它的那一帧必然为 false 且不可逆（BUG-003 现场复测）。
  const groups = new Map();
  for (const l of graphLinks(graph)) {
    if (!l || l.id == null || l.id < 0) continue;
    const ep = epMap.get(l.id);
    if (!ep) continue;
    if (state.frame.trunks.has(l.id)) continue; // 主干成员由 trunkPlan 定形，不参与编号阶梯
    const on = byId.get(String(l.origin_id));
    const tn = byId.get(String(l.target_id));
    const oy = Number.isFinite(on?.pos?.[1]) ? on.pos[1] : ep.ay;
    const ty = Number.isFinite(tn?.pos?.[1]) ? tn.pos[1] : ep.by;
    const dir = oy - ty < -1 ? 'up' : oy - ty > 1 ? 'down' : 'flat';
    const gk = `${l.target_id}|${dir}`;
    if (!groups.has(gk)) groups.set(gk, { members: [], manual: 0 });
    const g = groups.get(gk);
    if (carriesReroute(l)) { g.manual += 1; continue; } // 手动 Reroute 链不成带（PRD §8.4 / F-010）
    g.members.push({ l, ep, dir });
  }

  const laneOf = (id) => state.frame.lanes.get(id) ?? { stubOut: DEFAULT_STUB, stubIn: DEFAULT_STUB };

  for (const [, g] of groups) {
    const members = g.members;
    if (members.length < 2) continue;
    const dir = members[0].dir;

    // 2) 先各自求解（只对本组做，规模 = 同组入线数；缓存命中时零次 A*，不重复求解）
    for (const m of members) {
      const lanes = laneOf(m.l.id);
      const key = laneKeyOf(m.l, m.ep, lanes);
      let pts = state.frame.trunks.get(m.l.id) ?? state.cache.get(key, state.frame.version) ?? null;
      if (!pts) {
        const solved = solveBaseline(m.l, m.ep, lanes, clearance);
        if (solved.pts) {
          pts = solved.pts;
          state.cache.set(key, state.frame.version, pts);
        }
      }
      m.pts = pts;
      m.ap = approachOf(pts);
    }

    // 3) 按目标引脚 y 全序给 rank：y 小 = rank 0；「外侧基准 / 内侧基准」由组方向决定（见 4 的 s）。
    members.sort((a, b) => a.ep.by - b.ep.by);
    const target = String(members[0].l.target_id);

    // 间距上限 = 同组接入点之间的最小 y 间距（min(brotherSpacing, 相邻引脚 y 差)）
    const pinYs = members.map((m) => m.ep.by).sort((a, b) => a - b);
    let minPinGap = Infinity;
    for (let i = 1; i < pinYs.length; i++) minPinGap = Math.min(minPinGap, pinYs[i] - pinYs[i - 1]);
    const spacing = Number.isFinite(minPinGap) ? Math.min(wantSpacing, minPinGap) : wantSpacing;
    if (!(spacing > 0)) continue;
    const clamped = spacing < wantSpacing;

    // 阶梯成员 = 有目标侧竖段的成员。纯直线成员（共线直连，例如 L76）没有走廊可平移，
    // 保持自身直线；只要它的引脚 y 位于阶梯外侧就不会与阶梯相交（相交由帧末校验兜底）。
    const ladder = members.filter((m) => m.pts && m.ap);
    // 排除手动 Reroute 成员后本组只剩 1 条可平移走廊线：不再构成阶梯，也不写虚假降级；
    // 手动线保持独立解（PRD §8.4「若无法确定用户意图，就保持原生路径」）。
    if (ladder.length < 2 && g.manual) continue;

    // 4) 以任一成员为枢轴生成阶梯：x_r = pivotX + s·(r - p)·dirToNode·spacing；
    //    k>0 时整梯再向外挪。逐个试（成员数很小，纯几何、零次 A*），取第一个全部通过
    //    净空校验与兄弟交叉校验的方案。允许「向外扇开」，避免把线硬拉进目标节点旁的障碍
    //    （BUG-003 现场：把 L78 拉到 814.5 会蹭到 VAELoader 63）。
    //    s = 接近侧符号：dir='up'（源在目标上方）时正确嵌套是「引脚 y 越小、走廊 x 越贴目标」，
    //    与 dir='down' 相反；down/flat 取 +1，逐点保持原算式（BUG-004）。
    const approachSign = dir === 'up' ? -1 : 1;
    let chosen = null;
    let lastReason = ladder.length === members.length ? null : `straight-${members.length - ladder.length}`;
    if (ladder.length >= 2) {
      const dirToNode = Math.sign(ladder[0].ep.bx - ladder[0].ap.x) || 1;
      for (let k = 0; k <= BAND_MAX_SHIFT_STEPS && !chosen; k++) {
        for (let p = 0; p < ladder.length && !chosen; p++) {
          const pivotX = ladder[p].ap.x - k * spacing * dirToNode;
          const staged = new Map();
          let ok = true;
          for (let r = 0; r < ladder.length; r++) {
            const m = ladder[r];
            const required = pivotX + approachSign * (r - p) * dirToNode * spacing;
            const skip = new Set([String(m.l.origin_id), String(m.l.target_id)]);
            const cand = shiftCorridor(m.pts, m.ep, m.ap, required - m.ap.x);
            const ownClear = bandClear(m.pts, rects, skip);
            const candClear = cand ? bandClear(cand, rects, skip) : false;
            // 自身求解本就不净空（semi/loose）时，不额外要求偏移结果更强
            if (!cand || !entryEndsClean(cand, m.ep) || (ownClear && !candClear)) {
              ok = false; lastReason = `pivot${p}-k${k}-r${r}`; break;
            }
            staged.set(m.l.id, cand);
          }
          // P0.5：候选必须先过「同组两两不相交」（含不可平移的直线成员），
          // 交叉的候选直接不提交；全部候选失败才由下面的 markOrderDegraded 显式降级。
          if (ok) {
            const candMap = new Map();
            for (const m of members) candMap.set(m.l.id, staged.get(m.l.id) ?? m.pts ?? null);
            outer: for (let i = 0; i < members.length; i++) {
              for (let j = i + 1; j < members.length; j++) {
                if (pathsCross(candMap.get(members[i].l.id), candMap.get(members[j].l.id))) {
                  ok = false; lastReason = `cross-pivot${p}-k${k}`; break outer;
                }
              }
            }
            if (ok) chosen = { staged, k, pivot: p };
          }
        }
      }
    }

    const placed = new Map();
    if (chosen) {
      for (const [id, pts] of chosen.staged) {
        placed.set(id, pts);
        state.frame.bands.set(id, pts);
      }
      for (const m of members) {
        if (placed.has(m.l.id)) continue;
        placed.set(m.l.id, m.pts); // 直线成员原样
      }
      for (const m of ladder) {
        state.frame.orderCtx.set(m.l.id, {
          target, spacing, x: approachOf(placed.get(m.l.id))?.x ?? null, shift: chosen.k, pts: placed.get(m.l.id),
        });
      }
      state.frame.bandInfo.push({
        target,
        members: members.map((m) => String(m.l.id)),
        anchor: ladder[chosen.pivot].l.id,
        pivot: chosen.pivot,
        spacing,
        clamped,
        shift: chosen.k,
        degraded: chosen.k >= BAND_MAX_SHIFT_STEPS,
        xs: members.map((m) => round2(approachOf(placed.get(m.l.id))?.x)),
      });
      // 撞到外移上限：几何仍然成立，但已到边界，显式记录（下次再压只能降级）。
      if (chosen.k >= BAND_MAX_SHIFT_STEPS) {
        for (const m of members) {
          const rec = {
            id: m.l.id, target, kind: 'order', reason: 'cap', spacing, steps: chosen.k,
            clamped, fallback: 'band',
          };
          state.frame.bandDegraded.push(rec);
          state.frame.orderDegraded.push(rec);
        }
      }
    } else {
      for (const m of members) placed.set(m.l.id, m.pts ?? null);
      if (ladder.length) markOrderDegraded(ladder, target, lastReason ?? 'order', spacing, clamped);
    }

    // 5) 帧末校验：覆盖「带不成立」——同目标同方向的入线即便没成带，也不许换序/交叉。
    checkOrderCrossings(members, placed, target, spacing, chosen ? chosen.k : BAND_MAX_SHIFT_STEPS);
  }
}

// 等距带无法成立（撞上限 / 目标侧走廊不可平移 / 帧末仍交叉）：打降级标记（不许静默）；
// 仅当上一帧折线端点与当前一致时才冻结，避免把旧位置的几何锁死在节点移动之后。
function markOrderDegraded(members, target, reason, spacing, clamped) {
  for (const m of members) {
    const prev = state.lastGoodRoutes.get(m.l.id);
    const frozen = sameEnds(prev, m.ep.ax, m.ep.ay, m.ep.bx, m.ep.by) ? prev : null;
    const pts = frozen ?? m.pts ?? null;
    if (frozen) state.frame.bands.set(m.l.id, frozen);
    const x = approachOf(pts)?.x ?? null;
    state.frame.orderCtx.set(m.l.id, {
      target, spacing, x, shift: BAND_MAX_SHIFT_STEPS, degraded: true, pts: pts ?? null,
    });
    const rec = {
      id: m.l.id, target, kind: 'order', reason, spacing, steps: BAND_MAX_SHIFT_STEPS,
      clamped, fallback: frozen ? 'prev' : 'solved',
    };
    state.frame.bandDegraded.push(rec);
    state.frame.orderDegraded.push(rec);
  }
  state.frame.bandInfo.push({
    target, members: members.map((m) => String(m.l.id)), spacing, clamped,
    shift: null, degraded: true, reason,
    xs: members.map((m) => round2(approachOf(m.pts)?.x)),
  });
}

// 帧末校验（带成立与带不成立都走这里）：同目标同方向的入线两两不得相交。
// 相交时优先冻结上一帧端点一致且自身合法的折线；无法冻结就保留本帧解，但必须写入 orderDegraded。
function checkOrderCrossings(members, placed, target, spacing, steps) {
  const ids = members.map((m) => m.l.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!pathsCross(placed.get(ids[i]), placed.get(ids[j]))) continue;
      const fallback = {};
      for (const id of [ids[i], ids[j]]) {
        const m = members.find((x) => x.l.id === id);
        const other = id === ids[i] ? ids[j] : ids[i];
        const prev = state.lastGoodRoutes.get(id);
        const prevOther = state.lastGoodRoutes.get(other);
        fallback[id] = 'solved';
        if (!m || !sameEnds(prev, m.ep.ax, m.ep.ay, m.ep.bx, m.ep.by)) continue;
        if (prevOther && pathsCross(prev, prevOther)) continue; // 上一帧本身交叉 → 不冻结
        fallback[id] = 'prev';
        placed.set(id, prev);
        state.frame.bands.set(id, prev);
        const ctx = state.frame.orderCtx.get(id) ?? {};
        state.frame.orderCtx.set(id, { ...ctx, x: approachOf(prev)?.x ?? null, frozen: true, pts: prev });
      }
      for (const id of [ids[i], ids[j]]) {
        const rec = { id, target, kind: 'order', reason: 'cross', spacing, steps, fallback: fallback[id] };
        state.frame.bandDegraded.push(rec);
        state.frame.orderDegraded.push(rec);
      }
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

// BUG-006：按现存 link 集合清理所有以 linkId 为键的状态表。
// 只删已消失的 link，不清空整表——未受影响的线路保留缓存与几何。
function pruneStaleLinkState(links) {
  const live = new Set(links.map((l) => String(l && l.id)));
  const dropDead = (map) => {
    if (!map || typeof map.keys !== 'function') return;
    for (const key of [...map.keys()]) {
      if (!live.has(String(key))) map.delete(key);
    }
  };
  dropDead(state.routes);
  dropDead(state.lastGoodRoutes);
  dropDead(state.frame.prevRoutes);
  dropDead(state.frame.baseRoutes);
  dropDead(state.frame.effectiveRoutes);
  dropDead(state.endpoints);
  dropDead(state.pinOffsets);
  dropDead(state.cleanup.routes);
  dropDead(state.frame.bands);
  dropDead(state.frame.orderCtx);
  if (state.hover) {
    const ids = state.hover.part === 'trunk' ? (state.hover.memberIds || []) : [state.hover.linkId];
    if (!ids.length || ids.some((id) => !live.has(String(id)))) state.hover = null;
  }
}

export function beginFrame(canvas) {
  const tBegin = perfBegin();
  const graph = canvas?.graph;
  if (!graph) return;
  if (canvas.pointer && canvas.pointer.isDown) {
    perfAdd('begin', tBegin);
    return; // 拖拽期冻结：不更新障碍版本/lanes（R10/CM 实践）
  }

  // 大斜切需要与其他线路保持净空：以上一帧实际绘制折线为参照。
  state.frame.prevRoutes = new Map(state.routes);
  // 帧级缓存清零（选中集合 / 宿主动画开关，每帧重取；DEC-040）
  state.frame.selectedIds = null;
  state.frame.hostAnimOff = null;
  // 等距带撞上限时的回退源：保留上一帧已绘制折线（跨障碍版本仍有效，仅作最后合法位置）
  if (state.routes.size) state.lastGoodRoutes = new Map(state.routes);

  const rects = nodeRects(graph);
  const allLinks = graphLinks(graph);
  // BUG-006：链路增删不改变节点矩形，旧实现只在 obstacleHash 变化时清理 state.routes，
  // 已删除的链路会作为幽灵条目留在路由/端点/悬停状态里。按现存 link 集合做差集清理，
  // 并把拓扑纳入帧指纹；不递增 obstacle 版本，未受影响链路的缓存仍然有效。
  const topologyHash = computeLinksHash(graph);
  if (topologyHash !== state.frame.linksHashStr) {
    state.frame.linksHashStr = topologyHash;
    pruneStaleLinkState(allLinks);
  }
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

  // 端点预测先于 lane 分配：走廊阻挡判定要用真实引脚 x 与该线两端引脚的 y 跨度
  // （旧口径 rect.x + 10 会把 eStub 落进第三方卡片；见 BUG-003）。
  state.frame.plannedEndpoints = null;
  let planned = null;
  const tPredict = perfBegin();
  try {
    planned = predictEndpoints(graph);
  } catch (err) {
    warnOnce('端点预测失败，本帧 lane 用兜底口径：', err);
  }
  perfAdd('predict', tPredict);
  state.frame.plannedEndpoints = planned;
  const pins = endpointsToPins(planned);
  const tLanes = perfBegin();
  const lh =
    computeLaneHash(allLinks, rects) + '|' + topologyHash +
    '|p' + state.settings.lanePitch + pinsHash(pins);
  if (lh !== state.frame.laneHashStr) {
    state.frame.laneHashStr = lh;
    state.frame.lanes = allocateLanes(allLinks, rects, { pitch: state.settings.lanePitch, pins });
    state.frame.baseRoutes.clear();
    state.frame.effectiveRoutes.clear();
    invalidateCleanup('lane-hash');
  }
  perfAdd('lanes', tLanes);

  // 阶段 2：同源多目标主干（端点用本帧预测值，避免主干态与独立态逐帧翻转）
  const tTrunks = perfBegin();
  try {
    planTrunks(graph, canvas, state.frame.plannedEndpoints);
  } catch (err) {
    warnOnce('主干规划失败，本帧全部独立路由：', err);
    state.frame.plannedEndpoints = null;
    state.frame.trunks = new Map();
    state.frame.trunkInfo = [];
  }
  perfAdd('trunks', tTrunks);

  // 阶段 2B：同目标等距带（基准线正常求解，兄弟线整体偏移；只改绘制表达）
  const tBands = perfBegin();
  try {
    planBands(graph);
  } catch (err) {
    warnOnce('等距带规划失败，本帧按独立路径绘制：', err);
    state.frame.bands = new Map();
    state.frame.bandInfo = [];
    state.frame.bandDegraded = [];
    state.frame.orderCtx = new Map();
    state.frame.orderDegraded = [];
  }
  perfAdd('bands', tBands);

  // 阶段 3B-2：布局静止去抖后执行一次离线交叉清理（默认关闭时不进入）
  scheduleCleanup(canvas);
  perfAdd('begin', tBegin);
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

// ---------- 主干组悬停与整组删除（只读渲染状态；删除只经原生 removeLink） ----------

function sameHover(a, b) {
  if (!a || !b) return a === b;
  return a.part === b.part && a.linkId === b.linkId && a.memberIds.join(',') === b.memberIds.join(',');
}

function clearHover() {
  if (!state.hover) return;
  state.hover = null;
  app.canvas?.setDirty?.(true, true);
}

function eventGraphPoint(e, canvas) {
  const rect = canvas.canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) / canvas.ds.scale - canvas.ds.offset[0],
    (e.clientY - rect.top) / canvas.ds.scale - canvas.ds.offset[1],
  ];
}

function onPointerMove(e) {
  const cfg = state.settings;
  if (!state.installed || !cfg.enabled || cfg.style === 'native') return;
  const canvas = app.canvas;
  if (!canvas?.canvas) return;
  const [gx, gy] = eventGraphPoint(e, canvas);
  const hit = classifyHover(state.routes, state.frame.trunks, [gx, gy], 8 / canvas.ds.scale);
  const next = hit
    ? { linkId: hit.linkId, part: hit.part, memberIds: hit.memberIds, groupPts: hit.groupPts }
    : null;
  if (!sameHover(state.hover, next)) {
    state.hover = next;
    canvas.setDirty(true, true);
  }
}

function onPointerLeave() {
  clearHover();
}

// 整组删除：仿 deleteSelected 的事务写法，一次操作只留一条 undo。
// removeLink → LLink.disconnect 内部已从 graph.links 移除并删除 layout（LLink.ts:582-584）。
function deleteTrunkGroup(memberIds) {
  const canvas = app.canvas;
  const graph = canvas?.graph;
  if (!graph || !Array.isArray(memberIds)) return 0;
  const ids = [...new Set(memberIds)].filter((id) => id != null && id >= 0 && graph.links?.get?.(id));
  if (!ids.length) return 0;
  canvas.emitBeforeChange?.();
  graph.beforeChange?.();
  try {
    for (const id of ids) graph.removeLink(id);
  } finally {
    graph.afterChange?.();
    canvas.emitAfterChange?.();
  }
  clearHover();
  canvas.setDirty?.(true, true);
  return ids.length;
}

// 仅在链路菜单（showLinkMenu）且右键点落在共享主干段时插入整组删除项。
// 分支段/独立线路保持原生单条删除；不改键盘 Delete 语义；不弹二次确认。
function injectTrunkMenu(args) {
  if (!state.installed || !state.settings.enabled || state.settings.style === 'native') return;
  const [options, menuOpts] = args ?? [];
  if (!Array.isArray(options) || !menuOpts?.event) return;
  const isLinkMenu = options.some((v) => {
    const value = typeof v === 'string' ? v : v?.value;
    return value === 'Add Reroute' || value === 'Hide Link' || value === 'Show Link';
  });
  if (!isLinkMenu) return;
  const canvas = app.canvas;
  if (!canvas?.canvas || !canvas.ds) return;
  const hit = classifyHover(state.routes, state.frame.trunks, eventGraphPoint(menuOpts.event, canvas), 8 / canvas.ds.scale);
  if (!hit || hit.part !== 'trunk' || hit.memberIds.length < 2) return;
  const n = hit.memberIds.length;
  options.unshift(
    {
      content: `删除这一组（${n} 条）`,
      value: 'LuoWen:DeleteTrunkGroup',
      callback: () => deleteTrunkGroup(hit.memberIds),
    },
    null,
  );
}

function installContextMenuHook() {
  if (state.menuHook.wrapped || typeof window === 'undefined') return;
  const LG = window.LiteGraph;
  if (!LG || typeof LG.ContextMenu !== 'function') return;
  const Original = LG.ContextMenu;
  const Wrapped = new Proxy(Original, {
    construct(target, args) {
      try {
        injectTrunkMenu(args);
      } catch (err) {
        warnOnce('context menu hook failed', err);
      }
      return Reflect.construct(target, args, target);
    },
  });
  state.menuHook.original = Original;
  state.menuHook.wrapped = Wrapped;
  LG.ContextMenu = Wrapped;
}

function uninstallContextMenuHook() {
  const LG = typeof window !== 'undefined' ? window.LiteGraph : null;
  if (LG && state.menuHook.wrapped && LG.ContextMenu === state.menuHook.wrapped) {
    LG.ContextMenu = state.menuHook.original;
  }
  state.menuHook.wrapped = null;
  state.menuHook.original = null;
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

  // 阶段 2：本帧有该线的主干计划，且端点与规划输入（本帧预测）一致 → 用「共享前缀 + 分支」路径
  // 等距带成员优先（带几何由基准线整体偏移得到，不再各自 A*）。
  const planEp = state.frame.plannedEndpoints?.get(link.id) ?? state.endpoints.get(link.id);
  let pts = null;
  if (planEp && (state.frame.bands.size || state.frame.trunks.size)) {
    const samePlanEp =
      Math.abs(planEp.ax - ax) < 0.5 &&
      Math.abs(planEp.ay - ay) < 0.5 &&
      Math.abs(planEp.bx - bx) < 0.5 &&
      Math.abs(planEp.by - by) < 0.5;
    if (samePlanEp) {
      pts = state.frame.bands.get(link.id) ?? state.frame.trunks.get(link.id) ?? null;
    } else if (state.frame.trunks.has(link.id) || state.frame.bands.has(link.id)) {
      canvas.setDirty?.(true, true); // 预测失效 → 下一帧重采样偏移
    }
  }

  // 同目标同方向编队：带几何优先；阶梯失败时用本帧预解折线（端点一致时），避免二次 A*。
  const orderCtx = state.frame.orderCtx?.get(link.id) ?? null;
  if (!pts && orderCtx && sameEnds(orderCtx.pts, ax, ay, bx, by)) pts = orderCtx.pts;

  if (!pts) {
    pts = state.cache.get(key, state.frame.version);
    if (!pts) {
      if (canvas.pointer && canvas.pointer.isDown) {
        // 拖拽期：端点正在移动的线用正交预览（不进缓存），避免整线回退成原生曲线
        state.counters.preview += 1;
        traceEntry({ id: link.id, mode: 'preview', rects: state.frame.rects.length, ver: state.frame.version });
        pts = previewPath(ax, ay, bx, by, DIR_NAME[start_dir] ?? 'right', DIR_NAME[end_dir] ?? 'left', lanes.stubOut, lanes.stubIn);
      } else {
        // 近共线捷径 + A*（与主干规划的基准求解共用 solveBaseline，口径一致）
        const solved = solveBaseline(link, { ax, ay, bx, by, sd: start_dir, ed: end_dir }, lanes, clearance);
        if (!solved.pts) {
          state.counters.strictNull += 1;
          traceEntry({ id: link.id, mode: 'strictNull', rects: state.frame.rects.length, ver: state.frame.version });
          recordEndpoint(link, { ax, ay, bx, by, sd: start_dir, ed: end_dir }, graph);
          return bypass(); // 连正交都无解 → 原生降级（degraded, alive）
        }
        pts = solved.pts;
        if (solved.mode === 'straight') state.counters.straight += 1;
        else state.counters[solved.mode === 'semi' ? 'semi' : solved.mode === 'loose' ? 'loose' : 'routed'] += 1;
        traceEntry({ id: link.id, mode: solved.mode, ver: state.frame.version, stub: [lanes.stubOut, lanes.stubIn], raw: state.frame.rects.length, pts });
        state.cache.set(key, state.frame.version, pts);
      }
    }
  }

  // 带外成员（阶梯失败/降级组）也把目标侧走廊夹回编队 x：同目标同方向不换序。
  // 只平移竖段，仍需通过入口锚定与第三方净空校验，否则保留原解并已由 orderDegraded 标记。
  if (pts && orderCtx && !state.frame.bands.has(link.id) && Number.isFinite(orderCtx.x)) {
    const ep = { ax, ay, bx, by };
    const ap = approachOf(pts);
    if (ap && Math.abs(ap.x - orderCtx.x) > 0.5) {
      const skip = new Set([String(link.origin_id), String(link.target_id)]);
      const shifted = shiftCorridor(pts, ep, ap, orderCtx.x - ap.x);
      if (shifted && entryEndsClean(shifted, ep) && bandClear(shifted, state.frame.rects, skip)) pts = shifted;
    }
  }

  // 记录端点 + 引脚偏移，供下一帧主干规划做「节点 pos + 偏移」的同帧预测
  recordEndpoint(link, { ax, ay, bx, by, sd: start_dir, ed: end_dir }, graph);

  // 3B-2：记录清理前基准几何；仅在缓存签名仍有效（epoch 未失效）时用采纳结果覆盖。
  // 端点必须与清理输入一致，避免节点亚像素移动后误用旧几何。
  state.frame.baseRoutes.set(link.id, pts);
  if (state.settings.crossCleanup && state.cleanup.routes.size && state.cleanup.epoch === state.frame.cleanupEpoch) {
    const cleaned = state.cleanup.routes.get(link.id);
    if (cleaned && sameEnds(cleaned, ax, ay, bx, by)) pts = cleaned;
  }
  state.frame.effectiveRoutes.set(link.id, pts);

  const width = typeof canvas.connections_width === 'number' ? canvas.connections_width : 2;
  // 配色主题（DEC-029）：主题开启时按连线数据类型取语义色（62 类显式映射）；
  // 关闭时回退原取色链（原生 color 实参 || #94a3b8），行为与接入前完全一致。
  const stroke = resolveLinkColor(link) ?? (typeof color === 'string' && color ? color : '#94a3b8');
  // 主干组悬停：trunk 段高亮全组，branch 段只高亮该条；无络纹 hover 时回退原生中心点悬停
  const hovered = state.hover
    ? state.hover.part === 'trunk'
      ? state.hover.memberIds.includes(link.id)
      : state.hover.linkId === link.id
    : canvas.over_link_center === link;

  // 绕障外角大斜切：仅正交样式 + 开关开启；与 smooth 圆角互斥（DEC-012 修订）。
  // 只切「为绕开第三方节点」形成的外凸拐角；合并树共享点全直角，端点节点不参与绕障判定，
  // 因此 T 点/分叉点/端口出线/入引脚段保持直角。cutA/cutB 按两腿可用长度独立计算。
  const orthogonal = cfg.style !== 'smooth';
  let drawPts = pts;
  if (orthogonal && cfg.chamfer) {
    const tChamfer = perfBegin();
    const idx = chamferIndexForFrame();
    const near = idx.query(polylineBox(pts), {
      excludeIds: new Set([String(link.origin_id), String(link.target_id)]),
      selfId: link.id,
    });
    drawPts = chamferPolyline(pts, {
      ratio: cfg.bevelRatio,
      skip: state.frame.trunkShared.get(link.id) ?? null,
      obstacles: near.obstacles,
      others: near.others,
      excludeIndices: near.excludeIndices,
    });
    perfAdd('chamfer', tChamfer);
    perfCount('chamfers');
  }

  const tBuild = perfBegin();
  const path = new Path2D();
  // smooth = 真 Bezier（PRD §5.1 骨架曲线化）：拐角三次贝塞尔，骨架 pts 不变，只换绘制表达。
  // cornerRadius 语义不变（0=直角）；与 chamfer 互斥口径不变（chamfer 仅 orthogonal 分支）。
  if (cfg.style === 'smooth') emitBezier(path, pts, cfg.cornerRadius);
  else sharpPath(path, drawPts);
  const mid = pointAt(drawPts, measurePts(drawPts), 0.5); // {x, y, angle}
  perfAdd('pathBuild', tBuild);
  const tStroke = perfBegin();

  ctx.save();
  ctx.lineWidth = width + (hovered ? 1.5 : 0);
  ctx.strokeStyle = stroke;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  // 流向动效 v2（DEC-040）：唯一语义=正在发生的数据流。三模式门禁 + 生成时禁用 + 三线型。
  const scaleNow = app?.canvas?.ds?.scale ?? 1;
  const animate = shouldAnimate({
    mode: cfg.animMode, link, selectedIds: selectedNodeIdsThisFrame(), executingNode: state.queue.executingNode,
    queueRunning: state.queue.running, disableAnimOnRun: cfg.disableAnimOnRun,
    enabled: cfg.flowAnim, scale: scaleNow, reducedMotion: reducedMotionPref(), hostAnimationsDisabled: hostAnimationsDisabled(),
  });
  // 拖动期间暂停动效（DEC-040 补充，用户反馈：拖动时晃眼且耗性能）：
  // 指针按下（拖节点/框选/平移）一律画实线，松开自动恢复。
  // 信号源 = 自维护 window 指针状态（Vue 拖动不走 legacy canvas.pointer，其 isDown 恒 false——实测）。
  const animSuppressed = state.windowPointerDown === true;
  if (animate && !animSuppressed) {
    if (cfg.flowStyle === 'glow') {
      // 发光：光晕大小 + 呼吸起伏（各自独立参数，与虚线无关）
      const breathe = 1 + (cfg.glowRate > 0 ? 0.35 * Math.sin((performance.now() / 1000) * Math.PI * 2 * cfg.glowRate * 0.2) : 0);
      ctx.shadowColor = stroke;
      ctx.shadowBlur = cfg.glowSize * breathe;
    } else if (cfg.flowStyle === 'pulse') {
      // 脉冲：频率 + 幅度（各自独立参数，与虚线无关）
      ctx.lineWidth = width * (1 + (cfg.pulseAmp / 100) * Math.sin((performance.now() / 1000) * Math.PI * 2 * cfg.pulseRate * 0.2));
    } else {
      // 虚线行进：流速 = 屏幕线速度（档位 × 60 px/s，缩放补偿）；长度/间距只管形状
      const period = cfg.dashLen + cfg.dashGap;
      if (period > 0) {
        ctx.setLineDash([cfg.dashLen, cfg.dashGap]);
        ctx.lineDashOffset = dashOffset({ now: performance.now(), speed: cfg.dashSpeed * 30, scale: scaleNow, period });
        ctx.globalAlpha = 0.92;
      }
    }
  }
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

  perfAdd('strokeT', tStroke);
  // 命中跟随：覆写渲染产物（不触碰图数据）。
  // 大斜切后按实际折线命中：斜边可悬停/可删除（DEC-012 修订）。
  link.path = path;
  link._pos = [mid.x, mid.y];
  // 记录下来供整线悬停、删除命中与调试 API 使用（只读渲染产物）
  state.routes.set(link.id, drawPts);
  return true;
}

function wrappedRenderLink(ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, opts) {
  const tRender = perfBegin();
  perfCount('renders');
  try {
    if (tryCustomRender.call(this, ctx, a, b, link, color, start_dir, end_dir, opts)) return undefined;
  } catch (err) {
    warnOnce('单线自绘失败，本线回退原生：', err);
  } finally {
    perfAdd('render', tRender);
  }
  return state.originalRenderLink.apply(this, arguments);
}

function wrappedDrawConnections(ctx, graph) {
  const on = state.perf.on;
  const tFrame = perfBegin();
  let sample = null;
  if (on) {
    const now = performance.now();
    sample = {
      ts: now,
      gap: state.perf.lastTs ? now - state.perf.lastTs : null,
      down: this.pointer?.isDown ? 1 : 0,
      frame: 0, begin: 0, predict: 0, lanes: 0, trunks: 0, bands: 0,
      astar: 0, astarCalls: 0, solveCalls: 0, chamfer: 0, chamfers: 0, render: 0, renders: 0,
    };
    state.perf.lastTs = now;
    state.perf.sample = sample;
  }
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
  if (on) {
    perfAdd('frame', tFrame);
    state.perf.sample = null;
    state.perf.frames.push(sample);
    if (state.perf.frames.length > state.perf.maxFrames) state.perf.frames.shift();
  }
  return result;
}

// ---------- 性能采样入口（LuoWen.perfStart / perfStop / perfReport） ----------

function perfPercentile(vals, p) {
  if (!vals.length) return 0;
  const a = [...vals].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil(a.length * p) - 1));
  return a[i];
}

function perfRound(v) {
  return Math.round((v || 0) * 1000) / 1000;
}

export function perfStart(limit = 600) {
  state.perf.frames = [];
  state.perf.lastTs = 0;
  state.perf.sample = null;
  state.perf.maxFrames = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 600;
  state.perf.cacheStart = state.cache.stats();
  state.perf.on = true;
  return { on: true, maxFrames: state.perf.maxFrames };
}

export function perfStop() {
  state.perf.on = false;
  state.perf.sample = null;
  return perfReport();
}

export function perfReport() {
  const fs = state.perf.frames;
  const keys = ['frame', 'begin', 'predict', 'lanes', 'trunks', 'bands', 'astar', 'chamfer', 'render', 'pathBuild', 'strokeT'];
  const sum = (k) => fs.reduce((a, s) => a + (s[k] || 0), 0);
  const out = {
    on: state.perf.on,
    frames: fs.length,
    maxFrames: state.perf.maxFrames,
    totals: {},
    avg: {},
    p50: {},
    p95: {},
    max: {},
    counts: {
      astarCalls: sum('astarCalls'),
      solveCalls: sum('solveCalls'),
      chamfers: sum('chamfers'),
      renders: sum('renders'),
      downFrames: fs.filter((s) => s.down).length,
    },
    gaps: {},
    cache: {},
    sample: fs.slice(-3),
  };
  for (const k of keys) {
    const vals = fs.map((s) => s[k] || 0);
    out.totals[k] = perfRound(sum(k));
    out.avg[k] = perfRound(sum(k) / Math.max(1, fs.length));
    out.p50[k] = perfRound(perfPercentile(vals, 0.5));
    out.p95[k] = perfRound(perfPercentile(vals, 0.95));
    out.max[k] = perfRound(vals.length ? Math.max(...vals) : 0);
  }
  const gaps = fs.map((s) => s.gap).filter((g) => typeof g === 'number');
  out.gaps = {
    p50: perfRound(perfPercentile(gaps, 0.5)),
    p95: perfRound(perfPercentile(gaps, 0.95)),
    max: perfRound(gaps.length ? Math.max(...gaps) : 0),
    over16ms: gaps.filter((g) => g > 16.7).length,
    over33ms: gaps.filter((g) => g > 33.4).length,
  };
  const now = state.cache.stats();
  const start = state.perf.cacheStart ?? { hits: 0, misses: 0 };
  const hits = now.hits - start.hits;
  const misses = now.misses - start.misses;
  out.cache = {
    size: now.size,
    hitsSince: hits,
    missesSince: misses,
    hitRateSince: hits + misses ? perfRound(hits / (hits + misses)) : 0,
  };
  return out;
}

// ---------- 安装 / 卸载 / 设置 ----------

let windowPointerListeners = null;
function onWindowPointerDown() { state.windowPointerDown = true; }
function onWindowPointerUp() { state.windowPointerDown = false; }
function attachWindowPointerListeners() {
  if (windowPointerListeners || typeof window === 'undefined') return;
  window.addEventListener('pointerdown', onWindowPointerDown, { capture: true });
  window.addEventListener('pointerup', onWindowPointerUp, { capture: true });
  window.addEventListener('pointercancel', onWindowPointerUp, { capture: true });
  windowPointerListeners = true;
}
function detachWindowPointerListeners() {
  if (!windowPointerListeners) return;
  window.removeEventListener('pointerdown', onWindowPointerDown, { capture: true });
  window.removeEventListener('pointerup', onWindowPointerUp, { capture: true });
  window.removeEventListener('pointercancel', onWindowPointerUp, { capture: true });
  windowPointerListeners = null;
  state.windowPointerDown = false;
}

export function install(canvas) {
  attachWindowPointerListeners();
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
  installContextMenuHook();
  // BUG-009-④：设置注册期的 onChange 早于本 install（当时 state.installed=false，syncFlowLoop 不会启动循环），
  // 且 setup() 的显式 apply 清单不含动效键——安装完成后补一次同步，
  // 使重启/刷新后已保存的动效配置无需用户再翻转开关即生效。
  syncFlowLoop();

  // 调试入口：内存态兄弟线间距（面板项由设置会话合并后再注册，避免改 index.js）。
  // 等距带默认 8px；上限在 planBands 内按同组接入点最小 y 间距钳制。
  try {
    const expose = () => {
      const api = window.LuoWen;
      if (!api) return false;
      if (typeof api.setBrotherSpacing !== 'function') {
        api.setBrotherSpacing = (v) => {
          const n = Number(v);
          state.settings.brotherSpacing = Number.isFinite(n) ? Math.max(0, Math.min(64, n)) : DEFAULT_BROTHER_SPACING;
          state.frame.bands = new Map();
          state.frame.bandInfo = [];
          state.frame.bandDegraded = [];
          state.frame.orderCtx = new Map();
          state.frame.orderDegraded = [];
          app?.canvas?.setDirty?.(false, true);
          return state.settings.brotherSpacing;
        };
      }
      if (typeof api.perfStart !== 'function') {
        api.perfStart = perfStart;
        api.perfStop = perfStop;
        api.perfReport = perfReport;
      }
      return true;
    };
    if (!expose()) {
      let tries = 0;
      const tick = () => {
        if (!expose() && ++tries < 120) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  } catch {
    /* 调试入口失败不影响绘制 */
  }

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
  detachWindowPointerListeners();
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
  state.hover = null;
  uninstallContextMenuHook();
  state.cache.clear();
}

export function getSettings() {
  return { ...state.settings };
}

export function setSettings(partial) {
  const prev = { ...state.settings };
  if ('cornerRadius' in partial) {
    const n = Number(partial.cornerRadius);
    partial.cornerRadius = Number.isFinite(n) ? Math.max(0, Math.min(CORNER_RADIUS_MAX, n)) : prev.cornerRadius;
  }
  if ('colorTheme' in partial) {
    const id = partial.colorTheme && partial.colorTheme !== 'off' ? String(partial.colorTheme) : 'off';
    partial.colorTheme = id;
    setLinkColorTheme(id === 'off' ? null : id);
  }
  if ('flowAnim' in partial) partial.flowAnim = !!partial.flowAnim;
  if ('animMode' in partial) partial.animMode = partial.animMode === 'selected' || partial.animMode === 'executing' ? partial.animMode : 'all';
  if ('flowStyle' in partial) partial.flowStyle = partial.flowStyle === 'glow' || partial.flowStyle === 'pulse' ? partial.flowStyle : 'dash';
  if ('flowDash' in partial) { const n = Number(partial.flowDash); partial.flowDash = Number.isFinite(n) ? Math.max(0, Math.min(30, n)) : prev.flowDash; }
  if ('flowGap' in partial) { const n = Number(partial.flowGap); partial.flowGap = Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : prev.flowGap; }
  if ('flowSpeed' in partial) { const n = Number(partial.flowSpeed); partial.flowSpeed = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : prev.flowSpeed; } // 档位 0-10，绘制时 ×30（屏幕像素/秒/档）
  if ('disableAnimOnRun' in partial) partial.disableAnimOnRun = !!partial.disableAnimOnRun;
  if ('brotherSpacing' in partial) {
    const n = Number(partial.brotherSpacing);
    partial.brotherSpacing = Number.isFinite(n) ? Math.max(0, Math.min(64, n)) : prev.brotherSpacing;
  }
  Object.assign(state.settings, partial);
  const dirty = ['enabled', 'style', 'avoidance', 'lanePitch', 'brotherSpacing', 'crossCleanup']
    .some((k) => k in partial && partial[k] !== prev[k]);
  if (dirty) invalidateCleanup('settings');
  if ('colorTheme' in partial || 'flowAnim' in partial) syncFlowLoop();
  app?.canvas?.setDirty?.(false, true);
}

// ---------- 连线配色主题（DEC-029 / link-color-tokens）与流向动效 ----------

// 主题关闭 → resolveLinkColor 返回 null → 回退原取色链（原生 color || #94a3b8）。
let reducedQuery = null;
function reducedMotionPref() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (!reducedQuery) reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  return !!reducedQuery.matches;
}

let flowRaf = 0;
function flowLoopTick() {
  flowRaf = 0;
  const cfg = state.settings;
  // BUG-009-①：主题是配色选择，不作动效隐藏依赖（与 shouldAnimate 解耦口径一致，BUG-008）
  const on = state.installed && cfg.flowAnim;
  if (!on) return;
  // 指针按下（拖动/框选/平移）：暂停本循环的 setDirty——拖动自身已有重绘节奏，动效已画实线
  if (state.windowPointerDown === true) {
    flowRaf = requestAnimationFrame(flowLoopTick);
    return;
  }
  // 空闲零重绘：仅当存在「本帧该动的线」才驱动重绘（DEC-040 第 5 条）
  // BUG-009-②：队列运行状态在 state.queue.running（state.settings.queueRunning 从不存在，修前为恒 false 死分支）
  // BUG-009-③：外部闸门（reduced-motion/宿主开关/缩放≤0.4）命中时逐线门禁本就画静态，循环不再驱动全图重绘
  //   （RAF 自转保留，完整自停+唤醒设计属研究任务阶段五）；hostAnimOff 缓存是帧级生命周期，
  //   循环停画期间无人刷新会成死缓存，这里每 tick 直读一次
  state.frame.hostAnimOff = null;
  const scaleNow = app?.canvas?.ds?.scale ?? 1;
  let hasWork = true;
  if (reducedMotionPref() || hostAnimationsDisabled() || !(Number(scaleNow) > 0.4)) hasWork = false;
  else if (state.queue.running && cfg.disableAnimOnRun) hasWork = false;
  else if (cfg.animMode === 'executing') hasWork = state.queue.executingNode != null;
  else if (cfg.animMode === 'selected') hasWork = (app?.canvas?.selectedItems?.size ?? 0) > 0;
  if (hasWork && !document.hidden) app?.canvas?.setDirty?.(false, true);
  flowRaf = requestAnimationFrame(flowLoopTick);
}

function syncFlowLoop() {
  const want = !!(state.installed && state.settings.flowAnim);
  if (want && !flowRaf) flowRaf = requestAnimationFrame(flowLoopTick);
}

// 调试/验收入口：当前主题 + 现存连线按类型的解析结果与条数
// 队列运行时状态（api 事件驱动，index.js 订阅；不持久化）
state.queue = { running: false, executingNode: null };

export function setQueueState({ running, executingNode } = {}) {
  if (running != null) state.queue.running = !!running;
  if (executingNode !== undefined) state.queue.executingNode = executingNode == null ? null : String(executingNode);
  syncFlowLoop();
  app?.canvas?.setDirty?.(false, true);
}

function selectedNodeIdsThisFrame() {
  if (state.frame.selectedIds) return state.frame.selectedIds;
  const sel = app?.canvas?.selectedItems;
  const ids = new Set();
  if (sel && typeof sel.forEach === 'function') sel.forEach((n) => { if (n && n.id != null) ids.add(String(n.id)); });
  state.frame.selectedIds = ids;
  return ids;
}

function hostAnimationsDisabled() {
  if (state.frame.hostAnimOff != null) return state.frame.hostAnimOff;
  let v = false;
  try { v = app?.ui?.settings?.getSettingValue?.('Comfy.Appearance.DisableAnimations') === true; } catch { /* 宿主设置不可读时按未禁用 */ }
  state.frame.hostAnimOff = v;
  return v;
}

export function getColorDebug() {
  const g = app?.canvas?.graph;
  const links = g?.links ? [...g.links.values()] : [];
  const byType = {};
  for (const l of links) {
    const t = String(l?.type ?? '');
    const hex = resolveLinkColor(l);
    if (!byType[t]) byType[t] = { hex, n: 0 };
    byType[t].n += 1;
  }
  const id = state.settings.colorTheme !== 'off' ? state.settings.colorTheme : null;
  return {
    theme: state.settings.colorTheme, flowAnim: !!state.settings.flowAnim,
    animMode: state.settings.animMode, flowStyle: state.settings.flowStyle,
    queue: { running: state.queue.running, executingNode: state.queue.executingNode },
    disableAnimOnRun: !!state.settings.disableAnimOnRun,
    info: themeInfo(id), byType,
  };
}

export function getStats() {
  return {
    rev: 'r7-input-lanes',
    ...state.settings,
    installed: state.installed,
    obstacleVersion: state.frame.version,
    rects: state.frame.rects.length,
    cache: state.cache.stats(),
    hovered: state.hover?.linkId ?? null,
    hover: state.hover
      ? { linkId: state.hover.linkId, part: state.hover.part, members: state.hover.memberIds }
      : null,
    routed: state.routes.size,
    counters: { ...state.counters },
    trunks: state.frame.trunkInfo.map((t) => ({ group: t.group, fork: t.T, merged: t.merged })),
    trunkDebug: state.frame.trunkDebug ?? null,
    bands: state.frame.bandInfo.map((b) => ({ ...b, members: [...b.members] })),
    bandDegraded: state.frame.bandDegraded.map((b) => ({ ...b })),
    orderDegraded: state.frame.orderDegraded.map((b) => ({ ...b })),
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
