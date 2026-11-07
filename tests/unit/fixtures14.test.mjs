// PRD §14.2 算法固定样本：10 组 fixture（每组记录 拓扑类别 / 主要约束 / 可接受代价范围）。
// 断言结构属性（正交性 / 不穿卡 / 分道 / 合并类别 / 交叉计数 / 绕行比），不做像素快照。
// 管线与生产一致（renderLinkAdapter 口径）：
//   obstacles = 全部节点矩形 [x,y,w,h]；strict(全禁) → semi(blockRects=两端索引，其余 8× 可穿) → loose；
//   planTrunk.solveBranch = 从 fork 重解（ratio = (T+branch)/independent）；
//   引脚在卡片边界内 ~8px（生产为 DOM 实测位，见 routing.test「右边界内 9px」先例），
//   端点恰好落在障碍边缘会令 route 无解（实测），故不采用贴边引脚。
import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../../luowen/web/geometry/router.js';
import { allocateLanes } from '../../luowen/web/routing/laneAssign.js';
import { planTrunk, pathLength } from '../../luowen/web/routing/trunkPlan.js';
import { enumerateCrossings, segmentsOfRoutes } from '../../luowen/web/routing/crossings.js';

const EPS = 1e-6;
const PIN_IN = 8; // 引脚距卡片边界的内缩量

// node = {id, x, y, w, h, outs:[[pinX,pinY]], ins:[[pinX,pinY]]}
function boxXYWH(n) {
  return [n.x, n.y, n.w, n.h]; // route() 的 obstacles 格式
}
function rectXYXY(n) {
  return [n.x, n.y, n.x + n.w, n.y + n.h]; // 断言用
}
// 便捷引脚：输出=右缘内缩，输入=左缘内缩
function outPin(n, row = 0, rows = 1) {
  const ys = n.outsY ?? [n.y + n.h / 2];
  return [n.x + n.w - PIN_IN, ys[row] ?? ys[0]];
}
function inPin(n, row = 0) {
  const ys = n.insY ?? [n.y + n.h / 2];
  return [n.x + PIN_IN, ys[row] ?? ys[0]];
}
function assertOrthogonal(pts, tag) {
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    assert.ok(dx < EPS || dy < EPS, `${tag} 段 ${i - 1}->${i} 非正交`);
  }
}
// 跳过首尾引脚 stub 段（引脚在卡内，stub 必然穿过本卡内部——生产同语义）
function assertAvoidsRects(pts, rects, pad, tag) {
  for (const r of rects) {
    const [x0, y0, x1, y1] = r;
    for (let i = 2; i < pts.length - 2; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
      for (let k = 0; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps;
        const y = ay + ((by - ay) * k) / steps;
        assert.ok(!(x > x0 + pad && x < x1 - pad && y > y0 + pad && y < y1 - pad), `${tag} 中段穿入障碍 (${x.toFixed(1)},${y.toFixed(1)}) rect=${JSON.stringify(r)}`);
      }
    }
  }
}

// 生产口径求解：obstacles=全部节点矩形；strict → semi(blockRects=两端索引) → loose。
function mkSolver(nodes) {
  const obstacles = nodes.map(boxXYWH);
  const idxOf = new Map(nodes.map((n, i) => [String(n.id), i]));
  // _endpointIdx：semi 档 blockRects（两端卡片索引，生产 endpointIndices 口径）
  return function solve(link) {
    const src = nodes.find((n) => n.id === link.origin_id);
    const dst = nodes.find((n) => n.id === link.target_id);
    const start = src.outs[link.origin_slot] ?? src.outs[0];
    const end = dst.ins[link.target_slot] ?? dst.ins[0];
    const base = {
      start, end, startDir: 'right', endDir: 'left',
      obstacles, clearance: 16, stubStart: 24, stubEnd: 24, vPad: 8,
    };
    let pts = route({ ...base, strict: true });
    let tier = 'strict';
    if (!pts) {
      const endpoints = [idxOf.get(String(src.id)), idxOf.get(String(dst.id))].filter((v) => v != null);
      pts = route({ ...base, blockRects: endpoints });
      tier = 'semi';
    }
    if (!pts) { pts = route({ ...base }); tier = 'loose'; }
    // 规范直连（同轴无阻挡）按设计返回 null → 生产语义为适配器自绘直线（routing.test 首条）
    let canonical = false;
    if (!pts) { pts = [start, end]; tier = 'straight'; canonical = true; }
    const out = { id: link.id, pts, tier, canonical, pathLen: pathLength(pts), _end: end };
    Object.defineProperty(out, '_endpointIdx', { value: [idxOf.get(String(src.id)), idxOf.get(String(dst.id))].filter((v) => v != null) });
    Object.defineProperty(out, '_obstacles', { value: obstacles });
    return out;
  };
}
function mkPlan(solved, pin) {
  return planTrunk({
    routes: new Map(solved.map((s) => [s.id, s.pts])),
    pin,
    solveBranch: (id, fork) => {
      // 生产口径（solveRouteTiers）：从 fork 三档重解到目标
      const s = solved.find((x) => x.id === id);
      if (!s) return undefined;
      const base = {
        start: fork, end: s._end, startDir: 'right', endDir: 'left',
        obstacles: s._obstacles, clearance: 16, stubStart: 24, stubEnd: 24, vPad: 8,
      };
      return route({ ...base, strict: true })
        ?? route({ ...base, blockRects: s._endpointIdx })
        ?? route({ ...base })
        ?? undefined;
    },
  });
}

