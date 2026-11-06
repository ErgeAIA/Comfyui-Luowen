import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BEVEL_RATIO,
  MIN_LEG,
  chamferPolyline,
  findSharedPoints,
} from '../../luowen/web/geometry/chamfer.js';

// 绕障外角基准：v=(300,300)，两腿 280/280，节点右缘 280、下缘 110
// → gap=(20,190)（一近一远，符合绕障判据），ratio=0.6 时两腿切 154。
const DETOUR_PTS = [[300, 20], [300, 300], [20, 300]];
const DETOUR_NODE = [[0, 0, 280, 110]];

function diagSegments(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    if (dx > 0.5 && dy > 0.5) out.push([pts[i - 1], pts[i], dx, dy]);
  }
  return out;
}

test('findSharedPoints: 主干分叉点被识别为共享点', () => {
  const p1 = [[0, 100], [80, 100], [80, 40], [200, 40]];
  const p2 = [[0, 100], [80, 100], [80, 300], [200, 300]];
  const shared = findSharedPoints([p1, p2]);
  assert.ok(shared.has('0,100'), '主干起点共享');
  assert.ok(shared.has('80,100'), 'T 点/分叉点共享');
  assert.ok(!shared.has('80,40'), '仅属于一条路径的转角不算共享');
});

test('合并树共享点一律直角（即使几何上是绕障外角）', () => {
  // 两条路径共用同一个绕障外角；该点进入 skip 集合后不得斜切
  const a = DETOUR_PTS;
  const b = [[300, 20], [300, 300], [20, 240]];
  const shared = findSharedPoints([a, b]);
  assert.ok(shared.has('300,300'));
  const outA = chamferPolyline(a, { ratio: 0.6, obstacles: DETOUR_NODE, skip: shared });
  const outB = chamferPolyline(b, { ratio: 0.6, obstacles: DETOUR_NODE, skip: shared });
  assert.deepEqual(outA, DETOUR_PTS, '共享 T 点必须保持直角');
  assert.ok(outB.some(([x, y]) => x === 300 && y === 300), '共享点必须保留');
  assert.equal(diagSegments(outA).length, 0);
});

test('绕障外角：两腿等长时近似 45° 大斜切', () => {
  const out = chamferPolyline(DETOUR_PTS, { ratio: 0.6, obstacles: DETOUR_NODE });
  // 两腿可用 256/256 → 切 154/154（等边）
  assert.deepEqual(out, [[300, 20], [300, 146], [146, 300], [20, 300]]);
  const diag = diagSegments(out);
  assert.equal(diag.length, 1, '只产生一段斜边');
  assert.equal(diag[0][2], diag[0][3], '等长腿 → 斜边接近 45°');
});

test('绕障外角：一近一远按各腿独立计算，不强求 45°', () => {
  const pts = [[300, 80], [300, 300], [20, 300]]; // 纵腿 220、横腿 280
  const out = chamferPolyline(pts, { ratio: 0.6, obstacles: DETOUR_NODE });
  // 可用 196/256 → 切 118/154，斜边两端不等距
  assert.deepEqual(out, [[300, 80], [300, 182], [146, 300], [20, 300]]);
  const [p1, p2] = [out[1], out[2]];
  assert.equal(p1[0], 300, '纵腿切点仍在 x=300');
  assert.equal(p2[1], 300, '横腿切点仍在 y=300');
  assert.notEqual(Math.abs(p1[1] - 300), Math.abs(p2[0] - 300), '两腿切长不同，斜边非 45°');
});

test('大斜切档位：更高 ratio 切得更长', () => {
  const lo = chamferPolyline(DETOUR_PTS, { ratio: 0.35, obstacles: DETOUR_NODE });
  const mid = chamferPolyline(DETOUR_PTS, { ratio: 0.6, obstacles: DETOUR_NODE });
  assert.deepEqual(lo, [[300, 20], [300, 210], [210, 300], [20, 300]]);
  assert.deepEqual(mid, [[300, 20], [300, 146], [146, 300], [20, 300]]);
  assert.ok(300 - mid[1][1] > 300 - lo[1][1], '0.6 档切掉的边长大于 0.35 档');
});

