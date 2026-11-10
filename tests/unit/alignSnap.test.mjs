import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignSnap,
  DEFAULT_SNAP_TOL,
  DEFAULT_RELEASE_TOL,
  SNAP_TIE_WINDOW,
  GRID_SIZE,
} from '../../luowen/web/snap/alignSnap.js';

// 约定：所有坐标均为图坐标（graph units），此处没有任何缩放/屏幕像素换算。

test('alignSnap: 常量按图坐标口径（snapTol=10 / releaseTol=15 / 平手窗口=2）', () => {
  assert.equal(DEFAULT_SNAP_TOL, 10);
  assert.equal(DEFAULT_RELEASE_TOL, 15);
  assert.equal(SNAP_TIE_WINDOW, 2);
});

test('alignSnap: 每轴独立，只有 x 命中时只吸 x', () => {
  const r = alignSnap({
    pos: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [{ id: 1, x: 9, y: 300, w: 100, h: 50 }],
  });
  assert.equal(r.snapped.x, true);
  assert.equal(r.snapped.y, false);
  assert.deepEqual(r.position, { x: 9, y: 0 });
  assert.deepEqual(r.delta, { x: 9, y: 0 });
  assert.equal(r.guides.x.at, 9);
  assert.equal(r.guides.x.sourceId, 1);
  assert.equal(r.guides.y, null);
  assert.deepEqual(r.state.x, { sourceId: 1, movedAnchor: 'left', candAnchor: 'left' });
  assert.equal(r.state.y, null);
});

