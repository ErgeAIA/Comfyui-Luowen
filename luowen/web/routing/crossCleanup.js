// 络纹 LuoWen — 3B-2 离线交叉清理（纯逻辑；无 DOM / 无 litegraph / 无 app）
//
// 输入是当前「基准正交折线」全量快照与单线重解回调，输出采纳后的折线集合与调试统计。
// 契约（DEC-017）：
//   - 只对存在 cross（垂直内点交叉）的线路对重解；同组共享段与共线重叠不处罚（DEC-016 口径）。
//   - 采纳条件：计入交叉对严格下降，且本轮参与线路总长增幅 ≤ maxGrowth（默认 15%）。
//   - 任一轮不满足即整轮丢弃，调用方保持当前画面；最多 maxRounds 轮（默认 2，钳制 1..2）。
//   - 纯函数、确定性：同一输入必得同一输出。适配器以「基准几何签名」缓存结果，
//     因此基准几何未变时二次运行不会产生二次改变。

import { enumerateCrossings, segmentsOfRoutes } from './crossings.js'

export const DEFAULT_MAX_GROWTH = 0.15
export const DEFAULT_MAX_ROUNDS = 2
export const DEFAULT_CROSS_COST = 60

const EPS = 0.01

function lengthOf(pts) {
  let total = 0
  for (let i = 1; i < pts.length; i += 1) {
    total += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1])
  }
  return total
}

function cloneRoute(r) {
  return {
    ...r,
    points: (r?.points ?? []).map((p) => [p[0], p[1]]),
  }
}

function summary(stats) {
  return {
    pairs: stats.pairs,
    count: stats.count,
    involved: [...stats.involved],
  }
}

function statsOf(routes) {
  return enumerateCrossings({ segments: segmentsOfRoutes(routes) })
}

function samePoints(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i][0] - b[i][0]) > EPS || Math.abs(a[i][1] - b[i][1]) > EPS) return false
  }
  return true
}

function clampRounds(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return DEFAULT_MAX_ROUNDS
  return Math.max(1, Math.min(2, n))
}

// 交叉事件按线路聚合权重：同一对多处相交也按事件数加权，决定先重解哪条。
function weightByLink(crossPairs) {
  const w = new Map()
  for (const p of crossPairs) {
    w.set(String(p.a), (w.get(String(p.a)) ?? 0) + (p.cross ?? 0))
    w.set(String(p.b), (w.get(String(p.b)) ?? 0) + (p.cross ?? 0))
  }
  return w
}

