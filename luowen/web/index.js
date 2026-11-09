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
  notifyFlowWake,
  CORNER_RADIUS_MAX,
} from './adapters/renderLinkAdapter.js';
import { DEFAULT_RADIUS } from './geometry/trace.js';
import { graphNodes, linkTuples } from './adapters/graphRead.js';
import { t, i18nDebug } from './i18n.js';
import { installSnap, uninstallSnap, setSnapEnabled, getSnapDebug } from './snap/dragSnap.js';

// 前端 1.55.18 只暴露 window.comfyAPI shim（见 docs/phase0/drawing-api-notes.md §2）
const { app } = window.comfyAPI.app;

const LANGUAGE_ID = 'LuoWen.Language';
const BROTHER_SPACING_ID = 'LuoWen.BrotherSpacing';
const AUTOLAYOUT_COLLAPSE_ID = 'LuoWen.AutoLayout.CollapseNotes';
const AUTOLAYOUT_ALIGN_ID = 'LuoWen.AutoLayout.ColumnAlign';
const AUTOLAYOUT_GAP_ID = 'LuoWen.AutoLayout.NodeGap';
const AUTOLAYOUT_LAYER_GAP_ID = 'LuoWen.AutoLayout.LayerGap';
const AUTOLAYOUT_INLINE_GAP_ID = 'LuoWen.AutoLayout.InlineGap';
const AUTOLAYOUT_COMPONENT_ID = 'LuoWen.AutoLayout.ComponentLayout';
const ENABLED_ID = 'LuoWen.Enabled';
const STYLE_ID = 'LuoWen.WireStyle';
const AVOID_ID = 'LuoWen.NodeAvoidance';
const CHAMFER_ID = 'LuoWen.Chamfer';
const CORNER_RADIUS_ID = 'LuoWen.CornerRadius';
const COLOR_THEME_ID = 'LuoWen.ColorTheme';
const FLOW_ID = 'LuoWen.FlowAnim';
const ANIM_MODE_ID = 'LuoWen.AnimMode';
const FLOW_STYLE_ID = 'LuoWen.FlowStyle';
const DASH_SPEED_ID = 'LuoWen.DashSpeed';
const DASH_LEN_ID = 'LuoWen.DashLen';
const DASH_GAP_ID = 'LuoWen.DashGap';
const BEAM_SPEED_ID = 'LuoWen.BeamSpeed';
const BEAM_LEN_ID = 'LuoWen.BeamLen';
const BEAM_SPACING_ID = 'LuoWen.BeamSpacing';
const DISABLE_ANIM_ON_RUN_ID = 'LuoWen.DisableAnimOnRun';
const SNAP_ID = 'LuoWen.SnapAlign';
const CROSS_CLEANUP_ID = 'LuoWen.CrossCleanup';

const TIP_CLASS = 'luowen-tooltip';

