// 设置面板信息架构唯一真相（DEC-066）。
// 宿主排序规则（前端 1.55.18，SettingDialog.vue:181-198）：组序 = 组内最大 sortOrder 降序，
// 并列按组名 localeCompare；组内按 sortOrder 降序，无并列兜底。
// 因此编号用带区：sortOrder = 组号×100 + 组内序（9→1 递减），组号步长 10。
// 不变量：一组的全部 sortOrder 落在 [band, band+99]，组序永远由组号决定，不受组内最大值漂移影响。
// 分类三段 = ['LuoWen', 组名, 唯一键]；唯一键取 id 最后一段（同组内必须唯一，否则宿主折叠覆盖）。
export const SETTINGS_GROUPS = [
  { label: '基础', band: 8000, items: [['LuoWen.Enabled', 9], ['LuoWen.SnapAlign', 8], ['LuoWen.SnapTolerance', 7], ['LuoWen.Language', 6]] },
  {
    label: '线路外观',
    band: 7000,
    items: [['LuoWen.WireStyle', 9], ['LuoWen.NodeAvoidance', 8], ['LuoWen.Chamfer', 7], ['LuoWen.CornerRadius', 6], ['LuoWen.BrotherSpacing', 5]],
  },
  { label: '连线配色', band: 6000, items: [['LuoWen.ColorTheme', 9], ['LuoWen.ColorTheme.Scope', 8]] },
  {
    label: '自动布局',
    band: 5000,
    items: [
      ['LuoWen.AutoLayout.ComponentLayout', 9],
      ['LuoWen.AutoLayout.ColumnAlign', 8],
      ['LuoWen.AutoLayout.LayerGap', 7],
      ['LuoWen.AutoLayout.InlineGap', 6],
      ['LuoWen.AutoLayout.NodeGap', 5],
      ['LuoWen.AutoLayout.CollapseNotes', 4],
      ['LuoWen.AutoLayout.Button', 3],
    ],
  },
  {
    label: '动效',
    band: 4000,
    items: [['LuoWen.FlowAnim', 9], ['LuoWen.AnimMode', 8], ['LuoWen.FlowStyle', 7], ['LuoWen.DisableAnimOnRun', 6]],
  },
  { label: '动效·光束', band: 3000, items: [['LuoWen.BeamSpeed', 9], ['LuoWen.BeamLen', 8], ['LuoWen.BeamSpacing', 7]] },
  { label: '动效·虚线', band: 2000, items: [['LuoWen.DashSpeed', 9], ['LuoWen.DashLen', 8], ['LuoWen.DashGap', 7]] },
  { label: '实验', band: 1000, items: [['LuoWen.CrossCleanup', 9]] },
];

const BY_ID = new Map();
for (const group of SETTINGS_GROUPS) {
  for (const [id, rank] of group.items) {
    BY_ID.set(id, { label: group.label, band: group.band, category: ['LuoWen', group.label, id.split('.').pop()], sortOrder: group.band + rank });
  }
}

// 运行时用：非登记的 id 直接抛错，避免新增设置时漏排/静默落到别的组
export function layoutOf(id) {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`[LuoWen] 设置项未登记在 settings-layout: ${id}`);
  return { category: entry.category, sortOrder: entry.sortOrder };
}

// 由表生成设置投影，供单测断言（与运行时同一份数据）
export function settingsFromLayout() {
  return SETTINGS_GROUPS.flatMap((group) => group.items.map(([id]) => ({ id, ...layoutOf(id) })));
}

// 镜像宿主算法：组内取最大 sortOrder 降序排组、并列按组名 localeCompare；组内按 sortOrder 降序
export function settingsPanelOrder(settings) {
  const groups = new Map();
  for (const setting of settings) {
    const parts = setting.category?.length ? setting.category : String(setting.id).split('.');
    const label = parts[1] ?? 'Other';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(setting);
  }
  const groupOrder = (items) => Math.max(0, ...items.map((setting) => setting.sortOrder ?? 0));
  return [...groups.entries()]
    .sort((a, b) => {
      const diff = groupOrder(b[1]) - groupOrder(a[1]);
      return diff !== 0 ? diff : a[0].localeCompare(b[0]);
    })
    .map(([label, items]) => ({
      label,
      settings: [...items].sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0)),
    }));
}

// 带区不变量检查：返回越区/未登记项，空数组即通过
export function bandViolations(settings) {
  const violations = [];
  for (const setting of settings) {
    const label = setting.category?.[1];
    const group = SETTINGS_GROUPS.find((candidate) => candidate.label === label);
    const sortOrder = setting.sortOrder ?? 0;
    if (!group) violations.push({ id: setting.id, label, sortOrder, reason: 'unknown-group' });
    else if (sortOrder < group.band || sortOrder >= group.band + 100) {
      violations.push({ id: setting.id, label, sortOrder, reason: 'out-of-band' });
    }
  }
  return violations;
}
