import test from 'node:test';
import assert from 'node:assert/strict';
import { obstacleHash, toRawRects, corridorClear } from '../../luowen/web/geometry/obstacles.js';
import { node } from '../fixtures/graphs.mjs';

const rect = (id, x, y, w = 200, h = 100, collapsed = false) => ({ id, x, y, w, h, collapsed });

test('obstacleHash: 同布局同哈希，与输入顺序无关', () => {
  const a = [rect(1, 0, 0), rect(2, 100, 100)];
  const b = [rect(2, 100, 100), rect(1, 0, 0)];
  assert.equal(obstacleHash(a), obstacleHash(b));
});

test('obstacleHash: 移动/缩放/折叠都改变哈希', () => {
  const base = [rect(1, 0, 0)];
  assert.notEqual(obstacleHash(base), obstacleHash([rect(1, 5, 0)]));
  assert.notEqual(obstacleHash(base), obstacleHash([rect(1, 0, 0, 250)]));
  assert.notEqual(obstacleHash(base), obstacleHash([rect(1, 0, 0, 200, 100, true)]));
});

test('toRawRects: 排除两端节点，输出 [x,y,w,h]', () => {
  const rects = [rect(1, 0, 0), rect(2, 400, 100), rect(99, 150, 40)];
  const raw = toRawRects(rects, [1, 2]);
  assert.deepEqual(raw, [[150, 40, 200, 100]]);
});

test('corridorClear: 端点贴边的节点被排除，中间障碍阻断', () => {
  const rects = [rect(1, 0, 100), rect(2, 400, 100), rect(99, 200, 80)];
  // 端点自身矩形与走廊 bbox 相交，但必须排除
  assert.equal(corridorClear(200, 150, 400, 150, rects, [1, 2], 16, 8), false); // 障碍 99 在走廊上
  assert.equal(corridorClear(200, 150, 400, 150, rects, [1, 2, 99], 16, 8), true); // 只剩端点（排除后净空）
});

test('corridorClear: 走廊外的障碍不阻断', () => {
  const rects = [rect(99, 200, 800)];
  assert.equal(corridorClear(200, 150, 400, 150, rects, [], 16, 8), true);
});

test('nodeRects 兼容性由 adapter 负责：本测试只锁定纯函数契约', () => {
  // 保证 fixture 形状与 geometry 输入一致
  const n = node(7, 10, 20);
  assert.deepEqual([n.id, n.pos[0], n.pos[1], n.size[0], n.size[1]], [7, 10, 20, 200, 100]);
});