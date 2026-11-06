// 络纹 LuoWen — 阶段 0 技术可行性验证原型（PRD §15 阶段 0 交付物）。
//
// 目标：证明在 ComfyUI 前端 1.55.18 上——
//   1) 可以单点接管线路绘制（renderLink）并完整回滚；
//   2) 样式切换不改动任何原生图数据（数据不变性可机检）；
//   3) 悬停/命中/菜单/拖拽/删除等交互不被破坏（命中跟随自建 Path2D）。
//
// 边界（PRD §9/§10/§18）：只改绘制；demo 路径是 O(1) 折线样例，不做任何搜索；
// 运行时派生数据零落盘；异常单线隔离、失败回退原生。
//
// 适配依据（1.55.18 源码级核实，详见 docs/phase0/drawing-api-notes.md）：
//   - wrap 点：LGraphCanvas.prototype.renderLink(ctx, a, b, link, skip_border,
//     flow, color, start_dir, end_dir, {startControl,endControl,reroute,num_sublines,disabled})
//   - 命中：hitTesting.ts 用 ctx.isPointInStroke(segment.path, x*dpr, y*dpr)，
//     中心判定用 segment._pos 8×8 —— 两者都读"上帧渲染产物"，覆写即生效
//   - link===null 是拖拽预览线；opts.disabled 是 bypass；opts.reroute 是 reroute 共享段
//   - 全前端只有一个 LGraphCanvas 实例换 graph —— 原型层 wrap 自动覆盖根图与全部子图

const { app } = window.comfyAPI.app;

const STYLE_SETTING_ID = "LuoWen.Phase0.WireStyle";
const STUB = 12; // 端口 stub 长度（graph 坐标），PRD §7.2 的 demo 简化版

const state = {
  proto: null,
  originalRenderLink: null,
  wrappedRef: null,
  style: "native",
  baseline: null,
  fallbackWarned: false,
  capability: { checked: false, ok: false, reasons: [] },
};

// ---------- 工具 ----------

function activeGraph() {
  // app.graph 已 deprecated（永远返回根图）；活动图必须取 app.canvas.graph
  return app.canvas?.graph ?? null;
}

function snapshotGraph() {
  const g = activeGraph();
  if (!g) return null;
  const src = g.links;
  const list = src instanceof Map ? Array.from(src.values()) : Object.values(src ?? {});
  const links = list
    .map((l) => [l?.id, l?.origin_id, l?.origin_slot, l?.target_id, l?.target_slot, String(l?.type)])
    .sort((x, y) => (x?.[0] ?? 0) - (y?.[0] ?? 0));
  const nodes = Array.isArray(g._nodes) ? g._nodes : Array.isArray(g.nodes) ? g.nodes : [];
  return {
    kind: g.subgraph ? "subgraph" : "root",
    nodeCount: nodes.length,
    nodeIds: nodes.map((n) => n.id).sort((a, b) => a - b),
    linkCount: links.length,
    links,
  };
}

function diffSnapshot(a, b) {
  if (!a || !b) return ["snapshot-missing"];
  const diffs = [];
  if (a.kind !== b.kind) diffs.push(`graph-kind: ${a.kind} -> ${b.kind}`);
  if (a.nodeCount !== b.nodeCount) diffs.push(`node-count: ${a.nodeCount} -> ${b.nodeCount}`);
  if (a.linkCount !== b.linkCount) diffs.push(`link-count: ${a.linkCount} -> ${b.linkCount}`);
  const an = new Set(a.nodeIds);
  const bn = new Set(b.nodeIds);
  for (const id of an) if (!bn.has(id)) diffs.push(`node-added: ${id}`);
  for (const id of bn) if (!an.has(id)) diffs.push(`node-removed: ${id}`);
  const am = new Map(a.links.map((l) => [l[0], l]));
  const bm = new Map(b.links.map((l) => [l[0], l]));
  for (const [id, l] of am) {
    const r = bm.get(id);
    if (!r) {
      diffs.push(`link-removed: ${id}`);
    } else if (JSON.stringify(l) !== JSON.stringify(r)) {
      diffs.push(`link-changed: ${id} ${JSON.stringify(l)} -> ${JSON.stringify(r)}`);
    }
  }
  for (const [id] of bm) if (!am.has(id)) diffs.push(`link-added: ${id}`);
  return diffs;
}

