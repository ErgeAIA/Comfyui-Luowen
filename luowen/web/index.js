// 络纹 LuoWen — 扩展注册（阶段 1）
// 设置项（PRD §5.4 首版少而明确）：总开关 / 线路样式三选一 / 避障档位。
// 对外验证 API：window.LuoWen（status/rebase/verify——数据不变性机检，延续 phase0 方法）。

import {
  install,
  uninstall,
  setSettings,
  getStats,
  getDebugRoutes,
  getTrace,
  getCrossDebug,
  runCrossCleanup,
  CORNER_RADIUS_MAX,
} from './adapters/renderLinkAdapter.js';
import { DEFAULT_RADIUS } from './geometry/trace.js';
import { graphNodes, linkTuples } from './adapters/graphRead.js';
import { installSnap, uninstallSnap, setSnapEnabled, getSnapDebug } from './snap/dragSnap.js';

// 前端 1.55.18 只暴露 window.comfyAPI shim（见 docs/phase0/drawing-api-notes.md §2）
const { app } = window.comfyAPI.app;

const ENABLED_ID = 'LuoWen.Enabled';
const STYLE_ID = 'LuoWen.WireStyle';
const AVOID_ID = 'LuoWen.NodeAvoidance';
const CHAMFER_ID = 'LuoWen.Chamfer';
const CORNER_RADIUS_ID = 'LuoWen.CornerRadius';
const SNAP_ID = 'LuoWen.SnapAlign';
const CROSS_CLEANUP_ID = 'LuoWen.CrossCleanup';

const TIP_CLASS = 'luowen-tooltip';

// 设置项提示框宽度：1.55.18 的 PrimeVue 默认 max-width 为 200px（实测）。
// v-tooltip 的对象形式支持附加 class，因此只放宽带此标记的提示框，不影响其他扩展与全局设置页。
function installTooltipStyle() {
  if (document.getElementById('luowen-tooltip-style')) return;
  const style = document.createElement('style');
  style.id = 'luowen-tooltip-style';
  style.textContent = `.p-tooltip.${TIP_CLASS}{width:max-content;max-width:min(560px,calc(100vw - 2rem))}`;
  document.head.appendChild(style);
}

installTooltipStyle();

let baseline = null;

function snapshotGraph() {
  const g = app.canvas?.graph;
  if (!g) return null;
  const nodes = graphNodes(g);
  return {
    kind: g.subgraph ? 'subgraph' : 'root',
    nodeCount: nodes.length,
    nodeIds: nodes.map((n) => n.id).sort((a, b) => a - b),
    links: linkTuples(g),
  };
}

function diffSnapshot(a, b) {
  if (!a || !b) return ['snapshot-missing'];
  const diffs = [];
  if (a.kind !== b.kind) diffs.push(`graph-kind: ${a.kind} -> ${b.kind}`);
  if (a.nodeCount !== b.nodeCount) diffs.push(`node-count: ${a.nodeCount} -> ${b.nodeCount}`);
  if (a.links.length !== b.links.length) diffs.push(`link-count: ${a.links.length} -> ${b.links.length}`);
  const am = new Map(a.links.map((l) => [l[0], l]));
  const bm = new Map(b.links.map((l) => [l[0], l]));
  for (const [id, l] of am) {
    const r = bm.get(id);
    if (!r) diffs.push(`link-removed: ${id}`);
    else if (JSON.stringify(l) !== JSON.stringify(r)) diffs.push(`link-changed: ${id}`);
  }
  for (const [id] of bm) if (!am.has(id)) diffs.push(`link-added: ${id}`);
  return diffs;
}

