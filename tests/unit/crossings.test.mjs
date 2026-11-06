import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateCrossings, crossingsOnSegment, segmentsOfRoutes } from '../../luowen/web/routing/crossings.js';
import { route } from '../../luowen/web/geometry/router.js';

function seg(linkId, groupId, a, b, extra = {}) {
  return { linkId, groupId, a, b, ...extra };
}

function zeroIgnored() {
  return { sameLink: 0, sameGroup: 0, sharedPin: 0, touch: 0 };
}

// ---------- 一、垂直相交 ----------

test('crossings: 垂直相交（两段内点）计入交叉对', () => {
  const r = enumerateCrossings({
    segments: [seg(1, null, [200, 0], [200, 200]), seg(2, null, [0, 100], [400, 100])],
  });
  assert.equal(r.pairs, 1);
  assert.equal(r.count, 1);
  assert.deepEqual(r.involved, [1, 2]);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'cross');
  assert.equal(r.events[0].counted, true);
  assert.deepEqual(r.events[0].at, [200, 100]);
  assert.deepEqual(r.byPair[0], { a: 1, b: 2, count: 1, cross: 1, overlap: 0, length: 0 });
  assert.deepEqual(r.ignored, zeroIgnored());
});

test('crossings: 同一线路对多处相交 —— 事件计数 2、交叉对 1', () => {
  const r = enumerateCrossings({
    segments: [
      seg(1, null, [100, 0], [100, 200]),
      seg(1, null, [200, 0], [200, 200]),
      seg(2, null, [0, 100], [300, 100]),
    ],
  });
  assert.equal(r.count, 2);
  assert.equal(r.pairs, 1);
  assert.equal(r.byPair[0].count, 2);
  assert.deepEqual(r.involved, [1, 2]);
});

// ---------- 二、相切 ----------

test('crossings: 共线相切（仅端点接触、重叠长 0）不计入', () => {
  const r = enumerateCrossings({
    segments: [seg(1, null, [0, 50], [100, 50]), seg(2, null, [100, 50], [200, 50])],
  });
  assert.equal(r.pairs, 0);
  assert.equal(r.count, 0);
  assert.equal(r.events[0].type, 'touch');
  assert.deepEqual(r.events[0].at, [100, 50]);
  assert.equal(r.ignored.touch, 1);
});

// ---------- 三、端点接触 ----------

test('crossings: 垂直但交点在端点 —— 归为端点接触，不计入', () => {
  const both = enumerateCrossings({
    segments: [seg(1, null, [0, 100], [300, 100]), seg(2, null, [300, 100], [300, 400])],
  });
  assert.equal(both.events[0].type, 'touch');
  assert.deepEqual(both.events[0].at, [300, 100]);
  assert.equal(both.pairs, 0);

  // 竖线穿过横线的端点（竖线端点、横线内点）：仍是端点接触
  const oneSided = enumerateCrossings({
    segments: [seg(1, null, [0, 100], [300, 100]), seg(2, null, [100, 100], [100, 400])],
  });
  assert.equal(oneSided.events[0].type, 'touch');
  assert.equal(oneSided.pairs, 0);
  assert.equal(oneSided.ignored.touch, 1);
});

// ---------- 四、共线重叠 ----------

test('crossings: 不同组共线重叠计入，长度按重叠段计', () => {
  const r = enumerateCrossings({
    segments: [seg(1, 'g1', [0, 50], [150, 50]), seg(2, 'g2', [100, 50], [250, 50])],
  });
  assert.equal(r.pairs, 1);
  assert.equal(r.count, 1);
  assert.equal(r.events[0].type, 'overlap');
  assert.equal(r.events[0].length, 50);
  assert.deepEqual(r.events[0].at, [125, 50]);
  assert.equal(r.byPair[0].overlap, 1);
  assert.equal(r.byPair[0].length, 50);
});

// ---------- 五、平行不交 ----------

test('crossings: 平行且不共线 —— 无事件', () => {
  const r = enumerateCrossings({
    segments: [seg(1, null, [0, 50], [100, 50]), seg(2, null, [0, 100], [100, 100])],
  });
  assert.equal(r.events.length, 0);
  assert.equal(r.pairs, 0);
  assert.deepEqual(r.ignored, zeroIgnored());
});

// ---------- 六、同组豁免边界 ----------

test('crossings: 同组共线重叠豁免（共享走廊按设计预期）', () => {
  const r = enumerateCrossings({
    segments: [seg(1, 'g', [0, 50], [150, 50]), seg(2, 'g', [100, 50], [250, 50])],
  });
  assert.equal(r.pairs, 0);
  assert.equal(r.count, 0);
  assert.equal(r.events[0].counted, false);
  assert.equal(r.events[0].reason, 'same-group');
  assert.equal(r.ignored.sameGroup, 1);
});

test('crossings: 同组垂直穿插仍计入（线束内真交叉）', () => {
  const r = enumerateCrossings({
    segments: [seg(1, 'g', [200, 0], [200, 200]), seg(2, 'g', [0, 100], [400, 100])],
  });
  assert.equal(r.pairs, 1);
  assert.equal(r.events[0].type, 'cross');
});

