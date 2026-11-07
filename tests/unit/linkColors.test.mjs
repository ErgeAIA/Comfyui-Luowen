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
