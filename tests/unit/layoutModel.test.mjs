import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, foldRerouteEdges, componentsOf, topoOrderOf, fromWorkflowJson } from '../../luowen/web/layout/graph-model.js';
import { buildConstraints } from '../../luowen/web/layout/constraints.js';

const N = (id, type = 'KSampler', pos = [0, 0], size = [220, 90], opts = {}) => ({ id, type, pos, size, inputs: opts.inputs ?? [], outputs: opts.outputs ?? [], ...opts });
const L = (id, fromId, fromSlot, toId, toSlot) => ({ id, fromId, fromSlot, toId, toSlot });

test('layoutModel.buildModel: 线性链、拓扑序与分量', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [220, 90], { outputs: [{ name: 'IMAGE' }] }), N(2, 'B', [300, 0], [220, 90], { inputs: [{ name: 'IMAGE' }] }), N(3, 'C', [600, 0], [220, 90], { inputs: [{ name: 'IMAGE' }] })],
    links: [L('l1', 1, 0, 2, 0), L('l2', 2, 0, 3, 0)],
    groups: [],
  });
  assert.equal(m.nodes.size, 3);
  assert.equal(m.edges.length, 2);
  assert.equal(m.components.length, 1);
  assert.deepEqual(m.topoOrder, ['1', '2', '3']);
  assert.equal(m.dropped.length, 0);
});

test('layoutModel.buildModel: 引用缺失/自环剔除并如实报告 dropped', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [220, 90], { outputs: [{ name: 'X' }] })],
    links: [L('l1', 1, 0, 99, 0), L('l2', 1, 0, 1, 0), L('l3', 98, 0, 1, 0)],
    groups: [],
  });
  assert.equal(m.edges.length, 0);
  assert.equal(m.dropped.length, 3);
  assert.ok(m.dropped.every((d) => d.kind === 'link'));
  assert.ok(m.dropped.some((d) => d.reason === 'endpoint-not-in-nodes'));
  assert.ok(m.dropped.some((d) => d.reason === 'self-loop'));
});

test('layoutModel: Note 节点归 kind=note；Reroute 节点进 reroutes 表', () => {
  const m = buildModel({
    nodes: [N(1, 'Note', [0, 0], [200, 80]), N(2, 'Reroute', [100, 100], [40, 20])],
    links: [],
    groups: [],
  });
  assert.equal(m.nodes.get('1').kind, 'note');
  assert.deepEqual(m.notes, ['1']);
  assert.ok(m.reroutes.has('2'));
});

test('layoutModel.foldRerouteEdges: A→R→B 折叠为直连并标记 manualIntent（DEC-033 引申）', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [220, 90], { outputs: [{ name: 'X' }] }), N(2, 'Reroute', [150, 50], [40, 20]), N(3, 'B', [300, 0], [220, 90], { inputs: [{ name: 'X' }] })],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0)],
    groups: [],
  });
  assert.equal(m.edges.length, 1);
  const e = m.edges[0];
  assert.equal(e.src, '1');
  assert.equal(e.dst, '3');
  assert.deepEqual(e.rerouteChain, ['e2'], '链=被吞的 R→B 段');
  assert.equal(e.manualIntent, true);
  assert.ok(m.reroutes.has('2'));
});

test('layoutModel.foldRerouteEdges: 分叉的 Reroute 保守不折叠并记 dropped', () => {
  const m = buildModel({
    nodes: [
      N(1, 'A', [0, 0], [220, 90], { outputs: [{ name: 'X' }] }),
      N(2, 'Reroute', [150, 50], [40, 20]),
      N(3, 'B', [300, 0], [220, 90], { inputs: [{ name: 'X' }] }),
      N(4, 'C', [300, 200], [220, 90], { inputs: [{ name: 'X' }] }),
    ],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0), L('e3', 2, 0, 4, 0)],
    groups: [],
  });
  const edgeToR = m.edges.find((e) => e.dst === '2');
  assert.equal(edgeToR.manualIntent, false, '分叉链不折叠');
  assert.ok(m.dropped.some((d) => d.kind === 'reroute-chain' && d.reason === 'cyclic-or-branching-reroute'));
});