test('alignSnap: 两轴同时吸附，并记录实际命中的锚点（中心对中心 / 顶对顶）', () => {
  const r = alignSnap({
    pos: { x: 100, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [
      { id: 1, x: 144, y: 400, w: 12, h: 50 }, // 中心 150，与移动节点中心重合
      { id: 2, x: 800, y: 8, w: 100, h: 50 }, // 顶部 8
    ],
  });
  assert.deepEqual(r.snapped, { x: true, y: true });
  assert.deepEqual(r.position, { x: 100, y: 8 });
  assert.equal(r.guides.x.at, 150);
  assert.equal(r.guides.x.movedAnchor, 'center');
  assert.equal(r.guides.x.candAnchor, 'center');
  assert.equal(r.guides.y.at, 8);
  assert.equal(r.guides.y.movedAnchor, 'top');
});

test('alignSnap: 距离差 <2px 的平手窗口内，相连邻居优先', () => {
  const r = alignSnap({
    pos: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [
      { id: 1, x: 0.5, y: 200, w: 100, h: 50 }, // 其他节点，更近 0.5
      { id: 2, x: 1.5, y: 200, w: 100, h: 50, adjacent: true }, // 相连邻居 1.5
    ],
  });
  assert.equal(r.snapped.x, true);
  assert.equal(r.position.x, 1.5); // 2 - 0.5 = 1 < 2，邻居胜出
  assert.equal(r.guides.x.sourceId, 2);
});

test('alignSnap: 距离差 >=2px 时取更近者，邻居身份不越级覆盖', () => {
  const r = alignSnap({
    pos: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [
      { id: 1, x: 0.5, y: 200, w: 100, h: 50 }, // 其他节点 0.5
      { id: 2, x: 5, y: 200, w: 100, h: 50, adjacent: true }, // 邻居 5，差 4.5
    ],
  });
  assert.equal(r.snapped.x, true);
  assert.equal(r.position.x, 0.5);
  assert.equal(r.guides.x.sourceId, 1);
});

test('alignSnap: 同档候选取更近（距离差 <2px 时明确裁决）', () => {
  const r = alignSnap({
    pos: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [
      { id: 1, x: 3, y: 200, w: 100, h: 50 },
      { id: 2, x: 4, y: 200, w: 100, h: 50 },
    ],
  });
  assert.equal(r.snapped.x, true);
  assert.equal(r.position.x, 3);
  assert.equal(r.guides.x.sourceId, 1);
});

test('alignSnap: 同档等距但落点相反 → 歧义，该轴不吸附', () => {
  const r = alignSnap({
    pos: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [
      { id: 1, x: 5, y: 200, w: 100, h: 50 }, // 左对左：+5
      { id: 2, x: -105, y: 200, w: 100, h: 50 }, // 右对左：-5
    ],
  });
  assert.equal(r.snapped.x, false);
  assert.equal(r.position.x, 0);
  assert.equal(r.guides.x, null);
  assert.equal(r.state.x, null);
});

test('alignSnap: 同档等距但落点相同（重复候选）不算冲突', () => {
  const r = alignSnap({
    pos: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [
      { id: 1, x: 5, y: 200, w: 100, h: 50 },
      { id: 2, x: 5, y: 200, w: 100, h: 50 },
    ],
  });
  assert.equal(r.snapped.x, true);
  assert.equal(r.position.x, 5);
});

test('alignSnap: 迟滞——进入 10px 生效，脱离需超过 15px', () => {
  const size = { w: 100, h: 50 };
  const candidates = [{ id: 1, x: 0, y: 200, w: 100, h: 50 }];

  // 1) 距离 9 <= 10：进入吸附
  const f1 = alignSnap({ pos: { x: -9, y: 0 }, size, candidates });
  assert.equal(f1.snapped.x, true);
  assert.equal(f1.position.x, 0);

  // 2) 距离 12：已在吸附态，<=15 继续吸附
  const f2 = alignSnap({ pos: { x: -12, y: 0 }, size, candidates, state: f1.state });
  assert.equal(f2.snapped.x, true);
  assert.equal(f2.position.x, 0);
  assert.equal(f2.guides.x.held, true);

  // 3) 距离恰好 15：边界内继续吸附
  const f3 = alignSnap({ pos: { x: -15, y: 0 }, size, candidates, state: f2.state });
  assert.equal(f3.snapped.x, true);
  assert.equal(f3.position.x, 0);

  // 4) 距离 15.5 > 15：解除，且超出 10 不再重新捕获
  const f4 = alignSnap({ pos: { x: -15.5, y: 0 }, size, candidates, state: f3.state });
  assert.equal(f4.snapped.x, false);
  assert.equal(f4.position.x, -15.5);
  assert.equal(f4.state.x, null);

  // 5) 重新回到 9.5：再次进入
  const f5 = alignSnap({ pos: { x: -9.5, y: 0 }, size, candidates, state: f4.state });
  assert.equal(f5.snapped.x, true);
  assert.equal(f5.position.x, 0);

  // 6) 无吸附态时距离 11 > 10：不吸附（重新进入必须 <=10）
  const f6 = alignSnap({ pos: { x: -11, y: 0 }, size, candidates });
  assert.equal(f6.snapped.x, false);
  assert.equal(f6.position.x, -11);
});

test('alignSnap: 进入阈值边界 10 生效、10.5 不生效', () => {
  const size = { w: 100, h: 50 };
  const near = alignSnap({
    pos: { x: 0, y: 0 },
    size,
    candidates: [{ id: 1, x: 10, y: 200, w: 100, h: 50 }],
  });
  assert.equal(near.snapped.x, true);
  assert.equal(near.position.x, 10);

  const far = alignSnap({
    pos: { x: 0, y: 0 },
    size,
    candidates: [{ id: 1, x: 10.5, y: 200, w: 100, h: 50 }],
  });
  assert.equal(far.snapped.x, false);
  assert.equal(far.position.x, 0);
});

test('alignSnap: 多选拖动由调用方标志跳过，并清空迟滞状态', () => {
  const prev = {
    x: { sourceId: 1, movedAnchor: 'left', candAnchor: 'left' },
    y: null,
  };
  const r = alignSnap({
    pos: { x: 3, y: 4 },
    size: { w: 100, h: 50 },
    candidates: [{ id: 1, x: 0, y: 0, w: 100, h: 50, adjacent: true }],
    state: prev,
    multiSelect: true,
  });
  assert.equal(r.skipped, 'multi-select');
  assert.deepEqual(r.position, { x: 3, y: 4 });
  assert.deepEqual(r.snapped, { x: false, y: false });
  assert.equal(r.state, null);
});

test('alignSnap: 设置开关关闭时跳过', () => {
  const r = alignSnap({
    pos: { x: 1, y: 2 },
    size: { w: 100, h: 50 },
    candidates: [{ id: 1, x: 0, y: 0, w: 100, h: 50 }],
    enabled: false,
  });
  assert.equal(r.skipped, 'disabled');
  assert.deepEqual(r.position, { x: 1, y: 2 });
  assert.equal(r.state, null);
});

test('alignSnap: 大图坐标不引入屏幕像素量纲', () => {
  const r = alignSnap({
    pos: { x: 10000, y: 20000 },
    size: { w: 100, h: 50 },
    candidates: [{ id: 1, x: 10009, y: 20100, w: 100, h: 50 }],
  });
  assert.equal(r.snapped.x, true);
  assert.equal(r.position.x, 10009);
  assert.equal(r.snapped.y, false); // 9 组 y 锚点距离均 >10
});

test('alignSnap: yTarget（引脚行）只按 top 匹配并只吸 y，状态记为 pin', () => {
  const r = alignSnap({
    pos: { x: 0, y: 340 },
    size: { w: 100, h: 50 },
    candidates: [{ id: 2, yTarget: 339.5, adjacent: true, skipX: true }],
  });
  assert.deepEqual(r.snapped, { x: false, y: true });
  assert.deepEqual(r.position, { x: 0, y: 339.5 });
  assert.equal(r.guides.y.at, 339.5);
  assert.equal(r.guides.y.movedAnchor, 'top');
  assert.equal(r.guides.y.candAnchor, 'pin');
  assert.deepEqual(r.state.y, { sourceId: 2, movedAnchor: 'top', candAnchor: 'pin' });
  assert.equal(r.state.x, null);
});

test('alignSnap: skipX 候选即便有矩形也不参与 x 轴', () => {
  const r = alignSnap({
    pos: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [{ id: 3, x: 5, y: 200, w: 100, h: 50, skipX: true }],
  });
  assert.equal(r.snapped.x, false);
  assert.equal(r.position.x, 0);
});

test('alignSnap: yTarget 超出 10px 不吸附', () => {
  const r = alignSnap({
    pos: { x: 0, y: 340 },
    size: { w: 100, h: 50 },
    candidates: [{ id: 2, yTarget: 351, adjacent: true, skipX: true }],
  });
  assert.equal(r.snapped.y, false);
  assert.equal(r.position.y, 340);
});

test('alignSnap: yTarget 迟滞——进入 10px、11–15px 保持、超过 15px 解除', () => {
  const size = { w: 100, h: 50 };
  const candidates = [{ id: 2, yTarget: 339.5, adjacent: true, skipX: true }];

  const f1 = alignSnap({ pos: { x: 0, y: 348.5 }, size, candidates }); // 9
  assert.equal(f1.snapped.y, true);
  assert.equal(f1.position.y, 339.5);

  const f2 = alignSnap({ pos: { x: 0, y: 351.5 }, size, candidates, state: f1.state }); // 12
  assert.equal(f2.snapped.y, true);
  assert.equal(f2.guides.y.held, true);

  const f3 = alignSnap({ pos: { x: 0, y: 354.5 }, size, candidates, state: f2.state }); // 15
  assert.equal(f3.snapped.y, true);

  const f4 = alignSnap({ pos: { x: 0, y: 355 }, size, candidates, state: f3.state }); // 15.5
  assert.equal(f4.snapped.y, false);
  assert.equal(f4.state.y, null);
});

test('alignSnap: 2px 平手窗口内相连邻居的引脚行优先于更近的其他节点', () => {
  const r = alignSnap({
    pos: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    candidates: [
      { id: 1, x: 0, y: 0.5, w: 100, h: 50 }, // 其他节点，更近 0.5
      { id: 2, yTarget: 1.5, adjacent: true, skipX: true }, // 相连邻居引脚行 1.5
    ],
  });
  assert.equal(r.snapped.y, true);
  assert.equal(r.position.y, 1.5);
  assert.equal(r.guides.y.sourceId, 2);
  assert.equal(r.guides.y.candAnchor, 'pin');
});

test('alignSnap: 画布一小格 = 10 图坐标像素（背景 tile 100×100 内每 10 单位细线）', () => {
  assert.equal(GRID_SIZE, 10);
});

test('alignSnap: 吸附距离可调——15 图 px 偏移在 10 时不吸、20 时吸到 0', () => {
  const candidates = [{ id: 'a', x: 0, y: 15, w: 100, h: 100 }];
  const base = { pos: { x: 0, y: 0 }, size: { w: 100, h: 100 }, candidates };
  const tight = alignSnap({ ...base, snapTol: 10, releaseTol: 15 });
  assert.equal(tight.snapped.y, false);
  const loose = alignSnap({ ...base, snapTol: 20, releaseTol: 30 });
  assert.equal(loose.snapped.y, true);
  assert.equal(loose.position.y, 15);
});
