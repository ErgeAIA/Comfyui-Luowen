// 络纹 LuoWen — 阶段 2：同源多目标主干预规划（纯函数，可单测）
//
// 输入：同一输出端口（origin 节点 + slot）的若干条“独立路径基准”（每个成员已有一条
//       A* 路由），以及从分叉点重新求解分支的回调。
// 输出：主干预 + 每个成员的分叉路径；不在 merged 里的成员保持自己的独立路径。
//
// 契约（PRD §7.3 / §8.2-§8.3 / 阶段 2 交付）：
//   - 主干只取所有成员第一段沿出线方向的**共同范围**，分叉点不越过公共前缀；
//   - 合流段按 PRD §7.3 呈现为**平行 Ribbon**（pitch 4px），不重叠冒充合并；
//     每条逻辑连接保留独立命中区域（§8.3 的降级形态：不支持组选择时用多股呈现）；
//   - 分叉后分支重新求解（可避障），并按“共享后长度 / 独立长度”做单目标绕行保护；
//   - 合并决策带双阈值滞回：曾合并的成员放宽到 keepRatio 才踢出，曾独立的成员收紧到
//     rejoinRatio 才纳入，避免布局微动时拓扑闪烁（§6.5）；
//   - 合流成员 < 2 或空间不足时返回空计划（完全独立）。

const EPS = 0.01;
const DEFAULT_PITCH = 4; // 线宽 2 + 间隔 2（PRD §7.3：不以零间距重叠冒充合并）
const DEFAULT_FAN = 14; // 离开引脚后的并排展开距离（引脚内缩约 9px，需在卡片外）
const DEFAULT_MIN_TRUNK = 16;
const DEFAULT_MAX_TRUNK = 72;

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

// 分叉长度：至少要有 min 的共同前缀；上限取 max 与“最近目标投影 − 余量”的较小者。
// 不把共同前缀本身当上限——主干的目的就是让分支晚一点分开；是否划算交给绕行保护判定。
export function chooseForkLength(runs, { min = DEFAULT_MIN_TRUNK, max = DEFAULT_MAX_TRUNK, limit = null } = {}) {
  const usable = runs.filter((r) => r != null && r.len > EPS);
  if (!usable.length) return null;
  const common = Math.min(...usable.map((r) => r.len));
  if (common < min) return null;
  const cap = limit == null ? max : Math.min(max, limit);
  if (cap < min) return null;
  return Math.max(min, cap);
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
    const branch = solveBranch(id, fork);
    if (!branch) return { id, branch: null, ratio: Infinity };
    const independent = pathLength(routes.get(id));
    const shared = T + pathLength(branch);
    return { id, branch, ratio: independent > EPS ? shared / independent : Infinity };
  });

  const merged = decideMembership(entries, prevMembers, opts);
  if (merged.size < 2) return { ...empty, ratios: new Map(entries.map((e) => [e.id, e.ratio])) };

  // Ribbon：按目标在主干法向上的位置排序，分配平行股道
  const pitch = opts.ribbonPitch ?? DEFAULT_PITCH;
  const fan = opts.fan ?? DEFAULT_FAN;
  const perp = dir0[0] !== 0 ? [0, 1] : [1, 0];
  const ordered = [...merged].sort((a, b) => {
    const ea = routes.get(a).at(-1);
    const eb = routes.get(b).at(-1);
    const va = ea[0] * perp[0] + ea[1] * perp[1];
    const vb = eb[0] * perp[0] + eb[1] * perp[1];
    return va - vb || a - b;
  });
  const n = ordered.length;
  // 空间不足：并排股道放不进公共前缀 → 退回完全独立（不做零间距重叠）
  if (T < fan + ((n - 1) / 2) * pitch + 6) return { ...empty, ratios: new Map(entries.map((e) => [e.id, e.ratio])) };

  const f0 = [pin[0] + dir0[0] * fan, pin[1] + dir0[1] * fan];
  const paths = new Map();
  for (let i = 0; i < n; i++) {
    const id = ordered[i];
    const off = (i - (n - 1) / 2) * pitch;
    const jog = [f0[0] + perp[0] * off, f0[1] + perp[1] * off];
    const f1 = [pin[0] + dir0[0] * T + perp[0] * off, pin[1] + dir0[1] * T + perp[1] * off];
    const end = routes.get(id).at(-1);
    let branch = solveBranch(id, f1);
    if (!branch) branch = straightBranch(f1, end, dir0);
    if (!branch) {
      merged.delete(id);
      continue;
    }
    const rest =
      Math.abs(branch[0][0] - f1[0]) < 0.5 && Math.abs(branch[0][1] - f1[1]) < 0.5 ? branch.slice(1) : branch;
    paths.set(id, simplify([[pin[0], pin[1]], f0, jog, f1, ...rest]));
  }
  if (merged.size < 2) return { ...empty, ratios: new Map(entries.map((e) => [e.id, e.ratio])) };
  return { merged, fork, T, ratios: new Map(entries.map((e) => [e.id, e.ratio])), paths };
}