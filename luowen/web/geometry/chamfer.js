// 络纹 LuoWen — 绕障外角大斜切（纯函数，DEC-012 修订）
//
// 语义（用户 2026-11-06 第三轮确认）：
//   - 仅对「为绕开第三方节点而形成的那个外凸拐角」把直角切掉一大块，用长斜边连接两腿；
//     不是全局样式，也不再是 4px 微倒角。
//   - cutA / cutB 按两条腿各自可用长度独立计算：等长时近似 45°，一近一远时自然形成
//     浅角/陡角，不强求等边。
//   - 每腿切完后仍须保留 >= MIN_LEG 的可见正交段；不足则退回直角，不允许从引脚直接起飞长斜线。
//   - 合并树共享点（主干 T 点、分叉点、同向分叉点、公共走廊）一律直角；
//     普通正交阶梯、端口出/入引脚段一律直角。
//   - 斜边净空采样：穿过任何节点矩形（含 nodePad）或贴近其他线路（< linePad）时
//     按比例缩短切角；低于 MIN_CUT 退回直角。
//   - 命中/悬停/删除按实际绘制折线（含斜边），不再使用正交骨架。
//   - 不产生任意斜线走线：除该斜切外，其余段仍水平/竖直；与 smooth 圆角互斥（调用方保证）。

// 默认档位 0.6（用户已确认：目标是视觉省位，不追求「三角区能塞进节点」）。
// 0.35 / 0.85 仅作调试对比，不改变默认行为。
export const DEFAULT_BEVEL_RATIO = 0.6;
// 每腿至少保留的可见正交段（与默认 stub 24 同量级）。
export const MIN_LEG = 24;
// 小于该值的切角视为无意义微倒角，直接直角。
export const MIN_CUT = 24;
// 斜边与节点矩形的安全间距。
export const NODE_PAD = 6;
// 斜边与其他线路的最小间距。
export const LINE_PAD = 10;

// 绕障判定：较近的一条边距 <= GAP_NEAR_MAX，较远的一条 <= GAP_FAR_MAX。
// 用户场景实测 gap ≈ (155, 35)；本机高避障档实测 gap ≈ (191, 53)：
// 一近一远仍算绕障，但不允许两条边都离得很远（那只是普通正交阶梯）。
const GAP_NEAR_MAX = 64;
const GAP_FAR_MAX = 200;
// 斜边净空采样步长（px）。
const SAMPLE_STEP = 4;

function key(p) {
  return `${Math.round(p[0] * 2) / 2},${Math.round(p[1] * 2) / 2}`;
}

// 组内共享点：同一坐标出现在 >=2 条成员路径上，即合并树上的主干段、公共走廊、
// T 点/分叉点、同向分叉点。这些位置一律直角。
export function findSharedPoints(paths) {
  const owners = new Map();
  paths.forEach((pts, idx) => {
    if (!Array.isArray(pts) || pts.length < 2) return;
    for (const p of pts) {
      const k = key(p);
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k).add(idx);
    }
  });
  const out = new Set();
  for (const [k, s] of owners) if (s.size >= 2) out.add(k);
  return out;
}

