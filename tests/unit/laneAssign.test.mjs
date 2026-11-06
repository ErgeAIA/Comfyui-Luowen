import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateLanes, laneHash } from '../../luowen/web/routing/laneAssign.js';
import { fanOut, link } from '../fixtures/graphs.mjs';

test('allocateLanes: 输出侧整组统一 base stub，不按 rank 阶梯（DEC-011）', () => {
  const { nodes, links } = fanOut(); // 1 在 y=100；目标 y=40(上行) / 100(平) / 300(下行)
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  // 同端口多线共用 base 24：端口只出一条线，分叉后各自走线
  assert.equal(lanes.get(10).stubOut, 24); // 上行目标（y=40）
  assert.equal(lanes.get(11).stubOut, 24); // 平走目标（y=100）
  assert.equal(lanes.get(12).stubOut, 24); // 下行目标（y=300）
  // 目标侧（不同 slot 时各自独立分组）——此 fixture 三个目标不同 slot，各自单成员
  assert.equal(lanes.get(10).stubIn, 24);
});

test('allocateLanes: 多个上行目标输出侧仍共用 base，不再阶梯', () => {
  const nodes = [
    { id: 1, pos: [0, 100] },
    { id: 2, pos: [400, 20] },
    { id: 3, pos: [400, 60] },
    { id: 4, pos: [400, 90] },
  ];
  const links = [link(10, 1, 0, 2, 0), link(11, 1, 0, 3, 0), link(12, 1, 0, 4, 0)];
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  assert.equal(lanes.get(10).stubOut, 24);
  assert.equal(lanes.get(11).stubOut, 24);
  assert.equal(lanes.get(12).stubOut, 24);
});

test('allocateLanes: 多个下行目标输出侧仍共用 base', () => {
  const nodes = [
    { id: 1, pos: [0, 100] },
    { id: 2, pos: [400, 200] },
    { id: 3, pos: [400, 400] },
  ];
  const links = [link(10, 1, 0, 2, 0), link(11, 1, 0, 3, 0)];
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  assert.equal(lanes.get(10).stubOut, 24);
  assert.equal(lanes.get(11).stubOut, 24);
});

test('allocateLanes: 输入侧保留 rank 阶梯（同向多源汇入同一引脚）', () => {
  const nodes = [
    { id: 1, pos: [0, 100] },
    { id: 2, pos: [0, 20] },
    { id: 3, pos: [400, 300] },
  ];
  // 两条线汇入节点 3 的同一 slot，两个来源都在上方（同向）→ 阶梯 24 / 29
  const links = [link(10, 1, 0, 3, 0), link(11, 2, 0, 3, 0)];
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  assert.equal(lanes.get(11).stubIn, 24); // y=20 最顶，贴引脚
  assert.equal(lanes.get(10).stubIn, 29); // y=100
});

test('allocateLanes: 确定性（同输入同输出）', () => {
  const { nodes, links } = fanOut();
  const a = allocateLanes(links, nodes);
  const b = allocateLanes(links, nodes);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
});

test('allocateLanes: 输入侧同引脚上下多源按接近方向错开（不再共用同一起点）', () => {
  const nodes = [
    { id: 1, pos: [0, 100] },
    { id: 2, pos: [0, 300] },
    { id: 3, pos: [400, 200] },
  ];
  // 两条线汇入节点 3 的同一 slot：来源 1 在上、来源 2 在下
  const links = [link(10, 1, 0, 3, 0), link(11, 2, 0, 3, 0)];
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 5 });
  // 上组先、下组后：上方来源贴节点，下方来源顺延一格（DEC-013 补记的嵌套规则）
  assert.equal(lanes.get(10).stubIn, 24);
  assert.equal(lanes.get(11).stubIn, 29);
});

test('laneHash: 节点 y 变化或拓扑变化会改变指纹', () => {
  const { nodes, links } = fanOut();
  const h1 = laneHash(links, nodes);
  const moved = nodes.map((n) => (n.id === 4 ? { ...n, pos: [400, 350] } : n));
  assert.notEqual(h1, laneHash(links, moved));
  assert.notEqual(h1, laneHash(links.slice(0, 2), nodes));
  assert.equal(h1, laneHash(links, nodes));
});

test('allocateLanes: 按接近方向嵌套分层（上→下→平），走廊 x 互不相同（DEC-013）', () => {
  const nodes = [
    { id: 1, pos: [0, 100] }, // 上方
    { id: 2, pos: [0, 200] }, // 上方
    { id: 3, pos: [0, 300] }, // 与目标同高 → 平走
    { id: 4, pos: [0, 400] }, // 下方
    { id: 5, pos: [400, 300] }, // 四个不同输入引脚汇聚同一目标节点
  ];
  const links = [link(10, 1, 0, 5, 0), link(11, 2, 0, 5, 1), link(12, 3, 0, 5, 2), link(13, 4, 0, 5, 3)];
  const lanes = allocateLanes(links, nodes, { base: 24, pitch: 8 });
  // 上组（slot 升序贴近）→ 下组（slot 降序贴近）→ 平走最外层
  assert.deepEqual([10, 11, 12, 13].map((id) => lanes.get(id).stubIn), [24, 32, 48, 40]);
  // 走廊是竖直线段；同一目标引脚 x 相同，stub 不同 → 走廊 x 两两不同 → 重叠区间为空
  const pinX = 400;
  const xs = [10, 11, 12, 13].map((id) => pinX - lanes.get(id).stubIn);
  assert.deepEqual(xs, [376, 368, 352, 360]);
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) assert.notEqual(xs[i], xs[j]);
  }
});

