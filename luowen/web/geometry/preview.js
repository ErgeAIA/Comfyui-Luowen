// 络纹 LuoWen — 拖拽期正交预览（原创，不依赖 A*）
//
// 节点拖动过程中，端点移动的线需要每帧重画；此时跑 A* 违反 PRD §10.1（热路径禁止搜索）。
// 这里给出廉价的两折正交路径：起点沿出线方向 stub → 一个直角 → 终点入线 stub → 终点。
// 松手后下一帧由适配器用 A* + 障碍严格模式重算，预览路径不进缓存。

const DIR_VEC = {
  none: [1, 0],
  right: [1, 0],
  left: [-1, 0],
  up: [0, -1],
  down: [0, 1],
};

export function previewPath(ax, ay, bx, by, startDir, endDir, stubOut = 24, stubIn = 24) {
  const sv = DIR_VEC[startDir] ?? DIR_VEC.right;
  const ev = DIR_VEC[endDir] ?? DIR_VEC.left;
  const pts = [[ax, ay]];
  const push = (x, y) => {
    const last = pts[pts.length - 1];
    if (Math.abs(x - last[0]) > 0.5 || Math.abs(y - last[1]) > 0.5) pts.push([x, y]);
  };
  const sx = ax + sv[0] * stubOut;
  const sy = ay + sv[1] * stubOut;
  const ex = bx + ev[0] * stubIn;
  const ey = by + ev[1] * stubIn;
  push(sx, sy);
  if (Math.abs(sx - ex) > 0.5 && Math.abs(sy - ey) > 0.5) {
    // 出线方向决定先横后竖还是先竖后横，保证拐角处与引脚方向一致
    if (sv[0] === 0) push(sx, ey);
    else push(ex, sy);
  }
  push(ex, ey);
  push(bx, by);
  // 共线冗余点折叠（stub 与端点同线时不留拐点）
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const colinear = (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5);
    if (!colinear) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}