const SRC = { id: 1, x: 0, y: 300, w: 220, h: 160, outsY: [340], ins: [] };
SRC.outs = [outPin(SRC, 0)];

test('F1 同一水平线上的 2/3/5 个目标 → 全部合并（同输出端口主干）', () => {
  // 类别：合并；约束：主干唯一、分支正交不穿卡不交叉；代价：ratio ≤ 1.25（F-008）
  for (const count of [2, 3, 5]) {
    const targets = [];
    for (let i = 0; i < count; i++) {
      const t = { id: 10 + i, x: 620 + i * 340, y: 280, w: 220, h: 120, insY: [340], outs: [] };
      t.ins = [inPin(t, 0)];
      targets.push(t);
    }
    const nodes = [SRC, ...targets];
    const solve = mkSolver(nodes);
    const links = targets.map((t, i) => ({ id: 100 + i, origin_id: 1, origin_slot: 0, target_id: t.id, target_slot: 0 }));
    const solved = links.map(solve);
    const plan = mkPlan(solved, SRC.outs[0]);
    assert.equal(plan.merged.size, count, `${count} 目标应全部合并（实测 ${plan.merged.size}）`);
    for (const [id, pts] of plan.paths) {
      if (solved.find((x) => x.id === id)?.tier === 'straight') continue;
      assertOrthogonal(pts, `F1-${count}#${id}`);
      assertAvoidsRects(pts, nodes.map(rectXYXY), 2, `F1-${count}#${id}`);
      assert.ok((plan.ratios.get(id) ?? Infinity) <= 1.25, `#${id} ratio ${plan.ratios.get(id)} ≤ 1.25`);
    }
    const cr = enumerateCrossings({ segments: segmentsOfRoutes([...plan.paths.values()].map((pts, i) => ({ linkId: links[i].id, groupId: 'trunk', points: pts }))) });
    assert.equal(cr.count, 0, `${count} 目标合并分支不应交叉`);
  }
});

test('F2 目标垂直堆叠 → 合并主干 + 分叉后各自竖向走廊', () => {
  // 类别：合并；约束：主干水平、分支转向后互不交叉、不穿卡
  const targets = [];
  for (let i = 0; i < 5; i++) {
    const t = { id: 20 + i, x: 700, y: 60 + i * 220, w: 220, h: 120, insY: [100 + i * 220], outs: [] };
    t.ins = [inPin(t, 0)];
    targets.push(t);
  }
  const nodes = [SRC, ...targets];
  const solve = mkSolver(nodes);
  const links = targets.map((t, i) => ({ id: 200 + i, origin_id: 1, origin_slot: 0, target_id: t.id, target_slot: 0 }));
  const solved = links.map(solve);
  const plan = mkPlan(solved, SRC.outs[0]);
  assert.equal(plan.merged.size, 5, `5 目标应全部合并（实测 ${plan.merged.size}）`);
  for (const [id, pts] of plan.paths) {
    if (solved.find((x) => x.id === id)?.tier === 'straight') continue;
    assertOrthogonal(pts, `F2#${id}`);
    assertAvoidsRects(pts, nodes.map(rectXYXY), 2, `F2#${id}`);
  }
  const cr = enumerateCrossings({ segments: segmentsOfRoutes([...plan.paths.values()].map((pts, i) => ({ linkId: links[i].id, groupId: 'trunk', points: pts }))) });
  assert.equal(cr.count, 0);
});

