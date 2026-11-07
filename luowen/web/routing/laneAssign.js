// 络纹 LuoWen — 同侧多线 lane 阶梯分配（阶段 1 简化版；CM registry laneStub 思想的确定性重写）
//
// 规则（纯图真相、无迭代）：
//   - 输出侧：同 origin 节点+slot 整组共用 base stub，**不做 rank 阶梯**（DEC-011：
//     DEC-009 单主干后，同一输出端口只应有一条出线；再按 rank 给 24/29/34 会让同一
//     fork 后的首个转折点错开，在仍需共用的走廊上长出平行双线）
//   - 输入侧：按 target 节点聚合，再按「线从哪一侧接近引脚」分三组（上 / 下 / 平走），
//     按嵌套规则由近到远分配走廊序号（DEC-013 补记，用户硬约束）：
//       上方来源：引脚越高（slot 越小）越贴节点，向下依次外移；
//       下方来源：反向镜像——引脚越高越靠外，引脚越低越贴节点；
//       平走来源：放最外层，避免其竖直段穿过其他引脚的进线水平段。
//     组内同一引脚多源沿用旧序：上方越顶越贴、下方越底越贴。
//     （旧实现按 target_slot 升序统一摊开，会在「下方来源」组内造成上下引脚交叉）
//
// 输出 Map<linkId, {stubOut, stubIn}>；纯函数，每帧重算成本低（链路数线性）。

const DEFAULT_BASE = 24;
// 输入侧引脚间距：用户拍板 8px（注释口径按线宽 2 → 边缘净空 6px；宿主实装
// connections_width=3，实测净空 5px）。仅作用于不同输入引脚之间的分层。
export const DEFAULT_LANE_PITCH = 8;

function nodeIndex(graphNodes) {
  const idx = new Map();
  for (const n of graphNodes) if (n && n.id != null) idx.set(n.id, n);
  return idx;
}

