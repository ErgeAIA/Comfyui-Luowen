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
  getColorDebug,
  setQueueState,
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
const COLOR_THEME_ID = 'LuoWen.ColorTheme';
const FLOW_ID = 'LuoWen.FlowAnim';
const ANIM_MODE_ID = 'LuoWen.AnimMode';
const FLOW_STYLE_ID = 'LuoWen.FlowStyle';
const FLOW_DASH_ID = 'LuoWen.FlowDash';
const FLOW_GAP_ID = 'LuoWen.FlowGap';
const FLOW_SPEED_ID = 'LuoWen.FlowSpeed';
const DISABLE_ANIM_ON_RUN_ID = 'LuoWen.DisableAnimOnRun';
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

// 宿主/前端在正常操作中会自行写入的 graph.extra 键，不属于第三方扩展数据，比对时必须排除。
// 依据：宿主前端工作流 extra schema（comfyui_frontend_package/static/assets/api-*.js，or=...）
// ds 为视口状态（serialize/load 重写）；linkExtensions/linkPresentation/reroutes 为原生 Reroute 状态；
// frontendVersion/workflowRendererVersion 为保存版本信息；Blueprint*/linear* 为前端模式与蓝图状态。
const EXTRA_HOST_KEYS = new Set([
  'ds',
  'frontendVersion',
  'linkExtensions',
  'linkPresentation',
  'reroutes',
  'workflowRendererVersion',
  'BlueprintDescription',
  'BlueprintSearchAliases',
  'linearMode',
  'linearData',
]);

// 结构化值 → 键深排序的稳定 JSON，用于键级比对；循环引用与非 JSON 值显式标记。
function canonicalValue(v, seen) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    if (typeof v === 'undefined' || typeof v === 'function' || typeof v === 'symbol') return '[skip]';
    return v;
  }
  if (seen.has(v)) return '[circular]';
  seen.add(v);
  let out;
  if (Array.isArray(v)) {
    out = v.map((x) => canonicalValue(x, seen));
  } else {
    out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalValue(v[k], seen);
  }
  seen.delete(v);
  return out;
}

function canonicalJson(v) {
  try {
    return JSON.stringify(canonicalValue(v, new WeakSet()));
  } catch {
    return '[unserializable]';
  }
}

// graph.extra 指纹：只保留非宿主键，第三方写入（如 cablemanagement_*、zipTies）必然可见。
function extraFingerprint(g) {
  const extra = g?.extra;
  const clean = {};
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(extra)) {
      if (!EXTRA_HOST_KEYS.has(k)) clean[k] = extra[k];
    }
  }
  return canonicalJson(clean);
}

const roundCoord = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);

function snapshotGraph() {
  const g = app.canvas?.graph;
  if (!g) return null;
  const nodes = graphNodes(g);
  const nodePos = {};
  const nodeProps = {};
  for (const n of nodes) {
    if (!n || n.id == null) continue;
    const key = String(n.id);
    // 宿主 1.55.18 的 pos 是 Float64Array（不是 Array），按 array-like 读取
    nodePos[key] = n.pos ? [roundCoord(n.pos[0]), roundCoord(n.pos[1])] : null;
    nodeProps[key] = canonicalJson(n.properties ?? {});
  }
  return {
    kind: g.subgraph ? 'subgraph' : 'root',
    nodeCount: nodes.length,
    nodeIds: nodes.map((n) => n.id).sort((a, b) => a - b),
    links: linkTuples(g),
    nodePos,
    nodeProps,
    extra: extraFingerprint(g),
  };
}

