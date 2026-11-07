// 络纹 LuoWen — 阶段 2：同源多目标主干预规划（纯函数，可单测）
//
// 输入：同一输出端口（origin 节点 + slot）的若干条“独立路径基准”（每个成员已有一条
//       A* 路由），以及从分叉点重新求解分支的回调。
// 输出：主干预 + 每个成员的分叉路径；不在 merged 里的成员保持自己的独立路径。
//
// 契约（PRD §7.3 / §8.2-§8.3 / 阶段 2 交付，DEC-009 / DEC-012）：
//   - 主干沿出线方向走「合法最晚分叉」：T = min(最近目标投影 − stub, 前方卡片净空)，
//     不再受固定 72px 上限；主干到 fork 前仍是同一方向的一条线；
//   - 合流段是**单条共享主干**：同组所有成员共用同一几何，端口只出一条线，到分叉点
//     之后再按成员各自分支（不在端口处分股，DEC-009 修正 DEC-008 的 Ribbon 并排）；
//   - 分叉后分支重新求解（可避障），并按“共享后长度 / 独立长度”做单目标绕行保护；
//   - 合并决策带双阈值滞回：曾合并的成员放宽到 keepRatio 才踢出，曾独立的成员收紧到
//     rejoinRatio 才纳入，避免布局微动时拓扑闪烁（§6.5）；
//   - 合流成员 < 2 或共同前缀不足时返回空计划（完全独立）。

const EPS = 0.01;
const DEFAULT_MIN_TRUNK = 16;

export function pathLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
  }
  return total;
}

// 第一段：返回 {len, dir:[dx,dy]}；共线直连（只有一段）时 len 为全长
export function firstRun(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return null;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[1];
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  if ((dx !== 0 && dy !== 0) || (dx === 0 && dy === 0)) return null; // 非正交第一段视为不可用
  return { len: Math.abs(bx - ax) + Math.abs(by - ay), dir: [dx, dy] };
}

export function sameDir(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

// 分叉长度：至少要有 min 的共同前缀；上限只由「合法最晚」约束决定（DEC-012）：
//   - 最近目标投影 − stub（再晚就要让最近目标先倒退）；
//   - 正前方最近卡片 − stub − 余量（分叉点与分支不得顶进卡片）。
// 不再套固定 72px 上限：主干每延长 1px，重复几何减少 (n-1)px；长主干比长平行分支更符合
// 「同源一棵树」。max 参数仅保留给显式调用方（对照/测试）作额外上限。
export function chooseForkLength(runs, { min = DEFAULT_MIN_TRUNK, max = null, limit = null } = {}) {
  const usable = runs.filter((r) => r != null && r.len > EPS);
  if (!usable.length) return null;
  const common = Math.min(...usable.map((r) => r.len));
  if (common < min) return null;
  const candidate = limit == null ? (max == null ? common : max) : max == null ? limit : Math.min(max, limit);
  if (candidate < min) return null;
  return Math.max(min, candidate);
}

// 双阈值滞回：prev 为上一轮合并集合（Set 或 null）
export function decideMembership(entries, prev, { join = 1.25, keep = 1.35, rejoin = 1.15 } = {}) {
  const merged = new Set();
  for (const e of entries) {
    if (!e.branch) continue;
    const wasMerged = prev ? prev.has(e.id) : false;
    const threshold = wasMerged ? keep : prev && prev.size ? rejoin : join;
    if (e.ratio <= threshold) merged.add(e.id);
  }
  return merged;
}

// 共线直连的平凡分支：route() 对 canonical 直连返回 null，这里补一条直线
function straightBranch(fork, end, dir) {
  if (dir[0] === 1 && end[0] > fork[0] + EPS && Math.abs(end[1] - fork[1]) < 1) return [[fork[0], fork[1]], [end[0], end[1]]];
  if (dir[0] === -1 && end[0] < fork[0] - EPS && Math.abs(end[1] - fork[1]) < 1) return [[fork[0], fork[1]], [end[0], end[1]]];
  if (dir[1] === 1 && end[1] > fork[1] + EPS && Math.abs(end[0] - fork[0]) < 1) return [[fork[0], fork[1]], [end[0], end[1]]];
  if (dir[1] === -1 && end[1] < fork[1] - EPS && Math.abs(end[0] - fork[0]) < 1) return [[fork[0], fork[1]], [end[0], end[1]]];
  return null;
}

function simplify(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const collinear =
      (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5) ||
      (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5);
    const dup = Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
    if (!collinear && !dup) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 两条分支从 fork 出发的几何公共前缀长度（同轴/同向/共线才计入）。
// 分支各自 A* 时，在真正分歧之前常需要走同一段走廊；这段必须合并成一条线，
// 否则会因 lane 阶梯或求解差异生成几像素间距的平行股（DEC-010）。
function sharedPrefixLength(a, b) {
  let i = 1;
  let j = 1;
  let len = 0;
  while (i < a.length && j < b.length) {
    const dxA = Math.sign(a[i][0] - a[i - 1][0]);
    const dyA = Math.sign(a[i][1] - a[i - 1][1]);
    const dxB = Math.sign(b[j][0] - b[j - 1][0]);
    const dyB = Math.sign(b[j][1] - b[j - 1][1]);
    if (dxA !== dxB || dyA !== dyB) break;
    if (dxA !== 0) {
      if (Math.abs(a[i - 1][1] - b[j - 1][1]) > 0.5) break; // 水平段但不共线
    } else if (Math.abs(a[i - 1][0] - b[j - 1][0]) > 0.5) break; // 垂直段但不共线
    const lenA = Math.abs(a[i][0] - a[i - 1][0]) + Math.abs(a[i][1] - a[i - 1][1]);
    const lenB = Math.abs(b[j][0] - b[j - 1][0]) + Math.abs(b[j][1] - b[j - 1][1]);
    len += Math.min(lenA, lenB);
    if (Math.abs(lenA - lenB) > 0.5) break; // 短的一段在此转向，之后不再共享
    i += 1;
    j += 1;
  }
  return len;
}

// 按弧长切分正交折线：{prefix 到切点, rest 从切点起}
function splitAt(pts, len) {
  let i = 1;
  while (i < pts.length) {
    const seg = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    if (seg < EPS) {
      i += 1;
      continue;
    }
    if (len <= seg + EPS) {
      const t = Math.max(0, Math.min(1, len / seg));
      const cut = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      return { prefix: [...pts.slice(0, i), cut], rest: [cut, ...pts.slice(i)] };
    }
    len -= seg;
    i += 1;
  }
  return { prefix: pts, rest: [pts[pts.length - 1]] };
}

// ---------- 主干组悬停分类（DEC-021；纯函数，可单测） ----------

const HOVER_EPS = 0.5;

// 折线最近点：返回 {d2, s}，s 为该最近点沿折线的弧长（用于区分共享主干段与分支段）
function nearestOnPath(pts, point) {
  const px = point[0];
  const py = point[1];
  let bestD2 = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0];
    const ay = pts[i - 1][1];
    const bx = pts[i][0];
    const by = pts[i][1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const segLen = Math.sqrt(len2);
    if (segLen < EPS) continue;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestS = acc + t * segLen;
    }
    acc += segLen;
  }
  return { d2: bestD2, s: bestS };
}