function pt(p) {
  return Array.isArray(p) ? [p[0], p[1]] : [p?.x ?? 0, p?.y ?? 0];
}

// 正交样例路径（O(1)，非搜索）：stub → 水平/垂直先行的单拐肘形
function elbowPoints(a, b, startDir, endDir) {
  const [ax, ay] = pt(a);
  const [bx, by] = pt(b);
  // LinkDirection: 0 NONE, 1 UP, 2 DOWN, 3 LEFT, 4 RIGHT, 5 CENTER
  const horiz = (d) => d === 3 || d === 4;
  const sgn = (d) => (d === 3 ? -1 : d === 4 ? 1 : 0);
  if (horiz(startDir) && horiz(endDir)) {
    const p1 = [ax + sgn(startDir) * STUB, ay];
    const p3 = [bx + sgn(endDir) * STUB, by];
    const midX = (p1[0] + p3[0]) / 2;
    return [
      [ax, ay], p1, [midX, ay], [midX, by], p3, [bx, by],
    ];
  }
  if (!horiz(startDir) && !horiz(endDir) && (startDir === 1 || startDir === 2) && (endDir === 1 || endDir === 2)) {
    const p1 = [ax, ay + (startDir === 1 ? -STUB : STUB)];
    const p3 = [bx, by + (endDir === 1 ? -STUB : STUB)];
    const midY = (p1[1] + p3[1]) / 2;
    return [
      [ax, ay], p1, [ax, midY], [bx, midY], p3, [bx, by],
    ];
  }
  // 混合/缺省方向：水平先行单拐
  const midX = (ax + bx) / 2;
  return [
    [ax, ay], [midX, ay], [midX, by], [bx, by],
  ];
}

function polylineMidpoint(pts) {
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dy);
    segs.push(len);
    total += len;
  }
  let remain = total / 2;
  for (let i = 1; i < pts.length; i++) {
    if (remain <= segs[i - 1]) {
      const t = segs[i - 1] === 0 ? 0 : remain / segs[i - 1];
      return [
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ];
    }
    remain -= segs[i - 1];
  }
  return pts[pts.length - 1];
}

// ---------- 适配器 ----------

function checkCapability() {
  const reasons = [];
  const canvas = app?.canvas;
  if (!canvas) reasons.push("app.canvas 不存在");
  const proto = canvas ? Object.getPrototypeOf(canvas) : null;
  if (!proto || typeof proto?.renderLink !== "function") {
    reasons.push("LGraphCanvas.prototype.renderLink 不存在（前端架构可能已变）");
  }
  if (!canvas?.linkRenderer || typeof canvas?.linkRenderer?.renderLinkDirect !== "function") {
    reasons.push("canvas.linkRenderer.renderLinkDirect 不存在（1.55.x 的 adapter+pathRenderer 架构不在位）");
  }
  state.capability = { checked: true, ok: reasons.length === 0, reasons };
  return state.capability;
}