// 顶层键级差异：只报告键增删/变化，不深入嵌套结构（能定位到第三方写入即可）。
function keyDiffs(prefix, aJson, bJson, diffs) {
  let a;
  let b;
  try {
    a = JSON.parse(aJson ?? '{}');
  } catch {
    a = {};
  }
  try {
    b = JSON.parse(bJson ?? '{}');
  } catch {
    b = {};
  }
  if (!a || typeof a !== 'object' || Array.isArray(a)) a = {};
  if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  for (const k of Object.keys(a)) {
    if (!has(b, k)) diffs.push(`${prefix}-removed: ${k}`);
    else if (canonicalJson(a[k]) !== canonicalJson(b[k])) diffs.push(`${prefix}-changed: ${k}`);
  }
  for (const k of Object.keys(b)) {
    if (!has(a, k)) diffs.push(`${prefix}-added: ${k}`);
  }
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

  const idsA = new Map(a.nodeIds.map((id) => [id, true]));
  const idsB = new Map(b.nodeIds.map((id) => [id, true]));
  for (const id of idsA.keys()) if (!idsB.has(id)) diffs.push(`node-removed: ${id}`);
  for (const id of idsB.keys()) if (!idsA.has(id)) diffs.push(`node-added: ${id}`);

  keyDiffs('extra', a.extra, b.extra, diffs);

  const propIds = new Set([...Object.keys(a.nodeProps ?? {}), ...Object.keys(b.nodeProps ?? {})]);
  for (const id of [...propIds].sort()) {
    const ap = a.nodeProps?.[id];
    const bp = b.nodeProps?.[id];
    if (ap == null || bp == null) continue; // 节点增删已由 node-removed/node-added 覆盖
    keyDiffs(`node-prop(${id})`, ap, bp, diffs);
  }
  return diffs;
}

