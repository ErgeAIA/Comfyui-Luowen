// 络纹 LuoWen — 障碍几何（Geometry Core，纯函数、零依赖）
// 输入：节点矩形数组 [{id,x,y,w,h,collapsed}]（adapter 层从活动图采集）
// 输出：CM router 期望的原始矩形 [x, y, w, h]（router 内部做 clearance/vPad 膨胀与 hard+4 判定）
// 版本化：布局 rect-hash —— 布局不变则 hash 不变，路由缓存隐式全量失效（CM registry 模式）

export function obstacleHash(rects) {
  const parts = rects
    .map((r) => `${r.id}|${r.x}|${r.y}|${r.w}|${r.h}|${r.collapsed ? 1 : 0};`)
    .sort();
  return parts.join('');
}

export function toRawRects(rects, excludeIds) {
  const skip = excludeIds ? new Set(excludeIds) : null;
  const out = [];
  for (const r of rects) {
    if (skip && skip.has(r.id)) continue;
    out.push([r.x, r.y, r.w, r.h]);
  }
  return out;
}

// 直线走廊净空预检：两端节点自身的矩形必须排除（端点贴在节点边缘上）
export function corridorClear(ax, ay, bx, by, rects, excludeIds, clearance = 16, vPad = 8) {
  const skip = excludeIds ? new Set(excludeIds) : null;
  const minx = Math.min(ax, bx) - clearance;
  const maxx = Math.max(ax, bx) + clearance;
  const miny = Math.min(ay, by) - clearance - vPad;
  const maxy = Math.max(ay, by) + clearance + vPad;
  for (const r of rects) {
    if (skip && skip.has(r.id)) continue;
    if (r.x + r.w > minx && r.x < maxx && r.y + r.h > miny && r.y < maxy) return false;
  }
  return true;
}
