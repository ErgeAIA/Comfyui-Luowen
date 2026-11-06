// 络纹 LuoWen — 节点位置对齐吸附（阶段 3A-1 纯几何内核）
//
// 纯函数：所有输入输出均为**图坐标（graph units）**，不出现屏幕像素、缩放或画布变换。
// 调用方负责把指针位移换算成图坐标、在原生 rAF 之后调用本函数，再把 position 写回节点。
//
// 规则：
//   - 每轴独立：x 用 left/center/right，y 用 top/middle/bottom，两轴互不影响。
//   - 进入吸附：距离 <= snapTol（默认 10 图 px）才捕获候选。
//   - 迟滞解除：已处于吸附态（state 命中且候选仍在）时，偏移 <= releaseTol（默认 15 图 px）
//     继续吸附，超过才解除；解除后需重新回到 snapTol 内才会再次吸附。
//   - 候选优先级：距离差 < SNAP_TIE_WINDOW(2) 的近似平手时，相连邻居（adjacent=true）优先；
//     同档取更近；距离完全相同但落点不同 → 视为歧义，该轴不吸附。
//     距离差 >= 2 时取更近者（邻居身份不越级覆盖明显更近的对齐）。
//   - 多选拖动由调用方传 multiSelect=true 跳过；设置开关关闭由 enabled=false 跳过。
//   - 3A-2 扩展：候选可带 `yTarget`（相连邻居的引脚行目标，图坐标），该候选在 y 轴只按
//     movedAnchor='top' 匹配这一个目标，不再展开 top/middle/bottom；`skipX=true` 时 x 轴忽略它。
//     用于把被拖动节点的引脚行对齐到邻居引脚行（连线变直），不改 3A-1 的矩形候选语义。
//
// 契约见 tests/unit/alignSnap.test.mjs。

export const DEFAULT_SNAP_TOL = 10;
export const DEFAULT_RELEASE_TOL = 15;
export const SNAP_TIE_WINDOW = 2;

const EPS = 1e-6;

const AXIS_ANCHORS = {
  x: ['left', 'center', 'right'],
  y: ['top', 'middle', 'bottom'],
};

function anchorValue(axis, anchor, rect) {
  const origin = axis === 'x' ? rect.x : rect.y;
  const extent = axis === 'x' ? rect.w : rect.h;
  if (anchor === 'center' || anchor === 'middle') return origin + extent / 2;
  if (anchor === 'right' || anchor === 'bottom') return origin + extent;
  return origin;
}

function hasRect(r) {
  return (
    r != null &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.w) &&
    Number.isFinite(r.h)
  );
}

function validRect(r) {
  return r != null && r.id != null && hasRect(r);
}

function hasPinTarget(r) {
  return r != null && Number.isFinite(r.yTarget);
}

function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 从当前候选重新捕获一条轴上的最优对齐；无候选返回 null。
function acquireAxis(axis, moved, candidates, snapTol) {
  const anchors = AXIS_ANCHORS[axis];
  const options = [];

  for (const cand of candidates) {
    // x 轴：pin 候选与 skipX 候选不参与
    if (axis === 'x' && (cand?.skipX || !validRect(cand))) continue;
    if (validRect(cand)) {
      for (const movedAnchor of anchors) {
        const from = anchorValue(axis, movedAnchor, moved);
        for (const candAnchor of anchors) {
          const target = anchorValue(axis, candAnchor, cand);
          const offset = target - from;
          const distance = Math.abs(offset);
          if (distance > snapTol) continue;
          options.push({
            distance,
            offset,
            target,
            sourceId: cand.id,
            movedAnchor,
            candAnchor,
            adjacent: !!cand.adjacent,
          });
        }
      }
    }
    // y 轴：相连邻居的引脚行目标（只按被拖动节点 top 匹配这一个目标）
    if (axis === 'y' && hasPinTarget(cand)) {
      const offset = cand.yTarget - moved.y;
      const distance = Math.abs(offset);
      if (distance <= snapTol) {
        options.push({
          distance,
          offset,
          target: cand.yTarget,
          sourceId: cand.id,
          movedAnchor: 'top',
          candAnchor: 'pin',
          adjacent: !!cand.adjacent,
        });
      }
    }
  }

  if (!options.length) return null;

  let minDistance = Infinity;
  for (const o of options) if (o.distance < minDistance) minDistance = o.distance;

  // 近似平手窗口内才让「相连邻居」优先；窗口外仍由距离决定。
  const near = options.filter((o) => o.distance - minDistance < SNAP_TIE_WINDOW);
  const adjacentNear = near.filter((o) => o.adjacent);
  const pool = adjacentNear.length ? adjacentNear : near;

  pool.sort(
    (a, b) =>
      a.distance - b.distance ||
      compareIds(String(a.sourceId), String(b.sourceId)) ||
      anchors.indexOf(a.movedAnchor) - anchors.indexOf(b.movedAnchor) ||
      anchors.indexOf(a.candAnchor) - anchors.indexOf(b.candAnchor)
  );

  const best = pool[0];

  // 同级等距但落点不同 = 歧义，不吸附。
  for (const o of pool) {
    if (o === best) continue;
    if (Math.abs(o.distance - best.distance) < EPS && Math.abs(o.offset - best.offset) > EPS) {
      return null;
    }
  }

  return best;
}