// slot 升序（target_slot 在图中为数值；非数值时退回字符串序，保证确定性）
function slotOrder(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

// 输入引脚 x 相对节点左边缘的偏移：实测 frontend 1.55.18（node70 pos[0]=659.9998，
// getConnectionPos(true,0)=670；node63 629.1→639 等，均为 +10）。仅作为**无真实引脚
// 信息时**的兜底口径；adapter 传入 pins 后一律用线路真实端点 x（与 router 的 eStub 一致）。
const INPUT_PIN_X_OFFSET = 10;
// 走廊净空判定与 router 的 hard 箱对齐（节点矩形外扩 4px）
const LANE_HARD_PAD = 4;
// 冲突簇重分配边界：向内侧最多下探 1 档；外侧顺延最多名义末位之后 4 档
// （PRD §7.3「不得无限增加绕行」）。
const MIN_STUB_STEPS = 1;
const MAX_FORWARD_STEPS = 4;

// 兼容两种输入：宿主 rects {id,x,y,w,h} 与测试 fixtures {id,pos,size}
function nodeRect(n) {
  if (!n) return null;
  if (Array.isArray(n.pos)) {
    const [x, y] = n.pos;
    const [w, h] = n.size || [0, 0];
    return { x, y, w, h };
  }
  if (n.x == null && n.y == null) return null;
  return { x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 0, h: n.h ?? 0 };
}

// 竖向走廊 x 是否被第三方节点挡住：x 落在节点（外扩 LANE_HARD_PAD）内，且该节点的
// y 区间与本条线「源节点到目标节点」的竖直跨度重叠。排除本条线的 origin/target 自身。
function laneBlocked(x, y0, y1, rects, skipIds) {
  if (y0 == null || y1 == null) return false;
  for (const n of rects) {
    if (!n || skipIds.has(String(n.id))) continue;
    const r = nodeRect(n);
    if (!r || !r.w || !r.h) continue;
    if (x <= r.x - LANE_HARD_PAD || x >= r.x + r.w + LANE_HARD_PAD) continue;
    if (y1 <= r.y || y0 >= r.y + r.h) continue;
    return true;
  }
  return false;
}

export function allocateLanes(links, nodes, { base = DEFAULT_BASE, pitch = DEFAULT_LANE_PITCH, pins = null } = {}) {
  const byId = nodeIndex(nodes);
  const inNodes = new Map(); // target_id -> Map<slotKey, links[]>
  const result = new Map();

  for (const l of links) {
    if (!l || l.id == null) continue;
    result.set(l.id, { stubOut: base, stubIn: base });
    // 输出侧：整组统一 base，不做 rank（DEC-011），端口只出一条线
    if (l.target_id == null) continue;
    // 输入侧以目标节点聚合，slot 只用于分层（DEC-013）
    if (!inNodes.has(l.target_id)) inNodes.set(l.target_id, new Map());
    const slots = inNodes.get(l.target_id);
    const sk = String(l.target_slot);
    if (!slots.has(sk)) slots.set(sk, []);
    slots.get(sk).push(l);
  }

  for (const [tid, slots] of inNodes) {
    const nodeY = (n) => (n?.pos ? n.pos[1] : (n?.y ?? 0)); // 兼容节点对象与矩形 {id,x,y,w,h}
    // 先收集目标节点全部入线，再按接近方向分组；slot 仅用作引脚高度与稳定排序。
    const entries = [];
    for (const sk of slots.keys()) {
      for (const l of slots.get(sk)) {
        const selfY = nodeY(byId.get(l.target_id));
        const otherY = nodeY(byId.get(l.origin_id));
        entries.push({ l, sk, dy: otherY - selfY, otherY });
      }
    }
    const byLinkId = (a, b) => a.l.id - b.l.id;
    // 上方来源：引脚越高越贴节点（引脚高度用 slot 序近似，slot 越小越靠上）
    const ups = entries
      .filter((e) => e.dy < -1)
      .sort((a, b) => slotOrder(a.sk, b.sk) || a.otherY - b.otherY || byLinkId(a, b));
    // 下方来源：镜像——引脚越高越靠外，故按 slot 降序从近到远；同引脚内越底越贴
    const downs = entries
      .filter((e) => e.dy > 1)
      .sort((a, b) => slotOrder(b.sk, a.sk) || b.otherY - a.otherY || byLinkId(a, b));
    // 平走来源：最外层
    const flats = entries
      .filter((e) => Math.abs(e.dy) <= 1)
      .sort((a, b) => slotOrder(a.sk, b.sk) || byLinkId(a, b));
    // 由近到远一次性编号：同节点任意两条不同引脚的竖直走廊因此不会相交。
    // 名义阶梯（base + 序号 × pitch）全部合法时原样使用（与既有基线逐点一致）；
    // 只要有一条被第三方节点占住，就把整组按「近→远」重排到一段连续合法位，
    // 允许向内侧下探、外侧顺延有上限，避免旧实现单向往外走到无解 stub（BUG-003）。
    const targetRect = nodeRect(byId.get(tid));
    const order = [...ups, ...downs, ...flats];
    const nominal = order.map((_, i) => base + i * pitch);

    // 单条线的真实走廊口径：目标入引脚实际 x + 该线两端引脚的实际 y 跨度（adapter 传入）。
    // 无引脚信息时退回旧口径（rect.x + 10 + 整节点 y 跨度），装载首帧与单测行为不变。
    const geometryOf = (e) => {
      const pin = pins ? pins.get(e.l.id) : null;
      if (pin && Number.isFinite(pin.x)) {
        return { pinX: pin.x, y0: pin.y0, y1: pin.y1 };
      }
      if (!targetRect) return { pinX: null, y0: null, y1: null };
      const oRect = nodeRect(byId.get(e.l.origin_id));
      return {
        pinX: targetRect.x + INPUT_PIN_X_OFFSET,
        y0: oRect ? Math.min(targetRect.y, oRect.y) : null,
        y1: oRect ? Math.max(targetRect.y + targetRect.h, oRect.y + oRect.h) : null,
      };
    };
    const laneFree = (e, stub) => {
      const g = geometryOf(e);
      if (g.pinX == null || g.y0 == null) return true;
      const skipIds = new Set([String(tid), String(e.l.origin_id)]);
      return !laneBlocked(g.pinX - stub, g.y0, g.y1, nodes, skipIds);
    };

    let chosen = nominal;
    if (!nominal.every((stub, i) => laneFree(order[i], stub))) {
      let best = null;
      let bestCost = Infinity;
      const startMax = base + MAX_FORWARD_STEPS * pitch;
      for (let s0 = MIN_STUB_STEPS * pitch; s0 <= startMax; s0 += pitch) {
        const cand = order.map((_, i) => s0 + i * pitch);
        if (!cand.every((stub, i) => laneFree(order[i], stub))) continue;
        const cost = cand.reduce((acc, stub, i) => acc + Math.abs(stub - nominal[i]), 0);
        if (cost < bestCost) {
          best = cand;
          bestCost = cost;
        }
      }
      if (best) chosen = best;
    }
    order.forEach((e, i) => {
      result.get(e.l.id).stubIn = chosen[i];
    });
  }
  return result;
}

// lane 分配的输入指纹：链路拓扑 + 节点矩形（分类依据 y；走廊净空依赖 x/w/h）；
// 任一变化都要重算，否则会沿用被挡住/已失效的走廊序号。
export function laneHash(links, nodes) {
  const rects = nodes
    .map((n) => {
      const r = nodeRect(n);
      return r
        ? `${n.id}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)};`
        : `${n.id}:?;`;
    })
    .sort();
  const ls = links
    .filter((l) => l && l.id != null)
    .map((l) => `${l.id}:${l.origin_id}:${l.origin_slot}:${l.target_id}:${l.target_slot};`)
    .sort();
  return `${rects.join('')}|${ls.join('')}`;
}