export function planCrossCleanup({
  routes = [],
  resolve = null,
  maxRounds = DEFAULT_MAX_ROUNDS,
  maxGrowth = DEFAULT_MAX_GROWTH,
  crossCost = DEFAULT_CROSS_COST,
  locked = null,
} = {}) {
  const initialRoutes = routes.map(cloneRoute)
  const lockedSet = new Set([...(locked ?? [])].map(String))
  const limit = clampRounds(maxRounds)
  const rounds = []
  const attempts = []
  const changed = []

  let current = initialRoutes
  let stats = statsOf(current)
  const initialStats = stats

  for (let round = 1; round <= limit; round += 1) {
    const crossPairs = stats.byPair.filter((p) => (p.cross ?? 0) > 0)
    if (!crossPairs.length) break

    const weights = weightByLink(crossPairs)
    const targets = [...weights.entries()]
      .filter(([key]) => !lockedSet.has(key))
      .sort((x, y) => y[1] - x[1] || Number(y[0]) - Number(x[0]))
    if (!targets.length) break

    const startById = new Map(current.map((r) => [String(r.linkId), r]))
    const trial = current.map(cloneRoute)
    const roundAttempts = []

    for (const [key, weight] of targets) {
      const spec = startById.get(key)
      if (!spec) continue
      const others = trial.filter((r) => String(r.linkId) !== key).map((r) => r.points)
      let next = null
      try {
        next = resolve ? resolve(spec, { lineObstacles: others, crossCost }) : null
      } catch {
        next = null
      }
      if (!Array.isArray(next) || next.length < 2) {
        roundAttempts.push({ round, linkId: spec.linkId, reason: 'no-route', crossings: weight })
        continue
      }
      if (samePoints(next, spec.points)) {
        roundAttempts.push({ round, linkId: spec.linkId, reason: 'unchanged', crossings: weight, before: lengthOf(spec.points), after: lengthOf(spec.points) })
        continue
      }
      const before = lengthOf(spec.points)
      const after = lengthOf(next)
      const idx = trial.findIndex((r) => String(r.linkId) === key)
      if (idx >= 0) {
        trial[idx] = { ...trial[idx], points: next.map((p) => [Number(p[0]), Number(p[1])]) }
      }
      roundAttempts.push({
        round,
        linkId: spec.linkId,
        reason: 'candidate',
        crossings: weight,
        before,
        after,
      })
    }

    const participating = roundAttempts.filter((a) => a.reason === 'candidate')
    if (!participating.length) {
      const reason = roundAttempts.length && roundAttempts.every((a) => a.reason === 'no-route')
        ? 'no-route'
        : 'pairs-not-decreased'
      roundAttempts.forEach((a) => {
        if (a.reason === 'candidate') a.reason = reason
      })
      attempts.push(...roundAttempts)
      rounds.push({ round, adopted: false, reason, before: stats.pairs, after: stats.pairs, growth: 0 })
      break
    }

    const beforeLen = participating.reduce((s, a) => s + a.before, 0)
    const afterLen = participating.reduce((s, a) => s + a.after, 0)
    const growth = beforeLen > EPS ? (afterLen - beforeLen) / beforeLen : 0
    const trialStats = statsOf(trial)
    const decrease = stats.pairs - trialStats.pairs

    let reason = null
    if (decrease <= 0) reason = 'pairs-not-decreased'
    else if (growth > maxGrowth + 1e-9) reason = 'length-growth'

    if (reason) {
      for (const a of participating) a.reason = reason
      attempts.push(...roundAttempts)
      rounds.push({ round, adopted: false, reason, before: stats.pairs, after: trialStats.pairs, growth })
      break
    }

    for (const a of participating) a.reason = 'adopted'
    attempts.push(...roundAttempts)
    current = trial
    stats = trialStats
    for (const a of participating) changed.push(a.linkId)
    rounds.push({
      round,
      adopted: true,
      reason: 'adopted',
      before: rounds.length ? rounds[rounds.length - 1].after : initialStats.pairs,
      after: trialStats.pairs,
      growth,
    })
  }

  const finalStats = statsOf(current)
  const initialById = new Map(initialRoutes.map((r) => [String(r.linkId), r]))
  const finalById = new Map(current.map((r) => [String(r.linkId), r]))
  let growthBefore = 0
  let growthAfter = 0
  for (const id of new Set(changed.map(String))) {
    const a = initialById.get(id)
    const b = finalById.get(id)
    if (!a || !b) continue
    growthBefore += lengthOf(a.points)
    growthAfter += lengthOf(b.points)
  }
  const totalGrowth = growthBefore > EPS ? (growthAfter - growthBefore) / growthBefore : 0
  const lastRound = rounds.length ? rounds[rounds.length - 1] : null
  const initialCross = initialStats.byPair.filter((p) => (p.cross ?? 0) > 0).length
  const discardedReason = changed.length
    ? null
    : lastRound && !lastRound.adopted
      ? lastRound.reason
      : initialCross === 0
        ? 'no-cross'
        : null

  return {
    routes: current,
    changed,
    changedAny: changed.length > 0,
    rounds,
    debug: {
      before: summary(initialStats),
      after: summary(finalStats),
      candidates: initialStats.byPair
        .filter((p) => (p.cross ?? 0) > 0)
        .map((p) => ({ a: p.a, b: p.b, cross: p.cross, count: p.count })),
      attempts,
      growth: { before: growthBefore, after: growthAfter, ratio: totalGrowth },
      adopted: [...changed],
      discardedReason,
      rounds: rounds.length,
      maxRounds: limit,
      maxGrowth,
      locked: [...lockedSet],
    },
  }
}
