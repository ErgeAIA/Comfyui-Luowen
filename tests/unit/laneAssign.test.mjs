import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateLanes, laneHash } from '../../luowen/web/routing/laneAssign.js';
import { fanOut, link } from '../fixtures/graphs.mjs';

test('allocateLanes: 上行/平走/下行各自成级，上行最顶贴引脚', () => {
  const { nodes, links } = fanOut(); // 1 在 y=100；目标 y=40(上行) / 100(平) / 300(下行)
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  // 上行唯一 → rank 0 → 24；下行唯一 → 24；平走排在上行之后 → 24 + (1+1)*5 = 34
  assert.equal(lanes.get(10).stubOut, 24); // 上行目标（y=40）
  assert.equal(lanes.get(11).stubOut, 34); // 平走目标（y=100）
  assert.equal(lanes.get(12).stubOut, 24); // 下行目标（y=300）
  // 目标侧（不同 slot 时各自独立分组）——此 fixture 三个目标不同 slot，各自单成员
  assert.equal(lanes.get(10).stubIn, 24);
});

test('allocateLanes: 多个上行目标按目标 y 升序阶梯，越顶越贴引脚', () => {
  const nodes = [
    { id: 1, pos: [0, 100] },
    { id: 2, pos: [400, 20] },
    { id: 3, pos: [400, 60] },
    { id: 4, pos: [400, 90] },
  ];
  const links = [link(10, 1, 0, 2, 0), link(11, 1, 0, 3, 0), link(12, 1, 0, 4, 0)];
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  assert.equal(lanes.get(10).stubOut, 24); // y=20 最顶
  assert.equal(lanes.get(11).stubOut, 29); // y=60
  assert.equal(lanes.get(12).stubOut, 34); // y=90
});

test('allocateLanes: 下行目标按 y 降序阶梯，越底越贴引脚', () => {
  const nodes = [
    { id: 1, pos: [0, 100] },
    { id: 2, pos: [400, 200] },
    { id: 3, pos: [400, 400] },
  ];
  const links = [link(10, 1, 0, 2, 0), link(11, 1, 0, 3, 0)];
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  assert.equal(lanes.get(11).stubOut, 24); // y=400 最底
  assert.equal(lanes.get(10).stubOut, 29); // y=200
});

test('allocateLanes: 确定性（同输入同输出）', () => {
  const { nodes, links } = fanOut();
  const a = allocateLanes(links, nodes);
  const b = allocateLanes(links, nodes);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
});

test('allocateLanes: 输入侧独立分组（同 target slot 多来源）', () => {
  const nodes = [
    { id: 1, pos: [0, 100] },
    { id: 2, pos: [0, 300] },
    { id: 3, pos: [400, 200] },
  ];
  // 两条线汇入节点 3 的同一 slot
  const links = [link(10, 1, 0, 3, 0), link(11, 2, 0, 3, 0)];
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  // 对 3 的输入侧：来源 1 在上（dy<0? 1.y=100 < 3.y=200 → 上行），来源 2 在下（下行）→ 各自 rank0
  assert.equal(lanes.get(10).stubIn, 24);
  assert.equal(lanes.get(11).stubIn, 24); // 上下不同组分类，互不挤占
});

test('laneHash: 节点 y 变化或拓扑变化会改变指纹', () => {
  const { nodes, links } = fanOut();
  const h1 = laneHash(links, nodes);
  const moved = nodes.map((n) => (n.id === 4 ? { ...n, pos: [400, 350] } : n));
  assert.notEqual(h1, laneHash(links, moved));
  assert.notEqual(h1, laneHash(links.slice(0, 2), nodes));
  assert.equal(h1, laneHash(links, nodes));
});