// 同组判定：主干成员共享同一个输出引脚（路径首点坐标一致）；不新增组 ID 表
function trunkMembersOf(trunks, id) {
  const p0 = trunks.get(id)?.[0];
  if (!p0) return [id];
  const ids = [];
  for (const [other, pts] of trunks) {
    const q = pts?.[0];
    if (q && Math.abs(q[0] - p0[0]) < HOVER_EPS && Math.abs(q[1] - p0[1]) < HOVER_EPS) ids.push(other);
  }
  return ids;
}

// 组内共享几何长度 = 各成员与首成员公共前缀的最小值（含分叉后公共走廊，DEC-010）
function trunkSharedLength(trunks, ids) {
  if (ids.length < 2) return Infinity;
  const first = trunks.get(ids[0]);
  if (!Array.isArray(first)) return 0;
  let len = Infinity;
  for (let i = 1; i < ids.length; i++) {
    const other = trunks.get(ids[i]);
    if (!Array.isArray(other)) return 0;
    len = Math.min(len, sharedPrefixLength(first, other));
  }
  return Number.isFinite(len) ? len : 0;
}

// 悬停分类：命中最近折线后按弧长判定 trunk / branch。
// - s ≤ 共享前缀长度 → 整组（part='trunk'）；
// - 否则只该条（part='branch'）；
// - 无主干命中 → 单例（part='branch'）。
export function classifyHover(routes, trunks, point, tol = 8) {
  if (!routes?.size || !point) return null;
  let hit = null;
  let bestD2 = Infinity;
  for (const [id, pts] of routes) {
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const n = nearestOnPath(pts, point);
    if (n.d2 < bestD2) {
      bestD2 = n.d2;
      hit = { id, s: n.s };
    }
  }
  if (!hit) return null;
  const distance = Math.sqrt(bestD2);
  if (distance > tol) return null;

  const inTrunk = trunks?.has?.(hit.id);
  if (inTrunk) {
    const memberIds = trunkMembersOf(trunks, hit.id);
    if (memberIds.length >= 2) {
      const sharedLen = trunkSharedLength(trunks, memberIds);
      if (hit.s <= sharedLen + HOVER_EPS) {
        const first = trunks.get(memberIds[0]);
        const groupPts = Array.isArray(first) ? splitAt(first, sharedLen).prefix : null;
        return { linkId: hit.id, part: 'trunk', memberIds, groupPts, distance };
      }
    }
  }
  // 主干单成员（拓扑刚变化）与非主干线路一律按单条命中
  return { linkId: hit.id, part: 'branch', memberIds: [hit.id], groupPts: null, distance };
}

