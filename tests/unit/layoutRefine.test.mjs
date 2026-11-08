import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../../luowen/web/layout/graph-model.js';
import { straightenEdges, swapReduceCrossings, rerouteComponentIds } from '../../luowen/web/layout/refine.js';
import { countCrossings } from '../../luowen/web/layout/metrics.js';

const N = (id, type = 'KSampler', pos = [0, 0], size = [80, 60], opts = {}) => ({ id, type, pos, size, inputs: opts.inputs ?? [], outputs: opts.outputs ?? [], ...opts });
const L = (id, fromId, fromSlot, toId, toSlot) => ({ id, fromId, fromSlot, toId, toSlot });

test('layoutRefine.straightenEdges: 容差内吸附拉直（dy=30 ≤ tol=30），超容差不吸', () => {
  // A(0,170) out 口 y=200；B(400,200) in 口 y=230 → dy=30 ≤ tol(60*0.5=30) → 吸附 A.y→200 → 直线
  const m1 = buildModel({
    nodes: [N(1, 'A', [0, 170], [80, 60], { outputs: [{}] }), N(2, 'B', [400, 200], [80, 60], { inputs: [{}] })],
    links: [L('e1', 1, 0, 2, 0)],
    groups: [],
  });
  const pos1 = new Map([['1', [0, 170]], ['2', [400, 200]]]);
  const r1 = straightenEdges(m1, pos1);
  assert.equal(r1.movedCount, 1);
  const after = r1.positions.get('1');
  const outY = after[1] + 60 * 0.5;
  assert.ok(Math.abs(outY - 230) < 1e-6, `吸附后 out 口 y=${outY} ≈ 目标口 230（直线）`);
  // 超容差：A(0,0) → dy=200 > 30 → 不动
  const m2 = buildModel({
    nodes: [N(1, 'A', [0, 0], [80, 60], { outputs: [{}] }), N(2, 'B', [400, 200], [80, 60], { inputs: [{}] })],
    links: [L('e1', 1, 0, 2, 0)],
    groups: [],
  });
  const pos2 = new Map([['1', [0, 0]], ['2', [400, 200]]]);
  const r2 = straightenEdges(m2, pos2);
  assert.equal(r2.movedCount, 0, 'dy=200 超 tol=30 不吸附');
});

test('layoutRefine.swapReduceCrossings: X 交叉配置交换后 crossings 1→0（同列、无重叠守卫触发）', () => {
  const m = buildModel({
    nodes: [
      N(1, 'A', [0, 0], [80, 60], { outputs: [{}] }),
      N(2, 'B', [0, 200], [80, 60], { outputs: [{}] }),
      N(3, 'C', [400, 0], [80, 60], { inputs: [{}] }),
      N(4, 'D', [400, 200], [80, 60], { inputs: [{}] }),
    ],
    links: [L('e1', 1, 0, 4, 0), L('e2', 2, 0, 3, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [0, 200]], ['3', [400, 0]], ['4', [400, 200]]]);
  assert.equal(countCrossings(m, pos), 1, '前置：X 交叉 1');
  const { swaps, positions: swapped } = swapReduceCrossings(m, pos, { colGap: 150, nodeGap: 40 });
  const crossings = countCrossings(m, swapped);
  assert.equal(crossings, 0, '重排后交叉 0（按目标口 y 排序自动消除 X 交叉）');
  assert.equal(swaps, 1);
  // 重排后边全水平：1 出口 y = 4 入口 y；2 出口 y = 3 入口 y（端口 y = node.y + h/2，单端口）
  const outY1 = swapped.get('1')[1] + 30; // h=60, 1 out port → y + h/2 = y+30
  const inY4 = swapped.get('4')[1] + 30;
  assert.ok(Math.abs(outY1 - inY4) < 1e-6, `边 e1 水平（out=${outY1} in=${inY4}）`);
  const outY2 = swapped.get('2')[1] + 30;
  const inY3 = swapped.get('3')[1] + 30;
  assert.ok(Math.abs(outY2 - inY3) < 1e-6, `边 e2 水平（out=${outY2} in=${inY3}）`);
});

test('layoutRefine.rerouteComponentIds: 含 Reroute 链的分量整体跳过（含链上 Reroute 节点），干净分量不跳', () => {
  const m = buildModel({
    nodes: [
      N(1, 'A', [0, 0], [220, 90], { outputs: [{ name: 'X' }] }),
      N(2, 'Reroute', [150, 50], [40, 20]),
      N(3, 'B', [300, 0], [220, 90], { inputs: [{ name: 'X' }] }),
      N(4, 'C', [600, 0], [220, 90], { outputs: [{ name: 'Y' }] }),
      N(5, 'D', [900, 0], [220, 90], { inputs: [{ name: 'Y' }] }),
    ],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0), L('e3', 4, 0, 5, 0)],
    groups: [],
  });
  // Reroute 链折叠后的分量级跳过：A⇢B (manualIntent) 分量 {1,3} + 链上 Reroute {2} 整体跳过；干净分量 {4,5} 不跳
  const skip = rerouteComponentIds(m);
  assert.ok(skip.has('1'), 'A 在含链分量内');
  assert.ok(skip.has('3'), 'B 在含链分量内');
  assert.ok(skip.has('2'), '链上 Reroute 节点一并固定');
  assert.equal(skip.has('4'), false, '干净分量不跳过');
  assert.equal(skip.has('5'), false);
});

test('layoutRefine.rerouteComponentIds: 无 Reroute 时返回空集', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [220, 90], { outputs: [{ name: 'X' }] }), N(2, 'B', [300, 0], [220, 90], { inputs: [{ name: 'X' }] })],
    links: [L('l1', 1, 0, 2, 0)],
    groups: [],
  });
  assert.equal(rerouteComponentIds(m).size, 0);
});