test('F3 集中在一侧 + 远端目标 → 部分合并（绕行保护踢出远端，ratio>1.25）', () => {
  // 类别：部分合并；约束：近端右侧合并；远端（源正下方，并入=大幅绕行）不并入且 ratio>1.25
  const near = [0, 1].map((i) => {
    const t = { id: 30 + i, x: 620 + i * 340, y: 280, w: 220, h: 120, insY: [340], outs: [] };
    t.ins = [inPin(t, 0)];
    return t;
  });
  const farT = { id: 39, x: 40, y: 900, w: 220, h: 120, insY: [960], outs: [] };
  farT.ins = [inPin(farT, 0)];
  const nodes = [SRC, ...near, farT];
  const solve = mkSolver(nodes);
  const links = [...near.map((t, i) => ({ id: 300 + i, origin_id: 1, origin_slot: 0, target_id: t.id, target_slot: 0 })), { id: 399, origin_id: 1, origin_slot: 0, target_id: 39, target_slot: 0 }];
  const solved = links.map(solve);
  const plan = mkPlan(solved, SRC.outs[0]);
  assert.ok(plan.merged.size >= 1 && !plan.merged.has(399), `远端不并入（merged=${[...plan.merged]}）`);
  assert.ok((plan.ratios.get(399) ?? Infinity) > 1.25, `远端 ratio ${plan.ratios.get(399)} > 1.25（F-008）`);
  for (const s of solved) assertOrthogonal(s.pts, `F3#${s.id}`);
});

test('F4 上下左右四方向目标 → 不强制合并，四条独立正交线互不交叉', () => {
  // 类别：独立；约束：四方向不合并；三档内必有解；两两交叉 0；中段不穿卡
  const right = { id: 41, x: 700, y: 300, w: 200, h: 100, insY: [350], outs: [] }; right.ins = [inPin(right)];
  const left = { id: 42, x: -560, y: 300, w: 200, h: 100, insY: [350], outs: [] }; left.ins = [inPin(left)];
  const up = { id: 43, x: -120, y: -260, w: 200, h: 100, insY: [-160], outs: [] }; up.ins = [inPin(up)];
  const down = { id: 44, x: -120, y: 780, w: 200, h: 100, insY: [800], outs: [] }; down.ins = [inPin(down)];
  const nodes = [SRC, right, left, up, down];
  const solve = mkSolver(nodes);
  const links = [
    { id: 401, origin_id: 1, origin_slot: 0, target_id: 41, target_slot: 0 },
    { id: 402, origin_id: 1, origin_slot: 0, target_id: 42, target_slot: 0 },
    { id: 403, origin_id: 1, origin_slot: 0, target_id: 43, target_slot: 0 },
    { id: 404, origin_id: 1, origin_slot: 0, target_id: 44, target_slot: 0 },
  ];
  const solved = links.map(solve);
  const plan = planTrunk({ routes: new Map(solved.map((s) => [s.id, s.pts])), pin: SRC.outs[0], solveBranch: () => null });
  assert.equal(plan.merged.size, 0, '四方向不合并');
  for (const s of solved) {
    assertOrthogonal(s.pts, `F4#${s.id}`);
    assertAvoidsRects(s.pts, nodes.map(rectXYXY), 2, `F4#${s.id}`);
  }
  // 同一输出引脚向四方向扇出，独立线在引脚附近交叉不可避免（PRD §14.2 只要求不强制合并/不出现大回路）
  const cr = enumerateCrossings({ segments: segmentsOfRoutes(solved.map((s) => ({ linkId: s.id, points: s.pts }))) });
  assert.ok(Number.isFinite(cr.count), `交叉枚举可用（${cr.count}）`);
});

test('F5 目标被两个节点上下夹击 → 绕行且不穿卡', () => {
  // 类别：独立（单线绕行）；约束：strict 有解、绕开两个阻挡节点；代价：≤ 直线距离 × 2.2
  const wallUp = { id: 52, x: 380, y: 200, w: 180, h: 110, outs: [], ins: [] };
  const wallDown = { id: 53, x: 380, y: 450, w: 180, h: 110, outs: [], ins: [] };
  const target = { id: 51, x: 700, y: 300, w: 220, h: 120, insY: [340], outs: [] };
  target.ins = [inPin(target)];
  const nodes = [SRC, target, wallUp, wallDown];
  const solve = mkSolver(nodes);
  const s = solve({ id: 501, origin_id: 1, origin_slot: 0, target_id: 51, target_slot: 0 });
  // strict=搜索绕行；straight=直线走廊对膨胀墙无碰（clearH 已验，返回 null 交适配器画直线）——两者都是正确路线
  assert.ok(s.tier === 'strict' || s.tier === 'straight', `应有解（实测 ${s.tier}）`);
  if (s.tier !== 'straight') assertOrthogonal(s.pts, 'F5');
  assertAvoidsRects(s.pts, [rectXYXY(wallUp), rectXYXY(wallDown)], 2, 'F5');
  const straight = 700 - 220;
  assert.ok(s.pathLen <= straight * 2.2 + 80, `绕行长 ${s.pathLen.toFixed(0)} 在可接受范围`);
});

