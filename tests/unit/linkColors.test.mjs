import test from 'node:test';
import assert from 'node:assert/strict';
import { setTheme, getTheme, listThemes, resolveLinkColor, flowParams, themeInfo } from '../../luowen/web/colors/linkColors.js';

test('linkColors: 主题关闭（默认）→ resolve 返回 null，适配器回退原取色链', () => {
  setTheme(null);
  assert.equal(getTheme(), null);
  assert.equal(resolveLinkColor({ type: 'CLIP' }), null);
  assert.equal(resolveLinkColor({ type: 'ANYTHING' }), null);
  assert.equal(flowParams({ enabled: true, scale: 1 }), null, '主题关闭时流向动效一并无效');
});

test('linkColors: 两套主题内置，62 类映射齐全，hex 格式合法', () => {
  assert.deepEqual(listThemes().sort(), ['luowen-cyberpunk', 'luowen-dark']);
  for (const id of listThemes()) {
    setTheme(id);
    const info = themeInfo();
    assert.equal(info.typeCount, 62, `${id} 显式映射 62 类`);
    assert.ok(info.context && info.context.canvas && info.context.card);
    for (const [type, hex] of Object.entries(info && resolveTypes(id))) {
      assert.ok(/^#[0-9A-F]{6}$/.test(hex), `${id}.${type} = ${hex} 应为 #RRGGBB`);
    }
  }
});

function resolveTypes(id) {
  // 通过 62 类逐类 resolve 拿到映射（不直接 import materialized，走公开口径）
  setTheme(id);
  const out = {};
  const types = requireMaterialized(id).types;
  for (const t of Object.keys(types)) out[t] = resolveLinkColor({ type: t });
  return out;
}

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function requireMaterialized(id) {
  const all = require('../../luowen/web/colors/materialized.js');
  return all.THEMES[id];
}

test('linkColors: 显式映射命中（CLIP/LATENT/MODEL）与 token 层产物逐值一致', () => {
  setTheme('luowen-dark');
  const mat = requireMaterialized('luowen-dark');
  for (const t of ['CLIP', 'LATENT', 'MODEL', 'IMAGE', 'STRING', '*']) {
    assert.equal(resolveLinkColor({ type: t }), mat.types[t], `${t} 应与 verify.mjs 产物一致`);
  }
  // 未映射但可正则归纳的新类型（宿主升级长尾）：走 typeRules，不落 unknown
  const ruleHit = resolveLinkColor({ type: 'SOME_NEW_CONTROL_NET' });
  assert.ok(ruleHit && ruleHit !== mat.tokens['link.unknown'], 'NEW_CONTROL_NET 应命中 conditioning/长尾规则而非 unknown');
  // 完全无语义类型 → link.unknown（显式中性，不是没配置）
  assert.equal(resolveLinkColor({ type: 'NLFPRED' }), mat.tokens['link.unknown']);
  // 缺 type 字段 → unknown
  assert.equal(resolveLinkColor({}), mat.tokens['link.unknown']);
  setTheme('luowen-cyberpunk');
  assert.equal(resolveLinkColor({ type: 'CLIP' }), requireMaterialized('luowen-cyberpunk').types.CLIP, 'cyberpunk 同口径');
});

test('linkColors: 流向动效门槛——enabled/reduced-motion/缩放三重闸门', () => {
  setTheme('luowen-dark');
  assert.equal(flowParams({ enabled: false, scale: 1 }), null, '默认关闭');
  const on = flowParams({ enabled: true, scale: 1 });
  assert.ok(on && on.dash === 7 && on.gap === 13 && on.speed === 48 && on.opacity === 0.92, 'token flow 参数透传');
  assert.equal(on.period, 20);
  assert.equal(flowParams({ enabled: true, scale: 1, reducedMotion: true }), null, 'reduced-motion 强制实线');
  assert.equal(flowParams({ enabled: true, scale: 0.4 }), null, '缩放 ≤0.4 强制实线');
  assert.ok(flowParams({ enabled: true, scale: 0.41 }), '0.41 放行');
});

test('linkColors.shouldAnimate: 三模式 × 生成时禁用 × 外部闸门', async () => {
  const { shouldAnimate } = await import('../../luowen/web/colors/linkColors.js');
  const link = { origin_id: 62, target_id: 67 };
  const base = { mode: 'all', link, enabled: true, scale: 1 };
  // 主题与动效解耦（用户反馈：主题关不该静默灭掉动效）
  setTheme(null);
  assert.equal(shouldAnimate(base), true, '主题关闭时动效照常（描边回退原取色链）');
  setTheme('luowen-dark');
  assert.equal(shouldAnimate(base), true, 'all 模式：启用即动');
  // selected：命中/未命中
  assert.equal(shouldAnimate({ ...base, mode: 'selected', selectedIds: new Set(['67']) }), true, '选中端点命中');
  assert.equal(shouldAnimate({ ...base, mode: 'selected', selectedIds: new Set(['70']) }), false, '未触及选中节点');
  assert.equal(shouldAnimate({ ...base, mode: 'selected', selectedIds: new Set() }), false, '无选中不动');
  // executing：执行节点命中/未命中/空闲
  assert.equal(shouldAnimate({ ...base, mode: 'executing', executingNode: '62' }), true);
  assert.equal(shouldAnimate({ ...base, mode: 'executing', executingNode: '70' }), false);
  assert.equal(shouldAnimate({ ...base, mode: 'executing', executingNode: null }), false, '空闲零动画');
  // 生成时禁用开关：优先于一切模式
  assert.equal(shouldAnimate({ ...base, queueRunning: true, disableAnimOnRun: true }), false, '运行中全停');
  assert.equal(shouldAnimate({ ...base, mode: 'executing', executingNode: '62', queueRunning: true, disableAnimOnRun: true }), false, '开关赢过执行模式');
  assert.equal(shouldAnimate({ ...base, queueRunning: true, disableAnimOnRun: false }), true, '显式关闭开关则运行中仍动');
  // 外部闸门
  assert.equal(shouldAnimate({ ...base, reducedMotion: true }), false);
  assert.equal(shouldAnimate({ ...base, hostAnimationsDisabled: true }), false, '宿主禁用动画=开 → 我方停');
  assert.equal(shouldAnimate({ ...base, scale: 0.4 }), false, '缩放 0.4 停');
  assert.equal(shouldAnimate({ ...base, scale: 0.41 }), true);
});

test('linkColors.dashOffset: 屏幕恒速——不同缩放下单位时间的屏幕位移一致', async () => {
  const { dashOffset } = await import('../../luowen/web/colors/linkColors.js');
  // dt=1ms：保证最小缩放(0.2)下图坐标位移(1px) < 周期(20px)，不发生采样混叠
  const now = 5000, dt = 1, speed = 200, period = 20;
  const screenDelta = (scale) => {
    const a = dashOffset({ now, speed, scale, period });
    const b = dashOffset({ now: now + dt, speed, scale, period });
    let d = Math.abs(a - b) % period;
    if (d > period / 2) d = period - d;
    return d * scale; // 相位差为图坐标位移，×scale = 屏幕位移
  };
  const expect = (speed * dt) / 1000; // 屏幕恒速口径：200px/s × 1ms = 0.2 屏幕像素
  for (const scale of [1.0, 0.9, 0.5, 0.2]) {
    const got = screenDelta(scale);
    assert.ok(Math.abs(got - expect) < 1e-6, `${scale} 缩放屏幕位移 ${got.toFixed(4)} ≈ ${expect}`);
  }
  assert.equal(dashOffset({ now: 0, speed: 200, scale: 0.02, period: 20 }), 0, '极小缩放钳制下限不发散');
});
