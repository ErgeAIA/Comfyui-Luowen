import test from 'node:test';
import assert from 'node:assert/strict';
import { planTrunk, firstRun, chooseForkLength, decideMembership, pathLength, classifyHover } from '../../luowen/web/routing/trunkPlan.js';
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
  assert.equal(chooseForkLength(runs, { min: 16, max: 72 }), 72); // 显式 max 仍作额外上限（对照用）
  assert.equal(chooseForkLength(runs, { min: 16, limit: 76 }), 76); // DEC-012：不再套 72 上限
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

test('planTrunk: 全部合流时共用单条主干，分叉后才分支', () => {
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
  assert.equal(plan.T, 76); // 最近目标投影 100−24=76（DEC-012：合法最晚分叉，不再封顶 72）
  assert.equal(plan.merged.size, 3);
  for (const [id, pts] of plan.paths) {
    assert.deepEqual(pts[0], pin);
    assert.deepEqual(pts[pts.length - 1], ends.get(id));
    assertOrthogonal(pts);
  }
  // 主干段共用同一几何：三条路径在 fork 处同一点，端口只出一条线，不存在并排股道
  assert.deepEqual(plan.fork, [76, 100]);
  const ys = [1, 2, 3].map((id) => yAtX(plan.paths.get(id), plan.T));
  assert.deepEqual(ys, [100, 100, 100]);
  for (const pts of plan.paths.values()) assert.deepEqual(pts.slice(0, 2), [[0, 100], [76, 100]]);
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

test('planTrunk + 真实 router: 多目标合流后仍正交、避开障碍、主干共用几何', () => {
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
  assert.equal(plan.T, 376); // 最近目标投影 400−24（DEC-012：无 72 上限，走廊无阻挡）
  assert.equal(plan.merged.size, 2);
  for (const [id, pts] of plan.paths) {
    assert.deepEqual(pts[0], pin);
    assert.deepEqual(pts[pts.length - 1], ends.get(id));
    assertOrthogonal(pts);
    assertAvoidsBox(pts, [149.5, 199.5, 250.5, 260.5]);
  }
  // 主干是共用几何：两条路径在 fork 处同一点（不是 pitch 4 的并排股）
  assert.deepEqual(plan.fork, [376, 100]);
  assert.equal(yAtX(plan.paths.get(1), plan.T), 100);
  assert.equal(yAtX(plan.paths.get(2), plan.T), 100);
  assert.ok(pathLength(plan.paths.get(1)) > 0);
});

test('planTrunk: 同列目标分叉后仍共用竖直走廊，只出一条线（远端源，DEC-010）', () => {
  // 复现实测：源在左远处，两个目标左对齐（同一 x=180），分叉后仍需走同一段竖直走廊。
  // 分支从同一 fork 起步、起点 stub 同为 24，几何公共前缀应一路合并到真正分歧的高度。
  const pin = [-669, 914];
  const routes = new Map([
    [79, [[-669, 914], [-573, 914], [-573, 304], [180, 304]]],
    [81, [[-669, 914], [-568, 914], [-568, 534], [180, 534]]],
  ]);
  const ends = new Map([[79, [180, 304]], [81, [180, 534]]]);
  const plan = planTrunk({
    routes,
    pin,
    solveBranch: (id, fork) => {
      const ey = ends.get(id)[1];
      return [fork, [fork[0] + 24, fork[1]], [fork[0] + 24, ey], [180, ey]];
    },
  });
  assert.equal(plan.T, 825); // 最近目标投影 849 − stub 24（DEC-012：合法最晚分叉，无 72 上限）
  assert.equal(plan.merged.size, 2);
  assert.deepEqual(plan.fork, [156, 914]); // 端口只出一条线，分叉点在主干末端
  for (const [id, pts] of plan.paths) {
    assert.deepEqual(pts[0], pin);
    assert.deepEqual(pts[pts.length - 1], ends.get(id));
    assertOrthogonal(pts);
    // 不含 x=-568 之类的并行竖线：竖直走廊唯一
    assert.ok(!pts.some(([x]) => Math.abs(x + 568) < 0.5), `路径 ${id} 出现并行竖线 x=-568`);
  }
  // 两条路径的竖直段共用同一 x（fork 与 x=180 共线，simplify 后只保留 x=180 拐点）
  assert.deepEqual(plan.paths.get(79), [[-669, 914], [180, 914], [180, 304]]);
  assert.deepEqual(plan.paths.get(81), [[-669, 914], [180, 914], [180, 534]]);
});

test('planTrunk: router 返回 null 的直连成员用共线直线分支补齐，仍参与合流', () => {
  const pin = [0, 100];
  const routes = new Map([
    [1, [[0, 100], [200, 100]]], // 直连目标：router 对 canonical 直连返回 null
    [2, [[0, 100], [80, 100], [80, 300], [400, 300]]],
  ]);
  const plan = planTrunk({
    routes,
    pin,
    solveBranch: (id, fork) => (id === 2 ? [fork, [fork[0], 300], [400, 300]] : null),
  });
  assert.equal(plan.merged.size, 2);
  // 直连成员与主干共线：路径折叠成 pin → 目标，不额外绕行
  assert.deepEqual(plan.paths.get(1), [[0, 100], [200, 100]]);
  assert.equal(plan.ratios.get(1), 1);
});

test('classifyHover: 主干中点 → 整组；分叉后 → 仅该分支', () => {
  const routes = new Map([
    [1, [[0, 100], [80, 100], [80, 40]]],
    [2, [[0, 100], [80, 100], [80, 160]]],
  ]);
  const trunks = new Map(routes);

  // 共享前缀中点：整组（成员 1、2），groupPts 为共享前缀
  assert.deepEqual(classifyHover(routes, trunks, [40, 100], 8), {
    linkId: 1,
    part: 'trunk',
    memberIds: [1, 2],
    groupPts: [[0, 100], [80, 100]],
    distance: 0,
  });
  // 分叉点本身仍在共享段（弧长 80 ≤ 80）
  assert.equal(classifyHover(routes, trunks, [80, 100], 8).part, 'trunk');
  // 分叉后（弧长 85）只高亮该分支
  assert.deepEqual(classifyHover(routes, trunks, [80, 95], 8), {
    linkId: 1,
    part: 'branch',
    memberIds: [1],
    groupPts: null,
    distance: 0,
  });
  assert.equal(classifyHover(routes, trunks, [80, 140], 8).linkId, 2);
  assert.equal(classifyHover(routes, trunks, [80, 140], 8).part, 'branch');
});

test('classifyHover: 无 trunk → 单例；超出阈值 → null；多组按同引脚分组', () => {
  assert.equal(classifyHover(new Map(), new Map(), [0, 0], 8), null);
  assert.equal(classifyHover(new Map([[5, [[200, 0], [260, 0]]]]), new Map(), [230, 0], 8).part, 'branch');
  assert.deepEqual(classifyHover(new Map([[5, [[200, 0], [260, 0]]]]), new Map(), [230, 0], 8).memberIds, [5]);
  // 阈值外
  assert.equal(classifyHover(new Map([[5, [[200, 0], [260, 0]]]]), new Map(), [230, 9], 8), null);

  // 两个独立组：组身份按路径首点（同一输出引脚）划分，不串组
  const routes = new Map([
    [1, [[0, 100], [80, 100], [80, 40]]],
    [2, [[0, 100], [80, 100], [80, 160]]],
    [3, [[0, 300], [80, 300], [80, 240]]],
    [4, [[0, 300], [80, 300], [80, 360]]],
  ]);
  const trunks = new Map(routes);
  assert.deepEqual(classifyHover(routes, trunks, [40, 100], 8).memberIds, [1, 2]);
  assert.deepEqual(classifyHover(routes, trunks, [40, 300], 8).memberIds, [3, 4]);

  // 主干只剩单成员（拓扑刚变化）：按单条处理，不冒充整组
  const lone = new Map([[1, [[0, 100], [80, 100], [80, 40]]], [2, [[200, 0], [260, 0]]]]);
  const loneTrunks = new Map([[1, [[0, 100], [80, 100], [80, 40]]]]);
  assert.equal(classifyHover(lone, loneTrunks, [40, 100], 8).part, 'branch');
  assert.deepEqual(classifyHover(lone, loneTrunks, [40, 100], 8).memberIds, [1]);
});