// ---------- 七、共享引脚 / 同一线路 ----------

test('crossings: 同一引脚出发的重叠段豁免（共享引脚）', () => {
  const r = enumerateCrossings({
    segments: [
      seg(1, null, [0, 100], [100, 100], { aPin: '1:0' }),
      seg(2, null, [0, 100], [80, 100], { aPin: '1:0' }),
    ],
  });
  assert.equal(r.pairs, 0);
  assert.equal(r.events[0].counted, false);
  assert.equal(r.events[0].reason, 'shared-pin');
  assert.equal(r.ignored.sharedPin, 1);

  // 引脚不同（仅坐标相同）不算共享引脚
  const diff = enumerateCrossings({
    segments: [
      seg(1, null, [0, 100], [100, 100], { aPin: '1:0' }),
      seg(2, null, [0, 100], [80, 100], { aPin: '2:0' }),
    ],
  });
  assert.equal(diff.pairs, 1);
});

test('crossings: 同一线路的相邻段不计（角点不是交叉）', () => {
  const r = enumerateCrossings({
    segments: [seg(1, null, [100, 0], [100, 200]), seg(1, null, [0, 100], [200, 100])],
  });
  assert.equal(r.events.length, 0);
  assert.equal(r.ignored.sameLink, 1);
});

test('crossings: segmentsOfRoutes 只给首段起点与末段终点挂引脚', () => {
  const segs = segmentsOfRoutes([
    { linkId: 7, groupId: 'g', points: [[0, 0], [100, 0], [100, 100]], startPin: '1:0', endPin: '2:1' },
  ]);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].aPin, '1:0');
  assert.equal(segs[0].bPin, null);
  assert.equal(segs[1].aPin, null);
  assert.equal(segs[1].bPin, '2:1');
});

// ---------- 八、单段查询（router 成本用） ----------

test('crossingsOnSegment: 只计垂直内点交叉，端点接触与共线重叠不计', () => {
  const lines = [
    { a: [200, 0], b: [200, 200] }, // 内点交叉
    { a: [100, 100], b: [100, 400] }, // 端点接触
    { a: [0, 100], b: [120, 100] }, // 共线重叠
  ];
  assert.equal(crossingsOnSegment([0, 100], [300, 100], lines), 1);
  assert.equal(crossingsOnSegment([0, 100], [300, 100], []), 0);
  assert.equal(crossingsOnSegment([0, 500], [300, 500], lines), 0);
});

// ---------- 九、router 可选成本：默认关闭零变化 ----------

test('router: lineObstacles/crossCost 默认关闭时输出逐点不变', () => {
  const args = {
    start: [0, 100],
    end: [600, 100],
    obstacles: [[150, 40, 100, 120]],
    clearance: 16,
    stubStart: 24,
    stubEnd: 24,
  };
  const base = route(args);
  assert.ok(Array.isArray(base) && base.length > 2, '基线应走 A* 绕障');

  const lines = [[[300, 0], [300, 400]], [[150, 220], [450, 220]]];
  assert.deepEqual(route({ ...args, lineObstacles: lines, crossCost: 0 }), base);
  assert.deepEqual(route({ ...args, crossCost: 40 }), base);
  assert.deepEqual(route({ ...args, lineObstacles: [], crossCost: 40 }), base);
});

test('router: 开启成本后直连捷径不再无条件放行', () => {
  const args = { start: [0, 100], end: [500, 100], obstacles: [], clearance: 16, stubStart: 24, stubEnd: 24 };
  assert.equal(route(args), null); // 默认：规范直连交给原生

  const lines = [[[300, 0], [300, 400]]]; // 与直连走廊相交
  const blocked = route({ ...args, lineObstacles: lines, crossCost: 40 });
  assert.ok(Array.isArray(blocked), '开启后应返回正交折线而不是 null');
  assert.deepEqual(blocked[0], args.start);
  assert.deepEqual(blocked[blocked.length - 1], args.end);

  // 不相交的既有线路不触发
  assert.equal(route({ ...args, lineObstacles: [[[300, 600], [300, 900]]], crossCost: 40 }), null);
});

test('router: 开启成本后在两条等价绕障路线间改选（可避免交叉）', () => {
  // 卡片挡住直连，上方/下方绕行等长；既有线路竖段只穿过上方绕行。
  const args = { start: [0, 300], end: [600, 300], obstacles: [[200, 250, 200, 100]], clearance: 16, stubStart: 24, stubEnd: 24 };
  const base = route(args);
  const tolled = route({ ...args, lineObstacles: [[[300, 150], [300, 300]]], crossCost: 60 });
  assert.equal(base[2][1], 234, '默认走上绕（y=234）');
  assert.equal(tolled[2][1], 366, '计费后改走下绕（y=366）');
  assert.deepEqual(base.slice(0, 2), tolled.slice(0, 2));
});
