import test from 'node:test';
import assert from 'node:assert/strict';
import { emit, emitBezier, filletRadius } from '../../luowen/web/geometry/trace.js';

// Path2D 桩：记录绘制指令（emit/emitBezier 只调 path 方法，不依赖全局 Path2D）
class Path2DStub {
  constructor() { this.ops = []; }
  moveTo(...a) { this.ops.push(['moveTo', ...a]); }
  lineTo(...a) { this.ops.push(['lineTo', ...a]); }
  arcTo(...a) { this.ops.push(['arcTo', ...a]); }
  bezierCurveTo(...a) { this.ops.push(['bezierCurveTo', ...a]); }
  quadraticCurveTo(...a) { this.ops.push(['quadraticCurveTo', ...a]); }
}

const L = (path, kind) => path.ops.filter((o) => o[0] === kind);

// 二次贝塞尔采样
function sampleQuadratic(p0, c, p2, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]]);
  }
  return pts;
}

// 三次贝塞尔采样（de Casteljau）
function sampleCubic(p0, c1, c2, p3, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
}

// 点到正交折线骨架的最近距离
function distToSkeleton(pt, pts) {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2)) : 0;
    const px = a[0] + dx * t, py = a[1] + dy * t;
    best = Math.min(best, Math.hypot(pt[0] - px, pt[1] - py));
  }
  return best;
}

test('emitBezier: 端点钉死，拐角为 lineTo(切点)→quadraticCurveTo→lineTo 交替', () => {
  const pts = [[0, 0], [100, 0], [100, 100]];
  const path = new Path2DStub();
  emitBezier(path, pts, 24);
  assert.deepEqual(path.ops[0], ['moveTo', 0, 0]);
  const last = path.ops[path.ops.length - 1];
  assert.equal(last[0], 'lineTo');
  assert.equal(last[1], 100);
  assert.equal(last[2], 100);
  const bez = L(path, 'quadraticCurveTo');
  assert.equal(bez.length, 1, '一个拐角一段贝塞尔（二次表达，升阶即三次）');
  // 切点：角点 (100,0) 沿两腿各 d；相邻段 100/3 → d = min(24, 33.33, 33.33) = 24
  assert.deepEqual(bez[0].slice(3), [100, 24], '曲线终点切点 = 角点沿出腿 24');
  assert.deepEqual(bez[0].slice(1, 3), [100, 0], '控制点 = 角点');
  const pre = L(path, 'lineTo');
  assert.deepEqual(pre[0].slice(1), [76, 0], '入腿切点 = 角点沿入腿 24');
});

test('emitBezier: 控制点钉在两腿上（升阶等价，切点→角点 2/3 处）→ 曲线在拐角三角形内', () => {
  const pts = [[0, 0], [100, 0], [100, 100]];
  const path = new Path2DStub();
  emitBezier(path, pts, 24);
  const bez = L(path, 'quadraticCurveTo')[0];
  assert.deepEqual(bez.slice(1, 3), [100, 0], '控制点钉在角点（在两腿延长交点上）');
  const t1 = L(path, 'lineTo').map((o) => [o[1], o[2]]);
  assert.deepEqual(t1[0], [76, 0], '入腿切点');
});

test('emitBezier: 采样偏差上界 ≤0.26·d（90° 拐角理论 0.25d）→ hover 容差 8px 不需放宽', () => {
  const pts = [[0, 0], [200, 0], [200, 200]];
  const path = new Path2DStub();
  emitBezier(path, pts, 24);
  const bez = L(path, 'quadraticCurveTo')[0];
  const samples = sampleQuadratic([176, 0], [bez[1], bez[2]], [200, 24]);
  let worst = 0;
  for (const s of samples) worst = Math.max(worst, distToSkeleton(s, pts));
  assert.ok(worst <= 0.26 * 24 + 1e-9, `最坏偏差 ${worst.toFixed(3)} ≤ 6.24`);
});

test('emitBezier: r=0 全 lineTo（直角），无 bezier 段；短段钳制与 filletRadius 同语义', () => {
  const pts = [[0, 0], [30, 0], [30, 200]];
  const path0 = new Path2DStub();
  emitBezier(path0, pts, 0);
  assert.equal(L(path0, 'quadraticCurveTo').length, 0);
  assert.equal(L(path0, 'lineTo').length, 2);
  const path1 = new Path2DStub();
  emitBezier(path1, pts, 24);
  const bez = L(path1, 'quadraticCurveTo')[0];
  // d = filletRadius(24, 30, 200) = 10（短段 1/3）
  assert.deepEqual(bez.slice(3), [30, 10], '切距被短段钳到 10');
  assert.equal(filletRadius(24, 30, 200), 10);
});

test('emitBezier: Z 形双拐各一段；共线中间点退化 lineTo', () => {
  const z = [[0, 0], [100, 0], [100, 80], [220, 80]];
  const path = new Path2DStub();
  emitBezier(path, z, 24);
  assert.equal(L(path, 'quadraticCurveTo').length, 2, '两个拐角两段');
  const straight = [[0, 0], [50, 0], [100, 0], [200, 0]];
  const ps = new Path2DStub();
  emitBezier(ps, straight, 24);
  assert.equal(L(ps, 'bezierCurveTo').length, 0, '共线点不产生曲线段');
  assert.equal(L(ps, 'lineTo').length, 3, '两个共线内点 + 终点各一次 lineTo');
});

test('emitBezier 与 emit 骨架一致：同为 moveTo(pts0) 起、lineTo(last) 终', () => {
  const pts = [[0, 0], [90, 0], [90, 70], [210, 70]];
  const a = new Path2DStub(), b = new Path2DStub();
  emit(a, pts, 10);
  emitBezier(b, pts, 10);
  assert.deepEqual(a.ops[0], b.ops[0]);
  const la = a.ops[a.ops.length - 1], lb = b.ops[b.ops.length - 1];
  assert.deepEqual(la, lb);
});
