import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../../luowen/web/layout/graph-model.js';
import { buildConstraints } from '../../luowen/web/layout/constraints.js';
import { portPos, countCrossings, totalEdgeLength, backwardEdges, estimateBends, portAlignment, groupCohesion, canvasFootprint, nodeOverlaps, displacement, evaluateLayout } from '../../luowen/web/layout/metrics.js';

const N = (id, type = 'KSampler', pos = [0, 0], size = [220, 90], opts = {}) => ({ id, type, pos, size, inputs: opts.inputs ?? [], outputs: opts.outputs ?? [], ...opts });
const L = (id, fromId, fromSlot, toId, toSlot) => ({ id, fromId, fromSlot, toId, toSlot });

test('layoutMetrics.portPos: 输入口按端口序均分左缘', () => {
  const m = buildModel({ nodes: [N(1, 'A', [100, 200], [220, 90], { inputs: [{}, {}, {}] })], links: [], groups: [] });
  const pos = new Map([['1', [100, 200]]]);
  assert.deepEqual(portPos(m, pos, '1', 'in', 0), [100, 215]);
  assert.deepEqual(portPos(m, pos, '1', 'in', 1), [100, 245]);
  assert.deepEqual(portPos(m, pos, '1', 'in', 2), [100, 275]);
  assert.deepEqual(portPos(m, pos, '1', 'out', 0), [320, 245]);
});

test('layoutMetrics.countCrossings: 交叉对=1 与 平行=0', () => {
  // 交叉：左上→右下 × 左下→右上
  const cross = buildModel({
    nodes: [N(1, 'A', [0, 0], [80, 60], { outputs: [{}] }), N(2, 'B', [0, 200], [80, 60], { outputs: [{}] }), N(3, 'C', [400, 0], [80, 60], { inputs: [{}] }), N(4, 'D', [400, 200], [80, 60], { inputs: [{}] })],
    links: [L('e1', 1, 0, 4, 0), L('e2', 2, 0, 3, 0)],
    groups: [],
  });
  const posCross = new Map([['1', [0, 0]], ['2', [0, 200]], ['3', [400, 0]], ['4', [400, 200]]]);
  assert.equal(countCrossings(cross, posCross), 1);
  // 平行：左上→右上 × 左下→右下
  const para = buildModel({
    nodes: cross.nodes ? [] : [],
    links: [L('e1', 1, 0, 3, 0), L('e2', 2, 0, 4, 0)],
    groups: [],
  });
  // 复用同一模型只换边：直接重建
  const paraM = buildModel({
    nodes: [N(1, 'A', [0, 0], [80, 60], { outputs: [{}] }), N(2, 'B', [0, 200], [80, 60], { outputs: [{}] }), N(3, 'C', [400, 0], [80, 60], { inputs: [{}] }), N(4, 'D', [400, 200], [80, 60], { inputs: [{}] })],
    links: [L('e1', 1, 0, 3, 0), L('e2', 2, 0, 4, 0)],
    groups: [],
  });
  assert.equal(countCrossings(paraM, posCross), 0);
  void para;
});