// 绕障外角判定：转角内侧象限完整包住某个节点矩形，两条臂分别贴着它的两条垂直边
// （间距在绕行间隙内），且臂长越过节点角点。端点节点（本连接自身 origin/target）
// 不参与判定，保证端口出/入引脚段保持直角。
function wrapsNode(v, qx, qy, horizLen, vertLen, obstacles, exclude) {
  if (!obstacles || !obstacles.length) return false;
  for (let i = 0; i < obstacles.length; i++) {
    if (exclude && exclude.has(i)) continue;
    const [x, y, w, h] = obstacles[i];
    const maxX = x + w;
    const maxY = y + h;
    // 节点必须完全落在内侧象限（以 v 为原点，qx/qy 为象限方向）
    if (qx < 0 ? maxX > v[0] : x < v[0]) continue;
    if (qy < 0 ? maxY > v[1] : y < v[1]) continue;
    const gapX = qx < 0 ? v[0] - maxX : x - v[0];
    const gapY = qy < 0 ? v[1] - maxY : y - v[1];
    if (gapX < 0 || gapY < 0) continue;
    const near = Math.min(gapX, gapY);
    const far = Math.max(gapX, gapY);
    if (near > GAP_NEAR_MAX || far > GAP_FAR_MAX) continue;
    // 臂必须沿节点两条边伸过角点，否则只是从节点旁边掠过
    if (horizLen < gapX || vertLen < gapY) continue;
    return true;
  }
  return false;
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function polylineBox(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function boxesNear(a, b, pad) {
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}

// 斜边净空采样：只检查斜边内部采样点（两端点仍在原正交臂上，属于既有路径）。
// obstacles 为 [x,y,w,h]；others 为其他线路折线（已预计算包围盒）。
function segmentClear(ax, ay, bx, by, obstacles, others, nodePad, linePad) {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(2, Math.ceil(len / SAMPLE_STEP));
  const box = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    if (obstacles && obstacles.length) {
      for (const [x, y, w, h] of obstacles) {
        if (px > x - nodePad && px < x + w + nodePad && py > y - nodePad && py < y + h + nodePad) {
          return false;
        }
      }
    }
    if (others && others.length) {
      for (const o of others) {
        if (!boxesNear(box, o.box, linePad)) continue;
        for (let j = 1; j < o.pts.length; j++) {
          const [sx, sy] = o.pts[j - 1];
          const [ex, ey] = o.pts[j];
          if (pointSegDist(px, py, sx, sy, ex, ey) < linePad) return false;
        }
      }
    }
  }
  return true;
}

// ---------- 预筛索引（性能项 2） ----------
// 目的：把「每条线全量扫障碍、全量重建其他线包围盒」换成「每帧建一次格网，逐线按折线包围盒取近邻」。
// 正确性前提（查询盒按 PREFILTER_MARGIN 外扩）：
//   - wrapsNode 的被绕节点两条边距角点分别 <= GAP_NEAR_MAX / GAP_FAR_MAX，
//     即节点整体落在角点 GAP_FAR_MAX 内 → 必在外扩盒内，不会被漏筛；
//   - segmentClear 的斜边采样点都在折线包围盒内，障碍需落在 +nodePad、他线需落在 +linePad 内，
//     两者都 <= PREFILTER_MARGIN。
// 排序差异不影响结果：wrapsNode 只返回真假，segmentClear 命中即返回 false。
export const PREFILTER_MARGIN = GAP_FAR_MAX;
const PRE_CELL = 256;

function cellSpan(minX, minY, maxX, maxY, cell) {
  return {
    x0: Math.floor(minX / cell),
    y0: Math.floor(minY / cell),
    x1: Math.floor(maxX / cell),
    y1: Math.floor(maxY / cell),
  };
}

// obstacles: [{ id, rect:[x,y,w,h] }]；paths: [{ id, pts }]
// query(box, {excludeIds, selfId}) → { obstacles: [[x,y,w,h]], excludeIndices, others: [pts] }
export function createChamferIndex({ obstacles = [], paths = [], cell = PRE_CELL } = {}) {
  const obs = [];
  const obsCells = new Map();
  obstacles.forEach((o) => {
    const rect = Array.isArray(o) ? o : o?.rect;
    if (!Array.isArray(rect)) return;
    const box = [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]];
    const i = obs.length;
    obs.push({ id: o && o.id != null ? String(o.id) : null, rect, box });
    const s = cellSpan(box[0], box[1], box[2], box[3], cell);
    for (let cx = s.x0; cx <= s.x1; cx++) {
      for (let cy = s.y0; cy <= s.y1; cy++) {
        const k = cx + ',' + cy;
        let arr = obsCells.get(k);
        if (!arr) obsCells.set(k, (arr = []));
        arr.push(i);
      }
    }
  });

  const pat = [];
  const patCells = new Map();
  paths.forEach((p) => {
    const pts = p?.pts;
    if (!Array.isArray(pts) || pts.length < 2) return;
    const box = polylineBox(pts);
    const i = pat.length;
    pat.push({ id: p.id != null ? String(p.id) : null, pts, box });
    const s = cellSpan(box[0], box[1], box[2], box[3], cell);
    for (let cx = s.x0; cx <= s.x1; cx++) {
      for (let cy = s.y0; cy <= s.y1; cy++) {
        const k = cx + ',' + cy;
        let arr = patCells.get(k);
        if (!arr) patCells.set(k, (arr = []));
        arr.push(i);
      }
    }
  });

  return {
    query(box, { excludeIds = null, selfId = null } = {}) {
      const q = [box[0] - PREFILTER_MARGIN, box[1] - PREFILTER_MARGIN, box[2] + PREFILTER_MARGIN, box[3] + PREFILTER_MARGIN];
      const s = cellSpan(q[0], q[1], q[2], q[3], cell);
      const outObstacles = [];
      const excludeIndices = [];
      const seenObs = new Set();
      for (let cx = s.x0; cx <= s.x1; cx++) {
        for (let cy = s.y0; cy <= s.y1; cy++) {
          const arr = obsCells.get(cx + ',' + cy);
          if (!arr) continue;
          for (const i of arr) {
            if (seenObs.has(i)) continue;
            seenObs.add(i);
            const o = obs[i];
            if (!boxesNear(q, o.box, 0)) continue;
            outObstacles.push(o.rect);
            if (excludeIds && o.id != null && excludeIds.has(o.id)) excludeIndices.push(outObstacles.length - 1);
          }
        }
      }
      const others = [];
      const seenPat = new Set();
      for (let cx = s.x0; cx <= s.x1; cx++) {
        for (let cy = s.y0; cy <= s.y1; cy++) {
          const arr = patCells.get(cx + ',' + cy);
          if (!arr) continue;
          for (const i of arr) {
            if (seenPat.has(i)) continue;
            seenPat.add(i);
            const p = pat[i];
            if (selfId != null && p.id === String(selfId)) continue;
            if (!boxesNear(q, p.box, 0)) continue;
            others.push(p.pts);
          }
        }
      }
      return { obstacles: outObstacles, excludeIndices, others };
    },
  };
}