// 位置变化只作为附加信息：用户拖动节点属正常操作，不计入 ok/diffs（避免误报）。
function movedNodes(a, b) {
  const moved = [];
  const aPos = a.nodePos ?? {};
  const bPos = b.nodePos ?? {};
  for (const id of Object.keys(aPos)) {
    if (!Object.prototype.hasOwnProperty.call(bPos, id)) continue;
    const p = aPos[id];
    const q = bPos[id];
    if (!p || !q) continue;
    if (p[0] !== q[0] || p[1] !== q[1]) moved.push({ id, from: p, to: q });
  }
  return moved.sort((x, y) => Number(x.id) - Number(y.id) || String(x.id).localeCompare(String(y.id)));
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
        value: 'orthogonal：A* 路由的正交折线。\nsmooth：同一骨架的平滑圆角。\native：ComfyUI 原生渲染。',
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
      id: COLOR_THEME_ID,
      name: '连线配色主题',
      category: ['LuoWen', '线路外观', 'ColorTheme'],
      sortOrder: 55,
      tooltip: {
        value:
          '按连线的数据类型着色（62 类语义映射）。\n暗色与 Cyberpunk 两套主题均通过对比度与色盲 ΔE 门槛。\n关闭时保持宿主原生配色。',
        class: TIP_CLASS,
      },
      type: 'combo',
      options: [
        { text: '关闭（原生）', value: 'off' },
        { text: '暗色（LuoWen Dark）', value: 'luowen-dark' },
        { text: 'Cyberpunk', value: 'luowen-cyberpunk' },
      ],
      defaultValue: 'off',
      onChange: (v) => setSettings({ colorTheme: v === 'luowen-dark' || v === 'luowen-cyberpunk' ? v : 'off' }),
    },
    {
      id: FLOW_ID,
      name: '启用动效',
      category: ['LuoWen', '动效', 'FlowAnim'],
      sortOrder: 100,
      tooltip: {
        value:
          '动效总开关（默认关闭）。\n仅配色主题开启时生效。\n系统开启减少动态效果时自动改为实线。\n缩放不大于 40% 时自动关闭。',
        class: TIP_CLASS,
      },
      type: 'boolean',
      defaultValue: false,
      onChange: (v) => setSettings({ flowAnim: !!v }),
    },
    {
      id: ANIM_MODE_ID,
      name: '动效模式',
      category: ['LuoWen', '动效', 'AnimMode'],
      sortOrder: 90,
      tooltip: {
        value:
          '全部连线：所有连线一起动。\n仅选中：只动与选中节点相连的线。\n仅执行中：只动与正在执行的节点相连的线。\n空闲时零开销。',
        class: TIP_CLASS,
      },
      type: 'combo',
      options: [
        { text: '全部连线', value: 'all' },
        { text: '仅选中', value: 'selected' },
        { text: '仅执行中', value: 'executing' },
      ],
      defaultValue: 'all',
      onChange: (v) => setSettings({ animMode: v }),
    },
    {
      id: FLOW_STYLE_ID,
      name: '动效线型',
      category: ['LuoWen', '动效', 'FlowStyle'],
      sortOrder: 80,
      tooltip: {
        value:
          '虚线行进：虚线沿连线从源向目标移动。\n发光：连线带恒定光晕。\n脉冲：连线宽度按流速节律呼吸。',
        class: TIP_CLASS,
      },
      type: 'combo',
      options: [
        { text: '虚线行进', value: 'dash' },
        { text: '发光', value: 'glow' },
        { text: '脉冲', value: 'pulse' },
      ],
      defaultValue: 'dash',
      onChange: (v) => setSettings({ flowStyle: v }),
    },
    {
      id: FLOW_DASH_ID,
      name: '虚线长度',
      category: ['LuoWen', '动效', 'FlowDash'],
      sortOrder: 70,
      tooltip: { value: '虚线行进线型的实线段长度（屏幕像素）。', class: TIP_CLASS },
      type: 'slider',
      attrs: { min: 0, max: 30, step: 1 },
      defaultValue: 7,
      onChange: (v) => setSettings({ flowDash: Number(v) }),
    },
    {
      id: FLOW_GAP_ID,
      name: '虚线间距',
      category: ['LuoWen', '动效', 'FlowGap'],
      sortOrder: 65,
      tooltip: { value: '虚线行进线型的空隙长度（屏幕像素）。', class: TIP_CLASS },
      type: 'slider',
      attrs: { min: 0, max: 40, step: 1 },
      defaultValue: 13,
      onChange: (v) => setSettings({ flowGap: Number(v) }),
    },
    {
      id: FLOW_SPEED_ID,
      name: '流速',
      category: ['LuoWen', '动效', 'FlowSpeed'],
      sortOrder: 60,
      tooltip: {
        value:
          '虚线行进速度（屏幕像素/秒）。\n脉冲线型下数值越大呼吸越快。',
        class: TIP_CLASS,
      },
      type: 'slider',
      attrs: { min: 20, max: 200, step: 20 },
      defaultValue: 48,
      onChange: (v) => setSettings({ flowSpeed: Number(v) }),
    },
    {
      id: DISABLE_ANIM_ON_RUN_ID,
      name: '生成时禁用动效',
      category: ['LuoWen', '动效', 'DisableAnimOnRun'],
      sortOrder: 40,
      tooltip: {
        value:
          '工作流运行期间暂停全部动效，结束后自动恢复。\n与宿主「禁用动画」开关独立；\n若想让「仅执行中」模式在运行时可视化数据流，请关闭本项。',
        class: TIP_CLASS,
      },
      type: 'boolean',
      defaultValue: true,
      onChange: (v) => setSettings({ disableAnimOnRun: !!v }),
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

    // 队列执行事件 → 动效「生成时禁用」与「仅执行中」模式（DEC-040；事件名取证 api-DTg5QMcw.js）
    try {
      const api = app.api;
      api.addEventListener('execution_start', () => setQueueState({ running: true, executingNode: null }));
      api.addEventListener('executing', (e) => setQueueState({ running: true, executingNode: e.detail ?? null }));
      const onQueueEnd = () => setQueueState({ running: false, executingNode: null });
      api.addEventListener('execution_success', onQueueEnd);
      api.addEventListener('execution_error', onQueueEnd);
      api.addEventListener('execution_interrupted', onQueueEnd);
    } catch {
      /* api 不可订阅时，「生成时禁用」与执行中模式退化为无信号（其余动效可用） */
    }

    window.LuoWen = {
      status: () => getStats(),
      colorDebug: () => getColorDebug(),
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
          // 位置变化（用户拖动等正常操作）只报告、不判失败
          moved: baseline && now ? movedNodes(baseline, now) : [],
        };
      },
    };
    console.log('[LuoWen] 就绪 — window.LuoWen 可用（status/setEnabled/setStyle/rebase/verify）');
  },
});