test('layoutModel.components: 两个独立子图 + 孤立节点 = 3 分量；reroute 节点不计入分量', () => {
  const m = buildModel({
    nodes: [
      N(1, 'A', [0, 0], [220, 90], { outputs: [{ name: 'X' }] }),
      N(2, 'B', [300, 0], [220, 90], { inputs: [{ name: 'X' }] }),
      N(5, 'Solo', [600, 0], [220, 90]),
      N(6, 'Reroute', [900, 0], [40, 20]),
    ],
    links: [L('l1', 1, 0, 2, 0)],
    groups: [],
  });
  assert.equal(m.components.length, 2, 'reroute 是透明路径点：分量只含非 reroute 节点');
  assert.deepEqual(m.components[0], ['1', '2']);
  assert.deepEqual(m.components[1], ['5']);
  assert.equal(m.components.some((c) => c.includes('6')), false, 'reroute 不计入分量');
});

test('layoutModel.topoOrderOf: 环返回 null', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [220, 90], { inputs: [{ name: 'X' }], outputs: [{ name: 'X' }] }), N(2, 'B', [300, 0], [220, 90], { inputs: [{ name: 'X' }], outputs: [{ name: 'X' }] })],
    links: [L('l1', 1, 0, 2, 0), L('l2', 2, 0, 1, 0)],
    groups: [],
  });
  assert.equal(m.topoOrder, null);
});

test('layoutModel.fromWorkflowJson: ComfyUI serialize 格式直读（含 groups.bounding 成员推导）', () => {
  const wf = {
    nodes: [
      { id: 9, type: 'CheckpointLoaderSimple', pos: [0, 0], size: [320, 100], outputs: [{ name: 'MODEL' }, { name: 'CLIP' }] },
      { id: 10, type: 'KSampler', pos: [400, 0], size: [300, 200], inputs: [{ name: 'model' }, { name: 'positive' }] },
      { id: 11, type: 'Note', pos: [0, 200], size: [200, 60] },
    ],
    links: [[1, 9, 0, 10, 0, 'MODEL']],
    groups: [{ id: 1, title: '加载区', bounding: [-40, -40, 640, 200] }],
  };
  const m = fromWorkflowJson(wf);
  assert.equal(m.nodes.size, 3);
  assert.equal(m.edges.length, 1);
  assert.equal(m.edges[0].src, '9');
  assert.equal(m.edges[0].dst, '10');
  assert.equal(m.groups[0].id, '1');
  assert.deepEqual(m.groups[0].memberIds, ['9', '10'], '中心落在 bounding 内的成员推导');
  assert.deepEqual(m.notes, ['11']);
});

test('layoutModel: Group 成员按几何包含推导', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [10, 10], [200, 80]), N(2, 'B', [500, 500], [200, 80])],
    links: [],
    groups: [{ id: 'g1', title: '区', bounds: [0, 0, 400, 200] }],
  });
  assert.deepEqual(m.groups[0].memberIds, ['1']);
});

test('constraints.buildConstraints: 局部布局——未选全 fixed+障碍，选中可动', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [200, 80]), N(2, 'B', [300, 0], [200, 80]), N(3, 'C', [600, 0], [200, 80])],
    links: [L('l1', 1, 0, 2, 0)],
    groups: [],
  });
  const c = buildConstraints(m, { selectedIds: ['2'] });
  assert.deepEqual(c.movableIds, ['2']);
  assert.equal(c.fixedIds.size, 2);
  assert.equal(c.obstacles.length, 2);
  assert.equal(c.local, true);
});

test('constraints.buildConstraints: pinned 恒 fixed（即使被选中）', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [200, 80], { pinned: true })],
    links: [],
    groups: [],
  });
  const c = buildConstraints(m, { selectedIds: ['1'] });
  assert.deepEqual(c.movableIds, []);
  assert.ok(c.fixedIds.has('1'));
});

test('constraints.buildConstraints: Reroute 手动意图与锁定 Group 进 notes', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0], [220, 90], { outputs: [{ name: 'X' }] }), N(2, 'Reroute', [150, 50], [40, 20]), N(3, 'B', [300, 0], [220, 90], { inputs: [{ name: 'X' }] }), N(4, 'D', [600, 0], [200, 80])],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0)],
    groups: [{ id: 'g1', title: '锁定区', bounds: [600, 0, 200, 80] }],
  });
  const c = buildConstraints(m, { lockedGroupIds: ['g1'] });
  const note = c.notes.find((x) => x.kind === 'reroute-manual-intent');
  assert.ok(note, '手动意图进入 notes');
  assert.ok(c.notes.some((x) => x.kind === 'group-locked'));
  assert.ok(c.fixedIds.has('4'), '锁定 Group 成员并入 fixed');
});