function readSetting(id, fallback) {
  try {
    const v = app.ui?.settings?.getSettingValue?.(id);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

app.registerExtension({
  name: 'LuoWen',

  settings: [
    {
      id: ENABLED_ID,
      name: '启用络纹',
      category: ['LuoWen', '基础', 'Enabled'],
      sortOrder: 100,
      tooltip: {
        value: '总开关。\n关闭后完全回归 ComfyUI 原生线路绘制（F-001）。',
        class: TIP_CLASS,
      },
      type: 'boolean',
      defaultValue: true,
      onChange: (v) => {
        if (v) {
          install(app.canvas);
          installSnap(app.canvas);
        } else {
          uninstall();
          uninstallSnap();
        }
      },
    },
    {
      id: SNAP_ID,
      name: '对齐吸附',
      category: ['LuoWen', '基础', 'SnapAlign'],
      sortOrder: 90,
      tooltip: {
        value:
          '拖动单个节点时，与相连邻居的引脚行按图坐标 10px 对齐吸附。\n离开 15px 才脱离。\n关闭后与未安装一致。',
        class: TIP_CLASS,
      },
      type: 'boolean',
      defaultValue: true,
      onChange: (v) => {
        if (v) installSnap(app.canvas);
        setSnapEnabled(!!v);
      },
    },
    {
      id: STYLE_ID,
      name: '线路样式',
      category: ['LuoWen', '线路外观', 'WireStyle'],
      sortOrder: 80,
      tooltip: {
        value: 'orthogonal：A* 路由的正交折线。\nsmooth：同一骨架的平滑圆角。\nnative：ComfyUI 原生渲染。',
        class: TIP_CLASS,
      },
      type: 'combo',
      options: ['orthogonal', 'smooth', 'native'],
      defaultValue: 'orthogonal',
      onChange: (v) => setSettings({ style: v === 'smooth' ? 'smooth' : v === 'native' ? 'native' : 'orthogonal' }),
    },
    {
      id: CORNER_RADIUS_ID,
      name: '圆角半径',
      category: ['LuoWen', '线路外观', 'CornerRadius'],
      sortOrder: 75,
      tooltip: {
        value:
          '只对 smooth 圆角样式生效。\n设定值即圆角半径上限，单位图坐标像素。\n实际半径取设定值与相邻短段三分之一中的较小值。\n0 为直角，最大 24。\northogonal 样式下此项无效。',
        class: TIP_CLASS,
      },
      type: 'slider',
      attrs: { min: 0, max: CORNER_RADIUS_MAX, step: 1 },
      defaultValue: DEFAULT_RADIUS,
      onChange: (v) => setSettings({ cornerRadius: v }),
    },
    {
      id: AVOID_ID,
      name: '节点避障',
      category: ['LuoWen', '线路外观', 'NodeAvoidance'],
      sortOrder: 70,
      tooltip: {
        value:
          '线路绕开节点时的净空档位。\nlow 净空 8，standard 净空 16，high 净空 24。\n数值单位为图坐标像素。',
        class: TIP_CLASS,
      },
      type: 'combo',
      options: [
        { text: '低', value: 'low' },
        { text: '标准', value: 'standard' },
        { text: '高', value: 'high' },
      ],
      defaultValue: 'standard',
      onChange: (v) => setSettings({ avoidance: v === 'low' ? 'low' : v === 'high' ? 'high' : 'standard' }),
    },
    {
      id: CHAMFER_ID,
      name: '绕障外角大斜切',
      category: ['LuoWen', '线路外观', 'Chamfer'],
      sortOrder: 60,
      tooltip: {
        value:
          '仅在正交样式下生效。\n只把为绕开第三方节点而形成的外凸直角切掉一大块。\n三通、分叉与引脚段保持直角。\n关闭后回到直角。\n与 smooth 圆角样式互斥。',
        class: TIP_CLASS,
      },
      type: 'boolean',
      defaultValue: true,
      onChange: (v) => setSettings({ chamfer: !!v }),
    },
    {
      id: CROSS_CLEANUP_ID,
      name: '离线交叉清理',
      category: ['LuoWen', '实验', 'CrossCleanup'],
      sortOrder: 50,
      experimental: true,
      tooltip: {
        value:
          '布局静止 400ms 后，\n只对存在垂直交叉的线路对做一次离线重解。\n交叉对数严格下降。\n参与线路总长增幅不超过 15% 时才采纳。\n否则保持原画面。\n默认关闭。',
        class: TIP_CLASS,
      },
      type: 'boolean',
      defaultValue: false,
      onChange: (v) => setSettings({ crossCleanup: !!v }),
    },
  ],

  afterConfigureGraph() {
    // 工作流每次加载/切换后重建数据不变性基线
    baseline = snapshotGraph();
  },

  setup() {
    const ok = install(app.canvas);
    console.log('[LuoWen] 安装:', ok ? 'OK' : 'FAIL（能力检测未过，保持原生渲染）');
    const snapOk = installSnap(app.canvas);
    console.log('[LuoWen] 对齐吸附:', snapOk ? 'OK' : 'SKIP（非 Vue 节点模式或能力未就绪）');
    try {
      setSettings({
        enabled: !!readSetting(ENABLED_ID, true),
        style: readSetting(STYLE_ID, 'orthogonal'),
        avoidance: readSetting(AVOID_ID, 'standard'),
        chamfer: !!readSetting(CHAMFER_ID, true),
        cornerRadius: readSetting(CORNER_RADIUS_ID, DEFAULT_RADIUS),
        crossCleanup: !!readSetting(CROSS_CLEANUP_ID, false),
      });
    } catch {
      /* 设置读取失败保持默认 */
    }
    setSnapEnabled(!!readSetting(SNAP_ID, true));
    if (!baseline) baseline = snapshotGraph();

    window.LuoWen = {
      status: () => getStats(),
      routes: () => getDebugRoutes(),
      trace: () => getTrace(),
      snapDebug: () => getSnapDebug(),
      crossDebug: () => getCrossDebug(),
      setCrossCleanup: (v) => {
        // 调试对照入口：返回实际生效值；同步写入设置，便于 A/B 同取景对照
        const on = !!v;
        setSettings({ crossCleanup: on });
        try {
          app.ui?.settings?.setSettingValue?.(CROSS_CLEANUP_ID, on);
        } catch {
          /* 设置不可写时仅内存生效 */
        }
        return getStats().crossCleanup;
      },
      crossCleanupNow: () => runCrossCleanup('manual'),
      setEnabled: (v) => {
        setSettings({ enabled: !!v });
        if (v) {
          install(app.canvas);
          installSnap(app.canvas);
        } else {
          uninstall();
          uninstallSnap();
        }
        return getStats().installed;
      },
      setSnapEnabled: (v) => {
        // 调试对照入口：返回实际生效值；同步写入设置，便于和「关闭 / 未安装」对照
        const on = !!v;
        if (on) installSnap(app.canvas);
        setSnapEnabled(on);
        try {
          app.ui?.settings?.setSettingValue?.(SNAP_ID, on);
        } catch {
          /* 设置不可写时仅内存生效 */
        }
        return getSnapDebug().enabled;
      },
      setStyle: (v) => {
        setSettings({ style: v });
        return getStats().style;
      },
      setChamfer: (v) => {
        setSettings({ chamfer: !!v });
        return getStats().chamfer;
      },
      setCornerRadius: (v) => {
        // 调试对照入口：0 / 默认 / 上限同取景对照；同步写入设置，保持持久值一致
        const n = Math.round(Number(v));
        if (!Number.isFinite(n)) return getStats().cornerRadius;
        const r = Math.max(0, Math.min(CORNER_RADIUS_MAX, n));
        setSettings({ cornerRadius: r });
        try {
          app.ui?.settings?.setSettingValue?.(CORNER_RADIUS_ID, r);
        } catch {
          /* 设置不可写时仅内存生效 */
        }
        return getStats().cornerRadius;
      },
      setBevelRatio: (v) => {
        // 调试对照入口：默认 0.6 已固化；0.35 / 0.85 仅用于对比，不写入持久设置
        setSettings({ bevelRatio: Math.max(0, Math.min(1, Number(v))) });
        return getStats().bevelRatio;
      },
      setLanePitch: (v) => {
        // 调试对照入口：默认 8px（DEC-013）；5px 仅用于同取景对比，不写入持久设置
        const n = Math.round(Number(v));
        if (!Number.isFinite(n)) return getStats().lanePitch;
        setSettings({ lanePitch: Math.max(2, Math.min(24, n)) });
        return getStats().lanePitch;
      },
      setTrunkCap: (v) => {
        // 调试对照入口：null = 合法最晚分叉（默认）；数值 = 旧版固定上限口径
        setSettings({ trunkCap: v == null ? null : Number(v) });
        return getStats().trunkCap;
      },
      rebase: () => {
        baseline = snapshotGraph();
        return baseline ? { ok: true, kind: baseline.kind, linkCount: baseline.links.length } : { ok: false };
      },
      verify: () => {
        const now = snapshotGraph();
        const diffs = diffSnapshot(baseline, now);
        return {
          ok: diffs.length === 0,
          baseline: baseline ? { kind: baseline.kind, nodeCount: baseline.nodeCount, linkCount: baseline.links.length } : null,
          now: now ? { kind: now.kind, nodeCount: now.nodeCount, linkCount: now.links.length } : null,
          diffs,
        };
      },
    };
    console.log('[LuoWen] 就绪 — window.LuoWen 可用（status/setEnabled/setStyle/rebase/verify）');
  },
});
