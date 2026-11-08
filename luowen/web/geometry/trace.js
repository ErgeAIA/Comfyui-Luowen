/*
 * Copyright (c) 2026 Vedran Aberle Tokić
 * SPDX-License-Identifier: MIT
 *
 * Adapted from https://github.com/vtokic/comfyui-cable-management
 * (upstream file: web/pathing/trace.js). Registered in THIRD_PARTY_NOTICES.md at repo root.
 * Modifications by LuoWen: fillet radius is a caller-supplied parameter (default 10);
 * emitBezier() added for the smooth style (corner cubic Bezier, PRD §5.1 骨架曲线化).
 */
// Trace geometry helpers: emit a filleted orthogonal polyline into a Path2D, and
// arc-length math for the centre point and point-at-t (arrows, flow dots).

export const DEFAULT_RADIUS = 10
const RADIUS = DEFAULT_RADIUS

// 实际圆角半径 = min(调用方上限, 相邻两段的各三分之一)；0 表示直角。
// 0.5 下限仅对正半径生效，保留原有默认观感（上游行为）。
export function filletRadius(radius, prevLen, nextLen) {
  if (!(radius > 0)) return 0
  return Math.max(0.5, Math.min(radius, prevLen / 3, nextLen / 3))
}

export function emit(path, pts, radius = RADIUS) {
  path.moveTo(pts[0][0], pts[0][1])
  for (let k = 1; k < pts.length - 1; k++) {
    const p = pts[k - 1], c = pts[k], n = pts[k + 1]
    // Clamp to a THIRD of the adjacent segments, not half: dense bundles have
    // 12-30px segments, and half-length fillets turn the whole trace into curve --
    // it then reads as a spline instead of a routed trace.
    path.arcTo(c[0], c[1], n[0], n[1], filletRadius(radius, dist(p, c), dist(c, n)))
  }
  const last = pts[pts.length - 1]
  path.lineTo(last[0], last[1])
}

// smooth 样式的真 Bezier（PRD §5.1 骨架曲线化）：每个拐角一段贝塞尔（二次表达，
// 控制点=角点；升阶等价于三次贝塞尔），切点沿两腿各 d（d 与圆角同一钳制语义）。
// 曲线全程落在拐角三角形内，不因曲线化额外切入节点（障碍安全由构造保证）。
// 与 emit 的骨架 pts 完全一致：只换绘制表达，不改变路由/命中几何。
export function emitBezier(path, pts, radius = RADIUS) {
  path.moveTo(pts[0][0], pts[0][1])
  for (let k = 1; k < pts.length - 1; k++) {
    const p = pts[k - 1], c = pts[k], n = pts[k + 1]
    const dp = dist(p, c)
    const dn = dist(c, n)
    const d = filletRadius(radius, dp, dn)
    // 共线（无转折）或退化段：直接 lineTo，不产生曲线
    const cross = (c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0])
    if (!(d > 0) || dp === 0 || dn === 0 || Math.abs(cross) < 1e-9) {
      path.lineTo(c[0], c[1])
      continue
    }
    const t1 = [c[0] + ((p[0] - c[0]) / dp) * d, c[1] + ((p[1] - c[1]) / dp) * d]
    const t2 = [c[0] + ((n[0] - c[0]) / dn) * d, c[1] + ((n[1] - c[1]) / dn) * d]
    path.lineTo(t1[0], t1[1])
    // 控制点=角点的二次曲线（参数最少的最快等价表达；升阶后即三次贝塞尔）
    path.quadraticCurveTo(c[0], c[1], t2[0], t2[1])
  }
  const last = pts[pts.length - 1]
  path.lineTo(last[0], last[1])
}

export function measure(pts) {
  const seg = []
  let total = 0
  for (let k = 1; k < pts.length; k++) {
    const d = dist(pts[k - 1], pts[k])
    seg.push(d)
    total += d
  }
  return { seg, total }
}

