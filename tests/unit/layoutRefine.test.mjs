import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../../luowen/web/layout/graph-model.js';
import { straightenEdges, spineOf, swapReduceCrossings, compressSpineInline, rerouteComponentIds, layoutSpineTracks } from '../../luowen/web/layout/refine.js';
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

test('layoutRefine.swapReduceCrossings: 列内对齐 right(默认)/left/center（不同宽度节点）', () => {
  const m = buildModel({
    nodes: [
      N(1, 'A', [0, 0], [200, 60], { outputs: [{}] }),
      N(2, 'B', [0, 200], [100, 60], { outputs: [{}] }),
    ],
    links: [],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [0, 200]]]);
  const right = swapReduceCrossings(m, pos, { align: 'right' }).positions;
  assert.equal(right.get('1')[0], 0, 'right：宽节点 A 右缘=200 → x=0');
  assert.equal(right.get('2')[0], 100, 'right：窄节点 B 右缘对齐 200 → x=100');
  const left = swapReduceCrossings(m, pos, { align: 'left' }).positions;
  assert.equal(left.get('1')[0], 0);
  assert.equal(left.get('2')[0], 0, 'left：左缘对齐');
  const center = swapReduceCrossings(m, pos, { align: 'center' }).positions;
  assert.equal(center.get('1')[0], 0);
  assert.equal(center.get('2')[0], 50, 'center：居中于 [0,200]');
  assert.equal(swapReduceCrossings(m, pos).positions.get('2')[0], 100, '默认 auto（无连线→右）');
});

test('layoutRefine.swapReduceCrossings: auto 逐列对齐——单源扇出→左，多源扇入→右', () => {
  // 扇出：S→A,B（A/B 为汇点）。中列 inFromSingle=2 > outToSingle=0 → 左对齐
  const m1 = buildModel({
    nodes: [
      N(1, 'S', [0, 0], [80, 60], { outputs: [{}] }),
      N(2, 'A', [300, 0], [200, 60], { inputs: [{}] }),
      N(3, 'B', [300, 200], [100, 60], { inputs: [{}] }),
    ],
    links: [L('e1', 1, 0, 2, 0), L('e2', 1, 0, 3, 0)],
    groups: [],
  });
  const pos1 = new Map([['1', [0, 0]], ['2', [300, 0]], ['3', [300, 200]]]);
  const r1 = swapReduceCrossings(m1, pos1, { align: 'auto' });
  assert.equal(r1.positions.get('2')[0], 300, '扇出列左对齐：宽节点 A 左缘 300');
  assert.equal(r1.positions.get('3')[0], 300, '扇出列左对齐：窄节点 B 左缘 300');

  // 扇入：S1→A、S2→B；A,B→T。中列 outToSingle=2 > inFromSingle=1 → 右对齐
  const m2 = buildModel({
    nodes: [
      N(1, 'S1', [0, 0], [80, 60], { outputs: [{}] }),
      N(5, 'S2', [0, 200], [80, 60], { outputs: [{}] }),
      N(2, 'A', [300, 0], [200, 60], { inputs: [{}], outputs: [{}] }),
      N(3, 'B', [300, 200], [100, 60], { inputs: [{}], outputs: [{}] }),
      N(4, 'T', [600, 100], [80, 60], { inputs: [{}] }),
    ],
    links: [L('e1', 1, 0, 2, 0), L('e2', 5, 0, 3, 0), L('e3', 2, 0, 4, 0), L('e4', 3, 0, 4, 0)],
    groups: [],
  });
  const pos2 = new Map([['1', [0, 0]], ['5', [0, 200]], ['2', [300, 0]], ['3', [300, 200]], ['4', [600, 100]]]);
  const r2 = swapReduceCrossings(m2, pos2, { align: 'auto' });
  assert.equal(r2.positions.get('2')[0], 300, '扇入列右对齐：宽节点 A 左缘 300');
  assert.equal(r2.positions.get('3')[0], 400, '扇入列右对齐：窄节点 B 左缘 400');
});

