import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_GROUPS, layoutOf, settingsFromLayout, settingsPanelOrder, bandViolations } from '../../luowen/web/settings-layout.js';

// 期望页序（DEC-066）：门控先于依赖 → 常驻视觉先于按需工具 → 稳定先于实验 → 组内宏观先于微观
const EXPECTED = [
  ['基础', ['LuoWen.Enabled', 'LuoWen.SnapAlign', 'LuoWen.Language']],
  ['线路外观', ['LuoWen.WireStyle', 'LuoWen.NodeAvoidance', 'LuoWen.Chamfer', 'LuoWen.CornerRadius', 'LuoWen.BrotherSpacing']],
  ['连线配色', ['LuoWen.ColorTheme', 'LuoWen.ColorTheme.Scope']],
  [
    '自动布局',
    [
      'LuoWen.AutoLayout.ComponentLayout',
      'LuoWen.AutoLayout.ColumnAlign',
      'LuoWen.AutoLayout.LayerGap',
      'LuoWen.AutoLayout.InlineGap',
      'LuoWen.AutoLayout.NodeGap',
      'LuoWen.AutoLayout.CollapseNotes',
      'LuoWen.AutoLayout.Button',
    ],
  ],
  ['动效', ['LuoWen.FlowAnim', 'LuoWen.AnimMode', 'LuoWen.FlowStyle', 'LuoWen.DisableAnimOnRun']],
  ['动效·光束', ['LuoWen.BeamSpeed', 'LuoWen.BeamLen', 'LuoWen.BeamSpacing']],
  ['动效·虚线', ['LuoWen.DashSpeed', 'LuoWen.DashLen', 'LuoWen.DashGap']],
  ['实验', ['LuoWen.CrossCleanup']],
];

test('settingsOrder: 宿主算法下的页序与期望表逐项相等', () => {
  const actual = settingsPanelOrder(settingsFromLayout()).map((group) => [group.label, group.settings.map((setting) => setting.id)]);
  assert.deepEqual(actual, EXPECTED);
});

test('settingsOrder: 每组编号落在自己的百位区，组最大值互不相同（不依赖 localeCompare 兜底）', () => {
  const settings = settingsFromLayout();
  assert.deepEqual(bandViolations(settings), []);
  const maxima = settingsPanelOrder(settings).map((group) => Math.max(...group.settings.map((setting) => setting.sortOrder)));
  assert.equal(new Set(maxima).size, maxima.length, `组最大值应两两不同：${maxima.join(',')}`);
});

test('settingsOrder: 越区或未登记的编号会被抓出来（检查非空转）', () => {
  const settings = settingsFromLayout();
  const leaked = settings.map((setting) => (setting.id === 'LuoWen.SnapAlign' ? { ...setting, sortOrder: 8999 } : setting));
  const violations = bandViolations(leaked);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].id, 'LuoWen.SnapAlign');
  assert.equal(violations[0].reason, 'out-of-band');

  const orphan = [...settings, { id: 'LuoWen.Unregistered', category: ['LuoWen', '未登记组', 'Unregistered'], sortOrder: 8001 }];
  const orphanViolations = bandViolations(orphan);
  assert.equal(orphanViolations.length, 1, '未登记组也要报');
  assert.equal(orphanViolations[0].reason, 'unknown-group');
  assert.throws(() => layoutOf('LuoWen.Unregistered'), /未登记/);
});

test('settingsOrder: 同组分类唯一键不重复（否则宿主把同组设置折叠成一条）', () => {
  const seen = new Map();
  for (const group of SETTINGS_GROUPS) {
    const keys = group.items.map(([id]) => layoutOf(id).category[2]);
    assert.equal(new Set(keys).size, keys.length, `${group.label} 存在重复唯一键：${keys.join(',')}`);
    for (const key of keys) {
      const owner = `${group.label}/${key}`;
      assert.equal(seen.has(owner), false, `唯一键撞车：${owner}`);
      seen.set(owner, true);
    }
  }
  const ids = SETTINGS_GROUPS.flatMap((group) => group.items.map(([id]) => id));
  assert.equal(ids.length, 28, '登记项数 = 运行时注册数');
  assert.equal(new Set(ids).size, 28, 'id 无重复');
});