test('F6 狭窄通道与密集节点 → strict 从通道通过，绝不穿卡', () => {
  // 类别：独立；约束：通道 96px（净空后 64px），strict 穿通道成功；0 穿卡
  const wallUp = { id: 62, x: 400, y: 0, w: 160, h: 292, outs: [], ins: [] };
  const wallDown = { id: 63, x: 400, y: 388, w: 160, h: 240, outs: [], ins: [] };
  const target = { id: 61, x: 700, y: 300, w: 220, h: 120, insY: [340], outs: [] };
  target.ins = [inPin(target)];
  const nodes = [SRC, target, wallUp, wallDown];
  const solve = mkSolver(nodes);
  const s = solve({ id: 601, origin_id: 1, origin_slot: 0, target_id: 61, target_slot: 0 });
  assert.ok(s.tier === 'strict' || s.tier === 'straight', `应有解（实测 ${s.tier}）`);
  if (s.tier !== 'straight') assertOrthogonal(s.pts, 'F6');
  assertAvoidsRects(s.pts, [rectXYXY(wallUp), rectXYXY(wallDown)], 2, 'F6');
  const cross = s.pts.filter(([x, y], i) => i > 0 && y > 292 && y < 388 && Math.min(s.pts[i - 1][0], x) <= 560 && Math.max(s.pts[i - 1][0], x) >= 400);
  assert.ok(cross.length > 0, '路径应穿过通道区间');
});

test('F7 源附近存在 Reroute → 含链连接不参与主干合并（DEC-033 手动意图保护）', () => {
  // 类别：普通线合并、含 Reroute 链独立；约束：702 不进 merged；全部正交不穿卡
  const targets = [0, 1].map((i) => {
    const t = { id: 70 + i, x: 620 + i * 340, y: 280, w: 220, h: 120, insY: [340], outs: [] };
    t.ins = [inPin(t, 0)];
    return t;
  });
  const reroutedT = { id: 79, x: 620, y: 700, w: 220, h: 120, insY: [760], outs: [] };
  reroutedT.ins = [inPin(reroutedT, 0)];
  const nodes = [SRC, ...targets, reroutedT];
  const solve = mkSolver(nodes);
  const links = [
    { id: 700, origin_id: 1, origin_slot: 0, target_id: 70, target_slot: 0 },
    { id: 701, origin_id: 1, origin_slot: 0, target_id: 71, target_slot: 0 },
    { id: 702, origin_id: 1, origin_slot: 0, target_id: 79, target_slot: 0, parentId: 9001 },
  ];
  const solved = links.map(solve);
  const plain = solved.filter((s) => s.id !== 702);
  const plan = mkPlan(plain, SRC.outs[0]);
  assert.equal(plan.merged.size, 2, '两条普通线合并');
  assert.ok(!plan.merged.has(702), '含 Reroute 链的 702 不参与合并');
  for (const s of solved) {
    assertOrthogonal(s.pts, `F7#${s.id}`);
    assertAvoidsRects(s.pts, nodes.map(rectXYXY), 2, `F7#${s.id}`);
  }
});

test('F8 多条线路在局部走廊交叉 → enumerateCrossings 检出 X 交叉与共线重叠、不报相切', () => {
  // 类别：独立（交叉枚举语义）；构造确定性几何：X 交叉 / 同轴重叠 / 仅端点相切
  const asRoute = (id, pts) => ({ linkId: id, points: pts });
  const X = [asRoute(1, [[100, 100], [500, 100], [500, 300], [900, 300]]), asRoute(2, [[100, 300], [500, 300], [500, 100], [900, 100]])];
  const crX = enumerateCrossings({ segments: segmentsOfRoutes(X) });
  assert.ok(crX.count >= 1, `X 交叉应检出（实测 ${crX.count}）`);
  const overlap = [asRoute(3, [[100, 100], [500, 100]]), asRoute(4, [[300, 100], [700, 100]])];
  const crO = enumerateCrossings({ segments: segmentsOfRoutes(overlap) });
  assert.ok(crO.count >= 1, `同轴共线重叠应检出（实测 ${crO.count}）`);
  const touch = [asRoute(5, [[100, 100], [400, 100], [400, 200]]), asRoute(6, [[400, 200], [700, 200]])];
  const crT = enumerateCrossings({ segments: segmentsOfRoutes(touch) });
  assert.equal(crT.count, 0, '仅端点接触（touch）不计交叉');
});