test('layoutRefine.compressSpineInline: 1进1出列向上一列收紧到 inlineGap，其余列保持净距', () => {
  const m = buildModel({
    nodes: [
      N(1, 'A', [0, 0], [100, 60], { outputs: [{}] }),
      N(2, 'B', [300, 0], [100, 60], { inputs: [{}], outputs: [{}] }),
      N(3, 'C', [600, 0], [100, 60], { inputs: [{}], outputs: [{}] }),
      N(4, 'D', [900, 0], [100, 60], { inputs: [{}] }),
    ],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0), L('e3', 3, 0, 4, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [300, 0]], ['3', [600, 0]], ['4', [900, 0]]]);
  const spine = { chain: ['1', '2', '3', '4'], ids: new Set(['1', '2', '3', '4']), anchorTop: 0 };
  const r = compressSpineInline(m, pos, { inlineGap: 50, spine });
  assert.equal(r.positions.get('2')[0], 150, 'B（1进1出）收窄到 50');
  assert.equal(r.positions.get('3')[0], 300, 'C（1进1出）收窄到 50');
  assert.equal(r.positions.get('4')[0], 600, 'D（非1进1出）随列同幅平移、净距保持');
  assert.equal(r.compressed, 2);
});

test('layoutRefine.swapReduceCrossings: 主链锚定——列内顶端为主链节点时起始 y=锚顶', () => {
  const m = buildModel({
    nodes: [
      N(1, 'S1', [0, 0], [80, 60], { outputs: [{}] }),
      N(2, 'S2', [0, 200], [80, 60], { outputs: [{}] }),
      N(3, 'A', [400, 100], [80, 60], { inputs: [{}] }),
    ],
    links: [L('e1', 1, 0, 3, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [0, 200]], ['3', [400, 100]]]);
  const spine = { ids: new Set(['1', '3']), anchorTop: 100 };
  const r = swapReduceCrossings(m, pos, { align: 'auto', spine });
  assert.equal(r.positions.get('1')[1], 100, 'S1 起始 y 锚定锚顶 100');
  assert.equal(r.positions.get('2')[1], 100 + 60 + 40, 'S2 顺次 = 100+60+40');
});

test('layoutRefine.spineOf: 最长路径（并列取起点 top 最小）返回链与锚顶', () => {
  const m = buildModel({
    nodes: [
      N(1, 'Load', [0, 0], [80, 60], { outputs: [{}] }),
      N(2, 'Mid', [200, 30], [80, 60], { outputs: [{}] }),
      N(3, 'Proc', [400, 90], [80, 60], { outputs: [{}] }),
      N(4, 'Out', [600, 20], [80, 60], { inputs: [{}] }),
    ],
    links: [L('e1', 1, 0, 3, 0), L('e2', 2, 0, 3, 0), L('e3', 3, 0, 4, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [200, 30]], ['3', [400, 90]], ['4', [600, 20]]]);
  const r = spineOf(m, pos);
  assert.deepEqual(r.chain, ['1', '3', '4'], '并列最长路径取起点 top 最小（1 的 0 < 2 的 30）');
  assert.equal(r.anchorTop, 90, '锚顶 = 链上第二个节点 3 的 top');
  assert.ok(r.ids.has('1') && r.ids.has('3') && r.ids.has('4'));
});

test('layoutRefine.spineOf: 含环返回空链', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0]), N(2, 'B', [200, 0]), N(3, 'C', [400, 0])],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0), L('e3', 3, 0, 1, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [200, 0]], ['3', [400, 0]]]);
  const r = spineOf(m, pos);
  assert.deepEqual(r.chain, []);
  assert.equal(r.anchorTop, null);
});