// 单条正交折线大斜切。skip 为组内共享点集合；obstacles 为节点矩形；
// others 为其他线路折线；excludeIndices 为本连接端点节点的下标（不作为「被绕节点」）。
export function chamferPolyline(pts, opts = {}) {
  const {
    ratio = DEFAULT_BEVEL_RATIO,
    skip = null,
    obstacles = [],
    others = [],
    excludeIndices = null,
    minLeg = MIN_LEG,
    minCut = MIN_CUT,
    nodePad = NODE_PAD,
    linePad = LINE_PAD,
  } = opts;
  if (!Array.isArray(pts) || pts.length < 3) return pts;
  const r = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  if (!(r > 0)) return pts;

  const exclude = excludeIndices ? new Set(excludeIndices) : null;
  const otherBoxes = others
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map((p) => ({ pts: p, box: polylineBox(p) }));

  const n = pts.length;
  const segLen = new Array(n - 1).fill(0);
  const segAxis = new Array(n - 1).fill(false);
  for (let i = 0; i < n - 1; i++) {
    const dx = Math.abs(pts[i + 1][0] - pts[i][0]);
    const dy = Math.abs(pts[i + 1][1] - pts[i][1]);
    segLen[i] = dx + dy;
    segAxis[i] = (dx < 0.5) !== (dy < 0.5); // 恰好沿一个轴；斜段不参与
  }

  // 第一遍：收集绕障外角候选（几何判据 + 两腿都能切出 MIN_CUT）
  const cand = new Array(n).fill(false);
  for (let i = 1; i < n - 1; i++) {
    const v = pts[i];
    if (!segAxis[i - 1] || !segAxis[i]) continue;
    if (segLen[i - 1] < minLeg + minCut || segLen[i] < minLeg + minCut) continue;
    if (skip && skip.has(key(v))) continue;
    const inDx = v[0] - pts[i - 1][0];
    const inDy = v[1] - pts[i - 1][1];
    const outDx = pts[i + 1][0] - v[0];
    const outDy = pts[i + 1][1] - v[1];
    const horizLen = Math.abs(inDx) > 0.5 ? segLen[i - 1] : segLen[i];
    const vertLen = Math.abs(inDy) > 0.5 ? segLen[i - 1] : segLen[i];
    const qx = Math.abs(inDx) > 0.5 ? -Math.sign(inDx) : Math.sign(outDx);
    const qy = Math.abs(inDy) > 0.5 ? -Math.sign(inDy) : Math.sign(outDy);
    if (!wrapsNode(v, qx, qy, horizLen, vertLen, obstacles, exclude)) continue;
    cand[i] = true;
  }

  // 每条边的可用上限：两端都是候选时各占一半，保证中间仍留 >= minLeg 的直段，
  // 避免相邻两个大斜切在同一段上互相吃掉。
  const usable = new Array(n - 1).fill(0);
  for (let e = 0; e < n - 1; e++) {
    const both = cand[e] && cand[e + 1];
    usable[e] = Math.max(0, segLen[e] - minLeg - (both ? minLeg : 0));
    if (both) usable[e] = Math.min(usable[e], (segLen[e] - minLeg) / 2);
  }

  // 第二遍：按各腿独立可用长度计算 cutA/cutB，净空失败则按比例缩短，仍不达标则直角。
  const out = [pts[0]];
  for (let i = 1; i < n - 1; i++) {
    const v = pts[i];
    if (!cand[i]) {
      out.push(v);
      continue;
    }
    const inLen = segLen[i - 1];
    const outLen = segLen[i];
    const inDx = Math.sign(v[0] - pts[i - 1][0]);
    const inDy = Math.sign(v[1] - pts[i - 1][1]);
    const outDx = Math.sign(pts[i + 1][0] - v[0]);
    const outDy = Math.sign(pts[i + 1][1] - v[1]);

    let cutIn = Math.round(r * usable[i - 1]);
    let cutOut = Math.round(r * usable[i]);
    if (cutIn < minCut || cutOut < minCut) {
      out.push(v);
      continue;
    }
    // 可用长度本身也不能超过腿长（防御异常输入）
    cutIn = Math.min(cutIn, inLen);
    cutOut = Math.min(cutOut, outLen);

    let placed = false;
    for (let s = 20; s >= 1; s--) {
      const t = s / 20;
      const ci = Math.round(cutIn * t);
      const co = Math.round(cutOut * t);
      if (ci < minCut || co < minCut) break;
      const p1 = [v[0] - inDx * ci, v[1] - inDy * ci];
      const p2 = [v[0] + outDx * co, v[1] + outDy * co];
      if (segmentClear(p1[0], p1[1], p2[0], p2[1], obstacles, otherBoxes, nodePad, linePad)) {
        out.push(p1, p2);
        placed = true;
        break;
      }
    }
    if (!placed) out.push(v);
  }
  out.push(pts[n - 1]);
  return out;
}
