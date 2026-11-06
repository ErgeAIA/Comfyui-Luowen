import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrunk, firstRun, chooseForkLength, decideMembership, pathLength } from '../../luowen/web/routing/trunkPlan.js';
import { route } from '../../luowen/web/geometry/router.js';

const AXIS_EPS = 1e-6;

function assertOrthogonal(pts) {
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    assert.ok(dx < AXIS_EPS || dy < AXIS_EPS, `段 ${i - 1}->${i} 非正交: ${JSON.stringify([pts[i - 1], pts[i]])}`);
  }
}

function assertAvoidsBox(pts, box) {
  const [x0, y0, x1, y1] = box;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      assert.ok(!(x > x0 + 0.5 && x < x1 - 0.5 && y > y0 + 0.5 && y < y1 - 0.5), `路径穿入障碍: (${x.toFixed(1)}, ${y.toFixed(1)})`);
    }
  }
}

test('firstRun / chooseForkLength: 共同前缀存在时取上限，且不越过最近目标', () => {
  assert.deepEqual(firstRun([[0, 100], [80, 100], [80, 40]]), { len: 80, dir: [1, 0] });
  assert.equal(firstRun([[0, 0], [10, 10]]), null); // 非正交
  const runs = [{ len: 80, dir: [1, 0] }, { len: 200, dir: [1, 0] }];
  assert.equal(chooseForkLength(runs, { min: 16, max: 72 }), 72);
  assert.equal(chooseForkLength(runs, { min: 16, max: 72, limit: 40 }), 40);
  assert.equal(chooseForkLength(runs, { min: 16, limit: 10 }), null);
  assert.equal(chooseForkLength([{ len: 10, dir: [1, 0] }], { min: 16 }), null);
  assert.equal(chooseForkLength([], { min: 16 }), null);
});

function yAtX(pts, x) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    if (Math.abs(ay - by) < 0.5 && x >= Math.min(ax, bx) - 0.5 && x <= Math.max(ax, bx) + 0.5) return ay;
  }
  return null;
}

test('planTrunk: 全部合流时共享主干呈平行 Ribbon（pitch=4），分支独立', () => {
  const pin = [0, 100];
  const routes = new Map([
    [1, [[0, 100], [100, 100], [100, 40]]],
    [2, [[0, 100], [80, 100], [80, 300], [400, 300]]],
    [3, [[0, 100], [60, 100], [60, 500], [400, 500]]],
  ]);
  const ends = new Map([[1, [100, 40]], [2, [400, 300]], [3, [400, 500]]]);
  const plan = planTrunk({
    routes,
    pin,
    solveBranch: (id, fork) => {
      const [ex, ey] = ends.get(id);
      const pts = fork[1] === ey ? [fork, [ex, ey]] : [fork, [fork[0], ey], [ex, ey]];
      return pts;
    },
  });
  assert.equal(plan.T, 72); // 最近目标投影 100-24=76，封顶 72
  assert.equal(plan.merged.size, 3);
  for (const [id, pts] of plan.paths) {
    assert.deepEqual(pts[0], pin);
    assert.deepEqual(pts[pts.length - 1], ends.get(id));
    assertOrthogonal(pts);
  }
  // 按目标法向位置排序：A(y=40) 最上、B(300) 中、C(500) 最下 → 主干段 y 间距 pitch=4
  const ys = [1, 2, 3].map((id) => yAtX(plan.paths.get(id), plan.T));
  assert.deepEqual(ys, [96, 100, 104]);
});

test('planTrunk: 分叉点不会顶进前方卡片（corridorLimit）', () => {
  const pin = [0, 100];
  const routes = new Map([
    [1, [[0, 100], [40, 100], [40, 40], [400, 40]]],
    [2, [[0, 100], [40, 100], [40, 300], [400, 300]]],
  ]);
  const plan = planTrunk({
    routes,
    pin,
    opts: { obstacles: [[80, 80, 100, 40]], stub: 24 }, // 卡片迎面挡住主干方向
    solveBranch: (id, fork) => [fork, id === 1 ? [400, 40] : [400, 300]],
  });
  assert.equal(plan.T, 50); // 80 − 24(stub) − 6(margin)
  assert.equal(plan.merged.size, 2);
});

test('planTrunk: 绕行保护踢出劣化成员（部分合并），并记录 ratio', () => {
  const pin = [0, 100];
  const routes = new Map([
    [1, [[0, 100], [100, 100], [100, 40]]],
    [2, [[0, 100], [80, 100], [80, 300], [400, 300]]],
    [9, [[0, 100], [60, 100], [60, 200], [-100, 200]]],
  ]);
  const plan = planTrunk({
    routes,
    pin,
    solveBranch: (id, fork) => {
      if (id === 9) return [fork, [fork[0], 900], [-100, 900]]; // 远路
      if (id === 1) return [fork, [fork[0], 40], [100, 40]];
      return [fork, [fork[0], 300], [400, 300]];
    },
  });
  assert.equal(plan.merged.size, 2);
  assert.ok(!plan.merged.has(9));
  assert.ok(plan.ratios.get(9) > 1.25);
});

test('decideMembership: 双阈值滞回（曾合并放宽、曾独立收紧）', () => {
  const entries = [
    { id: 'a', branch: [1], ratio: 1.3 },
    { id: 'b', branch: [1], ratio: 1.2 },
    { id: 'c', branch: [1], ratio: 1.1 },
  ];
  // 首次：join 1.25 → b(1.2)、c(1.1) 合流；a(1.3) 不合流
  assert.deepEqual([...decideMembership(entries, null)], ['b', 'c']);
  // 上一轮 a 曾合并：keep 1.35 → a 保留；b 曾独立，rejoin 1.15 → 不加入
  assert.deepEqual([...decideMembership(entries, new Set(['a']))], ['a', 'c']);
});

test('planTrunk + 真实 router: 多目标合流后仍正交、避开障碍、主干平行', () => {
  const pin = [0, 100];
  const ends = new Map([
    [1, [400, 40]],
    [2, [400, 300]],
  ]);
  const obstacle = [150, 200, 100, 60];
  const make = (start, end) =>
    route({
      start,
      end,
      startDir: 'right',
      endDir: 'left',
      obstacles: [obstacle],
      clearance: 16,
      stubStart: 24,
      stubEnd: 24,
      vPad: 8,
      flatTol: 0,
      strict: true,
    });
  // 独立基准：起点直连各目标（人工给定合法正交路径，避免依赖 router 的 trivial 语义）
  const routes = new Map([
    [1, [[0, 100], [40, 100], [40, 40], [400, 40]]],
    [2, [[0, 100], [40, 100], [40, 300], [400, 300]]],
  ]);
  const plan = planTrunk({
    routes,
    pin,
    solveBranch: (id, fork) => make(fork, ends.get(id)),
  });
  assert.equal(plan.T, 72);
  assert.equal(plan.merged.size, 2);
  for (const [id, pts] of plan.paths) {
    assert.deepEqual(pts[0], pin);
    assert.deepEqual(pts[pts.length - 1], ends.get(id));
    assertOrthogonal(pts);
    assertAvoidsBox(pts, [149.5, 199.5, 250.5, 260.5]);
  }
  // 主干是平行股道而不是零间距重叠：y 相差 pitch(4)
  assert.equal(yAtX(plan.paths.get(1), plan.T), 98);
  assert.equal(yAtX(plan.paths.get(2), plan.T), 102);
  assert.ok(pathLength(plan.paths.get(1)) > 0);
});