// ---------- 主链判据：longest（现状）vs sink-coverage（汇点覆盖优先，2026-11-09 提案） ----------
// 合成 A：同一连通分量内，外围 7 节点链 vs 主流程 5 节点（主流程汇点祖先 16）
// S(1) 同时喂 Hub 与外围链，保证两个汇点竞争同一条主链（生产中 spineOf 按分量调用）。
const makePeripheralVsMain = () => {
  const nodes = [];
  const links = [];
  let lid = 1;
  nodes.push(N(1, 'Source', [0, 1000], [80, 60], { outputs: [{}] }));
  for (let i = 2; i <= 12; i++) nodes.push(N(i, 'Source', [i * 40, 1000], [80, 60], { outputs: [{}] }));
  nodes.push(N(13, 'Hub', [600, 1000], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(14, 'Main1', [800, 1000], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(15, 'Main2', [1000, 1000], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(16, 'SaveMain', [1200, 1000], [80, 60], { inputs: [{}] }));
  for (let i = 17; i <= 23; i++) nodes.push(N(i, i === 23 ? 'SavePer' : `Per${i - 16}`, [(i - 17) * 200, 0], [80, 60], i === 23 ? { inputs: [{}] } : { inputs: [{}], outputs: [{}] }));
  links.push(L(`s${lid++}`, 1, 0, 13, 0), L(`s${lid++}`, 1, 0, 17, 0));
  for (let i = 2; i <= 12; i++) links.push(L(`s${lid++}`, i, 0, 13, 0));
  links.push(L(`m${lid++}`, 13, 0, 14, 0), L(`m${lid++}`, 14, 0, 15, 0), L(`m${lid++}`, 15, 0, 16, 0));
  for (let i = 17; i < 23; i++) links.push(L(`p${lid++}`, i, 0, i + 1, 0));
  const m = buildModel({ nodes, links, groups: [] });
  const pos = new Map(nodes.map((n) => [String(n.id), [n.pos[0], n.pos[1]]]));
  return { m, pos };
};

test('layoutRefine.spineOf: strategy=longest 保持现状——外围长链（7）压过主流程（5）', () => {
  const { m, pos } = makePeripheralVsMain();
  const r = spineOf(m, pos, null, { strategy: 'longest' });
  assert.deepEqual(r.chain, ['1', '17', '18', '19', '20', '21', '22', '23'], '最长路径含共享源 S(1)');
});

test('layoutRefine.spineOf: strategy=sink-coverage 选祖先覆盖最大的汇点——外围长链让位主流程', () => {
  const { m, pos } = makePeripheralVsMain();
  const r = spineOf(m, pos, null, { strategy: 'sink-coverage' });
  assert.deepEqual(r.chain, ['1', '13', '14', '15', '16'], '汇点 16 祖先 16 > 汇点 23 祖先 7；起点并列取 id 最小');
  assert.equal(r.anchorTop, 1000, '锚顶 = 链上第二个节点 top');
});

test('layoutRefine.spineOf: 同一分量内等长双链，sink-coverage 按祖先覆盖决胜', () => {
  // S(1) 同时喂侧链与 Hub；两条路径均为 5 节点：侧链汇点祖先 5，主链汇点祖先 13
  const nodes = [];
  const links = [];
  let lid = 1;
  nodes.push(N(1, 'S', [0, 0], [80, 60], { outputs: [{}] }));
  nodes.push(N(2, 'B1', [200, 0], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(3, 'B2', [400, 0], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(4, 'B3', [600, 0], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(5, 'SaveB', [800, 0], [80, 60], { inputs: [{}] }));
  for (let i = 6; i <= 13; i++) nodes.push(N(i, 'Src', [i * 40, 600], [80, 60], { outputs: [{}] }));
  nodes.push(N(14, 'Hub', [900, 600], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(15, 'A1', [1100, 600], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(16, 'A2', [1300, 600], [80, 60], { inputs: [{}], outputs: [{}] }));
  nodes.push(N(17, 'SaveA', [1500, 600], [80, 60], { inputs: [{}] }));
  links.push(L(`b${lid++}`, 1, 0, 2, 0), L(`b${lid++}`, 2, 0, 3, 0), L(`b${lid++}`, 3, 0, 4, 0), L(`b${lid++}`, 4, 0, 5, 0));
  links.push(L(`h${lid++}`, 1, 0, 14, 0));
  for (let i = 6; i <= 13; i++) links.push(L(`s${lid++}`, i, 0, 14, 0));
  links.push(L(`a${lid++}`, 14, 0, 15, 0), L(`a${lid++}`, 15, 0, 16, 0), L(`a${lid++}`, 16, 0, 17, 0));
  const m = buildModel({ nodes, links, groups: [] });
  const pos = new Map(nodes.map((n) => [String(n.id), [n.pos[0], n.pos[1]]]));
  assert.deepEqual(spineOf(m, pos, null, { strategy: 'longest' }).chain, ['1', '2', '3', '4', '5'], '现状：等长时先遇到侧链');
  assert.deepEqual(spineOf(m, pos, null, { strategy: 'sink-coverage' }).chain, ['1', '14', '15', '16', '17'], '提案：祖先覆盖 13 > 5');
});

test('layoutRefine.spineOf: sink-coverage 排除 Note 汇点', () => {
  const m = buildModel({
    nodes: [
      N(1, 'Load', [0, 0], [80, 60], { outputs: [{}] }),
      N(2, 'Mid', [200, 0], [80, 60], { inputs: [{}], outputs: [{}] }),
      N(3, 'Proc', [400, 0], [80, 60], { inputs: [{}], outputs: [{}] }),
      N(4, 'Save', [600, 0], [80, 60], { inputs: [{}] }),
      N(5, 'Extra', [200, 200], [80, 60], { outputs: [{}] }),
      N(6, 'Note', [800, 200], [200, 120], { inputs: [{}] }),
    ],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0), L('e3', 3, 0, 4, 0), L('e4', 1, 0, 6, 0), L('e5', 5, 0, 6, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [200, 0]], ['3', [400, 0]], ['4', [600, 0]], ['5', [200, 200]], ['6', [800, 200]]]);
  const r = spineOf(m, pos, null, { strategy: 'sink-coverage' });
  assert.deepEqual(r.chain, ['1', '2', '3', '4'], 'Note 汇点不参与主链（即使祖先更多）');
});

test('layoutRefine.spineOf: 单链上两种判据一致', () => {
  const m = buildModel({
    nodes: [
      N(1, 'A', [0, 0], [80, 60], { outputs: [{}] }),
      N(2, 'B', [200, 10], [80, 60], { inputs: [{}], outputs: [{}] }),
      N(3, 'C', [400, 20], [80, 60], { inputs: [{}] }),
    ],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [200, 10]], ['3', [400, 20]]]);
  assert.deepEqual(spineOf(m, pos, null, { strategy: 'longest' }).chain, ['1', '2', '3']);
  assert.deepEqual(spineOf(m, pos, null, { strategy: 'sink-coverage' }).chain, ['1', '2', '3']);
});

test('layoutRefine.spineOf: sink-coverage 含环仍返回空链', () => {
  const m = buildModel({
    nodes: [N(1, 'A', [0, 0]), N(2, 'B', [200, 0]), N(3, 'C', [400, 0])],
    links: [L('e1', 1, 0, 2, 0), L('e2', 2, 0, 3, 0), L('e3', 3, 0, 1, 0)],
    groups: [],
  });
  const pos = new Map([['1', [0, 0]], ['2', [200, 0]], ['3', [400, 0]]]);
  assert.deepEqual(spineOf(m, pos, null, { strategy: 'sink-coverage' }).chain, []);
});

test('layoutRefine.layoutSpineTracks: 直接扇入源按目标口顺序锚定主链源（下口在下）', () => {
  // 主链 A(1)→Hub(2)→C(3)；Hub 5 个输入，主链源 A 接最下口 slot4，侧源 10..13 接 slot0..3
  const build = (spineSlot) => {
    const nodes = [
      N(1, 'A', [0, 0], [100, 100], { outputs: [{}] }),
      N(2, 'Hub', [300, 0], [200, 300], { inputs: [{}, {}, {}, {}, {}], outputs: [{}] }),
      N(3, 'C', [700, 0], [100, 100], { inputs: [{}] }),
    ];
    const links = [L('e1', 1, 0, 2, spineSlot), L('e2', 2, 0, 3, 0)];
    let lid = 1;
    if (spineSlot === 4) {
      for (let i = 0; i < 4; i++) { nodes.push(N(10 + i, `Src${i}`, [0, 0], [100, 100], { outputs: [{}] })); links.push(L(`s${lid++}`, 10 + i, 0, 2, i)); }
    } else {
      for (let i = 0; i < 3; i++) { nodes.push(N(10 + i, `Src${i}`, [0, 0], [100, 100], { outputs: [{}] })); links.push(L(`s${lid++}`, 10 + i, 0, 2, i + 1)); }
    }
    const m = buildModel({ nodes, links, groups: [] });
    const pos = new Map(nodes.map((n) => [String(n.id), [0, 0]]));
    const r = layoutSpineTracks(m, pos, { spine: { chain: ['1', '2', '3'], ids: new Set(['1', '2', '3']), anchorTop: 0 }, inlineGap: 50, layerGap: 60, sideGap: 60, nodeGap: 40, align: 'auto' });
    return r.positions;
  };
  // 主链源接最下口 → 侧源全部在它上方，且按口序从上到下
  const pUp = build(4);
  const ay = pUp.get('1')[1];
  const ys = [0, 1, 2, 3].map((i) => pUp.get(String(10 + i))[1]);
  assert.ok(ys.every((y) => y < ay), `侧源应全部在主链源上方（spine y=${ay}, side=${ys}）`);
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2] && ys[2] < ys[3], '上方侧源按目标口序从上到下');
  // 主链源接最上口 → 侧源全部在它下方，且按口序从上到下
  const pDown = build(0);
  const ay2 = pDown.get('1')[1];
  const ys2 = [0, 1, 2].map((i) => pDown.get(String(10 + i))[1]);
  assert.ok(ys2.every((y) => y > ay2), `侧源应全部在主链源下方（spine y=${ay2}, side=${ys2}）`);
  assert.ok(ys2[0] < ys2[1] && ys2[1] < ys2[2], '下方侧源按目标口序从上到下');
});
