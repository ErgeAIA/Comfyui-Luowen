import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromGraph } from '../../luowen/web/layout/engine.js';
import { buildModel } from '../../luowen/web/layout/graph-model.js';
import { buildConstraints, shiftToFreeBand } from '../../luowen/web/layout/constraints.js';

// duck-typed 假图（engine.snapshotFromGraph 只依赖 _nodes/links.values/groups）
function fakeGraph(nodes, links, groups = []) {
  return {
    _nodes: nodes,
    links: { values: () => links },
    groups,
  };
}

test('layoutEngine.snapshotFromGraph: LGraph duck-typed 快照（pos/size/端口/折叠/Group bounds）', () => {
  const g = fakeGraph(
    [
      { id: 5, type: 'Note', pos: [10, 20], size: [280, 375], inputs: [], outputs: [], collapsed: true },
      { id: 7, type: 'KSampler', pos: [300, 0], size: [300, 200], inputs: [{ name: 'model' }], outputs: [{ name: 'IMAGE' }] },
    ],
    [{ id: 9, origin_id: 5, origin_slot: 0, target_id: 7, target_slot: 0 }],
    [{ id: 3, title: '区', _bounding: [0, 0, 600, 300] }],
  );
  const snap = snapshotFromGraph(g);
  assert.equal(snap.nodes.length, 2);
  assert.equal(snap.nodes[0].id, '5');
  assert.equal(snap.nodes[0].collapsed, true);
  assert.equal(snap.nodes[1].pinned, false);
  assert.equal(snap.links.length, 1);
  assert.deepEqual(snap.links[0], { id: '9', fromId: '5', fromSlot: 0, toId: '7', toSlot: 0 });
  assert.deepEqual(snap.groups[0].bounds, [0, 0, 600, 300]);
  // 快照 → 模型 → 约束 全链贯通
  const model = buildModel(snap);
  assert.equal(model.edges.length, 1);
  const c = buildConstraints(model, { selectedIds: ['7'] });
  assert.deepEqual(c.movableIds, ['7']);
});

test('layoutEngine.shiftToFreeBand: 有障碍时整体平移出空白带（硬约束不重叠）；无障碍不动', () => {
  const positions = new Map([['a', [0, 0]], ['b', [200, 100]]]);
  const obstacles = [{ id: 'f1', x: 500, y: 0, w: 300, h: 500 }]; // fixed 包围盒右缘 x=800
  const r = shiftToFreeBand(positions, obstacles, { margin: 60 });
  assert.equal(r.shifted, true);
  assert.equal(r.dx, 860); // 800 + 60 - 0 = 860
  assert.deepEqual(positions.get('a'), [860, 0]);
  assert.deepEqual(positions.get('b'), [1060, 100]);
  // 平移后 movable 与障碍不再重叠
  for (const [id, p] of positions) {
    assert.ok(p[0] >= obstacles[0].x + obstacles[0].w, `${id} 平移后越过障碍右缘`);
  }
  // 无障碍：不动
  const pos2 = new Map([['a', [10, 10]]]);
  const r2 = shiftToFreeBand(pos2, [], {});
  assert.equal(r2.shifted, false);
  assert.deepEqual(pos2.get('a'), [10, 10]);
  // 已在障碍右侧：dx<=0 不平移
  const pos3 = new Map([['a', [0, 0]]]);
  const r3 = shiftToFreeBand(pos3, [{ id: 'f', x: -900, y: 0, w: 300, h: 100 }], { margin: 60 });
  assert.equal(r3.shifted, false);
});

test('layoutEngine: 引擎模块纯度——不引用宿主 window/app（仅通过参数注入）', async () => {
  const src = await import('node:fs').then((fs) => fs.promises.readFile('luowen/web/layout/engine.js', 'utf8'));
  assert.ok(!/window\.comfyAPI|window\.LuoWen/.test(src), 'engine 不得直接引用 window 全局（app 由参数注入）');
  assert.ok(src.includes('export async function runAutoLayout'));
  assert.ok(src.includes('export function snapshotFromGraph'));
});
