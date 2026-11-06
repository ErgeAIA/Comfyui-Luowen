import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPath } from '../../luowen/web/geometry/preview.js';

const AXIS_EPS = 1e-6;

function assertOrthogonal(pts) {
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    assert.ok(dx < AXIS_EPS || dy < AXIS_EPS, `段 ${i - 1}->${i} 非正交: ${JSON.stringify([pts[i - 1], pts[i]])}`);
  }
}

test('previewPath: 各方向组合均正交、起止点精确、端点段沿引脚方向', () => {
  const cases = [
    [0, 100, 400, 100, 'right', 'left'],
    [0, 100, 400, 260, 'right', 'left'],
    [0, 100, 400, -80, 'right', 'left'],
    [400, 100, 0, 260, 'left', 'right'], // 反向
    [200, 300, 500, 100, 'up', 'down'],
    [200, 300, 500, 100, 'up', 'left'], // 混合方向
    [200, 300, 500, 100, 'right', 'up'],
  ];
  for (const [ax, ay, bx, by, sd, ed] of cases) {
    const pts = previewPath(ax, ay, bx, by, sd, ed, 24, 24);
    assert.deepEqual(pts[0], [ax, ay], `起点 ${sd}->${ed}`);
    assert.deepEqual(pts[pts.length - 1], [bx, by], `终点 ${sd}->${ed}`);
    assertOrthogonal(pts);
    assert.ok(pts.length >= 2);
  }
});

test('previewPath: 共线直连不产生多余拐点', () => {
  const pts = previewPath(0, 100, 400, 100, 'right', 'left');
  assert.deepEqual(pts, [[0, 100], [400, 100]]);
});

test('previewPath: 起点段方向与 startDir 一致（右出/左出/上出/下出）', () => {
  const from = [100, 100];
  const cases = [
    ['right', 1, 0, [500, 300]],
    ['left', -1, 0, [-300, 300]],
    ['up', 0, -1, [300, -200]],
    ['down', 0, 1, [300, 500]],
  ];
  for (const [dir, dx, dy, to] of cases) {
    const pts = previewPath(from[0], from[1], to[0], to[1], dir, 'left', 24, 24);
    const ddx = Math.sign(pts[1][0] - pts[0][0]);
    const ddy = Math.sign(pts[1][1] - pts[0][1]);
    assert.equal(ddx, dx, `${dir} 起点段 x 方向`);
    assert.equal(ddy, dy, `${dir} 起点段 y 方向`);
  }
});