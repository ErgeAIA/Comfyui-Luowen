import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../../luowen/web/geometry/router.js';
import { emit, measure, pointAt } from '../../luowen/web/geometry/trace.js';
import { createRouteCache } from '../../luowen/web/routing/routeCache.js';
import { blockedCorridor } from '../fixtures/graphs.mjs';

// Path2D 桩：记录绘制指令（trace.emit 只调用 path 的方法，不依赖全局 Path2D）
class Path2DStub {
  constructor() {
    this.ops = [];
  }
  moveTo(...a) {
    this.ops.push(['moveTo', ...a]);
  }
  lineTo(...a) {
    this.ops.push(['lineTo', ...a]);
  }
  arcTo(...a) {
    this.ops.push(['arcTo', ...a]);
  }
  closePath() {
    this.ops.push(['closePath']);
  }
}

const AXIS_EPS = 1e-6;

function assertOrthogonal(pts) {
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    assert.ok(dx < AXIS_EPS || dy < AXIS_EPS, `段 ${i - 1}->${i} 非正交: ${JSON.stringify([pts[i - 1], pts[i]])}`);
  }
}

function assertAvoidsBox(pts, box) {
  // box: [x0, y0, x1, y1]（hard 框，严格内部采样）
  const [x0, y0, x1, y1] = box;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    for (let t = 0; t <= 1; t += 1 / 40) {
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const inside = x > x0 + 0.5 && x < x1 - 0.5 && y > y0 + 0.5 && y < y1 - 0.5;
      assert.ok(!inside, `路径穿入障碍内部: (${x.toFixed(1)}, ${y.toFixed(1)})`);
    }
  }
}

test('route: 无障碍的规范直连返回 null（交给调用方走直线/原生）', () => {
  const pts = route({
    start: [0, 100],
    end: [400, 100],
    startDir: 'right',
    endDir: 'left',
    obstacles: [],
    clearance: 16,
    stubStart: 24,
    stubEnd: 24,
  });
  assert.equal(pts, null);
});

test('route: 单障碍阻挡时绕行，且全程正交、不穿硬框', () => {
  const { nodes } = blockedCorridor();
  const obstacle = nodes.find((n) => n.id === 99);
  const raw = [[obstacle.pos[0], obstacle.pos[1], obstacle.size[0], obstacle.size[1]]];
  const pts = route({
    start: [0, 100],
    end: [400, 100],
    startDir: 'right',
    endDir: 'left',
    obstacles: raw,
    clearance: 16,
    stubStart: 24,
    stubEnd: 24,
    vPad: 8,
  });
  assert.ok(Array.isArray(pts) && pts.length >= 4, `应产生绕行路径，实际: ${JSON.stringify(pts)}`);
  assert.deepEqual(pts[0], [0, 100]);
  assert.deepEqual(pts[pts.length - 1], [400, 100]);
  assertOrthogonal(pts);
  const [x, y, w, h] = raw[0];
  assertAvoidsBox(pts, [x - 4, y - 4, x + w + 4, y + h + 4]);
});

test('route: 反向连接（目标在左侧）走完整搜索，不只靠直线', () => {
  const pts = route({
    start: [0, 100],
    end: [-400, 100],
    startDir: 'right',
    endDir: 'left',
    obstacles: [[-300, 40, 160, 120]],
    clearance: 16,
    stubStart: 24,
    stubEnd: 24,
    vPad: 8,
  });
  // 反向 + 障碍：应返回绕行路径或 null（预算失败），不允许无检查直穿
  if (pts) {
    assertOrthogonal(pts);
    assertAvoidsBox(pts, [-304, 36, -136, 164]);
  }
});

test('route strict: 硬障碍禁行——非严格模式会穿节点，严格模式必然绕开', () => {
  // 一堵 100px 宽的高墙横在两点之间：穿墙代价 100×8=800，绕行约 1230
  const wall = [[50, -400, 100, 1000]];
  const opts = {
    start: [0, 100],
    end: [200, 100],
    startDir: 'right',
    endDir: 'left',
    obstacles: wall,
    clearance: 16,
    stubStart: 24,
    stubEnd: 24,
    vPad: 8,
  };
  const loose = route({ ...opts });
  assert.ok(Array.isArray(loose), '非严格模式应返回路径');
  // 非严格（上游 best-effort）确实允许穿墙：默认行为保持不动
  let looseCrosses = false;
  try {
    assertAvoidsBox(loose, [46, -404, 154, 604]);
  } catch {
    looseCrosses = true;
  }
  assert.ok(looseCrosses, `非严格模式预期穿墙，实际: ${JSON.stringify(loose)}`);

  const strict = route({ ...opts, strict: true });
  assert.ok(Array.isArray(strict), '严格模式应能绕行（存在净空路径）');
  assert.deepEqual(strict[0], [0, 100]);
  assert.deepEqual(strict[strict.length - 1], [200, 100]);
  assertOrthogonal(strict);
  assertAvoidsBox(strict, [46, -404, 154, 604]);
});

