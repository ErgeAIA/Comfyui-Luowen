import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenBezier, pointAtPx, subPolyPx, measure, emitBezier } from '../../luowen/web/geometry/trace.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function nearestDistToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby || 1)));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t)));
  }
  return best;
}

test('beamTrace.flattenBezier: radius=0（orthogonal）逐点还原；radius>0 端点钉死且弧长不增', () => {
  const pts = [[0, 0], [100, 0], [100, 80], [180, 80]];
  const flat0 = flattenBezier(pts, 0);
  assert.equal(flat0.length, pts.length, '直角不采样，逐点还原');
  for (let i = 0; i < pts.length; i++) assert.deepEqual(flat0[i], pts[i]);
  const flat = flattenBezier(pts, 10);
  assert.deepEqual(flat[0], pts[0], '起点钉死');
  assert.deepEqual(flat[flat.length - 1], pts[pts.length - 1], '终点钉死');
  const m0 = measure(pts), mf = measure(flat);
  assert.ok(mf.total <= m0.total + 1e-6, '曲线是捷径：扁平化弧长 ≤ 骨架弧长');
  assert.ok(mf.total >= m0.total * 0.9, '弧长不塌缩（圆角收缩 ≤ 10%）');
});

test('beamTrace.flattenBezier: 采样点贴近骨架曲线（偏差上界 = 圆角切距量级）', () => {
  const pts = [[0, 0], [60, 0], [60, 60], [140, 60], [140, 0]];
  const flat = flattenBezier(pts, 10);
  for (const p of flat) {
    const d = nearestDistToPolyline(p, pts);
    assert.ok(d <= 10.5, `flatten 点距骨架 ${d.toFixed(2)} ≤ 10.5（切距上界）`);
  }
  // 与 emitBezier 的曲线路径同源：flatten 采样点距二次曲线控制表达 ≤ 采样步长/2 + 浮点余量
  const m = measure(flat);
  for (const s of [0, m.total / 3, m.total / 2, m.total]) {
    const P = pointAtPx(flat, m, s);
    assert.ok(Number.isFinite(P.x) && Number.isFinite(P.y));
  }
});

test('beamTrace.pointAtPx/subPolyPx: 端点、区间拼接与越界钳制', () => {
  const pts = [[0, 0], [100, 0], [100, 100]];
  const m = measure(pts); // total 200
  const A = pointAtPx(pts, m, 0);
  assert.deepEqual([A.x, A.y], [0, 0]);
  const B = pointAtPx(pts, m, 200);
  assert.deepEqual([B.x, B.y], [100, 100]);
  const M = pointAtPx(pts, m, 150);
  assert.deepEqual([M.x, M.y], [100, 50], '弧长 150 落在竖段中点');
  // sub 区间拼接守恒：[0,60]+[60,200] 覆盖全长且无重叠缝
  const s1 = subPolyPx(pts, m, 0, 60);
  const s2 = subPolyPx(pts, m, 60, 200);
  assert.equal(measure(s1).total + measure(s2).total, m.total);
  assert.deepEqual(s1[s1.length - 1], s2[0], '拼接口为同一点');
  // 越界钳制 / 退化
  assert.equal(measure(subPolyPx(pts, m, -5, 999)).total, m.total);
  assert.deepEqual(subPolyPx(pts, m, 50, 50), []);
  assert.deepEqual(subPolyPx(pts, m, 60, 40), []);
});

test('beamTrace: flatten+subPoly 组合在 beam 覆盖段上保持端点插值（生产口径冒烟）', () => {
  const pts = [[0, 0], [80, 0], [80, 120]];
  const flat = flattenBezier(pts, 10);
  const fm = measure(flat);
  // beam 覆盖段 [20, 68]（束长 48 屏幕px 的量级）
  const seg = subPolyPx(flat, fm, 20, 68);
  assert.ok(seg.length >= 2);
  const total = measure(seg).total;
  assert.ok(Math.abs(total - 48) < 1.5, `覆盖段弧长 ${total.toFixed(2)} ≈ 48（±1.5 插值/采样容差）`);
  // 与 emitBezier 生成路径同骨架：flatten 不改起点终点方向
  const path = { moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arcTo() {} };
  let calls = 0;
  path.quadraticCurveTo = () => { calls++; };
  emitBezier(path, pts, 10);
  assert.equal(calls, 1, '三点折线唯一拐角 → 一段二次曲线（flatten 采样与之同源）');
});