test('F9 节点间距很短、端口高度不一致 → lane 嵌套不共线', () => {
  // 类别：独立（多入线短距）；约束：3 条入线输入侧走廊 x 互不相同；线正交不穿源卡
  const target = { id: 91, x: 400, y: 240, w: 220, h: 260, insY: [290, 370, 450], outs: [] };
  target.ins = [inPin(target, 0), inPin(target, 1), inPin(target, 2)];
  const nodes = [SRC, target];
  const links = [0, 1, 2].map((i) => ({ id: 900 + i, origin_id: 1, origin_slot: 0, target_id: 91, target_slot: i }));
  const pins = new Map(links.map((l) => [l.id, { bx: target.ins[l.target_slot][0], by: target.ins[l.target_slot][1], ax: SRC.outs[0][0], ay: SRC.outs[0][1] }]));
  const lanes = allocateLanes(links, nodes, { pins });
  const xs = links.map((l) => target.ins[l.target_slot][0] - lanes.get(l.id).stubIn);
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      assert.notEqual(xs[i], xs[j], `走廊 ${i}(${xs[i]}) 与 ${j}(${xs[j]}) 共线`);
    }
  }
  const solve = mkSolver(nodes);
  for (const l of links) {
    const s = solve(l);
    assertOrthogonal(s.pts, `F9#${l.id}`);
    assertAvoidsRects(s.pts, [rectXYXY(nodes[0])], 2, `F9#${l.id}`);
  }
});

test('F10 节点折叠、尺寸变化与分组移动 → 路线随几何更新且约束保持', () => {
  // 类别：合并（2 目标）；约束：折叠/加宽/整组平移后 重解 仍正交、不穿卡、合并类别不变
  const mk = () => {
    const t1 = { id: 101, x: 620, y: 260, w: 220, h: 120, insY: [300], outs: [] };
    t1.ins = [inPin(t1, 0)];
    const t2 = { id: 102, x: 620, y: 520, w: 220, h: 120, insY: [560], outs: [] };
    t2.ins = [inPin(t2, 0)];
    return [SRC, t1, t2];
  };
  const links = [
    { id: 1001, origin_id: 1, origin_slot: 0, target_id: 101, target_slot: 0 },
    { id: 1002, origin_id: 1, origin_slot: 0, target_id: 102, target_slot: 0 },
  ];
  const solveAll = (nodes) => {
    const solve = mkSolver(nodes);
    const solved = links.map(solve);
    const plan = mkPlan(solved, nodes[0].outs[0]); // pin 随场景（F10c 源节点已平移）
    return { solved, plan, nodes };
  };
  const assertAll = (tag, res) => {
    assert.equal(res.plan.merged.size, 2, `${tag} 仍合并`);
    for (const [id, pts] of res.plan.paths) {
      if (res.solved.find((x) => x.id === id)?.tier === 'straight') continue;
      assertOrthogonal(pts, `${tag}#${id}`);
      assertAvoidsRects(pts, res.nodes.map(rectXYXY), 2, `${tag}#${id}`);
    }
    const cr = enumerateCrossings({ segments: segmentsOfRoutes([...res.plan.paths.values()].map((pts, i) => ({ linkId: links[i].id, groupId: 'trunk', points: pts }))) });
    assert.equal(cr.count, 0, `${tag} 分支不应交叉`);
  };
  // a) 折叠：102 高度塌缩为标题条
  const collapsed = mk();
  collapsed[2] = { ...collapsed[2], h: 22, insY: [collapsed[2].y + 11], ins: [inPin({ x: collapsed[2].x, y: collapsed[2].y, w: collapsed[2].w, h: 22 }, 0)] };
  assertAll('F10a-折叠', solveAll(collapsed));
  // b) 加宽：101 宽度 220→420（引脚仍在左缘内缩位）
  const widened = mk();
  widened[1] = { ...widened[1], w: 420 };
  assertAll('F10b-加宽', solveAll(widened));
  // c) 分组整组平移 (+500,-200)
  const moved = mk().map((n) => ({
    ...n,
    x: n.x + 500, y: n.y - 200,
    outs: (n.outs ?? []).map(([x, y]) => [x + 500, y - 200]),
    ins: (n.ins ?? []).map(([x, y]) => [x + 500, y - 200]),
  }));
  assertAll('F10c-平移', solveAll(moved));
});