// 设置项提示框宽度：1.55.18 的 PrimeVue 默认 max-width 为 200px（实测）。
// v-tooltip 的对象形式支持附加 class，因此只放宽带此标记的提示框，不影响其他扩展与全局设置页。
// 另：LuoWen 的 combo 控件根元素带 setting id（FormItem.vue :id 透传），可按 id 精准放宽——
// 只动我方 5 个下拉框（用户反馈 2026-11-08：动效线型值「局部光脉冲」截断），不碰宿主全局样式。
function installTooltipStyle() {
  if (document.getElementById('luowen-tooltip-style')) return;
  const style = document.createElement('style');
  style.id = 'luowen-tooltip-style';
  style.textContent = [
    `.p-tooltip.${TIP_CLASS}{width:max-content;max-width:min(560px,calc(100vw - 2rem))}`,
    `#LuoWen\\.FlowStyle,#LuoWen\\.AnimMode,#LuoWen\\.WireStyle,#LuoWen\\.NodeAvoidance,#LuoWen\\.ColorTheme{min-width:15rem}`,
  ].join('\n');
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

  // 1.55.18 公开扩展钩子（app.ts collectCanvasMenuItems）；Vue 模式空白处右键仍走 litegraph 菜单
  getCanvasMenuItems() {
    return [
      {
        content: '络纹',
        has_submenu: true,
        submenu: {
          options: [
            { content: t('AutoLayout.full'), callback: () => { window.LuoWen?.autoLayout?.('full'); } },
            { content: t('AutoLayout.selected'), callback: () => { window.LuoWen?.autoLayout?.('selected'); } },
          ],
        },
      },
    ];
  },

  settings: [
    {
      id: LANGUAGE_ID,
      get name() {
        return t('Language.name');
      },
      category: ['LuoWen', '基础', 'Language'],
      sortOrder: 105,
      get tooltip() {
        return { value: t('Language.tooltip'), class: TIP_CLASS };
      },
      type: 'combo',
      get options() {
        return [
          { text: t('Language.opt.auto'), value: 'auto' },
          { text: t('Language.opt.zh'), value: 'zh' },
          { text: t('Language.opt.en'), value: 'en' },
        ];
      },
      defaultValue: 'auto',
      onChange: (v) => {
        // 值由宿主持久化；t() 每次渲染实时读取本项，无需额外状态
        getStats();
      },
    },
    {
      id: AUTOLAYOUT_COLLAPSE_ID,
      get name() {
        return t('AutoLayoutCollapse.name');
      },
      category: ['LuoWen', '自动布局', 'CollapseNotes'],
      sortOrder: 110,
      get tooltip() {
        return { value: t('AutoLayoutCollapse.tooltip'), class: TIP_CLASS };
      },
      type: 'boolean',
      defaultValue: false,
      onChange: (v) => setSettings({ collapseNotes: !!v }),
    },
    {
      id: AUTOLAYOUT_ALIGN_ID,
      get name() {
        return t('AutoLayoutAlign.name');
      },
      category: ['LuoWen', '自动布局', 'ColumnAlign'],
      sortOrder: 108,
      get tooltip() {
        return { value: t('AutoLayoutAlign.tooltip'), class: TIP_CLASS };
      },
      type: 'combo',
      get options() {
        return [
          { text: t('AutoLayoutAlign.opt.auto'), value: 'auto' },
          { text: t('AutoLayoutAlign.opt.right'), value: 'right' },
          { text: t('AutoLayoutAlign.opt.center'), value: 'center' },
          { text: t('AutoLayoutAlign.opt.left'), value: 'left' },
        ];
      },
      defaultValue: 'auto',
      onChange: (v) => setSettings({ autoLayoutAlign: v === 'right' || v === 'center' || v === 'left' ? v : 'auto' }),
    },
    {
      id: AUTOLAYOUT_GAP_ID,
      get name() {
        return t('AutoLayoutGap.name');
      },
      category: ['LuoWen', '自动布局', 'NodeGap'],
      sortOrder: 106,
      get tooltip() {
        return { value: t('AutoLayoutGap.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 20, max: 120, step: 5 },
      defaultValue: 40,
      onChange: (v) => setSettings({ autoLayoutGap: Math.max(20, Math.min(120, Number(v) || 40)) }),
    },
    {
      id: AUTOLAYOUT_LAYER_GAP_ID,
      get name() {
        return t('AutoLayoutLayerGap.name');
      },
      category: ['LuoWen', '自动布局', 'LayerGap'],
      sortOrder: 104,
      get tooltip() {
        return { value: t('AutoLayoutLayerGap.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 20, max: 160, step: 5 },
      defaultValue: 60,
      onChange: (v) => setSettings({ autoLayoutLayerGap: Math.max(20, Math.min(160, Number(v) || 60)) }),
    },
    {
      id: AUTOLAYOUT_INLINE_GAP_ID,
      get name() {
        return t('AutoLayoutInlineGap.name');
      },
      category: ['LuoWen', '自动布局', 'InlineGap'],
      sortOrder: 103,
      get tooltip() {
        return { value: t('AutoLayoutInlineGap.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 20, max: 160, step: 5 },
      defaultValue: 50,
      onChange: (v) => setSettings({ autoLayoutInlineGap: Math.max(20, Math.min(160, Number(v) || 50)) }),
    },
    {
      id: AUTOLAYOUT_COMPONENT_ID,
      get name() {
        return t('AutoLayoutComponent.name');
      },
      category: ['LuoWen', '自动布局', 'ComponentLayout'],
      sortOrder: 102,
      get tooltip() {
        return { value: t('AutoLayoutComponent.tooltip'), class: TIP_CLASS };
      },
      type: 'combo',
      get options() {
        return [
          { text: t('AutoLayoutComponent.opt.vertical'), value: 'vertical' },
          { text: t('AutoLayoutComponent.opt.horizontal'), value: 'horizontal' },
        ];
      },
      defaultValue: 'vertical',
      onChange: (v) => setSettings({ autoLayoutComponent: v === 'horizontal' ? 'horizontal' : 'vertical' }),
    },
    {
      id: ENABLED_ID,
      get name() {
        return t('Enabled.name');
      },
      category: ['LuoWen', '基础', 'Enabled'],
      sortOrder: 100,
      get tooltip() {
        return { value: t('Enabled.tooltip'), class: TIP_CLASS };
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
      get name() {
        return t('SnapAlign.name');
      },
      category: ['LuoWen', '基础', 'SnapAlign'],
      sortOrder: 90,
      get tooltip() {
        return { value: t('SnapAlign.tooltip'), class: TIP_CLASS };
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
      get name() {
        return t('WireStyle.name');
      },
      category: ['LuoWen', '线路外观', 'WireStyle'],
      sortOrder: 80,
      get tooltip() {
        return { value: t('WireStyle.tooltip'), class: TIP_CLASS };
      },
      type: 'combo',
      options: ['orthogonal', 'smooth', 'native'],
      defaultValue: 'orthogonal',
      onChange: (v) => setSettings({ style: v === 'smooth' ? 'smooth' : v === 'native' ? 'native' : 'orthogonal' }),
    },
    {
      id: CORNER_RADIUS_ID,
      get name() {
        return t('CornerRadius.name');
      },
      category: ['LuoWen', '线路外观', 'CornerRadius'],
      sortOrder: 75,
      get tooltip() {
        return { value: t('CornerRadius.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 0, max: CORNER_RADIUS_MAX, step: 1 },
      defaultValue: DEFAULT_RADIUS,
      onChange: (v) => setSettings({ cornerRadius: v }),
    },
    {
      id: AVOID_ID,
      get name() {
        return t('NodeAvoidance.name');
      },
      category: ['LuoWen', '线路外观', 'NodeAvoidance'],
      sortOrder: 70,
      get tooltip() {
        return { value: t('NodeAvoidance.tooltip'), class: TIP_CLASS };
      },
      type: 'combo',
get options() {
        return [
          { text: t('NodeAvoidance.opt.low'), value: 'low' },
          { text: t('NodeAvoidance.opt.standard'), value: 'standard' },
          { text: t('NodeAvoidance.opt.high'), value: 'high' },
        ];
      },
      defaultValue: 'standard',
      onChange: (v) => setSettings({ avoidance: v === 'low' ? 'low' : v === 'high' ? 'high' : 'standard' }),
    },
    {
      id: BROTHER_SPACING_ID,
      get name() {
        return t('BrotherSpacing.name');
      },
      category: ['LuoWen', '线路外观', 'BrotherSpacing'],
      sortOrder: 65,
      get tooltip() {
        return { value: t('BrotherSpacing.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 4, max: 24, step: 2 },
      defaultValue: 12,
      onChange: (v) => setSettings({ brotherSpacing: Number(v) }),
    },
    {
      id: CHAMFER_ID,
      get name() {
        return t('Chamfer.name');
      },
      category: ['LuoWen', '线路外观', 'Chamfer'],
      sortOrder: 60,
      get tooltip() {
        return { value: t('Chamfer.tooltip'), class: TIP_CLASS };
      },
      type: 'boolean',
      defaultValue: true,
      onChange: (v) => setSettings({ chamfer: !!v }),
    },
    {
      id: COLOR_THEME_ID,
      get name() {
        return t('ColorTheme.name');
      },
      category: ['LuoWen', '线路外观', 'ColorTheme'],
      sortOrder: 55,
      get tooltip() {
        return { value: t('ColorTheme.tooltip'), class: TIP_CLASS };
      },
      type: 'combo',
get options() {
        return [
          { text: t('ColorTheme.opt.off'), value: 'off' },
          { text: t('ColorTheme.opt.luowen-dark'), value: 'luowen-dark' },
          { text: t('ColorTheme.opt.luowen-cyberpunk'), value: 'luowen-cyberpunk' },
        ];
      },
      defaultValue: 'off',
      onChange: (v) => setSettings({ colorTheme: v === 'luowen-dark' || v === 'luowen-cyberpunk' ? v : 'off' }),
    },
    {
      id: FLOW_ID,
      get name() {
        return t('FlowAnim.name');
      },
      category: ['LuoWen', '动效', 'FlowAnim'],
      sortOrder: 100,
      get tooltip() {
        return { value: t('FlowAnim.tooltip'), class: TIP_CLASS };
      },
      type: 'boolean',
      defaultValue: false,
      onChange: (v) => setSettings({ flowAnim: !!v }),
    },
    {
      id: ANIM_MODE_ID,
      get name() {
        return t('AnimMode.name');
      },
      category: ['LuoWen', '动效', 'AnimMode'],
      sortOrder: 90,
      get tooltip() {
        return { value: t('AnimMode.tooltip'), class: TIP_CLASS };
      },
      type: 'combo',
get options() {
        return [
          { text: t('AnimMode.opt.selected'), value: 'selected' },
          { text: t('AnimMode.opt.executing'), value: 'executing' },
          { text: t('AnimMode.opt.all'), value: 'all' },
        ];
      },
      defaultValue: 'selected',
      onChange: (v) => setSettings({ animMode: v }),
    },
    {
      id: FLOW_STYLE_ID,
      get name() {
        return t('FlowStyle.name');
      },
      category: ['LuoWen', '动效', 'FlowStyle'],
      sortOrder: 80,
      get tooltip() {
        return { value: t('FlowStyle.tooltip'), class: TIP_CLASS };
      },
      type: 'combo',
get options() {
        return [
          { text: t('FlowStyle.opt.beam'), value: 'beam' },
          { text: t('FlowStyle.opt.dash'), value: 'dash' },
        ];
      },
      defaultValue: 'beam',
      // 已存 glow/pulse 值在注册期由宿主原生机制迁移（settingStore.tryMigrateDeprecatedValue），
      // 否则 combo 对不在选项里的旧值显示为空（用户实测 2026-11-08）
      migrateDeprecatedValue: (v) => (v === 'glow' || v === 'pulse' ? 'beam' : v),
      onChange: (v) => setSettings({ flowStyle: v }),
    },
    {
      id: DASH_SPEED_ID,
      get name() {
        return t('DashSpeed.name');
      },
      category: ['LuoWen', '动效·虚线', 'DashSpeed'],
      sortOrder: 30,
      get tooltip() {
        return { value: t('DashSpeed.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 0, max: 10, step: 1 },
      defaultValue: 4,
      onChange: (v) => setSettings({ dashSpeed: Number(v) }),
    },
    {
      id: DASH_LEN_ID,
      get name() {
        return t('DashLen.name');
      },
      category: ['LuoWen', '动效·虚线', 'DashLen'],
      sortOrder: 25,
get tooltip() {
        return { value: t('DashLen.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 0, max: 30, step: 1 },
      defaultValue: 7,
      onChange: (v) => setSettings({ dashLen: Number(v) }),
    },
    {
      id: DASH_GAP_ID,
      get name() {
        return t('DashGap.name');
      },
      category: ['LuoWen', '动效·虚线', 'DashGap'],
      sortOrder: 20,
get tooltip() {
        return { value: t('DashGap.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 4, max: 40, step: 1 },
      defaultValue: 13,
      onChange: (v) => setSettings({ dashGap: Number(v) }),
    },
    {
      id: BEAM_SPEED_ID,
      get name() {
        return t('BeamSpeed.name');
      },
      category: ['LuoWen', '动效·光束', 'BeamSpeed'],
      sortOrder: 30,
      get tooltip() {
        return { value: t('BeamSpeed.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 0, max: 10, step: 1 },
      defaultValue: 2,
      onChange: (v) => setSettings({ beamSpeed: Number(v) }),
    },
    {
      id: BEAM_LEN_ID,
      get name() {
        return t('BeamLen.name');
      },
      category: ['LuoWen', '动效·光束', 'BeamLen'],
      sortOrder: 25,
get tooltip() {
        return { value: t('BeamLen.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 24, max: 120, step: 4 },
      defaultValue: 48,
      onChange: (v) => setSettings({ beamLen: Number(v) }),
    },
    {
      id: BEAM_SPACING_ID,
      get name() {
        return t('BeamSpacing.name');
      },
      category: ['LuoWen', '动效·光束', 'BeamSpacing'],
      sortOrder: 20,
      get tooltip() {
        return { value: t('BeamSpacing.tooltip'), class: TIP_CLASS };
      },
      type: 'slider',
      attrs: { min: 120, max: 480, step: 20 },
      defaultValue: 240,
      onChange: (v) => setSettings({ beamSpacing: Number(v) }),
    },
    {
      id: DISABLE_ANIM_ON_RUN_ID,
      get name() {
        return t('DisableAnimOnRun.name');
      },
      category: ['LuoWen', '动效', 'DisableAnimOnRun'],
      sortOrder: 40,
      get tooltip() {
        return { value: t('DisableAnimOnRun.tooltip'), class: TIP_CLASS };
      },
      type: 'boolean',
      defaultValue: true,
      onChange: (v) => setSettings({ disableAnimOnRun: !!v }),
    },
    {
      id: CROSS_CLEANUP_ID,
      get name() {
        return t('CrossCleanup.name');
      },
      category: ['LuoWen', '实验', 'CrossCleanup'],
      sortOrder: 50,
      experimental: true,
      get tooltip() {
        return { value: t('CrossCleanup.tooltip'), class: TIP_CLASS };
      },
      type: 'boolean',
      defaultValue: false,
      onChange: (v) => setSettings({ crossCleanup: !!v }),
    },
  ],

  afterConfigureGraph() {
    // 工作流每次加载/切换后重建数据不变性基线
    baseline = snapshotGraph();
    // 自停架构的唤醒点之一（研究报告 §4.4）：子图/工作流切换后可能具备动效条件
    notifyFlowWake();
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
        brotherSpacing: Math.max(4, Math.min(24, Number(readSetting(BROTHER_SPACING_ID, 12)) || 12)),
        crossCleanup: !!readSetting(CROSS_CLEANUP_ID, false),
        dashSpeed: (() => { const raw = Number(readSetting(DASH_SPEED_ID, NaN)); if (Number.isFinite(raw) && raw >= 0) return Math.max(0, Math.min(10, raw)); const legacy = Number(readSetting('LuoWen.FlowSpeed', NaN)); return Number.isFinite(legacy) && legacy >= 0 ? Math.max(0, Math.min(10, legacy > 10 ? Math.round(legacy / 60) : legacy)) : 4; })(),
        dashLen: (() => { const raw = Number(readSetting(DASH_LEN_ID, NaN)); return Number.isFinite(raw) && raw >= 0 ? raw : Math.max(0, Math.min(30, Number(readSetting('LuoWen.FlowDash', 7)) || 7)); })(),
        dashGap: (() => { const raw = Number(readSetting(DASH_GAP_ID, NaN)); return Number.isFinite(raw) && raw >= 0 ? raw : Math.max(4, Math.min(40, Number(readSetting('LuoWen.FlowGap', 13)) || 13)); })(),
        beamSpeed: (() => { const raw = Number(readSetting(BEAM_SPEED_ID, NaN)); return Number.isFinite(raw) && raw >= 0 ? Math.max(0, Math.min(10, Math.round(raw))) : 2; })(),
        beamLen: (() => { const raw = Number(readSetting(BEAM_LEN_ID, NaN)); return Number.isFinite(raw) && raw >= 12 ? Math.max(12, Math.min(160, Math.round(raw))) : 48; })(),
        beamSpacing: (() => { const raw = Number(readSetting(BEAM_SPACING_ID, NaN)); return Number.isFinite(raw) && raw >= 80 ? Math.max(80, Math.min(600, Math.round(raw))) : 240; })(),
      });
    } catch {
      /* 设置读取失败保持默认 */
    }
    setSnapEnabled(!!readSetting(SNAP_ID, true));
    if (!baseline) baseline = snapshotGraph();    // 队列执行事件 → 动效「生成时禁用」与「仅执行中」模式（DEC-040；事件名取证 api-DTg5QMcw.js）
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
      i18n: () => i18nDebug(),
      autoLayout: (scope = 'full', opts = {}) => import('./layout/engine.js').then((m) => m.runAutoLayout(app, {
        scope,
        collapseNotes: opts.collapseNotes ?? !!readSetting(AUTOLAYOUT_COLLAPSE_ID, false),
        columnAlign: opts.columnAlign ?? readSetting(AUTOLAYOUT_ALIGN_ID, 'auto'),
        nodeGap: opts.nodeGap ?? Math.max(20, Math.min(120, Number(readSetting(AUTOLAYOUT_GAP_ID, 40)) || 40)),
        layerGap: opts.layerGap ?? Math.max(20, Math.min(160, Number(readSetting(AUTOLAYOUT_LAYER_GAP_ID, 60)) || 60)),
        inlineGap: opts.inlineGap ?? Math.max(20, Math.min(160, Number(readSetting(AUTOLAYOUT_INLINE_GAP_ID, 50)) || 50)),
        componentLayout: opts.componentLayout ?? readSetting(AUTOLAYOUT_COMPONENT_ID, 'vertical'),
      })),
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
    // 自动布局快捷键（Ctrl+Shift+L=全图，Ctrl+Alt+L=选区；输入框内不触发）
    window.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || e.key !== 'L' && e.key !== 'l') return;
      if (e.shiftKey && e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      const scope = e.altKey ? 'selected' : 'full';
      window.LuoWen?.autoLayout?.(scope).catch(() => {});
    }, { passive: false });
    // 自动布局浮动按钮：可拖动、位置持久化；默认锚在 actionbar 运行按钮左侧
    {
      const btn = document.createElement('button');
      btn.textContent = t('AutoLayout.button');
      btn.className = 'p-button p-component p-button-outlined';
      // z=1000：高于顶栏覆盖层 z-999，低于设置对话框 z-1700
      btn.style.cssText = 'position:fixed;z-index:1000;padding:0.3rem 0.75rem;font-size:0.75rem;cursor:grab;white-space:nowrap;touch-action:none';
      document.body.appendChild(btn);
      const POS_KEY = 'luowen.autolayout.btnPos';
      const place = (x, y) => {
        const r = btn.getBoundingClientRect();
        btn.style.left = Math.max(4, Math.min(window.innerWidth - r.width - 4, x)) + 'px';
        btn.style.top = Math.max(4, Math.min(window.innerHeight - r.height - 4, y)) + 'px';
      };
      const dockDefault = () => {
        const bar = document.querySelector('.actionbar');
        const ref = bar && [...bar.children].find((el) => (el.innerText || '').includes('运行'));
        if (ref) {
          const r = ref.getBoundingClientRect();
          const b = btn.getBoundingClientRect();
          place(r.left - b.width - 8, r.top + (r.height - b.height) / 2);
          return true;
        }
        return false;
      };
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(POS_KEY)); } catch { /* 首次无保存位置 */ }
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y);
      else if (!dockDefault()) setTimeout(() => { if (!dockDefault()) place(window.innerWidth - 120, 8); }, 2000);
      window.addEventListener('resize', () => {
        const r = btn.getBoundingClientRect();
        place(r.left, r.top);
      });
      let drag = null;
      let moved = false;
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const r = btn.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
        moved = false;
        btn.setPointerCapture(e.pointerId);
        btn.style.cursor = 'grabbing';
      });
      btn.addEventListener('pointermove', (e) => {
        if (!drag) return;
        e.stopPropagation();
        if (!moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        moved = true;
        place(e.clientX - drag.dx, e.clientY - drag.dy);
      });
      btn.addEventListener('pointerup', (e) => {
        if (!drag) return;
        e.stopPropagation();
        drag = null;
        btn.style.cursor = 'grab';
        if (moved) {
          const r = btn.getBoundingClientRect();
          try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch { /* 隐私模式等写入失败不阻塞 */ }
        } else {
          // 选择感知：有选中节点 → 整理其所在连通流；无选中 → 整理全图
          const hasSel = (app?.canvas?.selectedItems?.size ?? 0) > 0;
          window.LuoWen?.autoLayout?.(hasSel ? 'selected' : 'full');
        }
      });
    }
    console.log('[LuoWen] 就绪 — window.LuoWen 可用（status/setEnabled/setStyle/rebase/verify）');
  },
});
