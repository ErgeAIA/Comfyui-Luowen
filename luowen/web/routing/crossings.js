// 络纹 LuoWen — 线路交叉枚举（纯几何；无 DOM / 无 litegraph / 无 app）
//
// 输入是正交折线切出的线段集合，输出按「唯一线路对」与「涉及线路集合」两档计数。
// 判定口径（DEC-016）：
//   cross    垂直相交，交点在两条线段内部（距各自端点 > tol）→ 计入
//   overlap  同轴共线且重叠长度 > tol → 计入（同组共享段除外）
//   touch    仅在端点接触，或共线相切（重叠长度 ≤ tol）→ 不计入
// 斜边不参与（state.routes 与 link.path 始终保持正交，倒角只发生在绘制层）。
//
// 同组豁免的边界：只豁免「同组 + 共线重叠」这一种（共享走廊、共享引脚段属设计预期）；
// 同组线束之间的垂直穿插仍计入，因为那是真实的视觉交叉。引脚豁免要求两侧端点的
// 引脚标识相同，而不是仅坐标相同。

const DEFAULT_TOL = 0.5
const COST_TOL = 0.01

// 把 [{ linkId, groupId, points, startPin, endPin }] 摊平成线段。
// aPin / bPin 只挂在折线首段起点与末段终点：中间拐点不是引脚。
export function segmentsOfRoutes(routes) {
  const out = []
  for (const r of routes ?? []) {
    const pts = r?.points
    if (!pts || pts.length < 2) continue
    for (let k = 1; k < pts.length; k++) {
      out.push({
        linkId: r.linkId,
        groupId: r.groupId ?? null,
        a: pts[k - 1],
        b: pts[k],
        aPin: k === 1 ? r.startPin ?? null : null,
        bPin: k === pts.length - 1 ? r.endPin ?? null : null,
      })
    }
  }
  return out
}

export function enumerateCrossings({ segments = [], tol = DEFAULT_TOL } = {}) {
  const events = []
  const ignored = { sameLink: 0, sameGroup: 0, sharedPin: 0, touch: 0 }
  const byPair = new Map()
  const involvedSet = new Map() // idKey -> 原始 id（输出保留调用方类型）

  for (let i = 0; i < segments.length; i++) {
    const sa = segments[i]
    if (!valid(sa)) continue
    for (let j = i + 1; j < segments.length; j++) {
      const sb = segments[j]
      if (!valid(sb)) continue
      if (idKey(sa.linkId) === idKey(sb.linkId)) {
        ignored.sameLink += 1
        continue
      }
      const hit = classify(sa, sb, tol)
      if (!hit) continue

      const sameGroup = sa.groupId != null && sb.groupId != null && String(sa.groupId) === String(sb.groupId)
      const sharedPin = hit.type === 'overlap'
        ? sharedPinInSpan(sa, sb, hit, tol)
        : sharedPinAt(sa, sb, hit.at, tol)

      let counted = false
      let reason = null
      if (hit.type === 'touch') {
        reason = sharedPin ? 'shared-pin' : 'touch'
        ignored[sharedPin ? 'sharedPin' : 'touch'] += 1
      } else if (hit.type === 'overlap') {
        if (sharedPin) {
          reason = 'shared-pin'
          ignored.sharedPin += 1
        } else if (sameGroup) {
          reason = 'same-group'
          ignored.sameGroup += 1
        } else {
          counted = true
        }
      } else {
        counted = true
      }

      events.push({
        type: hit.type,
        at: hit.at,
        length: hit.length,
        counted,
        reason,
        a: { linkId: sa.linkId, index: i },
        b: { linkId: sb.linkId, index: j },
      })
      if (!counted) continue

      const k = pairKey(sa.linkId, sb.linkId)
      let rec = byPair.get(k)
      if (!rec) {
        rec = { a: sa.linkId, b: sb.linkId, count: 0, cross: 0, overlap: 0, length: 0 }
        byPair.set(k, rec)
      }
      rec.count += 1
      rec[hit.type] += 1
      rec.length += hit.length ?? 0
      involvedSet.set(idKey(sa.linkId), sa.linkId)
      involvedSet.set(idKey(sb.linkId), sb.linkId)
    }
  }

  const order = [...involvedSet.entries()].sort((x, y) => cmpIds(x[0], y[0])).map(([, id]) => id)
  return {
    pairs: byPair.size,
    count: events.filter((e) => e.counted).length,
    involved: order,
    byPair: [...byPair.values()],
    events,
    ignored,
  }
}

// 单条线段与既有线路的「垂直内点交叉」计数。供 router 的可选 crossCost 使用：
// 共线重叠（共享走廊）与端点接触都不计入，避免把同走廊并行股当成交叉。
export function crossingsOnSegment(a, b, segments = [], { tol = COST_TOL } = {}) {
  let n = 0
  for (const s of segments) {
    if (!valid(s)) continue
    const hit = classify({ a, b }, s, tol)
    if (hit && hit.type === 'cross') n += 1
  }
  return n
}

