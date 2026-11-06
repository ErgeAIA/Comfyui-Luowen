import test from 'node:test';
import assert from 'node:assert/strict';
import { planCrossCleanup } from '../../luowen/web/routing/crossCleanup.js';

function routeSpec(linkId, points, groupId = null, extra = {}) {
  return { linkId, groupId, points, startPin: null, endPin: null, ...extra };
}

// 基准布局：link1 竖线 x=0，y 40..60；link2 横线 y=50，x -100..100 —— 一处垂直内点交叉。
// 可选重解：向上绕到 y=39，总长 222（基准 200，+11%，在 15% 内）。
const CROSS_A = () => routeSpec(1, [[0, 40], [0, 60]], null, { startPin: '1:0:out', endPin: '9:0:in' });
const CROSS_B = () => routeSpec(2, [[-100, 50], [100, 50]], null, { startPin: '2:0:out', endPin: '9:1:in' });
const CHEAP_DETOUR = () => [[-100, 50], [-100, 39], [100, 39], [100, 50]];
const EXPENSIVE_DETOUR = () => [[-100, 50], [-100, -50], [100, -50], [100, 50]];

function fixedResolve(detourFor = 2, detour = CHEAP_DETOUR) {
  return (spec) => (String(spec.linkId) === String(detourFor) ? detour() : spec.points.map((p) => [p[0], p[1]]));
}

test('crossCleanup: 交叉对下降且总长增幅 ≤15% 时采纳', () => {
  const r = planCrossCleanup({ routes: [CROSS_A(), CROSS_B()], resolve: fixedResolve() });
  assert.deepEqual(r.changed, [2]);
  assert.equal(r.changedAny, true);
  assert.equal(r.debug.before.pairs, 1);
  assert.equal(r.debug.after.pairs, 0);
  assert.equal(r.debug.rounds, 1);
  assert.equal(r.debug.attempts.find((a) => a.linkId === 2).reason, 'adopted');
  assert.ok(Math.abs(r.debug.growth.ratio - 0.11) < 0.001, `growth=${r.debug.growth.ratio}`);
  const b = r.routes.find((x) => x.linkId === 2);
  assert.deepEqual(b.points, CHEAP_DETOUR());
});

test('crossCleanup: 总长增幅 >15% 时整轮丢弃，返回基准几何', () => {
  const r = planCrossCleanup({ routes: [CROSS_A(), CROSS_B()], resolve: fixedResolve(2, EXPENSIVE_DETOUR) });
  assert.deepEqual(r.changed, []);
  assert.equal(r.changedAny, false);
  assert.equal(r.debug.after.pairs, 1);
  assert.equal(r.debug.discardedReason, 'length-growth');
  assert.deepEqual(r.routes.find((x) => x.linkId === 2).points, CROSS_B().points);
});

test('crossCleanup: 重解后交叉对未下降则丢弃', () => {
  const identity = (spec) => spec.points.map((p) => [p[0], p[1]]);
  const r = planCrossCleanup({ routes: [CROSS_A(), CROSS_B()], resolve: identity });
  assert.deepEqual(r.changed, []);
  assert.equal(r.debug.after.pairs, 1);
  assert.equal(r.debug.discardedReason, 'pairs-not-decreased');
});

test('crossCleanup: resolve 返回 null 视为 no-route，不改画面', () => {
  const r = planCrossCleanup({ routes: [CROSS_A(), CROSS_B()], resolve: () => null });
  assert.deepEqual(r.changed, []);
  assert.equal(r.debug.attempts.every((a) => a.reason === 'no-route'), true);
  assert.equal(r.debug.after.pairs, 1);
});

test('crossCleanup: 同一输入重复调用结果完全一致（确定性）', () => {
  const a = planCrossCleanup({ routes: [CROSS_A(), CROSS_B()], resolve: fixedResolve() });
  const b = planCrossCleanup({ routes: [CROSS_A(), CROSS_B()], resolve: fixedResolve() });
  assert.deepEqual(a.routes, b.routes);
  assert.deepEqual(a.debug.after, b.debug.after);
  assert.deepEqual(a.changed, b.changed);
});

test('crossCleanup: 清理后第二轮无操作（幂等）', () => {
  const first = planCrossCleanup({ routes: [CROSS_A(), CROSS_B()], resolve: fixedResolve() });
  const second = planCrossCleanup({ routes: first.routes, resolve: fixedResolve() });
  assert.deepEqual(second.changed, []);
  assert.equal(second.debug.before.pairs, 0);
  assert.equal(second.debug.discardedReason, 'no-cross');
  assert.deepEqual(second.routes, first.routes);
});

test('crossCleanup: 锁定线路不重解，但仍参与交叉计数', () => {
  const r = planCrossCleanup({
    routes: [CROSS_A(), CROSS_B()],
    resolve: fixedResolve(),
    locked: [2],
  });
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.debug.locked, ['2']);
  assert.equal(r.debug.before.pairs, 1);
  assert.equal(r.debug.after.pairs, 1);
});

test('crossCleanup: 只处理 cross 对；纯共线重叠对不进候选', () => {
  const r = planCrossCleanup({
    routes: [
      routeSpec(1, [[0, 0], [100, 0]]),
      routeSpec(2, [[50, 0], [150, 0]]),
    ],
    resolve: (spec) => spec.points,
  });
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.debug.candidates, []);
  assert.equal(r.debug.before.pairs, 1);
  assert.equal(r.debug.discardedReason, 'no-cross');
});

test('crossCleanup: 同组共线重叠豁免后不作为候选', () => {
  const r = planCrossCleanup({
    routes: [
      routeSpec(1, [[0, 0], [100, 0]], 'g1'),
      routeSpec(2, [[50, 0], [150, 0]], 'g1'),
    ],
    resolve: (spec) => spec.points,
  });
  assert.equal(r.debug.before.pairs, 0);
  assert.deepEqual(r.debug.candidates, []);
});

test('crossCleanup: 轮数上限钳制在 1..2，且单轮采纳后第二轮无交叉即停止', () => {
  const r = planCrossCleanup({
    routes: [CROSS_A(), CROSS_B()],
    resolve: fixedResolve(),
    maxRounds: 9,
  });
  assert.ok(r.debug.rounds <= 2);
  assert.ok(r.debug.maxRounds <= 2);
  assert.equal(r.debug.rounds, 1);
});

test('crossCleanup: 空输入/无 resolve 时不报错且无操作', () => {
  const empty = planCrossCleanup({ routes: [], resolve: null });
  assert.deepEqual(empty.changed, []);
  assert.equal(empty.debug.after.pairs, 0);
  const none = planCrossCleanup({ routes: [CROSS_A(), CROSS_B()], resolve: null });
  assert.deepEqual(none.changed, []);
  assert.equal(none.debug.discardedReason, 'no-route');
});
