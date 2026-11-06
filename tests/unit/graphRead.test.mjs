import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeRects, graphNodes, graphLinks } from '../../luowen/web/adapters/graphRead.js';

function fakeNode(id, x, y, w = 200, h = 100, collapsed = false) {
  return {
    id,
    pos: [x, y],
    size: [w, h],
    flags: { collapsed },
    // LiteGraph 语义：绝对坐标 [x, y, w, h]（已含 pos）
    getBounding: () => [x, y + (collapsed ? 0 : 30), w, collapsed ? 40 : h],
  };
}

test('nodeRects: getBounding 已是绝对坐标，不得重复叠加 pos', () => {
  const graph = { _nodes: [fakeNode('67', 170, 260)] };
  const [r] = nodeRects(graph);
  assert.equal(r.x, 170);
  assert.equal(r.y, 290); // getBounding 的 y 覆盖标题偏移
  assert.equal(r.w, 200);
  assert.equal(r.h, 100);
});

test('nodeRects: 无 getBounding 时回退 pos/size；折叠标记透传', () => {
  const graph = { _nodes: [{ id: 1, pos: [10, 20], size: [300, 120], flags: { collapsed: true } }] };
  const [r] = nodeRects(graph);
  assert.deepEqual([r.x, r.y, r.w, r.h, r.collapsed], [10, 20, 300, 120, true]);
});

test('graphNodes/graphLinks: 兼容数组、对象与 Map 形态', () => {
  const a = { _nodes: [1, 2] };
  assert.deepEqual(graphNodes(a), [1, 2]);
  assert.deepEqual(graphNodes({ nodes: { x: 3 } }), [3]);
  assert.deepEqual(
    graphLinks({ links: { 5: { id: 5 }, 6: { id: 6 } } }).map((l) => l.id),
    [5, 6],
  );
  assert.deepEqual([...graphLinks({ links: new Map([[7, { id: 7 }]]) })], [{ id: 7 }]);
});