test('layoutMetrics: backwardEdges / estimateBends / portAlignment 方向与对齐口径', () => {
  // 对齐：同 y 直连 → bends 0、backward 0、alignment 1
  const aligned = buildModel({
    nodes: [N(1, 'A', [0, 0], [80, 60], { outputs: [{}] }), N(2, 'B', [400, 0], [80, 60], { inputs: [{}] })],
    links: [L('e1', 1, 0, 2, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [400, 0]]]);
  assert.equal(estimateBends(aligned, pos), 0);
  assert.deepEqual(backwardEdges(aligned, pos), { count: 0, totalLength: 0 });
  assert.equal(portAlignment(aligned, pos), 1);
  // 反向 + 斜跨：目标在源左侧 → backward 1；bends 1
  const back = buildModel({
    nodes: [N(1, 'A', [400, 0], [80, 60], { outputs: [{}] }), N(2, 'B', [0, 200], [80, 60], { inputs: [{}] })],
    links: [L('e1', 1, 0, 2, 0)],
    groups: [],
  });
  const posB = new Map([['1', [400, 0]], ['2', [0, 200]]]);
  assert.deepEqual(backwardEdges(back, posB).count, 1);
  assert.equal(estimateBends(back, posB), 1);
  assert.equal(portAlignment(back, posB), 0);
});

test('layoutMetrics: nodeOverlaps / canvasFootprint / displacement', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [100, 80]), N(2, 'B', [50, 40], [100, 80]), N(3, 'C', [300, 0], [100, 80])],
    links: [],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [50, 40]], ['3', [300, 0]]]);
  assert.equal(nodeOverlaps(m, pos), 1);
  const fp = canvasFootprint(m, pos);
  assert.equal(fp.w, 400);
  assert.equal(fp.h, 120);
  const d = displacement(m, new Map([['1', [0, 0]], ['2', [50, 40]], ['3', [300, 0]]]), new Map([['1', [10, 0]], ['2', [50, 40]], ['3', [300, 0]]]));
  assert.deepEqual(d, { mean: 3.333, max: 10 });
});

test('layoutMetrics.evaluateLayout: 汇总输出结构齐全且含基线位移', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [80, 60], { outputs: [{}] }), N(2, 'B', [400, 0], [80, 60], { inputs: [{}] })],
    links: [L('e1', 1, 0, 2, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [400, 0]]]);
  const out = evaluateLayout(m, pos, new Map([['1', [0, 0]], ['2', [390, 0]]]));
  for (const k of ['crossings', 'totalEdgeLength', 'backwardEdges', 'estimatedBends', 'portAlignment', 'groupCohesion', 'canvasFootprint', 'nodeOverlaps', 'displacement']) {
    assert.ok(k in out, `缺指标 ${k}`);
  }
  assert.deepEqual(out.displacement, { mean: 5, max: 10 });
});

test('layoutMetrics.groupCohesion: 紧凑度口径（成员面积/包围盒面积）；无 Group=1（中性）', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [10, 10], [100, 60]), N(2, 'B', [130, 10], [100, 60])],
    links: [],
    groups: [{ id: 'g1', title: '', bounds: [0, 0, 300, 120] }],
  });
  const pos = new Map([['1', [10, 10]], ['2', [130, 10]]]);
  // 成员面积和 12000 / 包围盒 220×60=13200 → 0.909
  assert.ok(Math.abs(groupCohesion(m, pos) - 12000 / 13200) < 1e-6);
  // 拉开距离后紧凑度下降
  const posFar = new Map([['1', [10, 10]], ['2', [2000, 10]]]);
  assert.ok(groupCohesion(m, posFar) < 0.2);
  const mNoGroups = buildModel({ nodes: [N(1, 'A', [0, 0], [100, 60])], links: [], groups: [] });
  assert.equal(groupCohesion(mNoGroups, pos), 1);
});

test('layoutMetrics: totalEdgeLength 手算口径（勾股）', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [80, 60], { outputs: [{}] }), N(2, 'B', [400, 200], [80, 60], { inputs: [{}] })],
    links: [L('e1', 1, 0, 2, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [400, 200]]]);
  // out 口 (80,30) → in 口 (400,230)：dx=320, dy=200 → √(320²+200²)
  const expect = Math.hypot(320, 200);
  assert.ok(Math.abs(totalEdgeLength(m, pos) - expect) < 1e-6);
});

test('layoutModel 与 constraints 联动冒烟：约束视图 obstacles 坐标随 positions 语义独立（fixed 用模型 pos）', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [200, 80]), N(2, 'B', [300, 0], [200, 80])],
    links: [],
    groups: [],
  });
  const c = buildConstraints(m, { selectedIds: ['2'] });
  assert.deepEqual(c.obstacles[0], { id: '1', x: 0, y: 0, w: 200, h: 80 });
});