// 主干方向上最近障碍的“净空上限”：分叉点 + stub 不得顶进前方卡片（PRD §7.2）
function corridorLimit(pin, dir0, obstacles, stub, halfBand = 12) {
  if (!obstacles || !obstacles.length) return null;
  const horiz = dir0[0] !== 0;
  let best = Infinity;
  for (const r of obstacles) {
    const [x, y, w, h] = r;
    let d = Infinity;
    if (horiz) {
      if (pin[1] < y - halfBand || pin[1] > y + h + halfBand) continue;
      const edge = dir0[0] > 0 ? x : x + w;
      d = dir0[0] > 0 ? edge - pin[0] : pin[0] - edge;
    } else {
      if (pin[0] < x - halfBand || pin[0] > x + w + halfBand) continue;
      const edge = dir0[1] > 0 ? y : y + h;
      d = dir0[1] > 0 ? edge - pin[1] : pin[1] - edge;
    }
    if (d > 0 && d < best) best = d;
  }
  return best === Infinity ? null : best - stub - 6;
}

// 主规划：routes: Map<linkId, pts>；solveBranch(id, fork) -> pts|null
// prevMembers: 上一轮 merged 集合（滞回用）
export function planTrunk({ routes, pin, solveBranch, prevMembers = null, opts = {} }) {
  const empty = { merged: new Set(), fork: null, T: 0, ratios: new Map(), paths: new Map() };
  const ids = [...routes.keys()];
  if (ids.length < 2) return empty;

  const runs = ids.map((id) => firstRun(routes.get(id)));
  const dir0 = runs[0]?.dir;
  if (!dir0 || !runs.every((r) => sameDir(r?.dir, dir0))) return empty;
  // 分叉点不得越过最近的目标（否则最近那条必须先倒退）
  const proj = (id) => {
    const e = routes.get(id).at(-1);
    return dir0[0] !== 0 ? (e[0] - pin[0]) * dir0[0] : (e[1] - pin[1]) * dir0[1];
  };
  const positives = ids.map(proj).filter((p) => p > 0);
  if (!positives.length) return empty;
  const stub = opts.stub ?? 24;
  const targetLimit = Math.min(...positives) - stub;
  const blockLimit = corridorLimit(pin, dir0, opts.obstacles, stub);
  const limit = blockLimit == null ? targetLimit : Math.min(targetLimit, blockLimit);
  const T = chooseForkLength(runs, { ...opts, limit });
  if (T == null) return empty;

  // 所有独立路径必须从同一 pin 出发（同一 slot 的前提校验）
  for (const id of ids) {
    const p0 = routes.get(id)[0];
    if (Math.abs(p0[0] - pin[0]) > 0.5 || Math.abs(p0[1] - pin[1]) > 0.5) return empty;
  }

  const fork = [pin[0] + dir0[0] * T, pin[1] + dir0[1] * T];
  const entries = ids.map((id) => {
    // router 对 canonical 直连返回 null（交给原生直连）；合流时用共线直线补齐分支
    const branch = solveBranch(id, fork) ?? straightBranch(fork, routes.get(id).at(-1), dir0);
    if (!branch) return { id, branch: null, ratio: Infinity };
    const independent = pathLength(routes.get(id));
    const shared = T + pathLength(branch);
    return { id, branch, ratio: independent > EPS ? shared / independent : Infinity };
  });

  const merged = decideMembership(entries, prevMembers, opts);
  if (merged.size < 2) return { ...empty, ratios: new Map(entries.map((e) => [e.id, e.ratio])) };

  // 单主干（三通形态，用户裁决）：主干段所有成员共用同一条几何，到 fork 再分支。
  // 分叉后仍要走同一段走廊的（如同列目标），把各分支的几何公共前缀合并成一条，
  // 只有真正分歧处才分开（DEC-010）。
  const mergedBranches = [];
  for (const e of entries) if (merged.has(e.id)) mergedBranches.push(e.branch);
  let sharedLen = Infinity;
  for (const b of mergedBranches) sharedLen = Math.min(sharedLen, sharedPrefixLength(mergedBranches[0], b));
  if (!Number.isFinite(sharedLen) || sharedLen <= EPS) sharedLen = 0;
  const sharedPrefix = sharedLen > 0 ? splitAt(mergedBranches[0], sharedLen).prefix : null;

  const paths = new Map();
  for (const e of entries) {
    if (!merged.has(e.id)) continue;
    const b = e.branch;
    if (sharedPrefix) {
      const rest = splitAt(b, sharedLen).rest;
      const restPts = Math.abs(rest[0][0] - b[b.length - 1][0]) < 0.5 && Math.abs(rest[0][1] - b[b.length - 1][1]) < 0.5 ? [] : rest.slice(1);
      paths.set(e.id, simplify([[pin[0], pin[1]], [fork[0], fork[1]], ...sharedPrefix.slice(1), ...restPts]));
      continue;
    }
    const rest = Math.abs(b[0][0] - fork[0]) < 0.5 && Math.abs(b[0][1] - fork[1]) < 0.5 ? b.slice(1) : b;
    paths.set(e.id, simplify([[pin[0], pin[1]], [fork[0], fork[1]], ...rest]));
  }
  if (paths.size < 2) return { ...empty, ratios: new Map(entries.map((e) => [e.id, e.ratio])) };
  return { merged, fork, T, ratios: new Map(entries.map((e) => [e.id, e.ratio])), paths };
}