test('route: 障碍包含两端节点时，中段不得从自己卡片底下穿过（strict）', () => {
  // 源引脚 (0,0) 在源卡片右边界内 9px；目标引脚 (100,300) 在目标卡片左边界内 10px
  const src = [-191, -50, 200, 100];
  const dst = [90, 250, 200, 100];
  const pts = route({
    start: [0, 0],
    end: [100, 300],
    startDir: 'right',
    endDir: 'left',
    obstacles: [src, dst],
    clearance: 16,
    stubStart: 24,
    stubEnd: 24,
    vPad: 8,
    flatTol: 0,
    strict: true,
  });
  assert.ok(Array.isArray(pts), `应能绕开两端卡片，实际: ${JSON.stringify(pts)}`);
  assertOrthogonal(pts);
  // 中段（跳过首尾引脚 stub 段）不得进入任一卡片内部
  for (let j = 1; j < pts.length - 2; j++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[j + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      for (const [x0, y0, w, h] of [src, dst]) {
        assert.ok(!(x > x0 + 1 && x < x0 + w - 1 && y > y0 + 1 && y < y0 + h - 1), `中段穿入端点卡片: (${x.toFixed(1)}, ${y.toFixed(1)})`);
      }
    }
  }
});

test('route blockRects: 仅列出的矩形禁行，其余硬框保持可穿行（8×）', () => {
  const wall = [50, -2000, 100, 4000];
  const other = [300, 500, 80, 300]; // 不挡路，仅确认非 blockRects 的框不参与禁行
  const opts = {
    start: [0, 100],
    end: [500, 100],
    startDir: 'right',
    endDir: 'left',
    obstacles: [wall, other],
    clearance: 16,
    stubStart: 24,
    stubEnd: 24,
    vPad: 8,
    flatTol: 0,
  };
  const blockedPts = route({ ...opts, blockRects: [0] });
  assert.ok(Array.isArray(blockedPts), `blockRects 应返回绕行路径，实际: ${JSON.stringify(blockedPts)}`);
  assertOrthogonal(blockedPts);
  assertAvoidsBox(blockedPts, [46, -2004, 154, 2004]);

  const loosePts = route({ ...opts });
  assert.ok(Array.isArray(loosePts), '非禁行模式应返回穿墙路径');
  let crosses = false;
  for (let i = 1; i < loosePts.length; i++) {
    const [ax, ay] = loosePts[i - 1];
    const [bx, by] = loosePts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      if (x > 50 && x < 150 && y > 0 && y < 200) crosses = true;
    }
  }
  assert.ok(crosses, `非禁行模式预期穿墙，实际: ${JSON.stringify(loosePts)}`);
});

test('routeCache: 同版本命中、版本升级失效、超限回收', () => {
  const cache = createRouteCache({ max: 2 });
  cache.set('k', 1, [[0, 0], [1, 0]]);
  assert.deepEqual(cache.get('k', 1), [[0, 0], [1, 0]]);
  assert.equal(cache.get('k', 2), null); // 版本失效
  cache.set('a', 1, [[0, 0]]);
  cache.set('b', 1, [[1, 0]]);
  cache.set('c', 1, [[2, 0]]); // 触发整体回收
  assert.ok(cache.stats().size <= 2);
});

test('trace.emit: 折线转圆角路径（moveTo + arcTo + lineTo），measure/pointAt 取中点', () => {
  const path = new Path2DStub();
  const pts = [
    [0, 0],
    [100, 0],
    [100, 100],
  ];
  emit(path, pts);
  const kinds = path.ops.map((o) => o[0]);
  assert.ok(kinds.includes('moveTo'));
  assert.ok(kinds.includes('arcTo'));
  assert.ok(kinds.includes('lineTo'));

  const m = measure(pts);
  assert.equal(m.total, 200);
  const mid = pointAt(pts, m, 0.5);
  assert.ok(Math.abs(mid.x - 100) < 1e-6 && Math.abs(mid.y - 0) < 1e-6);
});