test('allocateLanes: 默认 pitch 为 8；slot 起点按之前 slot 线数累计顺延（DEC-013）', () => {
  const nodes = [
    { id: 1, pos: [0, 20] },
    { id: 2, pos: [0, 80] },
    { id: 3, pos: [0, 400] },
    { id: 9, pos: [400, 200] },
  ];
  // slot 1 有两条同向上行来源（24/32）；slot 2 的下行来源顺延到 40
  const links = [link(10, 1, 0, 9, 1), link(11, 2, 0, 9, 1), link(12, 3, 0, 9, 2)];
  const lanes = allocateLanes(links, nodes); // 使用默认 base=24 / pitch=8
  assert.equal(lanes.get(10).stubIn, 24); // 上行最顶者贴引脚
  assert.equal(lanes.get(11).stubIn, 32);
  assert.equal(lanes.get(12).stubIn, 40); // 越过前一组全部台阶
  // 输出侧仍统一 base，不受 pitch 影响
  assert.equal(lanes.get(10).stubOut, 24);
});

// 轴对齐线段相交（含共线重叠）：用于锁定「同节点不同引脚进线不得交叉」
function segmentsOf(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i += 1) out.push([pts[i - 1], pts[i]]);
  return out;
}

function segmentsIntersect(p, q) {
  const [a, b] = p;
  const [c, d] = q;
  const cross = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const eps = 1e-9;
  const onSeg = (u, v, w) =>
    Math.abs(cross(u, v, w)) < eps &&
    Math.min(u[0], v[0]) - eps <= w[0] && w[0] <= Math.max(u[0], v[0]) + eps &&
    Math.min(u[1], v[1]) - eps <= w[1] && w[1] <= Math.max(u[1], v[1]) + eps;
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  const proper = ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
  if (proper) return true;
  const vertical = (s) => Math.abs(s[0][0] - s[1][0]) < 0.5;
  const horizontal = (s) => Math.abs(s[0][1] - s[1][1]) < 0.5;
  if (vertical(p) && vertical(q)) {
    if (Math.abs(a[0] - c[0]) > 0.5) return false;
    const lo = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
    const hi = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
    return hi - lo > 0.5;
  }
  if (horizontal(p) && horizontal(q)) {
    if (Math.abs(a[1] - c[1]) > 0.5) return false;
    const lo = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
    const hi = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]));
    return hi - lo > 0.5;
  }
  return onSeg(a, b, c) || onSeg(a, b, d) || onSeg(c, d, a) || onSeg(c, d, b);
}

test('allocateLanes: 多引脚上/下混合接近时走廊嵌套不交叉（DEC-013 补记）', () => {
  const targetTop = 300;
  const nodes = [
    { id: 1, pos: [0, 100] }, // slot 0，上方
    { id: 2, pos: [0, 200] }, // slot 1，上方
    { id: 3, pos: [0, 600] }, // slot 2，下方（上引脚）
    { id: 4, pos: [0, 700] }, // slot 3，下方（下引脚）
    { id: 5, pos: [400, targetTop] },
  ];
  const links = [link(10, 1, 0, 5, 0), link(11, 2, 0, 5, 1), link(12, 3, 0, 5, 2), link(13, 4, 0, 5, 3)];
  const lanes = allocateLanes(links, nodes); // 默认 base=24 / pitch=8

  // 近 → 远：slot0(上)、slot1(上)、slot3(下·下引脚)、slot2(下·上引脚)
  assert.deepEqual([10, 11, 12, 13].map((id) => lanes.get(id).stubIn), [24, 32, 48, 40]);
  const pinX = 400;
  const pinY = (slot) => targetTop + 40 + 20 * slot;
  const corridorX = (id) => pinX - lanes.get(id).stubIn;
  const xs = { 10: corridorX(10), 11: corridorX(11), 12: corridorX(12), 13: corridorX(13) };
  // 上方组：引脚越高越贴节点
  assert.ok(xs[10] > xs[11]);
  // 下方组镜像：引脚越高越靠外（slot2 引脚在 slot3 之上，走廊必须更远）
  assert.ok(pinY(2) < pinY(3));
  assert.ok(xs[12] < xs[13]);

  // 用 stub 长度还原四条正交折线，断言任意两条无交点
  const srcY = { 10: 100, 11: 200, 12: 600, 13: 700 };
  const slotOf = { 10: 0, 11: 1, 12: 2, 13: 3 };
  const paths = [10, 11, 12, 13].map((id) => {
    const x = xs[id];
    const y = pinY(slotOf[id]);
    return [[0, srcY[id]], [x, srcY[id]], [x, y], [pinX, y]];
  });
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      for (const p of segmentsOf(paths[i])) {
        for (const q of segmentsOf(paths[j])) {
          assert.equal(segmentsIntersect(p, q), false, `link ${10 + i} 与 link ${10 + j} 的线段相交`);
        }
      }
    }
  }
});