function wrappedRenderLink(ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, opts) {
  const o = opts ?? {};
  const seg = o.reroute ?? link;
  const canCustom =
    state.style === "orthogonal" &&
    a && b &&
    link && link.id != null && link.id >= 0 && // null = 拖拽预览线；负 id = floating link，均回退原生
    !o.disabled;
  if (!canCustom) {
    return state.originalRenderLink.apply(this, arguments);
  }
  try {
    const width = typeof this.connections_width === "number" ? this.connections_width : 2;
    const stroke = typeof color === "string" && color ? color : "#94a3b8";
    const hovered = this.over_link_center === seg;

    const pts = elbowPoints(a, b, start_dir, end_dir);
    const path = new Path2D();
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    const mid = polylineMidpoint(pts);

    ctx.save();
    ctx.lineWidth = width + (hovered ? 1.5 : 0);
    ctx.strokeStyle = stroke;
    ctx.lineJoin = "miter";
    ctx.lineCap = "round";
    ctx.stroke(path);
    // 中心 marker：与 _pos 对齐，供悬停 8×8 与线上菜单命中
    ctx.beginPath();
    ctx.arc(mid[0], mid[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = stroke;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.restore();

    // 命中跟随：hitTesting 用上帧渲染产物（isPointInStroke(seg.path)），覆写即生效
    if (seg) {
      seg.path = path;
      seg._pos = [mid[0], mid[1]];
    }
    return undefined;
  } catch (err) {
    // 异常单线隔离：本线回退原生，绝不逃逸进 ComfyUI 绘制循环（PRD §11.3）
    if (!state.fallbackWarned) {
      state.fallbackWarned = true;
      console.warn("[LuoWen.Phase0] 自绘失败，该线回退原生：", err);
    }
    return state.originalRenderLink.apply(this, arguments);
  }
}

function installRenderer() {
  if (state.originalRenderLink) return true;
  const proto = Object.getPrototypeOf(app.canvas);
  if (!proto || typeof proto.renderLink !== "function") return false;
  if (proto.renderLink.luowen_wrapped) return true; // 防双包
  const original = proto.renderLink;
  const wrapped = wrappedRenderLink;
  wrapped.luowen_wrapped = true;
  proto.renderLink = wrapped;
  state.proto = proto;
  state.originalRenderLink = original;
  state.wrappedRef = wrapped;
  return true;
}

function uninstallRenderer() {
  if (!state.originalRenderLink) return;
  // 仅当当前原型属性仍是我们的 wrap 时才还原（避免误拆他人后续包装）
  if (state.proto?.renderLink === state.wrappedRef) {
    state.proto.renderLink = state.originalRenderLink;
  }
  state.originalRenderLink = null;
  state.wrappedRef = null;
  state.proto = null;
}

function setStyle(v) {
  state.style = v === "orthogonal" ? "orthogonal" : "native";
  app.canvas?.setDirty?.(false, true);
  return state.style;
}

// ---------- 对外验证 API（浏览器 console / 自动化用） ----------

window.LuoWenPhase0 = {
  setStyle,
  install: installRenderer,
  uninstall() {
    uninstallRenderer();
    app.canvas?.setDirty?.(false, true);
  },
  rebase() {
    state.baseline = snapshotGraph();
    return state.baseline ? { ok: true, kind: state.baseline.kind, linkCount: state.baseline.linkCount } : { ok: false };
  },
  verify() {
    const now = snapshotGraph();
    const diffs = diffSnapshot(state.baseline, now);
    return {
      ok: diffs.length === 0,
      baseline: state.baseline
        ? { kind: state.baseline.kind, nodeCount: state.baseline.nodeCount, linkCount: state.baseline.linkCount }
        : null,
      now: now ? { kind: now.kind, nodeCount: now.nodeCount, linkCount: now.linkCount } : null,
      diffs,
    };
  },
  status() {
    return {
      style: state.style,
      installed: !!state.originalRenderLink,
      capability: state.capability,
      activeGraphKind: activeGraph()?.subgraph ? "subgraph" : "root",
    };
  },
};

// ---------- 扩展注册 ----------

app.registerExtension({
  name: "LuoWen.Phase0",

  settings: [
    {
      id: STYLE_SETTING_ID,
      name: "线路样式（阶段 0 demo）",
      category: ["LuoWen", "Phase0"],
      tooltip: "native = 原生渲染；orthogonal = 络纹正交样例路径（只改绘制，不改数据）",
      type: "combo",
      options: ["native", "orthogonal"],
      defaultValue: "native",
      onChange: (v) => setStyle(typeof v === "string" && v === "orthogonal" ? "orthogonal" : "native"),
    },
  ],

  afterConfigureGraph() {
    // 工作流每次加载/切换后重建基线快照（数据不变性的对照基准）
    state.baseline = snapshotGraph();
  },

  setup() {
    const cap = checkCapability();
    console.log("[LuoWen.Phase0] capability:", cap.ok ? "OK" : "FAIL", cap.reasons);
    if (cap.ok) {
      installRenderer();
      try {
        const saved = app.ui?.settings?.getSettingValue?.(STYLE_SETTING_ID);
        if (saved === "orthogonal") setStyle("orthogonal");
      } catch { /* 设置读取失败保持 native */ }
    }
    if (!state.baseline) state.baseline = snapshotGraph();
    console.log("[LuoWen.Phase0] ready — window.LuoWenPhase0 可用（setStyle/rebase/verify/status/uninstall）");
  },
});