// Point at fraction t of total polyline length (fillets ignored; the error is
// bounded by the fillet radius, fine for markers).
export function pointAt(pts, m, t) {
  let target = Math.max(0, Math.min(1, t)) * m.total
  for (let k = 0; k < m.seg.length; k++) {
    if (target <= m.seg[k] || k === m.seg.length - 1) {
      const f = m.seg[k] > 0 ? target / m.seg[k] : 0
      const a = pts[k], b = pts[k + 1]
      return {
        x: a[0] + (b[0] - a[0]) * f,
        y: a[1] + (b[1] - a[1]) * f,
        angle: Math.atan2(b[1] - a[1], b[0] - a[0])
      }
    }
    target -= m.seg[k]
  }
  const last = pts[pts.length - 1]
  return { x: last[0], y: last[1], angle: 0 }
}

// ---------- beam 线型（研究报告 §7 主方案）弧长工具：像素口径，与描边曲线对齐 ----------

// 把 emitBezier 的「折线+拐角二次曲线」扁平化为密集折线（拐角按曲线长约 6px 步长采样），
// 使 beam 覆盖段的弧长参数化与实际描边路径一致（deviation ≤ 采样步长/2，非扁平化时束会切角）。
// radius=0（orthogonal）或共线角退化为原折线。
export function flattenBezier(pts, radius = RADIUS) {
  if (!pts.length) return []
  const out = [[pts[0][0], pts[0][1]]]
  for (let k = 1; k < pts.length - 1; k++) {
    const p = pts[k - 1], c = pts[k], n = pts[k + 1]
    const dp = dist(p, c)
    const dn = dist(c, n)
    const d = filletRadius(radius, dp, dn)
    const cross = (c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0])
    if (!(d > 0) || dp === 0 || dn === 0 || Math.abs(cross) < 1e-9) {
      out.push([c[0], c[1]])
      continue
    }
    const t1 = [c[0] + ((p[0] - c[0]) / dp) * d, c[1] + ((p[1] - c[1]) / dp) * d]
    const t2 = [c[0] + ((n[0] - c[0]) / dn) * d, c[1] + ((n[1] - c[1]) / dn) * d]
    out.push(t1)
    // 二次贝塞尔 (t1 → c → t2)：曲线长介于弦 d 与两腰和 2d 之间，按 ~6px 目标步长采样
    const steps = Math.max(2, Math.min(16, Math.round((d * 1.5) / 6)))
    for (let i = 1; i < steps; i++) {
      const u = i / steps
      const a = 1 - u
      out.push([
        a * a * t1[0] + 2 * a * u * c[0] + u * u * t2[0],
        a * a * t1[1] + 2 * a * u * c[1] + u * u * t2[1],
      ])
    }
    out.push(t2)
  }
  const last = pts[pts.length - 1]
  out.push([last[0], last[1]])
  return out
}

// Point at arc length s (px) —— beam/粒子按像素推进用（pointAt 是分数口径，勿混用）
export function pointAtPx(pts, m, s) {
  let target = Math.max(0, Math.min(m.total, s))
  for (let k = 0; k < m.seg.length; k++) {
    if (target <= m.seg[k] || k === m.seg.length - 1) {
      const f = m.seg[k] > 0 ? target / m.seg[k] : 0
      const a = pts[k], b = pts[k + 1]
      return {
        x: a[0] + (b[0] - a[0]) * f,
        y: a[1] + (b[1] - a[1]) * f,
        angle: Math.atan2(b[1] - a[1], b[0] - a[0])
      }
    }
    target -= m.seg[k]
  }
  const last = pts[pts.length - 1]
  return { x: last[0], y: last[1], angle: 0 }
}

// 弧长区间 [s0, s1]（px，越界钳制、s1<=s0 返回空）内的子折线（两端插值）——beam 覆盖段用
export function subPolyPx(pts, m, s0, s1) {
  const a0 = Math.max(0, Math.min(m.total, s0))
  const a1 = Math.max(0, Math.min(m.total, s1))
  if (a1 <= a0) return []
  const out = []
  const A = pointAtPx(pts, m, a0)
  out.push([A.x, A.y])
  let acc = 0
  for (let k = 0; k < m.seg.length; k++) {
    const end = acc + m.seg[k]
    if (end > a0) {
      if (end <= a1) out.push([pts[k + 1][0], pts[k + 1][1]])
      else { const P = pointAtPx(pts, m, a1); out.push([P.x, P.y]); break }
    }
    acc = end
  }
  return out
}

function dist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
}