// 先看上一帧的吸附是否仍在迟滞范围内；否则重新捕获。
function resolveAxis(axis, moved, candidates, prev, snapTol, releaseTol) {
  if (prev && prev.sourceId != null) {
    const anchors = AXIS_ANCHORS[axis];
    const isPin = axis === 'y' && prev.candAnchor === 'pin';
    const anchorOk = isPin
      ? anchors.includes(prev.movedAnchor)
      : anchors.includes(prev.movedAnchor) && anchors.includes(prev.candAnchor);
    if (anchorOk) {
      let cand = null;
      for (const c of candidates) {
        if (String(c?.id) !== String(prev.sourceId)) continue;
        if (isPin ? hasPinTarget(c) : validRect(c)) {
          cand = c;
          break;
        }
      }
      if (cand) {
        const from = anchorValue(axis, prev.movedAnchor, moved);
        const target = isPin ? cand.yTarget : anchorValue(axis, prev.candAnchor, cand);
        const offset = target - from;
        if (Math.abs(offset) <= releaseTol) {
          return {
            offset,
            target,
            sourceId: cand.id,
            movedAnchor: prev.movedAnchor,
            candAnchor: prev.candAnchor,
            held: true,
          };
        }
      }
    }
  }
  return acquireAxis(axis, moved, candidates, snapTol);
}

function idleResult(pos, skipped) {
  return {
    position: { x: pos.x, y: pos.y },
    delta: { x: 0, y: 0 },
    snapped: { x: false, y: false },
    guides: { x: null, y: null },
    state: null,
    skipped,
  };
}

function guideOf(axis, snap) {
  if (!snap) return null;
  return {
    axis,
    at: snap.target,
    sourceId: snap.sourceId,
    movedAnchor: snap.movedAnchor,
    candAnchor: snap.candAnchor,
    held: !!snap.held,
  };
}

function stateOf(snap) {
  if (!snap) return null;
  return {
    sourceId: snap.sourceId,
    movedAnchor: snap.movedAnchor,
    candAnchor: snap.candAnchor,
  };
}

/**
 * @param {object} input
 * @param {{x:number,y:number}} input.pos   被拖动节点左上角的图坐标（原生未吸附位置）
 * @param {{w:number,h:number}} input.size  被拖动节点尺寸（图坐标）
 * @param {Array<{id:*,x:number,y:number,w:number,h:number,adjacent?:boolean,yTarget?:number,skipX?:boolean}>} [input.candidates]
 *        其他节点矩形（graphRead.nodeRects 同形）；adjacent=true 表示相连邻居。
 *        yTarget（可选，图坐标）= 被拖动节点 top 的目标值（引脚行对齐），y 轴只按 top 匹配它；
 *        skipX=true 时该候选不参与 x 轴（引脚行候选用）。
 * @param {{x:object|null,y:object|null}|null} [input.state] 上一帧返回的 state（迟滞用）
 * @param {boolean} [input.multiSelect] 多选拖动 → 跳过吸附
 * @param {boolean} [input.enabled]     设置开关 → false 时跳过吸附
 * @param {number} [input.snapTol]      进入吸附阈值（图坐标，默认 10）
 * @param {number} [input.releaseTol]   解除吸附阈值（图坐标，默认 15；小于 snapTol 时按 snapTol）
 * @returns {{
 *   position:{x:number,y:number}, delta:{x:number,y:number},
 *   snapped:{x:boolean,y:boolean},
 *   guides:{x:null|object,y:null|object},
 *   state:{x:null|object,y:null|object},
 *   skipped:null|'multi-select'|'disabled'
 * }}
 */
export function alignSnap({
  pos,
  size,
  candidates = [],
  state = null,
  multiSelect = false,
  enabled = true,
  snapTol = DEFAULT_SNAP_TOL,
  releaseTol = DEFAULT_RELEASE_TOL,
} = {}) {
  const moved = {
    x: Number(pos?.x ?? 0),
    y: Number(pos?.y ?? 0),
    w: Math.max(0, Number(size?.w ?? 0)),
    h: Math.max(0, Number(size?.h ?? 0)),
  };

  if (!enabled) return idleResult(moved, 'disabled');
  if (multiSelect) return idleResult(moved, 'multi-select');
  if (!Number.isFinite(moved.x) || !Number.isFinite(moved.y)) {
    return idleResult({ x: 0, y: 0 }, null);
  }

  const enter = Math.max(0, Number(snapTol) || 0);
  const release = Math.max(enter, Number(releaseTol) || 0);

  const snapX = resolveAxis('x', moved, candidates, state?.x ?? null, enter, release);
  const snapY = resolveAxis('y', moved, candidates, state?.y ?? null, enter, release);

  return {
    position: {
      x: moved.x + (snapX?.offset ?? 0),
      y: moved.y + (snapY?.offset ?? 0),
    },
    delta: { x: snapX?.offset ?? 0, y: snapY?.offset ?? 0 },
    snapped: { x: !!snapX, y: !!snapY },
    guides: { x: guideOf('x', snapX), y: guideOf('y', snapY) },
    state: { x: stateOf(snapX), y: stateOf(snapY) },
    skipped: null,
  };
}