// ---------- 几何 ----------

function valid(seg) {
  return Array.isArray(seg?.a) && Array.isArray(seg?.b) && seg.a.length >= 2 && seg.b.length >= 2
}

function shape(seg, tol) {
  const [ax, ay] = seg.a
  const [bx, by] = seg.b
  const dx = Math.abs(bx - ax)
  const dy = Math.abs(by - ay)
  if (dx <= tol && dy <= tol) return null // 退化点
  if (dy <= tol) return { axis: 'h', lo: Math.min(ax, bx), hi: Math.max(ax, bx), at: ay }
  if (dx <= tol) return { axis: 'v', lo: Math.min(ay, by), hi: Math.max(ay, by), at: ax }
  return null // 斜边不参与
}

function classify(sa, sb, tol) {
  const a = shape(sa, tol)
  const b = shape(sb, tol)
  if (!a || !b) return null

  if (a.axis === 'h' && b.axis === 'h') {
    if (Math.abs(a.at - b.at) > tol) return null // 平行不交
    const lo = Math.max(a.lo, b.lo)
    const hi = Math.min(a.hi, b.hi)
    const len = hi - lo
    const y = (a.at + b.at) / 2
    if (len > tol) return { type: 'overlap', axis: 'h', at: [(lo + hi) / 2, y], lo, hi, length: len }
    if (len >= -tol) return { type: 'touch', axis: 'h', at: [(lo + hi) / 2, y], lo, hi, length: 0 }
    return null
  }

  if (a.axis === 'v' && b.axis === 'v') {
    if (Math.abs(a.at - b.at) > tol) return null
    const lo = Math.max(a.lo, b.lo)
    const hi = Math.min(a.hi, b.hi)
    const len = hi - lo
    const x = (a.at + b.at) / 2
    if (len > tol) return { type: 'overlap', axis: 'v', at: [x, (lo + hi) / 2], lo, hi, length: len }
    if (len >= -tol) return { type: 'touch', axis: 'v', at: [x, (lo + hi) / 2], lo, hi, length: 0 }
    return null
  }

  // 一横一竖
  const h = a.axis === 'h' ? a : b
  const v = a.axis === 'h' ? b : a
  const x = v.at
  const y = h.at
  if (x < h.lo - tol || x > h.hi + tol || y < v.lo - tol || y > v.hi + tol) return null
  // 内点：交点到线段两端的距离都超过 tol；否则归为端点接触
  const inH = x - h.lo > tol && h.hi - x > tol
  const inV = y - v.lo > tol && v.hi - y > tol
  return { type: inH && inV ? 'cross' : 'touch', axis: 'p', at: [x, y], length: 0 }
}

// ---------- 引脚 ----------

function pinEntries(seg) {
  const out = []
  if (seg.aPin != null) out.push({ p: seg.a, id: String(seg.aPin) })
  if (seg.bPin != null) out.push({ p: seg.b, id: String(seg.bPin) })
  return out
}

function sharedPinAt(sa, sb, at, tol) {
  const a = pinEntries(sa).filter((e) => near(e.p, at, tol))
  const b = pinEntries(sb).filter((e) => near(e.p, at, tol))
  return a.some((ea) => b.some((eb) => ea.id === eb.id))
}

function sharedPinInSpan(sa, sb, hit, tol) {
  const a = pinEntries(sa).filter((e) => inSpan(e.p, hit, tol))
  const b = pinEntries(sb).filter((e) => inSpan(e.p, hit, tol))
  return a.some((ea) => b.some((eb) => ea.id === eb.id))
}

function near(p, at, tol) {
  return Math.abs(p[0] - at[0]) <= tol && Math.abs(p[1] - at[1]) <= tol
}

function inSpan(p, hit, tol) {
  const along = hit.axis === 'h' ? p[0] : p[1]
  const perp = hit.axis === 'h' ? p[1] : p[0]
  return along >= hit.lo - tol && along <= hit.hi + tol && Math.abs(perp - (hit.axis === 'h' ? hit.at[1] : hit.at[0])) <= tol
}

// ---------- 输出辅助 ----------

function idKey(v) {
  return String(v)
}

function cmpIds(x, y) {
  const nx = Number(x)
  const ny = Number(y)
  if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny
  return x < y ? -1 : x > y ? 1 : 0
}

function pairKey(a, b) {
  const [p, q] = cmpIds(idKey(a), idKey(b)) <= 0 ? [idKey(a), idKey(b)] : [idKey(b), idKey(a)]
  return `${p}\u0000${q}`
}