test('普通正交阶梯不倒角（无绕障语义）', () => {
  const pts = [[0, 0], [40, 0], [40, 40]];
  assert.deepEqual(chamferPolyline(pts, { ratio: 0.6 }), pts);
  // 节点只贴一条臂、且不在转角内侧象限
  assert.deepEqual(chamferPolyline(pts, { ratio: 0.6, obstacles: [[0, -80, 30, 60]] }), pts);
  // 节点在内侧象限但两腿都离得远 → 不是绕障，宁可少倒
  assert.deepEqual(chamferPolyline(pts, { ratio: 0.6, obstacles: [[-180, 60, 30, 30]] }), pts);
});

test('端点节点不参与绕障判定：端口出/入引脚段保持直角', () => {
  // 同一个绕障几何，但节点属于本连接端点 → 不得斜切
  const out = chamferPolyline(DETOUR_PTS, {
    ratio: 0.6,
    obstacles: DETOUR_NODE,
    excludeIndices: [0],
  });
  assert.deepEqual(out, DETOUR_PTS);
});

test('某腿短到切完没有可见直段时整体退回直角', () => {
  // 横腿仅 40px < MIN_LEG + MIN_CUT，不可切
  const short = [[300, 20], [300, 300], [260, 300]];
  assert.deepEqual(chamferPolyline(short, { ratio: 0.6, obstacles: DETOUR_NODE }), short);
  // 横腿 100px：切 46px，仍保留 54px 直段
  const ok = chamferPolyline([[300, 20], [300, 300], [200, 300]], {
    ratio: 0.6,
    obstacles: DETOUR_NODE,
  });
  assert.deepEqual(ok, [[300, 20], [300, 146], [254, 300], [200, 300]]);
  assert.ok(ok[2][0] - 200 >= MIN_LEG, '切后横腿保留 >= MIN_LEG');
});

test('斜边净空不通过时按比例缩短切角', () => {
  // 额外卡片压在完整斜边的中部，迫使切角缩小
  const blocker = [216, 216, 14, 14];
  const out = chamferPolyline(DETOUR_PTS, {
    ratio: 0.6,
    obstacles: [...DETOUR_NODE, blocker],
  });
  assert.ok(diagSegments(out).length === 1, '仍保留斜切');
  const cut = 300 - out[1][1];
  assert.ok(cut < 154, `切角应被缩短（实际 ${cut}）`);
  assert.ok(cut >= 24, '缩短后不低于最小切角');
  assert.ok(out[1][1] - 20 >= MIN_LEG, '纵腿保留可见正交段');
  assert.ok(out[2][0] - 20 >= MIN_LEG, '横腿保留可见正交段');
});

test('斜边贴近其他线路时按比例缩短切角', () => {
  // 另一条线路横穿完整斜边的中部
  const other = [[180, 230], [250, 230]];
  const out = chamferPolyline(DETOUR_PTS, {
    ratio: 0.6,
    obstacles: DETOUR_NODE,
    others: [other],
  });
  assert.equal(diagSegments(out).length, 1);
  const cut = 300 - out[1][1];
  assert.ok(cut <= 154, '不得超出完整切角');
  assert.ok(cut < 154, `遇到近距线路应缩短（实际 ${cut}）`);
  assert.ok(cut >= 24);
});

test('净空怎么缩都不达标时整体退回直角', () => {
  // 放大净空 pad 使节点包住整个斜边扫掠扇区：任何档位都无法净空
  const out = chamferPolyline(DETOUR_PTS, {
    ratio: 0.6,
    obstacles: DETOUR_NODE,
    nodePad: 200,
  });
  assert.deepEqual(out, DETOUR_PTS);
});

test('共线/零长度顶点不产生斜切', () => {
  const pts = [[0, 0], [20, 0], [40, 0], [40, 40], [40, 40]];
  const out = chamferPolyline(pts, { ratio: 0.6 });
  assert.deepEqual(out, pts);
});

test('默认档位常量为 0.6（待用户选定后固化）', () => {
  assert.equal(DEFAULT_BEVEL_RATIO, 0.6);
});
